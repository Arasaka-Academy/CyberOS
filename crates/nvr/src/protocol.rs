use crate::error::{Error, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct RecordingPolicy {
    pub storage_pool_id: Option<String>,
    pub directory: String,
    pub retention_days: u32,
    pub quota_bytes: u64,
}
impl Default for RecordingPolicy {
    fn default() -> Self {
        Self {
            storage_pool_id: None,
            directory: "NVR".into(),
            retention_days: 7,
            quota_bytes: 100 * 1024 * 1024 * 1024,
        }
    }
}
impl RecordingPolicy {
    pub fn validate(&self) -> Result<()> {
        if let Some(id) = &self.storage_pool_id {
            super::storage::validate_pool(id)?;
        }
        super::storage::validate_relative(&self.directory)?;
        if !(1..=3650).contains(&self.retention_days)
            || !(1024 * 1024 * 1024..=9_007_199_254_740_991).contains(&self.quota_bytes)
        {
            return Err(Error::invalid(
                "Retention must be 1–3650 days and quota at least 1 GiB",
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct NvrProfile {
    pub token: String,
    pub name: String,
    pub rtsp_uri: String,
    pub snapshot_uri: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct NvrDevice {
    pub id: String,
    pub name: String,
    pub onvif_url: String,
    pub credentials_configured: bool,
    pub profiles: Vec<NvrProfile>,
    pub recording_enabled: bool,
    pub recording_profile: String,
    pub removed_at: Option<String>,
    pub connection: String,
    pub video: String,
    #[serde(default = "unknown")]
    pub ptz: String,
    pub recording: String,
    pub analytics: Option<bool>,
    pub person: Option<bool>,
    pub vehicle: Option<bool>,
    pub last_error: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct NvrSegment {
    pub id: String,
    pub device_id: String,
    pub profile: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_seconds: f64,
    pub size_bytes: u64,
    pub status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct NvrEvent {
    pub id: String,
    pub device_id: String,
    pub category: String,
    pub state: Option<bool>,
    pub occurred_at: String,
    pub received_at: String,
    pub gap: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct NvrOverview {
    pub devices: Vec<NvrDevice>,
    pub policy: RecordingPolicy,
    pub used_bytes: u64,
    pub max_recordings: u32,
    pub heartbeat_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct NvrDiscovery {
    pub id: String,
    pub onvif_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct NvrSession {
    pub id: String,
    pub device_id: String,
    pub kind: String,
    pub url: String,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct PtzPosition {
    pub pan: f64,
    pub tilt: f64,
    pub moving: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct PtzPreset {
    pub token: String,
    pub name: String,
    pub pan: f64,
    pub tilt: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub struct NvrPtzStatus {
    pub enabled: bool,
    pub driver: String,
    pub state: String,
    pub simulated: bool,
    pub position: Option<PtzPosition>,
    pub presets: Vec<PtzPreset>,
    pub calibration_required: bool,
    pub absolute_move: bool,
    pub relative_move: bool,
    pub continuous_move: bool,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "nvr.ts"))]
pub enum NvrPtzCommand {
    AbsoluteMove { pan: f64, tilt: f64 },
    RelativeMove { pan: f64, tilt: f64 },
    ContinuousMove { pan: f64, tilt: f64 },
    Stop,
    Home,
    SetPreset { name: String, token: Option<String> },
    GotoPreset { token: String },
    RemovePreset { token: String },
}
impl NvrPtzCommand {
    pub fn validate(&self) -> Result<()> {
        match self {
            Self::AbsoluteMove { pan, tilt }
            | Self::RelativeMove { pan, tilt }
            | Self::ContinuousMove { pan, tilt } => {
                if !pan.is_finite() || !tilt.is_finite() || pan.abs() > 1.0 || tilt.abs() > 1.0 {
                    return Err(Error::invalid(
                        "PTZ coordinates must be finite values in [-1,1]",
                    ));
                }
            }
            Self::SetPreset { name, token } => {
                validate_text(name, 64)?;
                if let Some(token) = token {
                    validate_text(token, 64)?;
                }
            }
            Self::GotoPreset { token } | Self::RemovePreset { token } => validate_text(token, 64)?,
            Self::Stop | Self::Home => {}
        }
        Ok(())
    }
}
pub fn validate_text(value: &str, limit: usize) -> Result<()> {
    if value.trim().is_empty()
        || value.chars().count() > limit
        || value.chars().any(char::is_control)
    {
        return Err(Error::invalid("Invalid name or token"));
    }
    Ok(())
}
pub fn now() -> String {
    timestamp(time::OffsetDateTime::now_utc().unix_timestamp())
}
fn unknown() -> String {
    "unknown".into()
}
pub fn canonical_time(value: &str) -> Result<String> {
    let value = time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .map_err(|_| Error::invalid("An RFC3339 timestamp is required"))?;
    Ok(format_time(value))
}
fn format_time(value: time::OffsetDateTime) -> String {
    value
        .to_offset(time::UtcOffset::UTC)
        .format(
            &time::format_description::parse_borrowed::<2>(
                "[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:9]Z",
            )
            .expect("fixed timestamp format"),
        )
        .unwrap_or_default()
}
pub fn timestamp(seconds: i64) -> String {
    format_time(
        time::OffsetDateTime::from_unix_timestamp(seconds)
            .unwrap_or(time::OffsetDateTime::UNIX_EPOCH),
    )
}
pub fn parse_time(value: &str) -> Result<i64> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339)
        .map(|t| t.unix_timestamp())
        .map_err(|_| Error::invalid("An RFC3339 timestamp is required"))
}

#[cfg(test)]
#[test]
#[ignore = "writes checked-in TypeScript protocol bindings"]
fn export_protocol_bindings() {
    use ts_rs::TS;
    let config = ts_rs::Config::from_env();
    NvrOverview::export_all(&config).unwrap();
    NvrSegment::export_all(&config).unwrap();
    NvrEvent::export_all(&config).unwrap();
    NvrDiscovery::export_all(&config).unwrap();
    NvrSession::export_all(&config).unwrap();
    NvrPtzStatus::export_all(&config).unwrap();
    NvrPtzCommand::export_all(&config).unwrap();
}
