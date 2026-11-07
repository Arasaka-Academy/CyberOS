use crate::{
    db::{Run, Segment},
    error::{Error, Result},
    protocol::*,
    runtime::State,
    storage::Storage,
};
use std::os::unix::fs::MetadataExt;
use std::{fs::File, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    process::{Child, Command},
    sync::watch,
};
use uuid::Uuid;

// The credential-bearing URI is fed over an anonymous pipe. It is never an
// argument, environment variable, public API field, or diagnostic output.
pub async fn ffmpeg(
    camera: &crate::onvif::Camera,
    uri: &str,
    args: &[String],
    cwd: &std::path::Path,
) -> Result<Child> {
    let input = camera.rtsp_input(uri)?.replace('\'', "%27");
    let mut command = Command::new("ffmpeg");
    command
        .args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-f",
            "concat",
            "-safe",
            "0",
            "-protocol_whitelist",
            "file,pipe,rtsp,tcp,udp,rtp,crypto",
            "-i",
            "pipe:0",
        ])
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .kill_on_drop(true);
    // FFmpeg creates segments itself; apply the same private-file policy as DB/credentials.
    unsafe {
        command.pre_exec(|| {
            nix::libc::umask(0o077);
            Ok(())
        });
    }
    let mut child = command
        .spawn()
        .map_err(|_| Error::unavailable("FFmpeg is unavailable"))?;
    let mut input_pipe = child
        .stdin
        .take()
        .ok_or_else(|| Error::unavailable("FFmpeg input unavailable"))?;
    input_pipe.write_all(format!("ffconcat version 1.0\nfile '{input}'\noption rtsp_transport tcp\noption timeout 15000000\n").as_bytes()).await?;
    input_pipe.shutdown().await?;
    Ok(child)
}
pub async fn probe(file: File) -> Result<f64> {
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        Command::new("ffprobe")
            .args([
                "-v",
                "error",
                "-f",
                "mpegts",
                "-show_entries",
                "format=duration:stream=codec_name,codec_type",
                "-of",
                "json",
                "-i",
                "/dev/stdin",
            ])
            .stdin(Stdio::from(file))
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| Error::unavailable("Recording inspection timed out"))??;
    if !output.status.success() {
        return Err(Error::unavailable("Incomplete recording segment"));
    }
    let info: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|_| Error::unavailable("Invalid recording metadata"))?;
    if !info["streams"].as_array().is_some_and(|s| {
        s.iter()
            .any(|v| v["codec_type"] == "video" && v["codec_name"] == "h264")
    }) {
        return Err(Error::unavailable("NVR recording requires H.264 video"));
    }
    let duration = info["format"]["duration"]
        .as_str()
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or_default();
    if !duration.is_finite() || duration <= 0.0 || duration > 180.0 {
        return Err(Error::unavailable("Invalid segment duration"));
    }
    Ok(duration)
}
fn pending(run: &Run, index: u32, start: f64) -> Segment {
    let id = format!("{}-{index:06}", run.id);
    Segment {
        public: NvrSegment {
            id: id.clone(),
            device_id: run.device_id.clone(),
            profile: run.profile.clone(),
            started_at: timestamp(run.started + start as i64),
            ended_at: timestamp(run.started + start as i64),
            duration_seconds: 0.0,
            size_bytes: 0,
            status: "writing".into(),
        },
        location: run.location.clone(),
        filename: format!("{id}.ts"),
        file_identity: None,
    }
}
async fn finalize(
    state: &State,
    storage: &Storage,
    mut segment: Segment,
    recovered: bool,
) -> Result<()> {
    let file = match storage.open_file(&segment.filename) {
        Ok(file) => file,
        Err(_) => {
            segment.public.status = "missing".into();
            state.db.save_segment(&segment)?;
            return Ok(());
        }
    };
    let metadata = file.metadata()?;
    segment.public.size_bytes = metadata.len();
    segment.file_identity = Some((metadata.dev(), metadata.ino()));
    match probe(file).await {
        Ok(duration) => {
            segment.public.duration_seconds = duration;
            segment.public.ended_at =
                timestamp(parse_time(&segment.public.started_at)? + duration.ceil() as i64);
            segment.public.status = if recovered { "recovered" } else { "ready" }.into();
        }
        Err(_) => segment.public.status = "invalid".into(),
    }
    state.db.save_segment(&segment)
}
pub async fn recover(state: &State, device: Option<&str>) -> Result<()> {
    for run in state
        .db
        .runs()?
        .into_iter()
        .filter(|r| device.is_none_or(|id| r.device_id == id))
    {
        let storage = state.storage(&run.location)?;
        for item in std::fs::read_dir(storage.path())? {
            let item = item?;
            let name = item.file_name().to_string_lossy().into_owned();
            let Some(index) = name
                .strip_prefix(&format!("{}-", run.id))
                .and_then(|v| v.strip_suffix(".ts"))
                .filter(|v| v.len() >= 6 && v.bytes().all(|c| c.is_ascii_digit()))
                .and_then(|v| v.parse::<u32>().ok())
            else {
                continue;
            };
            let segment = pending(&run, index, f64::from(index) * 60.0);
            let segment = state.db.segment(&segment.public.id).unwrap_or(segment);
            if segment.public.status == "writing" {
                finalize(state, &storage, segment, true).await?;
            }
        }
        for segment in state.db.segments(Some(&run.device_id), "", "9999")? {
            if segment.public.id.starts_with(&run.id) && segment.public.status == "writing" {
                finalize(state, &storage, segment, true).await?;
            }
        }
        state.db.remove_run(&run.id)?;
    }
    Ok(())
}
pub async fn record_loop(state: Arc<State>, id: String, mut stop: watch::Receiver<bool>) {
    while !*stop.borrow() {
        let result = async {
            let device = state.db.device(&id)?;
            if !device.recording_enabled {
                state.db.update(&id, |d| d.recording = "disabled".into())?;
                return Ok(());
            }
            recover(&state, Some(&id)).await?;
            record(&state, &id, &mut stop).await
        }
        .await;
        if let Err(error) = result {
            let _ = state.db.update(&id, |d| {
                d.recording = "paused".into();
                d.last_error = Some(error.message);
            });
        }
        tokio::select! {_=tokio::time::sleep(Duration::from_secs(3))=>{}, _=stop.changed()=>{}}
    }
}
async fn record(state: &State, id: &str, stop: &mut watch::Receiver<bool>) -> Result<()> {
    let device = state.db.device(id)?;
    let policy = state.db.policy()?;
    let (storage, location) = state.selected_storage(id)?;
    if storage.available_bytes()? < 256 * 1024 * 1024
        || state.db.used_bytes()? >= policy.quota_bytes
    {
        return Err(Error::unavailable(
            "Recording paused: storage space or NVR quota exhausted",
        ));
    }
    let camera = state.camera(id).await?;
    let profile = device
        .profiles
        .iter()
        .find(|p| p.token == device.recording_profile)
        .ok_or_else(|| Error::invalid("Recording profile unavailable"))?;
    let run = Run {
        id: Uuid::new_v4().to_string(),
        device_id: id.into(),
        profile: profile.token.clone(),
        started: time::OffsetDateTime::now_utc().unix_timestamp(),
        location,
    };
    state.db.save_run(&run)?;
    let mut current = pending(&run, 0, 0.0);
    state.db.save_segment(&current)?;
    let args: Vec<String> = [
        "-map",
        "0:v:0",
        "-c:v",
        "copy",
        "-an",
        "-f",
        "segment",
        "-segment_time",
        "60",
        "-segment_format",
        "mpegts",
        "-reset_timestamps",
        "1",
        "-segment_list_type",
        "csv",
        "-segment_list",
        "pipe:1",
    ]
    .into_iter()
    .map(String::from)
    .chain([format!("{}-%06d.ts", run.id)])
    .collect();
    let mut child = ffmpeg(
        &camera,
        &profile.rtsp_uri,
        &args,
        &storage.working_directory(),
    )
    .await?;
    let mut lines = BufReader::new(
        child
            .stdout
            .take()
            .ok_or_else(|| Error::unavailable("FFmpeg output unavailable"))?,
    )
    .lines();
    state.db.update(id, |d| {
        d.recording = "recording".into();
        d.last_error = None;
    })?;
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    let mut index = 0;
    let mut reason = None;
    loop {
        tokio::select! {
            line=lines.next_line()=>{
                match line {
                    Ok(Some(line))=>{
                        let fields:Vec<_>=line.split(',').collect();
                        if fields.len()!=3 || fields[0].trim_matches('"')!=current.filename {reason=Some(Error::unavailable("Unexpected FFmpeg segment output"));break;}
                        finalize(state,&storage,current.clone(),false).await?;
                        index+=1;let start=fields[2].parse::<f64>().unwrap_or(f64::from(index)*60.0);
                        current=pending(&run,index,start);state.db.save_segment(&current)?;
                    }
                    _=>{reason=Some(Error::unavailable("Video stream interrupted; reconnecting"));break;}
                }
            }
            _=interval.tick()=>{
                let check=(||{
                    storage.verify()?;
                    if storage.available_bytes()?<256*1024*1024 {return Err(Error::unavailable("Recording paused: insufficient storage space"));}
                    if let Ok(file)=storage.open_file(&current.filename) {current.public.size_bytes=file.metadata()?.len();state.db.save_segment(&current)?;}
                    if state.db.used_bytes()?>=policy.quota_bytes {return Err(Error::unavailable("Recording paused: NVR quota reached"));}
                    Ok(())
                })();
                if let Err(error)=check {reason=Some(error);break;}
                let d=state.db.device(id)?;
                let p=state.db.policy()?;
                if !d.recording_enabled || d.removed_at.is_some() || d.recording_profile!=run.profile || p.storage_pool_id!=policy.storage_pool_id || p.directory!=policy.directory || p.quota_bytes!=policy.quota_bytes {break;}
            }
            _=stop.changed()=>{if *stop.borrow(){break;}}
        }
    }
    // Kill only this child; a missing mount must never cause a fallback write.
    let _ = child.kill().await;
    if storage.verify().is_ok() {
        finalize(state, &storage, current, true).await?;
        state.db.remove_run(&run.id)?;
    }
    if let Some(error) = reason {
        return Err(error);
    }
    Ok(())
}
pub async fn cleanup(state: &State) -> Result<()> {
    let policy = state.db.policy()?;
    let cutoff = timestamp(
        time::OffsetDateTime::now_utc().unix_timestamp() - i64::from(policy.retention_days) * 86400,
    );
    let mut used = state.db.used_bytes()?;
    // Session creation and stream pinning take the write lock. Keep this read
    // lock through unlink so a new viewer cannot pin a file after the check.
    let sessions = state.sessions.read().await;
    for mut segment in state.db.retention_candidates()? {
        if matches!(
            segment.public.status.as_str(),
            "writing" | "deleted" | "missing"
        ) || sessions
            .values()
            .any(|s| s.segments.contains(&segment.public.id))
            || state
                .active_streams
                .lock()
                .map_err(|_| Error::unavailable("NVR stream state unavailable"))?
                .contains_key(&segment.public.id)
        {
            continue;
        }
        if segment.public.ended_at >= cutoff && used < policy.quota_bytes {
            continue;
        }
        let storage = state.storage(&segment.location)?;
        let _file = storage.segment(&segment)?;
        storage.remove(&segment.filename)?;
        used = used.saturating_sub(segment.public.size_bytes);
        segment.public.size_bytes = 0;
        segment.public.status = "deleted".into();
        state.db.save_segment(&segment)?;
    }
    Ok(())
}
