use std::path::PathBuf;
use std::time::Duration;

use cyberos_terminald::config::Account;
use cyberos_terminald::{pty, tmux::TmuxManager};
use nix::unistd::{Gid, Uid, User};
use tokio::time::{MissedTickBehavior, interval, timeout};

#[tokio::test]
async fn attaches_to_a_real_tmux_session_through_a_pty() {
    let directory = tempfile::tempdir().unwrap();
    let _cleanup = TmuxCleanup(directory.path().join("tmux.sock"));
    let account = Account {
        name: std::env::var("USER").unwrap_or_else(|_| "cyberos-test".to_owned()),
        uid: Uid::current().as_raw(),
        gid: Gid::current().as_raw(),
        home: directory.path().to_owned(),
        shell: PathBuf::from("/bin/sh"),
    };
    let manager = TmuxManager::new(directory.path().join("tmux.sock"), account, 4);
    if manager.ensure_available().await.is_err() {
        eprintln!("tmux is unavailable; skipping tmux PTY integration test");
        return;
    }

    let session = "cyberos-integration";
    manager.ensure_session(session, true).await.unwrap();
    assert_eq!(
        session_status(&directory.path().join("tmux.sock"), session),
        "off"
    );
    let mut process = pty::spawn(manager.attach_command(session), 120, 32).unwrap();
    pty::write_all(&process.master, b"printf 'terminal-integration-ready\\n'\r")
        .await
        .unwrap();

    let output = timeout(Duration::from_secs(5), async {
        let mut output = Vec::new();
        let mut buffer = [0_u8; 4096];
        while !String::from_utf8_lossy(&output).contains("terminal-integration-ready") {
            let count = pty::read_chunk(&process.master, &mut buffer).await.unwrap();
            if count == 0 {
                break;
            }
            output.extend_from_slice(&buffer[..count]);
        }
        output
    })
    .await
    .expect("timed out waiting for tmux PTY output");

    assert!(String::from_utf8_lossy(&output).contains("terminal-integration-ready"));
    pty::resize(&process.master, 101, 37).unwrap();
    manager.resize(session, 101, 37).await.unwrap();
    let resized_output = timeout(Duration::from_secs(5), async {
        let mut output = Vec::new();
        let mut buffer = [0_u8; 4096];
        let mut probe = interval(Duration::from_millis(100));
        probe.set_missed_tick_behavior(MissedTickBehavior::Skip);
        loop {
            tokio::select! {
                _ = probe.tick() => {
                    pty::write_all(
                        &process.master,
                        b"printf 'terminal-resize:'; stty size; printf ':done\\n'\r",
                    )
                    .await
                    .unwrap();
                }
                result = pty::read_chunk(&process.master, &mut buffer) => {
                    let count = result.unwrap();
                    if count == 0 {
                        break;
                    }
                    output.extend_from_slice(&buffer[..count]);
                    if String::from_utf8_lossy(&output).contains("terminal-resize:37 101") {
                        break;
                    }
                }
            }
        }
        output
    })
    .await
    .expect("timed out waiting for resized tmux PTY output");
    assert!(
        String::from_utf8_lossy(&resized_output).contains("terminal-resize:37 101"),
        "resized output: {:?}",
        String::from_utf8_lossy(&resized_output)
    );
    manager.destroy(session).await.unwrap();
    pty::terminate(&mut process.child).await;
}

#[tokio::test]
async fn starts_in_account_home_and_preserves_shell_and_directory_on_reattach() {
    let directory = tempfile::tempdir().unwrap();
    let home = directory.path().canonicalize().unwrap();
    let user = User::from_uid(Uid::current()).unwrap().unwrap();
    let account = Account {
        name: user.name.clone(),
        uid: Uid::current().as_raw(),
        gid: Gid::current().as_raw(),
        home: home.clone(),
        shell: PathBuf::from("/bin/bash"),
    };
    std::fs::create_dir(home.join(".cyberos")).unwrap();
    let socket = home.join(".cyberos/tmux.sock");
    let _cleanup = TmuxCleanup(socket.clone());
    let manager = TmuxManager::new(socket.clone(), account.clone(), 4);
    if manager.ensure_available().await.is_err() {
        eprintln!("tmux is unavailable; skipping terminal home integration test");
        return;
    }

    let session = "cyberos-home-integration";
    manager.ensure_session(session, true).await.unwrap();
    let mut process = pty::spawn(manager.attach_command(session), 120, 32).unwrap();
    pty::write_all(
        &process.master,
        b"set +H; printf '%s\\n' \"$(id -u)\" \"$(id -un)\" \"$USER\" \"$LOGNAME\" \"$HOME\" \"$PWD\" \"$SHELL\" \"$$\" > \"$HOME/initial\"; cd /; cd ~; pwd >> \"$HOME/initial\"\r",
    )
    .await
    .unwrap();
    let initial = read_probe(&home.join("initial"), 9, &process).await;
    assert_eq!(initial[0], Uid::current().as_raw().to_string());
    assert_eq!(&initial[1..4], &[user.name.as_str(); 3]);
    assert_eq!(&initial[4..6], &[home.to_str().unwrap(); 2]);
    assert_eq!(initial[6], "/bin/bash");
    assert_eq!(initial[8], home.to_str().unwrap());

    pty::write_all(
        &process.master,
        b"mkdir -p \"$HOME/work\"; cd \"$HOME/work\"; sleep 60 & CYBEROS_TEST_CHILD=$!; printf '%s\\n' \"$PWD\" \"$CYBEROS_TEST_CHILD\" > \"$HOME/before-detach\"\r",
    )
    .await
    .unwrap();
    let before = read_probe(&home.join("before-detach"), 2, &process).await;
    assert_eq!(before[0], home.join("work").to_str().unwrap());
    pty::terminate(&mut process.child).await;

    // A new manager models a daemon restart; ensure_session must attach to
    // the existing shell rather than reset its directory or environment.
    assert!(
        std::process::Command::new("tmux")
            .arg("-S")
            .arg(&socket)
            .args(["set-option", "-t", session, "status", "on"])
            .status()
            .unwrap()
            .success()
    );
    let restarted = TmuxManager::new(socket, account, 4);
    restarted.ensure_session(session, true).await.unwrap();
    assert_eq!(
        session_status(&home.join(".cyberos/tmux.sock"), session),
        "off"
    );
    let mut reattached = pty::spawn(restarted.attach_command(session), 120, 32).unwrap();
    pty::write_all(
        &reattached.master,
        b"printf '%s\\n' \"$$\" \"$PWD\" \"$HOME\" \"$CYBEROS_TEST_CHILD\" > \"$HOME/reattached\"; if kill -0 \"$CYBEROS_TEST_CHILD\"; then printf 'alive\\n' >> \"$HOME/reattached\"; fi; kill \"$CYBEROS_TEST_CHILD\"\r",
    )
    .await
    .unwrap();
    let after = read_probe(&home.join("reattached"), 5, &reattached).await;
    assert_eq!(after[0], initial[7]);
    assert_eq!(after[1], before[0]);
    assert_eq!(after[2], home.to_str().unwrap());
    assert_eq!(after[3], before[1]);
    assert_eq!(after[4], "alive");
    restarted.destroy(session).await.unwrap();
    pty::terminate(&mut reattached.child).await;
}

async fn read_probe(
    path: &std::path::Path,
    lines: usize,
    process: &pty::PtyProcess,
) -> Vec<String> {
    let mut output = Vec::new();
    timeout(Duration::from_secs(5), async {
        let mut probe = interval(Duration::from_millis(10));
        let mut buffer = [0_u8; 4096];
        loop {
            tokio::select! {
                _ = probe.tick() => {
                    if let Ok(content) = tokio::fs::read_to_string(path).await {
                        let values: Vec<String> = content.lines().map(str::to_owned).collect();
                        if content.ends_with('\n') && values.len() == lines {
                            return values;
                        }
                    }
                }
                result = pty::read_chunk(&process.master, &mut buffer) => {
                    let count = result.unwrap();
                    output.extend_from_slice(&buffer[..count]);
                }
            }
        }
    })
    .await
    .unwrap_or_else(|_| {
        panic!(
            "timed out waiting for shell probe {}: {}",
            path.display(),
            String::from_utf8_lossy(&output)
        )
    })
}

struct TmuxCleanup(PathBuf);

#[tokio::test]
async fn hides_only_managed_session_status_without_changing_other_tmux_sessions() {
    let directory = tempfile::tempdir().unwrap();
    let socket = directory.path().join("tmux.sock");
    let _cleanup = TmuxCleanup(socket.clone());
    let account = Account {
        name: std::env::var("USER").unwrap_or_else(|_| "cyberos-test".to_owned()),
        uid: Uid::current().as_raw(),
        gid: Gid::current().as_raw(),
        home: directory.path().to_owned(),
        shell: PathBuf::from("/bin/sh"),
    };
    let manager = TmuxManager::new(socket.clone(), account, 4);
    if manager.ensure_available().await.is_err() {
        eprintln!("tmux is unavailable; skipping managed status integration test");
        return;
    }
    manager
        .ensure_session("cyberos-managed", true)
        .await
        .unwrap();
    for arguments in [
        vec!["new-session", "-d", "-s", "user-owned"],
        vec!["set-option", "-t", "user-owned", "status", "on"],
        vec!["set-option", "-t", "cyberos-managed", "status", "on"],
    ] {
        assert!(
            std::process::Command::new("tmux")
                .arg("-S")
                .arg(&socket)
                .args(arguments)
                .status()
                .unwrap()
                .success()
        );
    }
    manager
        .ensure_session("cyberos-managed", true)
        .await
        .unwrap();
    assert_eq!(session_status(&socket, "cyberos-managed"), "off");
    assert_eq!(session_status(&socket, "user-owned"), "on");
}

fn session_status(socket: &std::path::Path, session: &str) -> String {
    let output = std::process::Command::new("tmux")
        .arg("-S")
        .arg(socket)
        .args(["show-options", "-v", "-t", session, "status"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap().trim().to_owned()
}

impl Drop for TmuxCleanup {
    fn drop(&mut self) {
        let _ = std::process::Command::new("tmux")
            .arg("-S")
            .arg(&self.0)
            .arg("kill-server")
            .output();
    }
}
