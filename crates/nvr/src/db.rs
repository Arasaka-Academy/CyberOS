use crate::{
    error::{Error, Result},
    protocol::*,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::{path::Path, sync::Mutex, time::Duration};

pub struct Db(Mutex<Connection>);
#[derive(Clone, Serialize, Deserialize)]
pub struct Location {
    pub pool: String,
    pub directory: String,
    pub device: u64,
    pub inode: u64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Segment {
    pub public: NvrSegment,
    pub location: Location,
    pub filename: String,
    #[serde(default)]
    pub file_identity: Option<(u64, u64)>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub device_id: String,
    pub profile: String,
    pub started: i64,
    pub location: Location,
}
fn encode(value: &impl Serialize) -> Result<String> {
    serde_json::to_string(value).map_err(|_| Error::unavailable("NVR state cannot be serialized"))
}
fn decode<T: DeserializeOwned>(value: String) -> Result<T> {
    serde_json::from_str(&value).map_err(|_| Error::unavailable("NVR state is invalid"))
}
impl Db {
    pub fn open(path: &Path) -> Result<Self> {
        let conn = Connection::open_with_flags(
            path,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(Duration::from_secs(5))?;
        conn.query_row(
            "SELECT id FROM schema_migrations WHERE id='015_nvr'",
            [],
            |_| Ok(()),
        )
        .map_err(|_| Error::unavailable("NVR database migration is not installed"))?;
        Ok(Self(Mutex::new(conn)))
    }
    #[cfg(test)]
    pub fn memory() -> Self {
        let conn = Connection::open_in_memory().unwrap();
        let migration: serde_json::Value =
            serde_json::from_str(include_str!("../../../packages/db/src/migrations/nvr.json"))
                .unwrap();
        conn.execute_batch(migration["sql"].as_str().unwrap())
            .unwrap();
        Self(Mutex::new(conn))
    }
    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>> {
        self.0
            .lock()
            .map_err(|_| Error::unavailable("NVR database unavailable"))
    }
    pub fn devices(&self) -> Result<Vec<NvrDevice>> {
        let conn = self.lock()?;
        let mut statement = conn.prepare("SELECT document FROM nvr_devices ORDER BY id")?;
        statement
            .query_map([], |r| r.get::<_, String>(0))?
            .map(|v| decode(v?))
            .collect()
    }
    pub fn device(&self, id: &str) -> Result<NvrDevice> {
        self.devices()?
            .into_iter()
            .find(|d| d.id == id)
            .ok_or_else(Error::not_found)
    }
    pub fn add(&self, device: &NvrDevice) -> Result<()> {
        let mut conn = self.lock()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let mut statement = tx.prepare("SELECT document FROM nvr_devices")?;
        let entries: Vec<NvrDevice> = statement
            .query_map([], |r| r.get::<_, String>(0))?
            .map(|v| decode(v?))
            .collect::<Result<_>>()?;
        drop(statement);
        if entries
            .iter()
            .any(|d| d.id == device.id && d.removed_at.is_none())
        {
            return Err(Error::conflict("This device UUID is already registered"));
        }
        if entries.iter().filter(|d| d.removed_at.is_none()).count() >= 4 {
            return Err(Error::conflict("NVR supports up to four active devices"));
        }
        tx.execute("INSERT INTO nvr_devices(id,document) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET document=excluded.document", params![device.id,encode(device)?])?;
        tx.commit()?;
        Ok(())
    }
    pub fn save_device(&self, device: &NvrDevice) -> Result<()> {
        self.lock()?.execute(
            "UPDATE nvr_devices SET document=?2 WHERE id=?1",
            params![device.id, encode(device)?],
        )?;
        Ok(())
    }
    pub fn update(&self, id: &str, change: impl FnOnce(&mut NvrDevice)) -> Result<()> {
        let conn = self.lock()?;
        let raw = conn
            .query_row("SELECT document FROM nvr_devices WHERE id=?1", [id], |r| {
                r.get(0)
            })
            .optional()?
            .ok_or_else(Error::not_found)?;
        let mut device: NvrDevice = decode(raw)?;
        change(&mut device);
        device.updated_at = now();
        conn.execute(
            "UPDATE nvr_devices SET document=?2 WHERE id=?1",
            params![id, encode(&device)?],
        )?;
        Ok(())
    }
    pub fn policy(&self) -> Result<RecordingPolicy> {
        let text = self
            .lock()?
            .query_row("SELECT document FROM nvr_policy WHERE id=1", [], |r| {
                r.get(0)
            })
            .optional()?;
        text.map(decode)
            .unwrap_or_else(|| Ok(RecordingPolicy::default()))
    }
    pub fn save_policy(&self, policy: &RecordingPolicy) -> Result<()> {
        policy.validate()?;
        self.lock()?.execute("INSERT INTO nvr_policy VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET document=excluded.document", [encode(policy)?])?;
        Ok(())
    }
    pub fn save_run(&self, run: &Run) -> Result<()> {
        self.lock()?.execute(
            "INSERT INTO nvr_runs VALUES(?1,?2)",
            params![run.id, encode(run)?],
        )?;
        Ok(())
    }
    pub fn runs(&self) -> Result<Vec<Run>> {
        let conn = self.lock()?;
        let mut q = conn.prepare("SELECT document FROM nvr_runs")?;
        q.query_map([], |r| r.get::<_, String>(0))?
            .map(|v| decode(v?))
            .collect()
    }
    pub fn remove_run(&self, id: &str) -> Result<()> {
        self.lock()?
            .execute("DELETE FROM nvr_runs WHERE id=?1", [id])?;
        Ok(())
    }
    pub fn save_segment(&self, segment: &Segment) -> Result<()> {
        let s = &segment.public;
        self.lock()?.execute("INSERT INTO nvr_segments VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(id) DO UPDATE SET ended_at=excluded.ended_at,status=excluded.status,size_bytes=excluded.size_bytes,document=excluded.document",params![s.id,s.device_id,s.started_at,s.ended_at,s.status,i64::try_from(s.size_bytes).map_err(|_|Error::invalid("Segment too large"))?,encode(segment)?])?;
        Ok(())
    }
    pub fn segments(&self, device: Option<&str>, from: &str, to: &str) -> Result<Vec<Segment>> {
        let from = canonical_time(from).unwrap_or_else(|_| from.into());
        let to = canonical_time(to).unwrap_or_else(|_| to.into());
        let conn = self.lock()?;
        let mut q = conn.prepare("SELECT document FROM nvr_segments WHERE (?1 IS NULL OR device_id=?1) AND ended_at>=?2 AND started_at<=?3 ORDER BY started_at LIMIT 10000")?;
        q.query_map(params![device, from, to], |r| r.get::<_, String>(0))?
            .map(|v| decode(v?))
            .collect()
    }
    pub fn segment(&self, id: &str) -> Result<Segment> {
        decode(
            self.lock()?
                .query_row("SELECT document FROM nvr_segments WHERE id=?1", [id], |r| {
                    r.get(0)
                })
                .optional()?
                .ok_or_else(Error::not_found)?,
        )
    }
    pub fn retention_candidates(&self) -> Result<Vec<Segment>> {
        let conn = self.lock()?;
        let mut q = conn.prepare("SELECT document FROM nvr_segments WHERE status NOT IN ('writing','deleted','missing') ORDER BY started_at LIMIT 10000")?;
        q.query_map([], |r| r.get::<_, String>(0))?
            .map(|v| decode(v?))
            .collect()
    }
    pub fn used_bytes(&self) -> Result<u64> {
        Ok(self
            .lock()?
            .query_row(
                "SELECT COALESCE(SUM(size_bytes),0) FROM nvr_segments WHERE status!='deleted'",
                [],
                |r| r.get::<_, i64>(0),
            )?
            .max(0) as u64)
    }
    pub fn event(&self, event: &NvrEvent, unique_key: &str) -> Result<bool> {
        Ok(self.lock()?.execute(
            "INSERT OR IGNORE INTO nvr_events VALUES(?1,?2,?3,?4,?5)",
            params![
                event.id,
                event.device_id,
                event.occurred_at,
                unique_key,
                encode(event)?
            ],
        )? == 1)
    }
    pub fn events(&self, device: Option<&str>, from: &str, to: &str) -> Result<Vec<NvrEvent>> {
        let from = canonical_time(from).unwrap_or_else(|_| from.into());
        let to = canonical_time(to).unwrap_or_else(|_| to.into());
        let conn = self.lock()?;
        let mut q = conn.prepare("SELECT document FROM nvr_events WHERE (?1 IS NULL OR device_id=?1) AND occurred_at>=?2 AND occurred_at<=?3 ORDER BY occurred_at DESC LIMIT 1000")?;
        q.query_map(params![device, from, to], |r| r.get::<_, String>(0))?
            .map(|v| decode(v?))
            .collect()
    }
}
