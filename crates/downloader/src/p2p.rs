/**
 * [INPUT]: 依赖 librqbit、数据库租约和受限存储目标。
 * [OUTPUT]: 提供种子预览、引擎会话和 BT 执行循环。
 * [POS]: 协调传输、控制与发布；进度转换交给 progress。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
mod progress;
#[cfg(test)]
mod resume_tests;
#[cfg(test)]
mod tests;

use std::collections::BTreeMap;
use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::sync::Arc;

use futures_util::StreamExt;

use crate::db::{
    Db, ResolvedTorrentPreview, Task, TorrentFile, TorrentPreview, TorrentProgressUpdate,
};
use crate::error::{DownloadError, ErrorCode};
use crate::storage::TorrentStorageTarget;

const TORRENT_LEASE: std::time::Duration = std::time::Duration::from_secs(30);
const MAX_TORRENT_FILES: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TorrentTaskOutcome {
    Complete,
    Interrupted,
    Shutdown,
}

pub struct TorrentRunContext<'a> {
    pub data_root: &'a Path,
    pub require_mount: bool,
    pub minimum_free_bytes: u64,
    pub shutdown: &'a tokio_util::sync::CancellationToken,
}

#[derive(Clone)]
pub struct TorrentEngine {
    session: Arc<librqbit::Session>,
}

impl TorrentEngine {
    pub async fn new(
        output_root: &Path,
        cancellation_token: tokio_util::sync::CancellationToken,
    ) -> Result<Self, DownloadError> {
        let options = librqbit::SessionOptions {
            dht: Some(librqbit::DhtSessionConfig {
                persistence: None,
                ..Default::default()
            }),
            listen: Some(librqbit::ListenerOptions {
                enable_upnp_port_forwarding: false,
                ..Default::default()
            }),
            persistence: None,
            fastresume: false,
            cancellation_token: Some(cancellation_token),
            client_name_and_version: Some(format!("CyberOS/{}", env!("CARGO_PKG_VERSION"))),
            ..Default::default()
        };
        Self::new_with_options(output_root, options).await
    }

    #[cfg(test)]
    async fn new_isolated(
        output_root: &Path,
        listen_address: Option<SocketAddr>,
    ) -> Result<Self, DownloadError> {
        let options = librqbit::SessionOptions {
            dht: None,
            disable_trackers: true,
            disable_local_service_discovery: true,
            listen: listen_address.map(|listen_addr| librqbit::ListenerOptions {
                listen_addr,
                enable_upnp_port_forwarding: false,
                ipv4_only: true,
                ..Default::default()
            }),
            persistence: None,
            fastresume: false,
            ipv4_only: true,
            ..Default::default()
        };
        Self::new_with_options(output_root, options).await
    }

    async fn new_with_options(
        output_root: &Path,
        options: librqbit::SessionOptions,
    ) -> Result<Self, DownloadError> {
        let session = librqbit::Session::new_with_opts(output_root.to_path_buf(), options)
            .await
            .map_err(torrent_engine_error)?;
        Ok(Self { session })
    }

    pub async fn add_torrent_bytes(
        &self,
        metainfo: &[u8],
        selected_file_indices: &[usize],
        output_folder: &Path,
        initial_peers: Vec<SocketAddr>,
    ) -> Result<Arc<librqbit::ManagedTorrent>, DownloadError> {
        let parsed = parse_torrent_preview(metainfo)?;
        let metainfo = filter_metainfo_tracker_networks(&parsed.metainfo).await?;
        let response = self
            .session
            .add_torrent(
                librqbit::AddTorrent::from_bytes(metainfo),
                Some(librqbit::AddTorrentOptions {
                    only_files: Some(selected_file_indices.to_vec()),
                    overwrite: true,
                    output_folder: Some(output_folder.to_string_lossy().into_owned()),
                    initial_peers: (!initial_peers.is_empty()).then_some(initial_peers),
                    ..Default::default()
                }),
            )
            .await
            .map_err(torrent_engine_error)?;
        response.into_handle().ok_or_else(|| {
            DownloadError::new(
                ErrorCode::Internal,
                "torrent engine did not return a task handle",
                false,
            )
        })
    }

    pub async fn remove(
        &self,
        handle: &Arc<librqbit::ManagedTorrent>,
    ) -> Result<(), DownloadError> {
        self.session
            .delete(handle.id().into(), false)
            .await
            .map_err(torrent_engine_error)
    }

    pub async fn resolve_preview(
        &self,
        preview: &TorrentPreview,
    ) -> Result<ResolvedTorrentPreview, DownloadError> {
        let mut resolved = match preview.source_kind.as_str() {
            "torrent" => parse_torrent_preview(preview.metainfo.as_deref().ok_or_else(|| {
                DownloadError::new(
                    ErrorCode::TorrentInvalid,
                    "torrent preview has no metadata",
                    false,
                )
            })?)?,
            "magnet" => {
                let source = preview.source_uri.as_deref().ok_or_else(|| {
                    DownloadError::new(
                        ErrorCode::TorrentInvalid,
                        "magnet preview has no source",
                        false,
                    )
                })?;
                let source = filter_magnet_trackers(source).await?;
                let response = self
                    .session
                    .add_torrent(
                        librqbit::AddTorrent::from_url(source),
                        Some(librqbit::AddTorrentOptions {
                            list_only: true,
                            ..Default::default()
                        }),
                    )
                    .await
                    .map_err(torrent_engine_error)?;
                match response {
                    librqbit::AddTorrentResponse::ListOnly(response) => {
                        parse_torrent_preview(&response.torrent_bytes)?
                    }
                    _ => {
                        return Err(DownloadError::new(
                            ErrorCode::TorrentEngine,
                            "torrent engine unexpectedly started a preview",
                            true,
                        ));
                    }
                }
            }
            _ => {
                return Err(DownloadError::new(
                    ErrorCode::TorrentInvalid,
                    "unsupported torrent preview source",
                    false,
                ));
            }
        };
        resolved.metainfo = filter_metainfo_tracker_networks(&resolved.metainfo).await?;
        Ok(resolved)
    }
}

fn torrent_engine_error(error: impl std::fmt::Display) -> DownloadError {
    DownloadError::new(ErrorCode::TorrentEngine, error.to_string(), true)
}

pub async fn run_torrent_task(
    engine: &TorrentEngine,
    db: &Db,
    task: &Task,
    worker_id: &str,
    context: &TorrentRunContext<'_>,
) -> Result<TorrentTaskOutcome, DownloadError> {
    run_torrent_task_with_peers(engine, db, task, worker_id, context, Vec::new()).await
}

async fn run_torrent_task_with_peers(
    engine: &TorrentEngine,
    db: &Db,
    task: &Task,
    worker_id: &str,
    context: &TorrentRunContext<'_>,
    initial_peers: Vec<SocketAddr>,
) -> Result<TorrentTaskOutcome, DownloadError> {
    let target = TorrentStorageTarget::resolve(task, context.data_root, context.require_mount)?;
    let metainfo = task.torrent_metainfo.as_deref().ok_or_else(|| {
        DownloadError::new(
            ErrorCode::TorrentInvalid,
            "torrent task has no metadata",
            false,
        )
    })?;
    let metadata = parse_torrent_preview(metainfo)?;
    let selected_files = task
        .selected_file_indices
        .iter()
        .map(|index| {
            metadata.files.get(*index).cloned().ok_or_else(|| {
                DownloadError::new(
                    ErrorCode::TorrentInvalid,
                    "selected torrent file does not exist",
                    false,
                )
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let selected_total: u64 = selected_files.iter().map(|file| file.size_bytes).sum();
    let mut published = task.content_completed_at.is_some();
    if !published
        && task.phase.as_deref() == Some("publishing")
        && target.recover_published_path()?.is_some()
    {
        db.publish_torrent(task, worker_id).await?;
        published = true;
    }
    if !published {
        let remaining_bytes = selected_total.saturating_sub(task.received_bytes);
        db.reserve_space(
            task,
            remaining_bytes,
            target.available_bytes()?,
            context.minimum_free_bytes,
        )
        .await?;
    }
    let mut output_folder = if published {
        target.final_path()
    } else {
        target.prepare_partial()?
    };
    let mut handle = engine
        .add_torrent_bytes(
            metainfo,
            &task.selected_file_indices,
            &output_folder,
            initial_peers.clone(),
        )
        .await?;
    let mut uploaded_before_session = task.uploaded_bytes;
    let mut seed_started = task.seed_started_at.as_deref().and_then(parse_timestamp);
    let mut interval = tokio::time::interval(std::time::Duration::from_secs(1));

    let outcome = async {
        loop {
            tokio::select! {
                _ = context.shutdown.cancelled() => {
                    let _ = engine.remove(&handle).await;
                    return Ok(TorrentTaskOutcome::Shutdown);
                }
                _ = interval.tick() => {}
            }

            let current = db.get_task(&task.id).await?.ok_or_else(|| {
                DownloadError::new(ErrorCode::Database, "torrent task disappeared", false)
            })?;
            if current.worker_id.as_deref() != Some(worker_id)
                || !matches!(current.status.as_str(), "running" | "seeding")
            {
                engine.remove(&handle).await?;
                return Ok(TorrentTaskOutcome::Interrupted);
            }
            if let Some(control) = current.control_requested.as_deref() {
                let _ = engine.remove(&handle).await;
                match control {
                    "pause" => db.finish_control(task, false).await?,
                    "cancel" => {
                        if !published {
                            target.remove_partial()?;
                        }
                        db.finish_control(task, true).await?;
                    }
                    "stop_seeding" if published => db.complete_torrent(task, worker_id).await?,
                    _ => {
                        return Err(DownloadError::new(
                            ErrorCode::Internal,
                            "invalid torrent control request",
                            false,
                        ));
                    }
                }
                return Ok(if control == "stop_seeding" {
                    TorrentTaskOutcome::Complete
                } else {
                    TorrentTaskOutcome::Interrupted
                });
            }

            let stats = handle.stats();
            if let Some(error) = stats.error.as_deref() {
                return Err(DownloadError::new(ErrorCode::TorrentEngine, error, true));
            }
            let uploaded_bytes = uploaded_before_session.saturating_add(stats.uploaded_bytes);
            let seeding = published && stats.finished;
            let checkpoint =
                progress::checkpoint(&stats, uploaded_before_session, published, &selected_files);
            let update = match checkpoint {
                progress::TorrentCheckpoint::Checking => {
                    db.torrent_checking(task, worker_id, TORRENT_LEASE, selected_total)
                        .await?
                }
                progress::TorrentCheckpoint::Transfer(progress) => {
                    db.torrent_progress(task, worker_id, TORRENT_LEASE, &progress)
                        .await?
                }
            };
            match update {
                TorrentProgressUpdate::Updated => {}
                TorrentProgressUpdate::ControlPending => continue,
                TorrentProgressUpdate::LeaseLost => {
                    engine.remove(&handle).await?;
                    return Ok(TorrentTaskOutcome::Interrupted);
                }
            }

            if stats.finished && !published {
                uploaded_before_session = uploaded_bytes;
                engine.remove(&handle).await?;
                db.begin_torrent_publish(task, worker_id).await?;
                target.publish()?;
                db.publish_torrent(task, worker_id).await?;
                published = true;
                seed_started = Some(time::OffsetDateTime::now_utc());
                output_folder = target.final_path();
                handle = engine
                    .add_torrent_bytes(
                        metainfo,
                        &task.selected_file_indices,
                        &output_folder,
                        initial_peers.clone(),
                    )
                    .await?;
                continue;
            }

            if seeding {
                let elapsed = seed_started.map_or(0, |started| {
                    (time::OffsetDateTime::now_utc() - started)
                        .whole_seconds()
                        .max(0) as u64
                });
                let total = selected_total;
                if seeding_limit_reached(
                    uploaded_bytes,
                    total,
                    task.seed_ratio_limit,
                    elapsed,
                    task.seed_time_limit_seconds,
                ) {
                    engine.remove(&handle).await?;
                    db.complete_torrent(task, worker_id).await?;
                    return Ok(TorrentTaskOutcome::Complete);
                }
            }
        }
    }
    .await;
    if outcome.is_err() {
        let _ = engine.remove(&handle).await;
    }
    outcome
}

fn parse_timestamp(value: &str) -> Option<time::OffsetDateTime> {
    time::OffsetDateTime::parse(value, &time::format_description::well_known::Rfc3339).ok()
}

pub fn parse_torrent_preview(bytes: &[u8]) -> Result<ResolvedTorrentPreview, DownloadError> {
    let metainfo = librqbit::torrent_from_bytes(bytes).map_err(|error| {
        DownloadError::new(
            ErrorCode::TorrentInvalid,
            format!("invalid torrent metadata: {error}"),
            false,
        )
    })?;
    let info_hash = metainfo.info_hash.as_string();
    let info = metainfo.info.data.clone().validate().map_err(|error| {
        DownloadError::new(
            ErrorCode::TorrentInvalid,
            format!("invalid torrent file paths: {error}"),
            false,
        )
    })?;
    if info.info().private {
        return Err(DownloadError::new(
            ErrorCode::TorrentPrivate,
            "private torrents are not supported",
            false,
        ));
    }
    let name = info
        .name()
        .map(|value| value.into_owned())
        .unwrap_or_else(|| "torrent".to_owned());
    let mut total_bytes = 0_u64;
    let mut files = Vec::new();
    for (file_index, file) in info.iter_file_details().enumerate() {
        if file_index >= MAX_TORRENT_FILES {
            return Err(DownloadError::new(
                ErrorCode::TorrentInvalid,
                "torrent has too many files (maximum 10000)",
                false,
            ));
        }
        if file.attrs().symlink || file.symlink_path.is_some() {
            return Err(DownloadError::new(
                ErrorCode::TorrentInvalid,
                "torrent contains a symbolic link entry",
                false,
            ));
        }
        total_bytes = total_bytes.checked_add(file.len).ok_or_else(|| {
            DownloadError::new(
                ErrorCode::SizeLimit,
                "torrent size exceeds supported range",
                false,
            )
        })?;
        files.push(TorrentFile {
            file_index,
            path: file.filename.to_pathbuf().to_string_lossy().into_owned(),
            size_bytes: file.len,
        });
    }
    let trackers = usable_trackers(metainfo.iter_announce().map(|tracker| {
        let raw = tracker_text(tracker.as_ref())?;
        validate_tracker(raw)?;
        Ok(raw)
    }))?;
    Ok(ResolvedTorrentPreview {
        info_hash,
        name,
        metainfo: encode_torrent_trackers(&metainfo, &trackers),
        total_bytes,
        files,
    })
}

fn tracker_text(bytes: &[u8]) -> Result<&str, DownloadError> {
    std::str::from_utf8(bytes).map_err(|_| blocked_tracker("tracker URL is not UTF-8"))
}

fn usable_trackers<T>(
    results: impl IntoIterator<Item = Result<T, DownloadError>>,
) -> Result<Vec<T>, DownloadError> {
    let mut trackers = Vec::new();
    let mut errors = Vec::new();
    for result in results {
        match result {
            Ok(tracker) => trackers.push(tracker),
            Err(error) => {
                tracing::warn!(message = %error.message, "ignoring unusable torrent tracker");
                errors.push(error);
            }
        }
    }
    if trackers.is_empty() && !errors.is_empty() {
        return Err(DownloadError::new(
            errors[0].code,
            format!(
                "no usable public tracker: {}",
                errors
                    .iter()
                    .take(5)
                    .map(|error| error.message.as_str())
                    .collect::<Vec<_>>()
                    .join("; ")
            ),
            errors.iter().all(|error| error.retryable),
        ));
    }
    Ok(trackers)
}

fn validate_tracker(raw: &str) -> Result<url::Url, DownloadError> {
    let tracker = url::Url::parse(raw).map_err(|_| blocked_tracker("invalid tracker URL"))?;
    let host = tracker
        .host_str()
        .unwrap_or("<missing host>")
        .trim_matches(['[', ']']);
    if !matches!(tracker.scheme(), "http" | "https" | "udp") {
        return Err(blocked_tracker(format!(
            "tracker {host}: unsupported URL scheme"
        )));
    }
    if !tracker.username().is_empty() || tracker.password().is_some() {
        return Err(blocked_tracker(format!(
            "tracker {host}: URL credentials are not supported"
        )));
    }
    if tracker.host_str().is_none() {
        return Err(blocked_tracker("tracker URL has no host"));
    }
    if host.parse::<IpAddr>().is_ok_and(is_non_public_ip) {
        return Err(blocked_tracker(format!(
            "tracker {host}: non-public address is blocked"
        )));
    }
    Ok(tracker)
}

async fn filter_tracker_networks(trackers: &[&str]) -> Result<Vec<String>, DownloadError> {
    let trackers = trackers
        .iter()
        .map(|tracker| (*tracker).to_owned())
        .collect::<Vec<_>>();
    let results = futures_util::stream::iter(trackers)
        .map(|tracker| async move {
            validate_tracker_network(&tracker).await?;
            Ok(tracker)
        })
        .buffered(8)
        .collect::<Vec<_>>()
        .await;
    usable_trackers(results)
}

async fn filter_metainfo_tracker_networks(bytes: &[u8]) -> Result<Vec<u8>, DownloadError> {
    let metainfo = librqbit::torrent_from_bytes(bytes)
        .map_err(|error| DownloadError::new(ErrorCode::TorrentInvalid, error.to_string(), false))?;
    let trackers = usable_trackers(
        metainfo
            .iter_announce()
            .map(|tracker| tracker_text(tracker.as_ref())),
    )?;
    let trackers = filter_tracker_networks(&trackers).await?;
    Ok(encode_torrent_trackers(&metainfo, &trackers))
}

async fn filter_magnet_trackers(source: &str) -> Result<String, DownloadError> {
    let magnet = librqbit::Magnet::parse(source)
        .map_err(|error| DownloadError::new(ErrorCode::TorrentInvalid, error.to_string(), false))?;
    let trackers = magnet
        .trackers
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>();
    let trackers = filter_tracker_networks(&trackers).await?;
    let mut source = url::Url::parse(source)
        .map_err(|_| DownloadError::new(ErrorCode::TorrentInvalid, "invalid magnet URL", false))?;
    let pairs = source
        .query_pairs()
        .filter(|(key, _)| key != "tr")
        .map(|(key, value)| (key.into_owned(), value.into_owned()))
        .collect::<Vec<_>>();
    source.set_query(None);
    {
        let mut query = source.query_pairs_mut();
        query.extend_pairs(pairs);
        for tracker in trackers {
            query.append_pair("tr", &tracker);
        }
    }
    Ok(source.into())
}

async fn validate_tracker_network(raw: &str) -> Result<(), DownloadError> {
    let tracker = validate_tracker(raw)?;
    let host = tracker
        .host_str()
        .expect("validated tracker host")
        .trim_matches(['[', ']']);
    if host.parse::<IpAddr>().is_ok() {
        return Ok(());
    }
    let port = tracker
        .port_or_known_default()
        .or_else(|| (tracker.scheme() == "udp").then_some(80))
        .ok_or_else(|| blocked_tracker(format!("tracker {host}: missing port")))?;
    validate_tracker_dns(
        host,
        async {
            tokio::net::lookup_host((host, port))
                .await
                .map(|addresses| addresses.collect())
        },
        std::time::Duration::from_secs(5),
    )
    .await
}

async fn validate_tracker_dns(
    host: &str,
    lookup: impl std::future::Future<Output = std::io::Result<Vec<SocketAddr>>>,
    timeout: std::time::Duration,
) -> Result<(), DownloadError> {
    let addresses = tokio::time::timeout(timeout, lookup)
        .await
        .map_err(|_| {
            DownloadError::new(
                ErrorCode::Timeout,
                format!("tracker {host}: DNS lookup timed out"),
                true,
            )
        })?
        .map_err(|error| {
            DownloadError::new(
                ErrorCode::Dns,
                format!("tracker {host}: DNS lookup failed: {error}"),
                true,
            )
        })?;
    if addresses.is_empty() {
        return Err(DownloadError::new(
            ErrorCode::Dns,
            format!("tracker {host}: DNS returned no addresses"),
            true,
        ));
    }
    if let Some(address) = addresses
        .iter()
        .find(|address| is_non_public_ip(address.ip()))
    {
        return Err(blocked_tracker(format!(
            "tracker {host}: DNS resolved to non-public address {}",
            address.ip()
        )));
    }
    Ok(())
}

fn blocked_tracker(message: impl Into<String>) -> DownloadError {
    DownloadError::new(ErrorCode::TorrentUnsafe, message, false)
}

fn bencode_string(bytes: &[u8]) -> Vec<u8> {
    let mut encoded = format!("{}:", bytes.len()).into_bytes();
    encoded.extend_from_slice(bytes);
    encoded
}

fn encode_torrent_trackers(
    metainfo: &librqbit::TorrentMetaV1Borrowed<'_>,
    trackers: &[impl AsRef<str>],
) -> Vec<u8> {
    let mut fields: BTreeMap<&[u8], Vec<u8>> = BTreeMap::new();
    for (key, value) in [
        (b"comment".as_slice(), metainfo.comment.as_ref()),
        (b"created by".as_slice(), metainfo.created_by.as_ref()),
        (b"encoding".as_slice(), metainfo.encoding.as_ref()),
        (b"publisher".as_slice(), metainfo.publisher.as_ref()),
        (b"publisher-url".as_slice(), metainfo.publisher_url.as_ref()),
    ] {
        if let Some(value) = value {
            fields.insert(key, bencode_string(value.as_ref()));
        }
    }
    if let Some(date) = metainfo.creation_date {
        fields.insert(b"creation date", format!("i{date}e").into_bytes());
    }
    // Re-encoding the info dictionary can change the swarm identity or file paths.
    // Copy its exact bytes, including fields unknown to librqbit.
    fields.insert(b"info", metainfo.info.raw_bytes.as_ref().to_vec());
    if let Some(first) = trackers.first() {
        fields.insert(b"announce", bencode_string(first.as_ref().as_bytes()));
        let mut list = b"l".to_vec();
        for tracker in trackers {
            list.push(b'l');
            list.extend(bencode_string(tracker.as_ref().as_bytes()));
            list.push(b'e');
        }
        list.push(b'e');
        fields.insert(b"announce-list", list);
    }
    let mut bytes = b"d".to_vec();
    for (key, value) in fields {
        bytes.extend(bencode_string(key));
        bytes.extend(value);
    }
    bytes.push(b'e');
    bytes
}

fn is_non_public_ip(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => {
            address.is_private()
                || address.is_loopback()
                || address.is_link_local()
                || address.is_unspecified()
                || address.is_multicast()
                || address.is_broadcast()
                || address.is_documentation()
        }
        IpAddr::V6(address) => {
            address
                .to_ipv4_mapped()
                .is_some_and(|address| is_non_public_ip(IpAddr::V4(address)))
                || address.is_loopback()
                || address.is_unspecified()
                || address.is_multicast()
                || (address.segments()[0] & 0xfe00) == 0xfc00
                || (address.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

pub fn seeding_limit_reached(
    uploaded_bytes: u64,
    total_bytes: u64,
    ratio_limit: f64,
    elapsed_seconds: u64,
    time_limit_seconds: u64,
) -> bool {
    let ratio_reached = ratio_limit <= 0.0
        || total_bytes > 0 && uploaded_bytes as f64 / total_bytes as f64 >= ratio_limit;
    ratio_reached || elapsed_seconds >= time_limit_seconds
}
