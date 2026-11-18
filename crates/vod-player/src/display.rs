/**
 * [INPUT]: 接收播放抑制决定，连接 Weston 显示状态套接字。
 * [OUTPUT]: 以请求编号确认 active；播放期间续租；停止时释放。
 * [POS]: 控制器与原生空闲状态机的客户端边界。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use std::path::PathBuf;
use std::time::{Duration, Instant};

use serde::Deserialize;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;
use tokio::time::timeout;

use crate::protocol::{ActualAudioRouteKind, PlaybackOwner, PlayerState};

const COMMAND_TIMEOUT: Duration = Duration::from_millis(500);
const RETRY_DELAY: Duration = Duration::from_secs(5);
const RENEW_INTERVAL: Duration = Duration::from_secs(1);
const MAX_RESPONSE_BYTES: u64 = 4096;

pub(crate) fn inhibits(
    owner: Option<PlaybackOwner>,
    state: PlayerState,
    route: ActualAudioRouteKind,
) -> bool {
    state == PlayerState::Playing
        && match owner {
            Some(PlaybackOwner::Video) => true,
            Some(PlaybackOwner::Music) => !matches!(
                route,
                ActualAudioRouteKind::Bluetooth | ActualAudioRouteKind::Local
            ),
            None => false,
        }
}

#[derive(Debug, Deserialize)]
struct Snapshot {
    #[serde(rename = "requestId")]
    request_id: Option<u64>,
    state: String,
    supported: bool,
    reason: Option<String>,
}

pub(crate) struct Display {
    path: PathBuf,
    connection: Option<BufReader<UnixStream>>,
    retry_at: Option<Instant>,
    last_sent: Option<(bool, Instant)>,
    next_request_id: u64,
}

impl Default for Display {
    fn default() -> Self {
        Self {
            path: PathBuf::from("/run/cyberos-tv/display.sock"),
            connection: None,
            retry_at: None,
            last_sent: None,
            next_request_id: 1,
        }
    }
}

impl Display {
    #[cfg(test)]
    pub(crate) fn at_path(path: PathBuf) -> Self {
        Self {
            path,
            ..Default::default()
        }
    }

    pub(crate) async fn playback(&mut self, inhibit: bool) {
        if self
            .last_sent
            .is_some_and(|(previous, sent)| previous == inhibit && sent.elapsed() < RENEW_INTERVAL)
        {
            return;
        }
        if self.retry_at.is_some_and(|retry| Instant::now() < retry) {
            return;
        }
        match timeout(COMMAND_TIMEOUT, self.exchange(inhibit)).await {
            Ok(Ok(())) => {
                self.retry_at = None;
                self.last_sent = Some((inhibit, Instant::now()));
            }
            result => {
                self.connection = None;
                self.last_sent = None;
                self.retry_at = Some(Instant::now() + RETRY_DELAY);
                tracing::warn!(
                    ?result,
                    "native display inhibition unavailable; playback continues"
                );
            }
        }
    }

    async fn exchange(&mut self, inhibit: bool) -> std::io::Result<()> {
        let request_id = self.next_request_id;
        self.next_request_id = self.next_request_id.wrapping_add(1).max(1);
        if self.connection.is_none() {
            self.connection = Some(BufReader::new(UnixStream::connect(&self.path).await?));
        }
        let connection = self
            .connection
            .as_mut()
            .expect("display connection is initialized");
        connection
            .get_mut()
            .write_all(format!("PLAYBACK {} {request_id}\n", u8::from(inhibit)).as_bytes())
            .await?;
        loop {
            let mut bytes = Vec::new();
            let count = connection
                .take(MAX_RESPONSE_BYTES + 1)
                .read_until(b'\n', &mut bytes)
                .await?;
            if count == 0 || count as u64 > MAX_RESPONSE_BYTES || bytes.last() != Some(&b'\n') {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "invalid display response",
                ));
            }
            let snapshot: Snapshot =
                serde_json::from_slice(&bytes).map_err(std::io::Error::other)?;
            if snapshot.request_id != Some(request_id) {
                continue;
            }
            if !snapshot.supported {
                return Err(std::io::Error::other(
                    snapshot
                        .reason
                        .unwrap_or_else(|| "display module unsupported".into()),
                ));
            }
            if !matches!(snapshot.state.as_str(), "active" | "screensaver" | "off") {
                return Err(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "invalid display state",
                ));
            }
            if inhibit && snapshot.state != "active" {
                return Err(std::io::Error::other("display wake was not confirmed"));
            }
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::UnixListener;

    #[test]
    fn only_playing_video_or_unresolved_or_hdmi_music_holds_the_display() {
        for route in [
            ActualAudioRouteKind::Hdmi,
            ActualAudioRouteKind::Bluetooth,
            ActualAudioRouteKind::Local,
            ActualAudioRouteKind::Unknown,
            ActualAudioRouteKind::Unavailable,
        ] {
            assert!(inhibits(
                Some(PlaybackOwner::Video),
                PlayerState::Playing,
                route
            ));
            assert!(!inhibits(
                Some(PlaybackOwner::Video),
                PlayerState::Paused,
                route
            ));
            assert!(!inhibits(
                Some(PlaybackOwner::Music),
                PlayerState::Stopped,
                route
            ));
            assert_eq!(
                inhibits(Some(PlaybackOwner::Music), PlayerState::Playing, route),
                !matches!(
                    route,
                    ActualAudioRouteKind::Bluetooth | ActualAudioRouteKind::Local
                )
            );
        }
    }

    #[tokio::test]
    async fn wake_waits_for_active_despite_interleaved_broadcasts_and_releases() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("display.sock");
        let listener = UnixListener::bind(&path).unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut stream = BufReader::new(stream);
            let mut command = String::new();
            stream.read_line(&mut command).await.unwrap();
            let wake_id: u64 = command
                .trim()
                .strip_prefix("PLAYBACK 1 ")
                .unwrap()
                .parse()
                .unwrap();
            assert_ne!(wake_id, 0);
            stream
                .get_mut()
                .write_all(b"{\"state\":\"off\",\"supported\":true,\"reason\":null}\n")
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(40)).await;
            stream
                .get_mut()
                .write_all(
                    format!(
                        "{{\"requestId\":{wake_id},\"state\":\"active\",\"supported\":true,\"reason\":null}}\n"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            command.clear();
            stream.read_line(&mut command).await.unwrap();
            let release_id: u64 = command
                .trim()
                .strip_prefix("PLAYBACK 0 ")
                .unwrap()
                .parse()
                .unwrap();
            assert_ne!(release_id, 0);
            assert_ne!(release_id, wake_id);
            stream
                .get_mut()
                .write_all(
                    format!(
                        "{{\"requestId\":{wake_id},\"state\":\"active\",\"supported\":true,\"reason\":null}}\n\
                        {{\"state\":\"off\",\"supported\":true,\"reason\":null}}\n"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(40)).await;
            stream
                .get_mut()
                .write_all(
                    format!(
                        "{{\"requestId\":{release_id},\"state\":\"off\",\"supported\":true,\"reason\":null}}\n"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let mut display = Display {
            path,
            ..Default::default()
        };
        let start = Instant::now();
        display.playback(true).await;
        assert!(start.elapsed() >= Duration::from_millis(35));
        assert!(display.retry_at.is_none());
        let start = Instant::now();
        display.playback(false).await;
        assert!(start.elapsed() >= Duration::from_millis(35));
        assert!(display.retry_at.is_none());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn wake_ignores_queued_active_and_off_until_its_command_acknowledgement() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("display.sock");
        let listener = UnixListener::bind(&path).unwrap();
        let (queued, queued_rx) = tokio::sync::oneshot::channel();
        let (allow_ack, allow_ack_rx) = tokio::sync::oneshot::channel();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut stream = BufReader::new(stream);
            let mut command = String::new();
            stream.read_line(&mut command).await.unwrap();
            stream
                .get_mut()
                .write_all(
                    b"{\"state\":\"active\",\"supported\":true,\"reason\":null}\n\
                    {\"state\":\"off\",\"supported\":true,\"reason\":null}\n\
                    {\"requestId\":0,\"state\":\"off\",\"supported\":false,\"reason\":\"stale\"}\n",
                )
                .await
                .unwrap();
            queued.send(()).unwrap();
            if allow_ack_rx.await.is_err() {
                return;
            }
            let request_id: u64 = command
                .trim()
                .strip_prefix("PLAYBACK 1 ")
                .expect("wake command carries its request identifier")
                .parse()
                .unwrap();
            assert_ne!(request_id, 0);
            stream
                .get_mut()
                .write_all(
                    format!(
                        "{{\"requestId\":{request_id},\"state\":\"active\",\"supported\":true,\"reason\":null}}\n"
                    )
                    .as_bytes(),
                )
                .await
                .unwrap();
        });
        let client = tokio::spawn(async move {
            let mut display = Display::at_path(path);
            display.exchange(true).await
        });
        queued_rx.await.unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(
            !client.is_finished(),
            "queued broadcasts must not acknowledge a new wake command"
        );
        allow_ack.send(()).unwrap();
        timeout(Duration::from_secs(1), client)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        server.await.unwrap();
    }

    #[tokio::test]
    async fn stale_acknowledgements_time_out_and_back_off_instead_of_confirming_wake() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("display.sock");
        let listener = UnixListener::bind(&path).unwrap();
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut stream = BufReader::new(stream);
            let mut command = String::new();
            stream.read_line(&mut command).await.unwrap();
            stream
                .get_mut()
                .write_all(
                    b"{\"requestId\":0,\"state\":\"active\",\"supported\":true,\"reason\":null}\n",
                )
                .await
                .unwrap();
            command.clear();
            assert_eq!(stream.read_line(&mut command).await.unwrap(), 0);
        });
        let mut display = Display::at_path(path);
        timeout(Duration::from_secs(1), display.playback(true))
            .await
            .unwrap();
        assert!(display.retry_at.is_some());
        assert!(display.last_sent.is_none());
        assert!(display.connection.is_none());
        server.await.unwrap();
    }

    #[tokio::test]
    async fn unavailable_module_degrades_with_connection_backoff() {
        let mut display = Display {
            path: PathBuf::from("/nonexistent/cyberos-display.sock"),
            ..Default::default()
        };
        display.playback(true).await;
        let retry = display.retry_at.expect("failed connections back off");
        display.playback(false).await;
        assert_eq!(display.retry_at, Some(retry));
    }
}
