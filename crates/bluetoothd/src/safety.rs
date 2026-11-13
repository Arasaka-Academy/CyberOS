use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};

use nix::fcntl::{OFlag, openat};
use nix::sys::stat::Mode;
use nix::sys::statvfs::statvfs;

use crate::error::TransferError;

pub fn open_send_file(root: &Path, relative: &str) -> Result<(File, PathBuf), TransferError> {
    validate_relative(relative)?;
    let mut directory = OpenOptions::new()
        .read(true)
        .custom_flags(nix::libc::O_DIRECTORY | nix::libc::O_NOFOLLOW | nix::libc::O_CLOEXEC)
        .open(root)?;
    let mut components = Path::new(relative).components().peekable();
    while let Some(component) = components.next() {
        let flags = if components.peek().is_some() {
            OFlag::O_DIRECTORY
        } else {
            OFlag::empty()
        };
        directory = File::from(
            openat(
                &directory,
                component.as_os_str(),
                OFlag::O_RDONLY | OFlag::O_NOFOLLOW | OFlag::O_CLOEXEC | OFlag::O_NONBLOCK | flags,
                Mode::empty(),
            )
            .map_err(|error| TransferError(error.to_string()))?,
        );
    }
    let file = directory;
    if !file.metadata()?.is_file() {
        return Err(TransferError(
            "Bluetooth transfer source is not a file".to_owned(),
        ));
    }
    Ok((file, root.join(relative)))
}

/// An immutable send snapshot kept alive until OBEX has finished reading its pathname.
pub(crate) struct StagedSend {
    directory: PrivateDirectory,
    path: PathBuf,
}

impl StagedSend {
    pub(crate) fn prepare(
        root: &Path,
        relative: &str,
        outbox: &Path,
    ) -> Result<Self, TransferError> {
        let (source, _) = open_send_file(root, relative)?;
        let before = source.metadata()?;
        let name = Path::new(relative)
            .file_name()
            .ok_or_else(|| TransferError("Invalid Bluetooth source name".into()))?;
        let directory = PrivateDirectory::new(outbox, "send")?;
        let path = directory.path().join(name);
        ensure_available_space(directory.path(), before.len())?;
        let mut target = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)?;
        // Cap the copy at the initial size so a growing source cannot fill the state disk.
        let mut bounded = source.take(before.len());
        let copied = std::io::copy(&mut bounded, &mut target)?;
        let after = bounded.get_ref().metadata()?;
        if copied != before.len()
            || (
                before.dev(),
                before.ino(),
                before.len(),
                before.mtime(),
                before.mtime_nsec(),
                before.ctime(),
                before.ctime_nsec(),
            ) != (
                after.dev(),
                after.ino(),
                after.len(),
                after.mtime(),
                after.mtime_nsec(),
                after.ctime(),
                after.ctime_nsec(),
            )
        {
            return Err(TransferError(
                "Bluetooth source changed while staging".into(),
            ));
        }
        target.flush()?;
        Ok(Self { directory, path })
    }

    pub(crate) fn path(&self) -> &Path {
        debug_assert!(self.path.starts_with(self.directory.path()));
        &self.path
    }
}

/// Owns a newly created 0700 directory; only this service identity can traverse it.
pub(crate) struct PrivateDirectory(PathBuf);

impl PrivateDirectory {
    pub(crate) fn new(parent: &Path, prefix: &str) -> std::io::Result<Self> {
        use std::os::unix::fs::DirBuilderExt;
        let path = parent.join(format!("{prefix}-{}", uuid::Uuid::new_v4()));
        std::fs::DirBuilder::new().mode(0o700).create(&path)?;
        Ok(Self(path))
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for PrivateDirectory {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.0)
            && error.kind() != std::io::ErrorKind::NotFound
        {
            tracing::warn!(%error, "failed to remove Bluetooth staging directory");
        }
    }
}

pub fn storage_pool_path(
    data_root: &Path,
    storage_pool_id: &str,
    require_mount: bool,
) -> Result<PathBuf, TransferError> {
    let id = Path::new(storage_pool_id);
    if storage_pool_id.is_empty()
        || id.is_absolute()
        || id.components().count() != 1
        || !matches!(id.components().next(), Some(Component::Normal(_)))
    {
        return Err(TransferError(
            "Invalid Bluetooth storage pool id".to_owned(),
        ));
    }
    let data_root = std::fs::canonicalize(data_root)
        .map_err(|_| TransferError("CyberOS data root is unavailable".to_owned()))?;
    let requested = data_root.join(id);
    let metadata = std::fs::symlink_metadata(&requested)
        .map_err(|_| TransferError("Bluetooth storage pool is unavailable".to_owned()))?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(TransferError(
            "Bluetooth storage pool must be a real directory".to_owned(),
        ));
    }
    let pool = std::fs::canonicalize(&requested)
        .map_err(|_| TransferError("Bluetooth storage pool is unavailable".to_owned()))?;
    if pool != requested {
        return Err(TransferError(
            "Bluetooth storage pool is not a direct child of the CyberOS data root".to_owned(),
        ));
    }
    require_exact_mountpoint(&pool, require_mount)?;
    Ok(pool)
}

fn require_exact_mountpoint(_path: &Path, required: bool) -> Result<(), TransferError> {
    if !required {
        return Ok(());
    }
    #[cfg(target_os = "linux")]
    {
        let mountinfo = std::fs::read_to_string("/proc/self/mountinfo")?;
        if has_exact_mountpoint(&mountinfo, _path) {
            return Ok(());
        }
    }
    Err(TransferError(
        "Bluetooth storage pool is not mounted".to_owned(),
    ))
}

#[cfg(any(target_os = "linux", test))]
fn has_exact_mountpoint(mountinfo: &str, path: &Path) -> bool {
    mountinfo.lines().any(|line| {
        line.split_whitespace()
            .nth(4)
            .map(unescape_mount_field)
            .is_some_and(|mountpoint| Path::new(&mountpoint) == path)
    })
}

#[cfg(any(target_os = "linux", test))]
fn unescape_mount_field(value: &str) -> String {
    value
        .replace("\\040", " ")
        .replace("\\011", "\t")
        .replace("\\012", "\n")
        .replace("\\134", "\\")
}

pub fn ensure_available_space(directory: &Path, required: u64) -> Result<(), TransferError> {
    if required == 0 {
        return Ok(());
    }
    let stats = statvfs(directory).map_err(|error| TransferError(error.to_string()))?;
    let available =
        u128::from(stats.blocks_available()).saturating_mul(u128::from(stats.fragment_size()));
    if available < u128::from(required) {
        return Err(TransferError(
            "Bluetooth inbox does not have enough free space".to_owned(),
        ));
    }
    Ok(())
}

pub fn validate_receive_name(requested_name: &str) -> Result<&str, TransferError> {
    Path::new(requested_name)
        .file_name()
        .and_then(|value| value.to_str())
        .filter(|value| {
            !value.is_empty() && *value != "." && *value != ".." && *value == requested_name
        })
        .ok_or_else(|| TransferError("Invalid received file name".to_owned()))
}

pub fn safe_existing(root: &Path, relative: &str) -> Result<PathBuf, TransferError> {
    validate_relative(relative)?;
    let root = std::fs::canonicalize(root)
        .map_err(|_| TransferError("Storage pool is unavailable".to_owned()))?;
    let requested = root.join(relative);
    reject_symlinks(&root, &requested)?;
    let real = std::fs::canonicalize(&requested)
        .map_err(|_| TransferError("Bluetooth transfer path is unavailable".to_owned()))?;
    if !real.starts_with(&root) {
        return Err(TransferError(
            "Bluetooth transfer path escaped the storage pool".to_owned(),
        ));
    }
    Ok(real)
}

fn validate_relative(value: &str) -> Result<(), TransferError> {
    if value == "." {
        return Ok(());
    }
    let path = Path::new(value);
    if value.is_empty()
        || value.contains('\0')
        || path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(TransferError(
            "Bluetooth transfer path must stay inside the storage pool".to_owned(),
        ));
    }
    Ok(())
}

fn reject_symlinks(root: &Path, target: &Path) -> Result<(), TransferError> {
    let relative = target.strip_prefix(root).map_err(|_| {
        TransferError("Bluetooth transfer path escaped the storage pool".to_owned())
    })?;
    let mut current = root.to_path_buf();
    for component in relative.components() {
        current.push(component);
        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(TransferError(
                    "Refusing Bluetooth transfer through a symlink".to_owned(),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_send_survives_source_path_replacement_and_cleans_up() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().expect("temporary root");
        let pool = root.path().join("pool");
        let outbox = root.path().join("outbox");
        std::fs::create_dir(&pool).expect("pool");
        std::fs::create_dir(&outbox).expect("outbox");
        std::fs::write(pool.join("send.txt"), b"allowed").expect("source");
        let outside = root.path().join("outside.txt");
        std::fs::write(&outside, b"outside pool").expect("outside file");
        let staged = StagedSend::prepare(&pool, "send.txt", &outbox).expect("staged send");
        let path = staged.path().to_path_buf();
        std::fs::remove_file(pool.join("send.txt")).expect("remove source");
        std::os::unix::fs::symlink(&outside, pool.join("send.txt")).expect("replace source");
        assert_eq!(std::fs::read(&path).expect("OBEX payload"), b"allowed");
        assert_eq!(
            std::fs::metadata(path.parent().expect("staging directory"))
                .expect("permissions")
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert!(StagedSend::prepare(&pool, "send.txt", &outbox).is_err());
        drop(staged);
        assert!(!path.exists(), "staging must not outlive the transfer");
        std::os::unix::fs::symlink(root.path(), pool.join("nested")).expect("directory symlink");
        assert!(open_send_file(&pool, "nested/outside.txt").is_err());
    }

    #[test]
    fn rejects_fifo_without_waiting_for_a_writer() {
        use std::os::unix::fs::OpenOptionsExt;
        use std::{sync::mpsc, time::Duration};

        let root = tempfile::tempdir().expect("temporary pool");
        let path = root.path().join("fifo");
        nix::unistd::mkfifo(&path, nix::sys::stat::Mode::S_IRWXU).expect("test FIFO");
        let base = root.path().to_path_buf();
        let (tx, rx) = mpsc::channel();
        let reader = std::thread::spawn(move || {
            tx.send(open_send_file(&base, "fifo").is_err())
                .expect("send open result");
        });
        let result = rx.recv_timeout(Duration::from_secs(1));
        let _writer = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(nix::libc::O_NONBLOCK)
            .open(path)
            .expect("FIFO cleanup");
        reader.join().expect("FIFO reader thread");
        assert!(result.expect("opening a FIFO must not block"));
    }

    #[test]
    fn allows_the_pool_root_as_an_inbox_but_not_as_a_send_file() {
        let directory = tempfile::tempdir().unwrap();
        assert_eq!(
            safe_existing(directory.path(), ".").unwrap(),
            directory.path().canonicalize().unwrap()
        );
        assert!(open_send_file(directory.path(), ".").is_err());
        assert!(safe_existing(directory.path(), "").is_err());
        assert!(safe_existing(directory.path(), "/").is_err());
        assert!(safe_existing(directory.path(), "./..").is_err());
    }

    #[test]
    fn rejects_traversal_symlinks_and_unsafe_receive_names() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join("inbox")).unwrap();
        assert!(safe_existing(directory.path(), "../outside").is_err());
        std::os::unix::fs::symlink("inbox", directory.path().join("link")).unwrap();
        assert!(safe_existing(directory.path(), "link").is_err());
        assert_eq!(validate_receive_name("file.txt").unwrap(), "file.txt");
        assert!(validate_receive_name("../file.txt").is_err());
        assert!(validate_receive_name("nested/file.txt").is_err());
    }

    #[test]
    fn resolves_only_single_component_pools_beneath_the_data_root() {
        let directory = tempfile::tempdir().unwrap();
        let data_root = directory.path().join("data");
        let pool = data_root.join("media");
        std::fs::create_dir_all(&pool).unwrap();
        assert_eq!(
            storage_pool_path(&data_root, "media", false).unwrap(),
            pool.canonicalize().unwrap()
        );
        assert!(storage_pool_path(&data_root, "../media", false).is_err());
        assert!(storage_pool_path(&data_root, "missing", false).is_err());
    }

    #[test]
    fn recognizes_only_the_exact_pool_mountpoint() {
        let mountinfo = concat!(
            "22 1 8:1 / / rw - ext4 /dev/root rw\n",
            "23 22 8:2 / /cyberos/data/My\\040Pool rw - ext4 /dev/sda1 rw\n",
        );
        assert!(has_exact_mountpoint(
            mountinfo,
            Path::new("/cyberos/data/My Pool")
        ));
        assert!(!has_exact_mountpoint(
            mountinfo,
            Path::new("/cyberos/data/My Pool/inbox")
        ));
    }
}
