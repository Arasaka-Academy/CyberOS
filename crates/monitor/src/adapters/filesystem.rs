use std::fs::{File, OpenOptions};
use std::io;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

use nix::sys::statvfs::{Statvfs, fstatvfs};

/// Samples a held directory, requiring a visible exact pool mount on Linux.
pub(super) fn pool_capacity(path: &Path) -> io::Result<Statvfs> {
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_DIRECTORY | nix::libc::O_NOFOLLOW | nix::libc::O_CLOEXEC)
        .open(path)?;
    let canonical = std::fs::canonicalize(path)?;
    let held = file.metadata()?;
    let visible = std::fs::symlink_metadata(path)?;
    if visible.file_type().is_symlink()
        || (visible.dev(), visible.ino()) != (held.dev(), held.ino())
    {
        return Err(io::Error::other("storage pool changed while opening"));
    }
    verify_mount(&file, &canonical)?;
    let stats = fstatvfs(&file)?;
    // Recheck after the sample so an unmount/replacement cannot publish a stale identity.
    let visible = std::fs::symlink_metadata(path)?;
    if (visible.dev(), visible.ino()) != (held.dev(), held.ino()) {
        return Err(io::Error::other("storage pool changed while sampling"));
    }
    verify_mount(&file, &canonical)?;
    Ok(stats)
}

#[cfg(target_os = "linux")]
fn verify_mount(file: &File, path: &Path) -> io::Result<()> {
    use std::os::fd::AsRawFd;
    let info = std::fs::read_to_string(format!("/proc/self/fdinfo/{}", file.as_raw_fd()))?;
    let id = info
        .lines()
        .find_map(|line| line.strip_prefix("mnt_id:").map(str::trim))
        .ok_or_else(|| io::Error::other("storage pool mount id is unavailable"))?;
    let mountinfo = std::fs::read_to_string("/proc/self/mountinfo")?;
    if exact_mount(&mountinfo, path, id) {
        Ok(())
    } else {
        Err(io::Error::other("storage pool is not mounted"))
    }
}

#[cfg(not(target_os = "linux"))]
fn verify_mount(_file: &File, _path: &Path) -> io::Result<()> {
    Err(io::Error::other(
        "storage pool mount verification requires Linux",
    ))
}

#[cfg(any(target_os = "linux", test))]
fn exact_mount(mountinfo: &str, path: &Path, mount_id: &str) -> bool {
    mountinfo.lines().any(|line| {
        let fields = line.split_whitespace().take(5).collect::<Vec<_>>();
        fields.first() == Some(&mount_id)
            && fields.get(4).is_some_and(|field| {
                let decoded = field
                    .replace("\\040", " ")
                    .replace("\\011", "\t")
                    .replace("\\012", "\n")
                    .replace("\\134", "\\");
                Path::new(&decoded) == path
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn matches_exact_path_and_visible_mount_id() {
        let info = "22 1 8:1 / / rw - ext4 /dev/root rw\n23 22 8:2 / /data/My\\040Pool rw - ext4 /dev/data rw\n";
        assert!(exact_mount(info, Path::new("/data/My Pool"), "23"));
        assert!(!exact_mount(info, Path::new("/data/My Pool"), "22"));
        assert!(!exact_mount(info, Path::new("/data/My Pool/subdir"), "23"));
    }
}
