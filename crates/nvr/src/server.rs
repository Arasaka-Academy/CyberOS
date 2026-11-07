use crate::{
    error::{Error, Result},
    onvif::{self, Camera, Credentials},
    protocol::*,
    runtime::{Session, State},
};
use axum::{
    Json, Router,
    body::Body,
    extract::{DefaultBodyLimit, Path, Query, State as Extract},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
    routing::{get, post, put},
};
use futures_util::StreamExt;
use serde::Deserialize;
use std::{io::SeekFrom, sync::Arc, time::Duration};
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio_util::io::ReaderStream;
use uuid::Uuid;

pub fn router(state: Arc<State>) -> Router {
    Router::new()
        .route("/nvr", get(overview))
        .route("/nvr/discover", post(discover))
        .route("/nvr/policy", put(policy))
        .route("/nvr/devices", post(add))
        .route(
            "/nvr/devices/{id}",
            axum::routing::patch(update).delete(remove),
        )
        .route("/nvr/devices/{id}/ptz", get(ptz_status).post(ptz))
        .route("/nvr/devices/{id}/preview", get(preview))
        .route("/nvr/devices/{id}/snapshot", get(snapshot))
        .route("/nvr/segments", get(segments))
        .route("/nvr/events", get(events))
        .route("/nvr/segments/{id}/download", get(download))
        .route("/nvr/sessions", post(session))
        .route(
            "/nvr/sessions/{id}",
            post(renew_session).delete(delete_session),
        )
        .route("/nvr/sessions/{id}/assets/{name}", get(asset))
        .layer(DefaultBodyLimit::max(16384))
        .with_state(state)
}
async fn overview(Extract(s): Extract<Arc<State>>) -> Result<Json<NvrOverview>> {
    Ok(Json(NvrOverview {
        devices: s.db.devices()?,
        policy: s.db.policy()?,
        used_bytes: s.db.used_bytes()?,
        max_recordings: 4,
        heartbeat_at: now(),
    }))
}
async fn discover() -> Result<Json<Vec<NvrDiscovery>>> {
    Ok(Json(onvif::discover().await?))
}
async fn policy(
    Extract(s): Extract<Arc<State>>,
    Json(p): Json<RecordingPolicy>,
) -> Result<Json<RecordingPolicy>> {
    p.validate()?;
    if let Some(pool) = &p.storage_pool_id {
        crate::storage::Storage::open(
            &s.config.root.join("data"),
            pool,
            &p.directory,
            s.config.production,
        )?;
    }
    s.db.save_policy(&p)?;
    Ok(Json(p))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Add {
    name: String,
    onvif_url: String,
    username: String,
    password: String,
}
async fn add(
    Extract(s): Extract<Arc<State>>,
    Json(input): Json<Add>,
) -> Result<(StatusCode, Json<NvrDevice>)> {
    validate_text(&input.name, 64)?;
    let credentials = Credentials {
        username: input.username,
        password: input.password,
    };
    if credentials.username.is_empty() || credentials.password.is_empty() {
        return Err(Error::invalid("Camera credentials are required"));
    }
    let info = Camera::connect(&input.onvif_url, credentials.clone(), s.config.production).await?;
    let device = NvrDevice {
        id: info.id.clone(),
        name: input.name,
        onvif_url: input.onvif_url,
        credentials_configured: true,
        profiles: info.profiles,
        recording_enabled: false,
        recording_profile: "raw".into(),
        removed_at: None,
        connection: "connected".into(),
        video: "unknown".into(),
        ptz: "unknown".into(),
        recording: "disabled".into(),
        analytics: None,
        person: None,
        vehicle: None,
        last_error: None,
        updated_at: now(),
    };
    // Serialize device registration and credential replacement, including duplicates.
    let mut cameras = s.cameras.write().await;
    if s.db
        .devices()?
        .iter()
        .any(|d| d.id == device.id && d.removed_at.is_none())
    {
        return Err(Error::conflict("This device UUID is already registered"));
    }
    s.secrets.save(&info.id, &credentials)?;
    s.db.add(&device)?;
    cameras.insert(info.id, info.camera);
    Ok((StatusCode::CREATED, Json(device)))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Update {
    name: Option<String>,
    recording_enabled: Option<bool>,
    recording_profile: Option<String>,
}
async fn update(
    Extract(s): Extract<Arc<State>>,
    Path(id): Path<String>,
    Json(input): Json<Update>,
) -> Result<Json<NvrDevice>> {
    if let Some(name) = &input.name {
        validate_text(name, 64)?;
    }
    if let Some(profile) = &input.recording_profile
        && !matches!(profile.as_str(), "raw" | "annotated")
    {
        return Err(Error::invalid("Unknown recording profile"));
    }
    if input.recording_enabled == Some(true) {
        s.selected_storage(&id)?;
    }
    if s.db.device(&id)?.removed_at.is_some() {
        return Err(Error::not_found());
    }
    s.db.update(&id, |d| {
        if let Some(name) = input.name {
            d.name = name;
        }
        if let Some(enabled) = input.recording_enabled {
            d.recording_enabled = enabled;
        }
        if let Some(profile) = input.recording_profile {
            d.recording_profile = profile;
        }
    })?;
    Ok(Json(s.db.device(&id)?))
}
async fn remove(Extract(s): Extract<Arc<State>>, Path(id): Path<String>) -> Result<StatusCode> {
    if let Ok(camera) = s.camera(&id).await {
        let _ = camera.ptz_command(&NvrPtzCommand::Stop).await;
    }
    s.db.update(&id, |d| {
        d.removed_at = Some(now());
        d.recording_enabled = false;
        d.recording = "disabled".into();
        d.credentials_configured = false;
    })?;
    s.secrets.remove(&id)?;
    Ok(StatusCode::NO_CONTENT)
}
async fn ptz_status(
    Extract(s): Extract<Arc<State>>,
    Path(id): Path<String>,
) -> Result<Json<NvrPtzStatus>> {
    let status = s.camera(&id).await?.ptz_status().await?;
    s.db.update(&id, |d| {
        d.ptz = status.state.clone();
    })?;
    Ok(Json(status))
}
async fn ptz(
    Extract(s): Extract<Arc<State>>,
    Path(id): Path<String>,
    Json(command): Json<NvrPtzCommand>,
) -> Result<StatusCode> {
    command.validate()?;
    let camera = s.camera(&id).await?;
    let generation = {
        let mut epochs = s.ptz_generation.write().await;
        let value = epochs.entry(id.clone()).or_default();
        if matches!(command, NvrPtzCommand::Stop) {
            *value += 1;
        }
        *value
    };
    let lock = s
        .ptz_locks
        .write()
        .await
        .entry(id.clone())
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone();
    let _guard = lock.lock().await;
    if !matches!(command, NvrPtzCommand::Stop)
        && s.ptz_generation.read().await.get(&id) != Some(&generation)
    {
        return Err(Error::conflict("PTZ movement cancelled by stop"));
    }
    camera.ptz_command(&command).await?;
    Ok(StatusCode::NO_CONTENT)
}
async fn preview(Extract(s): Extract<Arc<State>>, Path(id): Path<String>) -> Result<Response> {
    let camera = s.camera(&id).await?;
    let response = camera
        .client
        .get(camera.management_url("/stream.mjpg"))
        .timeout(Duration::from_secs(3600))
        .send()
        .await?;
    let content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    if !response.status().is_success() || !content_type.starts_with("multipart/x-mixed-replace;") {
        return Err(Error::unavailable("Annotated preview unavailable"));
    }
    s.db.update(&id, |d| d.video = "available".into())?;
    Ok((
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, "no-store".into()),
        ],
        Body::from_stream(response.bytes_stream()),
    )
        .into_response())
}
async fn snapshot(Extract(s): Extract<Arc<State>>, Path(id): Path<String>) -> Result<Response> {
    let camera = s.camera(&id).await?;
    let device = s.db.device(&id)?;
    let uri = &device
        .profiles
        .iter()
        .find(|p| p.token == "annotated")
        .ok_or_else(Error::not_found)?
        .snapshot_uri;
    Ok((
        [
            (header::CONTENT_TYPE, "image/jpeg"),
            (header::CACHE_CONTROL, "no-store"),
        ],
        camera.snapshot(uri).await?,
    )
        .into_response())
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Timeline {
    device_id: Option<String>,
    from: String,
    to: String,
}
fn interval(from: &str, to: &str) -> Result<()> {
    let start = parse_time(from)?;
    let end = parse_time(to)?;
    if end < start || end - start > 31 * 86400 {
        return Err(Error::invalid("Select a time range of at most 31 days"));
    }
    Ok(())
}
async fn segments(
    Extract(s): Extract<Arc<State>>,
    Query(q): Query<Timeline>,
) -> Result<Json<Vec<NvrSegment>>> {
    interval(&q.from, &q.to)?;
    Ok(Json(
        s.db.segments(q.device_id.as_deref(), &q.from, &q.to)?
            .into_iter()
            .map(|s| s.public)
            .collect(),
    ))
}
async fn events(
    Extract(s): Extract<Arc<State>>,
    Query(q): Query<Timeline>,
) -> Result<Json<Vec<NvrEvent>>> {
    interval(&q.from, &q.to)?;
    Ok(Json(s.db.events(q.device_id.as_deref(), &q.from, &q.to)?))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CreateSession {
    device_id: String,
    kind: String,
    from: Option<String>,
    to: Option<String>,
}
async fn session(
    Extract(s): Extract<Arc<State>>,
    Json(input): Json<CreateSession>,
) -> Result<(StatusCode, Json<NvrSession>)> {
    let id = Uuid::new_v4().to_string();
    let public = NvrSession {
        id: id.clone(),
        device_id: input.device_id.clone(),
        kind: input.kind.clone(),
        url: format!("/api/nvr/sessions/{id}/assets/index.m3u8"),
        expires_at: timestamp(time::OffsetDateTime::now_utc().unix_timestamp() + 90),
    };
    let mut sessions = s.sessions.write().await;
    if sessions.len() >= 16 {
        return Err(Error::conflict("Too many active NVR viewing sessions"));
    }
    let mut session = Session {
        public: public.clone(),
        touched: tokio::time::Instant::now(),
        segments: Vec::new(),
        directory: None,
        process: None,
    };
    match input.kind.as_str() {
        "playback" => {
            let from = input
                .from
                .ok_or_else(|| Error::invalid("Playback start is required"))?;
            let to = input
                .to
                .ok_or_else(|| Error::invalid("Playback end is required"))?;
            interval(&from, &to)?;
            let segments = s.db.segments(Some(&input.device_id), &from, &to)?;
            for segment in segments
                .iter()
                .filter(|v| matches!(v.public.status.as_str(), "ready" | "recovered"))
            {
                s.storage(&segment.location)?.segment(segment)?;
                session.segments.push(segment.public.id.clone());
            }
            if session.segments.is_empty() {
                return Err(Error::not_found());
            }
        }
        "live" => {
            if sessions
                .values()
                .filter(|s| s.public.kind == "live")
                .count()
                >= 4
            {
                return Err(Error::conflict(
                    "At most four live HLS streams are supported",
                ));
            }
            let camera = s.camera(&input.device_id).await?;
            let device = s.db.device(&input.device_id)?;
            let profile = device
                .profiles
                .iter()
                .find(|p| p.token == "raw")
                .ok_or_else(|| Error::unavailable("Raw profile unavailable"))?;
            let dir = s.config.root.join("state/nvr-live").join(&id);
            tokio::fs::create_dir_all(&dir).await?;
            let args: Vec<_> = [
                "-map",
                "0:v:0",
                "-c:v",
                "copy",
                "-an",
                "-f",
                "hls",
                "-hls_time",
                "2",
                "-hls_list_size",
                // Retain enough history for queued browser requests on a
                // relayed connection; a twelve-second window expired too soon.
                "30",
                "-hls_flags",
                "delete_segments+independent_segments",
                "-hls_segment_filename",
                "live-%06d.ts",
                "index.m3u8",
            ]
            .into_iter()
            .map(String::from)
            .collect();
            session.process =
                Some(crate::recording::ffmpeg(&camera, &profile.rtsp_uri, &args, &dir).await?);
            session.directory = Some(dir);
        }
        _ => return Err(Error::invalid("Session kind must be live or playback")),
    }
    sessions.insert(id, session);
    Ok((StatusCode::CREATED, Json(public)))
}
async fn renew_session(
    Extract(s): Extract<Arc<State>>,
    Path(id): Path<String>,
) -> Result<Json<NvrSession>> {
    let mut sessions = s.sessions.write().await;
    let session = sessions.get_mut(&id).ok_or_else(Error::not_found)?;
    session.touched = tokio::time::Instant::now();
    session.public.expires_at = timestamp(time::OffsetDateTime::now_utc().unix_timestamp() + 90);
    Ok(Json(session.public.clone()))
}
async fn delete_session(
    Extract(s): Extract<Arc<State>>,
    Path(id): Path<String>,
) -> Result<StatusCode> {
    if let Some(mut session) = s.sessions.write().await.remove(&id) {
        if let Some(child) = &mut session.process {
            let _ = child.kill().await;
        }
        if let Some(dir) = session.directory {
            let _ = tokio::fs::remove_dir_all(dir).await;
        }
    }
    Ok(StatusCode::NO_CONTENT)
}
async fn asset(
    Extract(s): Extract<Arc<State>>,
    Path((id, name)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<Response> {
    let mut sessions = s.sessions.write().await;
    let session = sessions.get_mut(&id).ok_or_else(Error::not_found)?;
    session.touched = tokio::time::Instant::now();
    if let Some(directory) = &session.directory {
        if name != "index.m3u8"
            && !(name.starts_with("live-")
                && name.ends_with(".ts")
                && name.len() >= 14
                && name[5..name.len() - 3].bytes().all(|c| c.is_ascii_digit()))
        {
            return Err(Error::not_found());
        }
        let file = tokio::fs::File::open(directory.join(&name))
            .await
            .map_err(|_| Error::unavailable("Live stream is starting or reconnecting"))?;
        let len = file.metadata().await?.len();
        return serve(
            file,
            len,
            &headers,
            if name.ends_with("m3u8") {
                "application/vnd.apple.mpegurl"
            } else {
                "video/mp2t"
            },
            None,
        )
        .await;
    }
    if name == "index.m3u8" {
        let mut playlist = String::from("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n");
        let mut max_duration = 1.0_f64;
        let mut entries = String::new();
        for id in &session.segments {
            let segment = s.db.segment(id)?;
            max_duration = max_duration.max(segment.public.duration_seconds);
            entries.push_str(&format!(
                "#EXT-X-DISCONTINUITY\n#EXT-X-PROGRAM-DATE-TIME:{}\n#EXTINF:{:.3},\n{}.ts\n",
                segment.public.started_at, segment.public.duration_seconds, id
            ));
        }
        playlist.push_str(&format!(
            "#EXT-X-TARGETDURATION:{}\n#EXT-X-MEDIA-SEQUENCE:0\n{entries}#EXT-X-ENDLIST\n",
            max_duration.ceil()
        ));
        return Ok((
            [
                (header::CONTENT_TYPE, "application/vnd.apple.mpegurl"),
                (header::CACHE_CONTROL, "no-store"),
            ],
            playlist,
        )
            .into_response());
    }
    let segment_id = name.strip_suffix(".ts").ok_or_else(Error::not_found)?;
    if !session.segments.iter().any(|v| v == segment_id) {
        return Err(Error::not_found());
    }
    let segment = s.db.segment(segment_id)?;
    let file = s.storage(&segment.location)?.segment(&segment)?;
    let pin = StreamPin::new(s.clone(), segment_id)?;
    serve(
        tokio::fs::File::from_std(file),
        segment.public.size_bytes,
        &headers,
        "video/mp2t",
        Some(pin),
    )
    .await
}
async fn download(
    Extract(s): Extract<Arc<State>>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<Response> {
    let _sessions = s.sessions.write().await;
    let segment = s.db.segment(&id)?;
    if !matches!(segment.public.status.as_str(), "ready" | "recovered") {
        return Err(Error::conflict("Segment is not ready"));
    }
    let file = s.storage(&segment.location)?.segment(&segment)?;
    let pin = StreamPin::new(s.clone(), &id)?;
    let mut response = serve(
        tokio::fs::File::from_std(file),
        segment.public.size_bytes,
        &headers,
        "video/mp2t",
        Some(pin),
    )
    .await?;
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        format!("attachment; filename=\"{}\"", segment.filename)
            .parse()
            .map_err(|_| Error::not_found())?,
    );
    Ok(response)
}
pub fn byte_range(value: Option<&str>, size: u64) -> Result<(u64, u64, bool)> {
    if size == 0 {
        return Err(Error::not_found());
    }
    let Some(value) = value else {
        return Ok((0, size - 1, false));
    };
    let invalid = || Error {
        status: StatusCode::RANGE_NOT_SATISFIABLE,
        message: "Invalid byte range".into(),
    };
    let (first, last) = value
        .strip_prefix("bytes=")
        .and_then(|v| v.split_once('-'))
        .ok_or_else(invalid)?;
    let (start, end) = if first.is_empty() {
        let suffix = last.parse::<u64>().map_err(|_| invalid())?;
        if suffix == 0 {
            return Err(invalid());
        }
        (size.saturating_sub(suffix), size - 1)
    } else {
        (
            first.parse::<u64>().map_err(|_| invalid())?,
            if last.is_empty() {
                size - 1
            } else {
                last.parse::<u64>().map_err(|_| invalid())?.min(size - 1)
            },
        )
    };
    if start > end || start >= size {
        return Err(invalid());
    }
    Ok((start, end, true))
}
async fn serve(
    mut file: tokio::fs::File,
    size: u64,
    headers: &HeaderMap,
    kind: &str,
    pin: Option<StreamPin>,
) -> Result<Response> {
    if file.metadata().await?.len() != size {
        return Err(Error::unavailable("Recording file changed"));
    }
    let (start, end, partial) = byte_range(
        headers.get(header::RANGE).and_then(|h| h.to_str().ok()),
        size,
    )?;
    file.seek(SeekFrom::Start(start)).await?;
    let length = end - start + 1;
    let mut response = Response::builder()
        .status(if partial {
            StatusCode::PARTIAL_CONTENT
        } else {
            StatusCode::OK
        })
        .header(header::CONTENT_TYPE, kind)
        .header(header::CONTENT_LENGTH, length)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CACHE_CONTROL, "no-store");
    if partial {
        response = response.header(header::CONTENT_RANGE, format!("bytes {start}-{end}/{size}"));
    }
    response
        .body(Body::from_stream(futures_util::stream::unfold(
            (ReaderStream::new(file.take(length)), pin),
            |(mut stream, pin)| async move { stream.next().await.map(|item| (item, (stream, pin))) },
        )))
        .map_err(|_| Error::unavailable("Cannot stream recording"))
}

/// A download/segment request stays protected through EOF or cancellation,
/// even when a viewing session expires while the response is still in flight.
struct StreamPin {
    state: Arc<State>,
    id: String,
}
impl StreamPin {
    fn new(state: Arc<State>, id: &str) -> Result<Self> {
        *state
            .active_streams
            .lock()
            .map_err(|_| Error::unavailable("NVR stream state unavailable"))?
            .entry(id.into())
            .or_default() += 1;
        Ok(Self {
            state,
            id: id.into(),
        })
    }
}
impl Drop for StreamPin {
    fn drop(&mut self) {
        if let Ok(mut streams) = self.state.active_streams.lock()
            && let Some(count) = streams.get_mut(&self.id)
        {
            *count -= 1;
            if *count == 0 {
                streams.remove(&self.id);
            }
        }
    }
}

#[cfg(test)]
mod stream_tests {
    use super::*;
    use crate::db::Segment;
    use std::io::Write;
    use std::os::unix::fs::MetadataExt;
    #[tokio::test]
    async fn download_pin_lasts_until_response_drop_and_replaced_files_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join("data/pool-1")).unwrap();
        let s = crate::tests::state(root.path());
        let id = Uuid::new_v4().to_string();
        s.db.save_policy(&RecordingPolicy {
            storage_pool_id: Some("pool-1".into()),
            ..Default::default()
        })
        .unwrap();
        let (storage, location) = s.selected_storage(&id).unwrap();
        let mut file = storage.create("segment.ts").unwrap();
        file.write_all(b"fixture").unwrap();
        let m = file.metadata().unwrap();
        s.db.save_segment(&Segment {
            public: NvrSegment {
                id: "segment".into(),
                device_id: id,
                profile: "raw".into(),
                started_at: timestamp(0),
                ended_at: timestamp(60),
                duration_seconds: 60.0,
                size_bytes: 7,
                status: "ready".into(),
            },
            location,
            filename: "segment.ts".into(),
            file_identity: Some((m.dev(), m.ino())),
        })
        .unwrap();
        let response = download(Extract(s.clone()), Path("segment".into()), HeaderMap::new())
            .await
            .unwrap();
        assert!(s.sessions.read().await.is_empty());
        s.expire_sessions().await;
        crate::recording::cleanup(&s).await.unwrap();
        assert!(storage.open_file("segment.ts").is_ok());
        drop(response);
        assert!(s.active_streams.lock().unwrap().is_empty());
        std::fs::rename(
            storage.path().join("segment.ts"),
            storage.path().join("original.ts"),
        )
        .unwrap();
        storage
            .create("segment.ts")
            .unwrap()
            .write_all(b"fixture")
            .unwrap();
        assert!(
            download(Extract(s.clone()), Path("segment".into()), HeaderMap::new())
                .await
                .is_err()
        );
        assert!(crate::recording::cleanup(&s).await.is_err());
        assert!(storage.open_file("segment.ts").is_ok());
    }
}
