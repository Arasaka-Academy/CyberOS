/**
 * [INPUT]: 读取固定运行锁文件及播放器的隔离运行配置。
 * [OUTPUT]: 在输出重配期间拒绝播放；用共享锁保护命令与恢复。
 * [POS]: 与宿主 TV 脚本共用内核锁，不依赖 API 或播放器进程寿命。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use std::fs::{File, OpenOptions};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

use nix::fcntl::{Flock, FlockArg};

use crate::config::VodPlayerConfig;
use crate::error::{ErrorCode, VodError};

const LOCK_PATH: &str = "/run/cyberos-tv-output.lock";

pub(crate) fn shared(config: &VodPlayerConfig) -> Result<Flock<File>, VodError> {
    let path = if config.production {
        LOCK_PATH.into()
    } else {
        config.socket_path.with_file_name("tv-output.lock")
    };
    lock(&path, config.production)
}

fn conflict(message: impl Into<String>) -> VodError {
    VodError::new(ErrorCode::SessionConflict, message, 409)
}

fn lock(path: &Path, production: bool) -> Result<Flock<File>, VodError> {
    // 生产 inode 由 tmpfiles 创建；只读打开且拒绝符号链接。
    let file = OpenOptions::new()
        .read(true)
        .write(!production)
        .create(!production)
        .truncate(false)
        .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK)
        .open(path)
        .map_err(|error| conflict(format!("TV output lock is unavailable: {error}")))?;
    let metadata = file
        .metadata()
        .map_err(|error| conflict(format!("TV output lock cannot be inspected: {error}")))?;
    if !metadata.is_file() || (production && (metadata.uid() != 0 || metadata.mode() & 0o022 != 0))
    {
        return Err(conflict(
            "TV output lock has unsafe ownership or permissions",
        ));
    }
    Flock::lock(file, FlockArg::LockSharedNonblock).map_err(|(_, error)| {
        if error == nix::errno::Errno::EWOULDBLOCK {
            conflict("TV output is being reconfigured; retry after it completes")
        } else {
            conflict(format!("TV output cannot be locked: {error}"))
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;

    #[test]
    fn production_lock_is_never_created_and_symlinks_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing.lock");
        assert_eq!(
            lock(&path, true).unwrap_err().code,
            ErrorCode::SessionConflict
        );
        assert!(!path.exists());
        let target = directory.path().join("target.lock");
        std::fs::write(&target, []).unwrap();
        symlink(&target, &path).unwrap();
        assert_eq!(
            lock(&path, false).unwrap_err().code,
            ErrorCode::SessionConflict
        );
        assert_eq!(
            lock(directory.path(), false).unwrap_err().code,
            ErrorCode::SessionConflict
        );
    }
}
