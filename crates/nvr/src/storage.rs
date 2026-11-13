use crate::error::{Error, Result};
use nix::{
    fcntl::{OFlag, openat},
    sys::stat::{Mode, mkdirat},
};
use std::fs::{File, OpenOptions};
#[cfg(target_os = "linux")]
use std::os::fd::AsRawFd;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Component, Path, PathBuf};

pub fn validate_pool(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return Err(Error::invalid("Invalid storage pool"));
    }
    Ok(())
}
pub fn validate_relative(value: &str) -> Result<()> {
    if value.is_empty()
        || value.len() > 2048
        || value.contains(['\\', '\0', '\n', '\r'])
        || Path::new(value)
            .components()
            .any(|c| !matches!(c, Component::Normal(_)))
    {
        return Err(Error::invalid(
            "A relative path within the storage pool is required",
        ));
    }
    Ok(())
}
pub struct Storage {
    pool: File,
    directory: File,
    pool_path: PathBuf,
    path: PathBuf,
    pool_identity: (u64, u64),
    directory_identity: (u64, u64),
    mount_id: Option<String>,
}
fn identity(file: &File) -> Result<(u64, u64)> {
    let m = file.metadata()?;
    Ok((m.dev(), m.ino()))
}
fn mount_id(path: &Path) -> Result<Option<String>> {
    #[cfg(target_os = "linux")]
    {
        let encoded = path
            .to_string_lossy()
            .replace('\\', "\\134")
            .replace(' ', "\\040")
            .replace('\t', "\\011")
            .replace('\n', "\\012");
        for line in std::fs::read_to_string("/proc/self/mountinfo")?.lines() {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.get(4) == Some(&encoded.as_str()) {
                return Ok(fields.first().map(|s| (*s).to_owned()));
            }
        }
    }
    #[cfg(not(target_os = "linux"))]
    let _ = path;
    Ok(None)
}
impl Storage {
    pub fn open(root: &Path, pool: &str, relative: &str, require_mount: bool) -> Result<Self> {
        Self::open_mode(root, pool, relative, require_mount, true)
    }
    pub fn open_existing(
        root: &Path,
        pool: &str,
        relative: &str,
        require_mount: bool,
    ) -> Result<Self> {
        Self::open_mode(root, pool, relative, require_mount, false)
    }
    fn open_mode(
        root: &Path,
        pool: &str,
        relative: &str,
        require_mount: bool,
        create: bool,
    ) -> Result<Self> {
        validate_pool(pool)?;
        validate_relative(relative)?;
        let root = std::fs::canonicalize(root)?;
        let pool_path = root.join(pool);
        if std::fs::symlink_metadata(&pool_path)?
            .file_type()
            .is_symlink()
            || std::fs::canonicalize(&pool_path)? != pool_path
        {
            return Err(Error::unavailable(
                "Storage pool must be a real mount directory",
            ));
        }
        let mount_id = mount_id(&pool_path)?;
        if require_mount && mount_id.is_none() {
            return Err(Error::unavailable("Selected storage pool is not mounted"));
        }
        let pool = OpenOptions::new()
            .read(true)
            .custom_flags(nix::libc::O_DIRECTORY | nix::libc::O_NOFOLLOW | nix::libc::O_CLOEXEC)
            .open(&pool_path)?;
        let mut directory = pool.try_clone()?;
        for component in Path::new(relative).components() {
            let name = component.as_os_str();
            if create {
                match mkdirat(&directory, name, Mode::from_bits_truncate(0o700)) {
                    Ok(()) | Err(nix::errno::Errno::EEXIST) => {}
                    Err(_) => {
                        return Err(Error::unavailable("Cannot create NVR storage directory"));
                    }
                }
            }
            let fd = openat(
                &directory,
                name,
                OFlag::O_RDONLY | OFlag::O_DIRECTORY | OFlag::O_NOFOLLOW | OFlag::O_CLOEXEC,
                Mode::empty(),
            )
            .map_err(|_| Error::unavailable("NVR directory contains an unsafe path"))?;
            directory = File::from(fd);
        }
        let pool_identity = identity(&pool)?;
        let directory_identity = identity(&directory)?;
        let storage = Self {
            pool,
            directory,
            path: pool_path.join(relative),
            pool_path,
            pool_identity,
            directory_identity,
            mount_id,
        };
        storage.verify()?;
        Ok(storage)
    }
    pub fn verify(&self) -> Result<()> {
        let p = std::fs::symlink_metadata(&self.pool_path)?;
        let d = std::fs::symlink_metadata(&self.path)?;
        if p.file_type().is_symlink()
            || d.file_type().is_symlink()
            || (p.dev(), p.ino()) != self.pool_identity
            || (d.dev(), d.ino()) != self.directory_identity
            || identity(&self.pool)? != self.pool_identity
            || mount_id(&self.pool_path)? != self.mount_id
        {
            return Err(Error::unavailable("Storage mount or NVR directory changed"));
        }
        if std::fs::canonicalize(&self.path)? != self.path {
            return Err(Error::unavailable("NVR path changed"));
        }
        Ok(())
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn identity(&self) -> (u64, u64) {
        self.directory_identity
    }
    pub fn working_directory(&self) -> PathBuf {
        #[cfg(target_os = "linux")]
        {
            PathBuf::from(format!("/proc/self/fd/{}", self.directory.as_raw_fd()))
        }
        #[cfg(not(target_os = "linux"))]
        {
            self.path.clone()
        }
    }
    fn file_if_present(&self, name: &str, flags: OFlag) -> Result<Option<File>> {
        self.verify()?;
        validate_relative(name)?;
        if Path::new(name).components().count() != 1 {
            return Err(Error::invalid("Invalid segment filename"));
        }
        let fd = match openat(
            &self.directory,
            name,
            flags | OFlag::O_NOFOLLOW | OFlag::O_CLOEXEC | OFlag::O_NONBLOCK,
            Mode::from_bits_truncate(0o600),
        ) {
            Ok(fd) => fd,
            Err(nix::errno::Errno::ENOENT) => {
                // Only a missing leaf is recoverable; a removed mount/directory is not.
                self.verify()?;
                return Ok(None);
            }
            Err(_) => return Err(Error::unavailable("NVR segment unavailable")),
        };
        let file = File::from(fd);
        if !file.metadata()?.is_file() {
            return Err(Error::unavailable("NVR segment is not a regular file"));
        }
        Ok(Some(file))
    }
    fn file(&self, name: &str, flags: OFlag) -> Result<File> {
        self.file_if_present(name, flags)?
            .ok_or_else(|| Error::unavailable("NVR segment unavailable"))
    }
    pub fn create(&self, name: &str) -> Result<File> {
        self.file(name, OFlag::O_WRONLY | OFlag::O_CREAT | OFlag::O_EXCL)
    }
    pub fn open_file(&self, name: &str) -> Result<File> {
        self.file(name, OFlag::O_RDONLY)
    }
    pub fn remove(&self, name: &str) -> Result<()> {
        let _file = self.open_file(name)?;
        nix::unistd::unlinkat(
            &self.directory,
            name,
            nix::unistd::UnlinkatFlags::NoRemoveDir,
        )
        .map_err(|_| Error::unavailable("Cannot remove NVR segment"))?;
        Ok(())
    }
    pub fn remove_if_present(&self, name: &str) -> Result<bool> {
        let Some(_file) = self.file_if_present(name, OFlag::O_RDONLY)? else {
            return Ok(false);
        };
        match nix::unistd::unlinkat(
            &self.directory,
            name,
            nix::unistd::UnlinkatFlags::NoRemoveDir,
        ) {
            Ok(()) => Ok(true),
            Err(nix::errno::Errno::ENOENT) => {
                self.verify()?;
                Ok(false)
            }
            Err(_) => Err(Error::unavailable("Cannot remove NVR segment")),
        }
    }
    pub fn segment_if_present(&self, segment: &crate::db::Segment) -> Result<Option<File>> {
        let Some(file) = self.file_if_present(&segment.filename, OFlag::O_RDONLY)? else {
            return Ok(None);
        };
        if Some(identity(&file)?) != segment.file_identity
            || file.metadata()?.len() != segment.public.size_bytes
        {
            return Err(Error::unavailable("Recording changed outside NVR"));
        }
        Ok(Some(file))
    }
    pub fn segment(&self, segment: &crate::db::Segment) -> Result<File> {
        let file = self.open_file(&segment.filename)?;
        if Some(identity(&file)?) != segment.file_identity
            || file.metadata()?.len() != segment.public.size_bytes
        {
            return Err(Error::unavailable("Recording changed outside NVR"));
        }
        Ok(file)
    }
    pub fn available_bytes(&self) -> Result<u64> {
        self.verify()?;
        let v = nix::sys::statvfs::fstatvfs(&self.directory)
            .map_err(|_| Error::unavailable("Storage capacity unavailable"))?;
        #[cfg(target_os = "linux")]
        let blocks = v.blocks_available();
        #[cfg(not(target_os = "linux"))]
        let blocks = u64::from(v.blocks_available());
        Ok(blocks.saturating_mul(v.fragment_size()))
    }
}
