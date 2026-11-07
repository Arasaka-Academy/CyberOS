use crate::{
    error::{Error, Result},
    onvif::Credentials,
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
};
use uuid::Uuid;
pub struct Secrets(PathBuf);
impl Secrets {
    pub fn new(path: &Path) -> Result<Self> {
        fs::create_dir_all(path)?;
        if fs::symlink_metadata(path)?.file_type().is_symlink() {
            return Err(Error::unavailable("Unsafe NVR secrets directory"));
        }
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
        Ok(Self(path.into()))
    }
    fn path(&self, id: &str) -> Result<PathBuf> {
        let id = Uuid::parse_str(id).map_err(|_| Error::invalid("Invalid device UUID"))?;
        Ok(self.0.join(format!("{id}.json")))
    }
    pub fn save(&self, id: &str, credentials: &Credentials) -> Result<()> {
        if credentials.username.is_empty()
            || credentials.username.len() > 256
            || credentials.password.is_empty()
            || credentials.password.len() > 4096
        {
            return Err(Error::invalid("Camera username and password are required"));
        }
        let destination = self.path(id)?;
        let temporary = self.0.join(format!("{}.tmp", Uuid::new_v4()));
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(nix::libc::O_NOFOLLOW)
            .open(&temporary)?;
        let bytes =
            serde_json::to_vec(credentials).map_err(|_| Error::invalid("Invalid credentials"))?;
        file.write_all(&bytes)?;
        file.sync_all()?;
        fs::rename(temporary, destination)?;
        std::fs::File::open(&self.0)?.sync_all()?;
        Ok(())
    }
    pub fn load(&self, id: &str) -> Result<Credentials> {
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(nix::libc::O_NOFOLLOW)
            .open(self.path(id)?)?;
        if file.metadata()?.len() > 16384 {
            return Err(Error::unavailable("Invalid credential file"));
        }
        serde_json::from_reader(file)
            .map_err(|_| Error::unavailable("Camera credentials unavailable"))
    }
    pub fn remove(&self, id: &str) -> Result<()> {
        match fs::remove_file(self.path(id)?) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(e) => Err(e.into()),
        }
    }
}
