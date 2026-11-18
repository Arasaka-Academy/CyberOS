/**
 * [INPUT]: 读取 mpv 的 Linux PCM 描述符和 ALSA 只读控制项。
 * [OUTPUT]: 给出实际音频路由，不修改或重新打开播放设备。
 * [POS]: 播放控制器的硬件证据边界；设备名称不参与判断。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use crate::protocol::ActualAudioRouteKind;

#[cfg(target_os = "linux")]
#[path = "audio_route_alsa.rs"]
mod alsa;

pub(crate) fn detect(pid: u32, known_bluetooth: bool) -> ActualAudioRouteKind {
    if known_bluetooth {
        return ActualAudioRouteKind::Bluetooth;
    }
    #[cfg(target_os = "linux")]
    {
        detect_linux(std::path::Path::new("/proc"), pid)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = pid;
        ActualAudioRouteKind::Unknown
    }
}

#[cfg(target_os = "linux")]
fn detect_linux(proc: &std::path::Path, pid: u32) -> ActualAudioRouteKind {
    let Some(pcms) = opened_pcms(proc, pid) else {
        return ActualAudioRouteKind::Unknown;
    };
    if pcms.is_empty() {
        // PulseAudio, PipeWire and other servers hide the hardware endpoint.
        return ActualAudioRouteKind::Unknown;
    }
    let mut result = ActualAudioRouteKind::Local;
    for pcm in pcms {
        let Some(controls) = alsa::eld_controls(pcm.card) else {
            return ActualAudioRouteKind::Unknown;
        };
        if controls.is_empty() && usb_transport(std::path::Path::new("/sys"), pcm) {
            continue;
        }
        match classify_pcm(pcm, &controls) {
            ActualAudioRouteKind::Hdmi => return ActualAudioRouteKind::Hdmi,
            ActualAudioRouteKind::Local => {}
            kind => result = kind,
        }
    }
    result
}

#[cfg(any(target_os = "linux", test))]
fn usb_transport(sys: &std::path::Path, pcm: Pcm) -> bool {
    let Ok(path) = sys
        .join(format!("class/sound/pcmC{}D{}p", pcm.card, pcm.device))
        .canonicalize()
    else {
        return false;
    };
    path.ancestors().any(|ancestor| {
        std::fs::read_link(ancestor.join("subsystem"))
            .ok()
            .is_some_and(|subsystem| subsystem.file_name() == Some(std::ffi::OsStr::new("usb")))
    })
}

#[cfg(any(target_os = "linux", test))]
fn pcm_device(path: &str) -> Option<(u32, u32)> {
    let device = path.strip_prefix("/dev/snd/pcmC")?.strip_suffix('p')?;
    let (card, device) = device.split_once('D')?;
    Some((card.parse().ok()?, device.parse().ok()?))
}

#[cfg(any(target_os = "linux", test))]
fn opened_pcms(proc: &std::path::Path, pid: u32) -> Option<Vec<Pcm>> {
    let mut result = Vec::new();
    // ALSA can record the mpv audio thread's TID rather than its process leader.
    let mut owners = vec![pid];
    if let Ok(threads) = std::fs::read_dir(proc.join(format!("{pid}/task"))) {
        owners.extend(
            threads.filter_map(|entry| entry.ok()?.file_name().to_str()?.parse::<u32>().ok()),
        );
    }
    for entry in std::fs::read_dir(proc.join(pid.to_string()).join("fd")).ok()? {
        let target = std::fs::read_link(entry.ok()?.path()).ok()?;
        let Some((card, device)) = pcm_device(target.to_str()?) else {
            continue;
        };
        let pcm_dir = proc.join(format!("asound/card{card}/pcm{device}p"));
        let mut matched = false;
        for sub in std::fs::read_dir(pcm_dir).ok()? {
            let sub = sub.ok()?;
            let name = sub.file_name();
            let Some(subdevice) = name
                .to_str()
                .and_then(|name| name.strip_prefix("sub"))
                .and_then(|value| value.parse().ok())
            else {
                continue;
            };
            let status = std::fs::read_to_string(sub.path().join("status")).ok()?;
            if status.lines().any(|line| {
                line.split_once(':').is_some_and(|(key, value)| {
                    key.trim() == "owner_pid"
                        && value
                            .trim()
                            .parse::<u32>()
                            .is_ok_and(|owner| owners.contains(&owner))
                })
            }) {
                result.push(Pcm {
                    card,
                    device,
                    subdevice,
                });
                matched = true;
            }
        }
        if !matched {
            return None;
        }
    }
    result.sort_by_key(|pcm| (pcm.card, pcm.device, pcm.subdevice));
    result.dedup();
    Some(result)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[cfg(any(target_os = "linux", test))]
struct Pcm {
    card: u32,
    device: u32,
    subdevice: u32,
}

#[derive(Debug)]
#[cfg(any(target_os = "linux", test))]
struct Eld {
    device: u32,
    subdevice: u32,
    valid: bool,
}

#[cfg(any(target_os = "linux", test))]
fn classify_pcm(pcm: Pcm, controls: &[Eld]) -> ActualAudioRouteKind {
    if let Some(eld) = controls
        .iter()
        .find(|eld| eld.device == pcm.device && eld.subdevice == pcm.subdevice)
    {
        if eld.valid {
            ActualAudioRouteKind::Hdmi
        } else {
            ActualAudioRouteKind::Unavailable
        }
    } else if controls.iter().any(|eld| eld.device == pcm.device) {
        ActualAudioRouteKind::Unknown
    } else if !controls.is_empty() {
        ActualAudioRouteKind::Local
    } else {
        ActualAudioRouteKind::Unknown
    }
}

#[cfg(any(target_os = "linux", test))]
fn valid_eld(bytes: &[u8]) -> bool {
    if bytes.len() < 20 || bytes[0] >> 3 != 2 {
        return false;
    }
    let baseline = usize::from(bytes[2]) * 4;
    let required = 20 + usize::from(bytes[4] & 31) + usize::from(bytes[5] >> 4) * 3;
    baseline >= required && baseline <= bytes.len()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_open_pcm_and_exact_subdevice_can_prove_hdmi() {
        let pcm = Pcm {
            card: 0,
            device: 1,
            subdevice: 0,
        };
        assert_eq!(classify_pcm(pcm, &[]), ActualAudioRouteKind::Unknown);
        let other = Eld {
            device: 0,
            subdevice: 0,
            valid: true,
        };
        assert_eq!(classify_pcm(pcm, &[other]), ActualAudioRouteKind::Local);
        let wrong_subdevice = Eld {
            device: 1,
            subdevice: 1,
            valid: true,
        };
        assert_eq!(
            classify_pcm(pcm, &[wrong_subdevice]),
            ActualAudioRouteKind::Unknown
        );
        let exact = Eld {
            device: 1,
            subdevice: 0,
            valid: true,
        };
        assert_eq!(classify_pcm(pcm, &[exact]), ActualAudioRouteKind::Hdmi);
        let unplugged = Eld {
            device: 1,
            subdevice: 0,
            valid: false,
        };
        assert_eq!(
            classify_pcm(pcm, &[unplugged]),
            ActualAudioRouteKind::Unavailable
        );
    }

    #[test]
    fn zero_or_truncated_eld_never_proves_a_sink() {
        assert!(!valid_eld(&[0; 256]));
        assert!(!valid_eld(&[0x10, 0, 0]));
        let mut eld = [0; 256];
        eld[0] = 2 << 3;
        eld[2] = 5;
        assert!(valid_eld(&eld));
        eld[4] = 16;
        assert!(!valid_eld(&eld));
    }

    #[test]
    fn pcm_paths_are_evidence_not_device_labels() {
        assert_eq!(pcm_device("/dev/snd/pcmC2D10p"), Some((2, 10)));
        for path in [
            "default",
            "alsa/hdmi:CARD=vc4hdmi0",
            "/dev/snd/pcmC0D0c",
            "/tmp/pcmC0D0p",
            "/dev/snd/pcmC0D0p (deleted)",
        ] {
            assert_eq!(pcm_device(path), None, "{path}");
        }
    }

    #[test]
    fn subdevice_must_belong_to_the_player_process() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let proc = temp.path();
        std::fs::create_dir_all(proc.join("123/fd")).unwrap();
        symlink("/dev/snd/pcmC2D3p", proc.join("123/fd/9")).unwrap();
        std::fs::create_dir_all(proc.join("asound/card2/pcm3p/sub1")).unwrap();
        let status = proc.join("asound/card2/pcm3p/sub1/status");
        std::fs::write(&status, "state: RUNNING\nowner_pid : 456\n").unwrap();
        assert_eq!(opened_pcms(proc, 123), None);
        std::fs::create_dir_all(proc.join("123/task/456")).unwrap();
        assert_eq!(
            opened_pcms(proc, 123),
            Some(vec![Pcm {
                card: 2,
                device: 3,
                subdevice: 1
            }])
        );
        std::fs::write(&status, "state: RUNNING\nowner_pid : 123\n").unwrap();
        assert_eq!(
            opened_pcms(proc, 123),
            Some(vec![Pcm {
                card: 2,
                device: 3,
                subdevice: 1
            }])
        );
    }

    #[test]
    fn usb_transport_uses_sysfs_ancestry_instead_of_pcm_names() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let sys = temp.path();
        let pcm = Pcm {
            card: 2,
            device: 0,
            subdevice: 0,
        };
        std::fs::create_dir_all(sys.join("class/sound")).unwrap();
        std::fs::create_dir_all(sys.join("devices/usb/sound/pcmC2D0p")).unwrap();
        symlink(
            sys.join("devices/usb/sound/pcmC2D0p"),
            sys.join("class/sound/pcmC2D0p"),
        )
        .unwrap();
        assert!(!usb_transport(sys, pcm));
        symlink("/sys/bus/usb", sys.join("devices/usb/subsystem")).unwrap();
        assert!(usb_transport(sys, pcm));
    }
}
