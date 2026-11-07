use crate::{
    db::{Db, Location},
    error::{Error, Result},
    onvif::Camera,
    protocol::*,
    secrets::Secrets,
    storage::Storage,
};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{RwLock, watch};
use uuid::Uuid;

#[derive(Clone)]
pub struct Config {
    pub root: PathBuf,
    pub production: bool,
    pub socket: PathBuf,
}
impl Config {
    pub fn load() -> Result<Self> {
        let production = std::env::var("CYBEROS_ENVIRONMENT").as_deref() == Ok("production");
        let root = std::env::var_os("CYBEROS_ROOT")
            .map(PathBuf::from)
            .unwrap_or(if production {
                PathBuf::from("/cyberos")
            } else {
                std::env::current_dir()?.join(".cyberos/dev-root")
            });
        if !root.is_absolute()
            || root == Path::new("/")
            || production && root != Path::new("/cyberos")
        {
            return Err(Error::invalid("Invalid CyberOS root"));
        }
        let socket = if production {
            PathBuf::from("/run/cyberos/nvr.sock")
        } else {
            root.join("state/nvr.sock")
        };
        Ok(Self {
            root,
            production,
            socket,
        })
    }
}
pub struct Session {
    pub public: NvrSession,
    pub touched: tokio::time::Instant,
    pub segments: Vec<String>,
    pub directory: Option<PathBuf>,
    pub process: Option<tokio::process::Child>,
}
pub struct State {
    pub config: Config,
    pub db: Db,
    pub secrets: Secrets,
    pub cameras: RwLock<HashMap<String, Camera>>,
    pub sessions: RwLock<HashMap<String, Session>>,
    pub ptz_locks: RwLock<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    pub ptz_generation: RwLock<HashMap<String, u64>>,
    pub active_streams: std::sync::Mutex<HashMap<String, usize>>,
}
impl State {
    pub fn new(config: Config) -> Result<Arc<Self>> {
        let db = Db::open(&config.root.join("state/cyberos.sqlite"))?;
        let secrets = Secrets::new(&config.root.join("state/secrets/nvr"))?;
        Ok(Arc::new(Self {
            config,
            db,
            secrets,
            cameras: RwLock::new(HashMap::new()),
            sessions: RwLock::new(HashMap::new()),
            ptz_locks: RwLock::new(HashMap::new()),
            ptz_generation: RwLock::new(HashMap::new()),
            active_streams: Default::default(),
        }))
    }
    pub async fn camera(&self, id: &str) -> Result<Camera> {
        let d = self.db.device(id)?;
        if d.removed_at.is_some() {
            return Err(Error::not_found());
        }
        self.cameras
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| Error::unavailable("Camera is disconnected"))
    }
    pub fn storage(&self, location: &Location) -> Result<Storage> {
        let s = Storage::open_existing(
            &self.config.root.join("data"),
            &location.pool,
            &location.directory,
            self.config.production,
        )?;
        if s.identity() != (location.device, location.inode) {
            return Err(Error::unavailable("Recording storage identity changed"));
        }
        Ok(s)
    }
    pub fn selected_storage(&self, id: &str) -> Result<(Storage, Location)> {
        let policy = self.db.policy()?;
        policy.validate()?;
        let pool = policy.storage_pool_id.ok_or_else(|| {
            Error::conflict("Select a mounted storage pool before enabling recording")
        })?;
        let directory = format!(
            "{}/{}",
            policy.directory,
            Uuid::parse_str(id).map_err(|_| Error::invalid("Invalid device UUID"))?
        );
        let s = Storage::open(
            &self.config.root.join("data"),
            &pool,
            &directory,
            self.config.production,
        )?;
        let (device, inode) = s.identity();
        Ok((
            s,
            Location {
                pool,
                directory,
                device,
                inode,
            },
        ))
    }
    pub async fn supervise(self: Arc<Self>, mut shutdown: watch::Receiver<bool>) {
        let mut workers: HashMap<String, (watch::Sender<bool>, tokio::task::JoinHandle<()>)> =
            HashMap::new();
        loop {
            if *shutdown.borrow() {
                break;
            }
            if let Ok(devices) = self.db.devices() {
                let active: Vec<_> = devices
                    .iter()
                    .filter(|d| d.removed_at.is_none())
                    .map(|d| d.id.clone())
                    .collect();
                let removed: Vec<_> = workers
                    .keys()
                    .filter(|id| !active.contains(id))
                    .cloned()
                    .collect();
                for id in removed {
                    if let Some((stop, task)) = workers.remove(&id) {
                        let _ = stop.send(true);
                        let _ = task.await;
                    }
                    self.cameras.write().await.remove(&id);
                }
                for id in active {
                    workers.entry(id.clone()).or_insert_with(|| {
                        let (stop, rx) = watch::channel(false);
                        let state = self.clone();
                        (
                            stop,
                            tokio::spawn(async move {
                                state.worker(id, rx).await;
                            }),
                        )
                    });
                }
            }
            self.expire_sessions().await;
            if let Err(e) = crate::recording::cleanup(&self).await {
                tracing::warn!(reason=%e.message,"NVR retention paused");
            }
            tokio::select! {_=tokio::time::sleep(Duration::from_secs(2))=>{}, _=shutdown.changed()=>{}}
        }
        for (stop, _) in workers.values() {
            let _ = stop.send(true);
        }
        for (_, (_, task)) in workers {
            let _ = task.await;
        }
        let mut sessions = self.sessions.write().await;
        for (_, s) in sessions.iter_mut() {
            if let Some(child) = &mut s.process {
                let _ = child.kill().await;
            }
        }
    }
    async fn worker(self: Arc<Self>, id: String, stop: watch::Receiver<bool>) {
        let state = self.clone();
        let health_id = id.clone();
        let health_stop = stop.clone();
        let health = async move {
            state.health_loop(&health_id, health_stop).await;
        };
        let record = crate::recording::record_loop(self.clone(), id.clone(), stop.clone());
        let events = crate::events::event_loop(self.clone(), id.clone(), stop);
        tokio::join!(health, record, events);
    }
    async fn health_loop(&self, id: &str, mut stop: watch::Receiver<bool>) {
        while !*stop.borrow() {
            let result = async {
                let device = self.db.device(id)?;
                let credentials = self.secrets.load(id)?;
                let info =
                    Camera::connect(&device.onvif_url, credentials, self.config.production).await?;
                if info.id != id {
                    return Err(Error::conflict("Camera identity changed at this address"));
                }
                let video = if let Some(profile) = info.profiles.iter().find(|p| p.token == "raw") {
                    if info.camera.snapshot(&profile.snapshot_uri).await.is_ok() {
                        "available"
                    } else {
                        "unavailable"
                    }
                } else {
                    "unavailable"
                };
                self.db.update(id, |d| {
                    d.connection = "connected".into();
                    d.video = video.into();
                    d.profiles = info.profiles;
                    if d.recording != "paused" {
                        d.last_error = None;
                    }
                })?;
                let ptz = info.camera.ptz_status().await;
                self.db.update(id, |d| {
                    d.ptz = match ptz {
                        Ok(status) => status.state,
                        Err(_) => "unavailable".into(),
                    }
                })?;
                self.cameras.write().await.insert(id.into(), info.camera);
                Ok::<_, Error>(())
            }
            .await;
            if let Err(error) = result {
                self.cameras.write().await.remove(id);
                let _ = self.db.update(id, |d| {
                    d.connection = "disconnected".into();
                    d.video = "unavailable".into();
                    d.ptz = "unavailable".into();
                    d.last_error = Some(error.message);
                });
            }
            tokio::select! {_=tokio::time::sleep(Duration::from_secs(15))=>{}, _=stop.changed()=>{}}
        }
        if let Ok(camera) = self.camera(id).await {
            let _ = camera.ptz_command(&NvrPtzCommand::Stop).await;
        }
    }
    pub async fn expire_sessions(&self) {
        let mut sessions = self.sessions.write().await;
        let expired: Vec<_> = sessions
            .iter()
            .filter(|(_, s)| s.touched.elapsed() > Duration::from_secs(90))
            .map(|(id, _)| id.clone())
            .collect();
        for id in expired {
            if let Some(mut s) = sessions.remove(&id) {
                if let Some(p) = &mut s.process {
                    let _ = p.kill().await;
                }
                if let Some(dir) = s.directory {
                    let _ = tokio::fs::remove_dir_all(dir).await;
                }
            }
        }
    }
}
