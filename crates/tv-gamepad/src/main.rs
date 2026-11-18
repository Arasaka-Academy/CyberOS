// [INPUT]: evdev 手柄、纯映射状态机与原生输入客户端。
// [OUTPUT]: 配对 KEY 按下/释放与手柄健康快照。
// [POS]: 服务入口；STATUS 预检不发送测试按键。
// [PROTOCOL]: Update this header on change, then check AGENTS.md
use std::collections::{HashMap, HashSet};
use std::env;
use std::ffi::OsStr;
use std::io;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::{Duration, Instant};

use cyberos_tv_gamepad::{
    AxisRange, CapabilityDescriptor, Health, InputEvent, InputHub, code, evaluate_health,
};
use evdev::{Device, EventSummary};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::{MissedTickBehavior, interval, timeout};
use tracing_subscriber::EnvFilter;

const SCAN_INTERVAL: Duration = Duration::from_secs(1);
const REPEAT_TICK: Duration = Duration::from_millis(20);
const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(5);
const INPUT_TIMEOUT: Duration = Duration::from_secs(2);
const EVENT_QUEUE_CAPACITY: usize = 256;
const INPUT_DIR: &str = "/dev/input";
const STATUS_WRITER: &str = "/usr/lib/cyberos/scripts/cyberos-tv-write-status";
const INPUT_HELPER: &str = "/usr/lib/cyberos/bin/cyberos-tv-input";

#[derive(Debug)]
struct ActiveDevice {
    generation: u64,
    task: JoinHandle<()>,
}

#[derive(Debug)]
enum ReaderMessage {
    Event {
        path: PathBuf,
        generation: u64,
        event: InputEvent,
    },
    Disconnected {
        path: PathBuf,
        generation: u64,
        detail: String,
    },
}

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info")),
        )
        .with_target(false)
        .init();

    if env::args_os().nth(1).is_some() {
        tracing::error!("usage: cyberos-tv-gamepad");
        return ExitCode::from(64);
    }
    match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(message = %error, "TV gamepad service stopped");
            ExitCode::FAILURE
        }
    }
}

async fn run() -> io::Result<()> {
    let input_dir = PathBuf::from(INPUT_DIR);
    let status_writer = PathBuf::from(STATUS_WRITER);
    let input_helper = PathBuf::from(INPUT_HELPER);
    let started = Instant::now();
    let (sender, mut receiver) = mpsc::channel(EVENT_QUEUE_CAPACITY);
    let mut active = HashMap::<PathBuf, ActiveDevice>::new();
    let mut hub = InputHub::default();
    let mut generation = 0_u64;
    let mut input_error = None;
    let mut injection_error = None;
    let mut scan_timer = interval(SCAN_INTERVAL);
    let mut repeat_timer = interval(REPEAT_TICK);
    let mut heartbeat_timer = interval(HEARTBEAT_INTERVAL);
    scan_timer.set_missed_tick_behavior(MissedTickBehavior::Skip);
    repeat_timer.set_missed_tick_behavior(MissedTickBehavior::Skip);
    heartbeat_timer.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = scan_timer.tick() => {
                let before = hub.held_keys();
                input_error = scan_devices(
                    &input_dir,
                    &mut active,
                    &mut hub,
                    &mut generation,
                    &sender,
                );
                for key in before.difference(&hub.held_keys()) {
                    injection_error = inject_key(&input_helper, key, false).await.err().map(|error| error.to_string());
                }
            }
            _ = repeat_timer.tick() => {
                for key in hub.repeat(started.elapsed()) {
                    injection_error = inject_key(&input_helper, key, true).await.err().map(|error| error.to_string());
                }
            }
            _ = heartbeat_timer.tick() => {
                let preflight_error = runtime_preflight(&input_helper).await;
                write_health(
                    &status_writer,
                    evaluate_health(
                        hub.connected_count(),
                        injection_error.as_deref().or(preflight_error.as_deref()),
                        input_error.as_deref(),
                    ),
                ).await;
            }
            message = receiver.recv() => {
                let Some(message) = message else { return Ok(()); };
                match message {
                    ReaderMessage::Event { path, generation: event_generation, event } => {
                        if active.get(&path).is_some_and(|device| device.generation == event_generation) {
                            let id = path.to_string_lossy();
                            let before = hub.held_keys();
                            hub.handle(&id, event, started.elapsed());
                            let after = hub.held_keys();
                            for key in before.difference(&after) {
                                injection_error = inject_key(&input_helper, key, false).await.err().map(|error| error.to_string());
                            }
                            for key in after.difference(&before) {
                                injection_error = inject_key(&input_helper, key, true).await.err().map(|error| error.to_string());
                            }
                        }
                    }
                    ReaderMessage::Disconnected { path, generation: event_generation, detail } => {
                        if active.get(&path).is_some_and(|device| device.generation == event_generation) {
                            tracing::info!(device = %path.display(), reason = %detail, "Gamepad disconnected");
                            active.remove(&path);
                            let before = hub.held_keys();
                            hub.disconnect(&path.to_string_lossy());
                            for key in before.difference(&hub.held_keys()) {
                                injection_error = inject_key(&input_helper, key, false).await.err().map(|error| error.to_string());
                            }
                        }
                    }
                }
            }
            signal = tokio::signal::ctrl_c() => {
                signal?;
                for device in active.values() {
                    device.task.abort();
                }
                return Ok(());
            }
        }
    }
}

fn scan_devices(
    input_dir: &Path,
    active: &mut HashMap<PathBuf, ActiveDevice>,
    hub: &mut InputHub,
    generation: &mut u64,
    sender: &mpsc::Sender<ReaderMessage>,
) -> Option<String> {
    let entries = match std::fs::read_dir(input_dir) {
        Ok(entries) => entries,
        Err(error) => return Some(format!("Cannot scan {}: {error}", input_dir.display())),
    };
    let mut present = HashSet::new();
    let mut permission_error = None;
    for entry in entries.flatten() {
        let path = entry.path();
        if !path
            .file_name()
            .and_then(OsStr::to_str)
            .is_some_and(|name| name.starts_with("event"))
        {
            continue;
        }
        present.insert(path.clone());
        if active.contains_key(&path) {
            continue;
        }
        let device = match Device::open(&path) {
            Ok(device) => device,
            Err(error) => {
                if error.kind() == io::ErrorKind::PermissionDenied {
                    permission_error = Some(format!("Cannot read {}: {error}", path.display()));
                }
                continue;
            }
        };
        let capabilities = device_capabilities(&device);
        if !capabilities.is_supported_gamepad() {
            continue;
        }
        let ranges = device_axis_ranges(&device);
        *generation = generation.wrapping_add(1);
        let device_generation = *generation;
        let reader_sender = sender.clone();
        let reader_path = path.clone();
        let task = tokio::spawn(async move {
            read_device(device, reader_path, device_generation, reader_sender).await;
        });
        tracing::info!(device = %path.display(), "Supported gamepad connected");
        hub.connect(path.to_string_lossy(), ranges);
        active.insert(
            path,
            ActiveDevice {
                generation: device_generation,
                task,
            },
        );
    }

    let removed = active
        .keys()
        .filter(|path| !present.contains(*path))
        .cloned()
        .collect::<Vec<_>>();
    for path in removed {
        if let Some(device) = active.remove(&path) {
            device.task.abort();
        }
        hub.disconnect(&path.to_string_lossy());
    }
    permission_error
}

fn device_capabilities(device: &Device) -> CapabilityDescriptor {
    CapabilityDescriptor {
        keys: device
            .supported_keys()
            .into_iter()
            .flat_map(|keys| keys.iter().map(|key| key.0))
            .collect(),
        axes: device
            .supported_absolute_axes()
            .into_iter()
            .flat_map(|axes| axes.iter().map(|axis| axis.0))
            .collect(),
    }
}

fn device_axis_ranges(device: &Device) -> HashMap<u16, AxisRange> {
    let Ok(state) = device.get_abs_state() else {
        return HashMap::new();
    };
    device
        .supported_absolute_axes()
        .into_iter()
        .flat_map(|axes| axes.iter())
        .filter_map(|axis| {
            state.get(axis.0 as usize).map(|info| {
                (
                    axis.0,
                    AxisRange {
                        minimum: info.minimum,
                        maximum: info.maximum,
                    },
                )
            })
        })
        .collect()
}

async fn read_device(
    device: Device,
    path: PathBuf,
    generation: u64,
    sender: mpsc::Sender<ReaderMessage>,
) {
    let mut events = match device.into_event_stream() {
        Ok(events) => events,
        Err(error) => {
            let _ = sender
                .send(ReaderMessage::Disconnected {
                    path,
                    generation,
                    detail: error.to_string(),
                })
                .await;
            return;
        }
    };
    loop {
        let event = match events.next_event().await {
            Ok(event) => event,
            Err(error) => {
                let _ = sender
                    .send(ReaderMessage::Disconnected {
                        path,
                        generation,
                        detail: error.to_string(),
                    })
                    .await;
                return;
            }
        };
        let input = match event.destructure() {
            EventSummary::Key(_, key, value) => Some(InputEvent::Button { code: key.0, value }),
            EventSummary::AbsoluteAxis(_, axis, value)
                if matches!(
                    axis.0,
                    code::ABS_X | code::ABS_Y | code::ABS_HAT0X | code::ABS_HAT0Y
                ) =>
            {
                Some(InputEvent::Axis {
                    code: axis.0,
                    value,
                })
            }
            _ => None,
        };
        if let Some(input) = input
            && sender
                .send(ReaderMessage::Event {
                    path: path.clone(),
                    generation,
                    event: input,
                })
                .await
                .is_err()
        {
            return;
        }
    }
}

async fn runtime_preflight(input_helper: &Path) -> Option<String> {
    if !command_exists(input_helper) {
        return Some(format!("{} is not available", input_helper.display()));
    }
    if !Path::new("/run/cyberos-tv/display.sock").exists() {
        return Some("Native TV display input is not available".to_owned());
    }
    let mut probe = Command::new(input_helper);
    probe.kill_on_drop(true).arg("probe");
    match timeout(INPUT_TIMEOUT, probe.output()).await {
        Ok(Ok(output)) if output.status.success() => None,
        _ => Some("Native TV input is not available".to_owned()),
    }
}

fn command_exists(command: &Path) -> bool {
    if command.components().count() > 1 {
        return command.is_file();
    }
    env::var_os("PATH").is_some_and(|paths| {
        env::split_paths(&paths).any(|directory| directory.join(command).is_file())
    })
}

async fn inject_key(input_helper: &Path, key: &str, pressed: bool) -> io::Result<()> {
    let mut command = Command::new(input_helper);
    let code = match key {
        "Up" => "103",
        "Down" => "108",
        "Left" => "105",
        "Right" => "106",
        "Return" => "28",
        "Escape" => "1",
        "F6" => "64",
        "F7" => "65",
        "F8" => "66",
        "F9" => "67",
        "F10" => "68",
        _ => return Err(io::Error::other("Unsupported TV key")),
    };
    command
        .kill_on_drop(true)
        .args(["key", code, if pressed { "1" } else { "0" }]);
    let output = timeout(INPUT_TIMEOUT, command.output())
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "TV input timed out"))??;
    if output.status.success() {
        return Ok(());
    }
    let detail = String::from_utf8_lossy(&output.stderr).trim().to_owned();
    Err(io::Error::other(if detail.is_empty() {
        format!("TV input exited with {}", output.status)
    } else {
        format!("TV input failed: {detail}")
    }))
}

async fn write_health(status_writer: &Path, health: Health) {
    let (state, detail) = match health {
        Health::Ready(detail) => ("ready", detail),
        Health::Degraded(detail) => ("degraded", detail),
        Health::Unavailable(detail) => ("unavailable", detail),
    };
    match Command::new(status_writer)
        .args(["gamepad", state, &detail])
        .status()
        .await
    {
        Ok(status) if status.success() => {}
        Ok(status) => tracing::warn!(%status, "Could not write gamepad health"),
        Err(error) => tracing::warn!(%error, "Could not invoke TV status writer"),
    }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;

    use super::*;

    #[tokio::test]
    async fn input_failure_recovers_on_the_next_successful_injection() {
        let directory = tempfile::tempdir().unwrap();
        let command = directory.path().join("input_helper");
        std::fs::write(
            &command,
            "#!/bin/sh\nstate=\"$0.state\"\nif [ ! -e \"$state\" ]; then : > \"$state\"; exit 1; fi\nexit 0\n",
        )
        .unwrap();
        std::fs::set_permissions(&command, std::fs::Permissions::from_mode(0o755)).unwrap();

        assert!(inject_key(&command, "Return", true).await.is_err());
        assert!(inject_key(&command, "Return", true).await.is_ok());
    }
}
