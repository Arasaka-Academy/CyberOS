/**
 * [INPUT]: 依赖 librqbit 引擎统计和数据库任务契约。
 * [OUTPUT]: 提供 BT 引擎快照到产品进度的转换。
 * [POS]: 隔离校验扫描量与选中文件下载量。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use crate::db::{TorrentFile, TorrentProgress};
use librqbit::TorrentStats;

#[derive(Debug)]
pub(super) enum TorrentCheckpoint {
    Checking,
    Transfer(TorrentProgress),
}

pub(super) fn checkpoint(
    stats: &TorrentStats,
    uploaded_before_session: u64,
    published: bool,
    selected_files: &[TorrentFile],
) -> TorrentCheckpoint {
    if matches!(
        stats.state,
        librqbit::TorrentStatsState::Initializing { .. }
    ) {
        return TorrentCheckpoint::Checking;
    }
    let file_progress: Vec<_> = selected_files
        .iter()
        .map(|file| {
            (
                file.file_index,
                stats
                    .file_progress
                    .get(file.file_index)
                    .copied()
                    .unwrap_or_default()
                    .min(file.size_bytes),
            )
        })
        .collect();
    let (speed, upload_speed, peers) = stats.live.as_ref().map_or((0, 0, 0), |live| {
        (
            live.download_speed.as_bytes(),
            live.upload_speed.as_bytes(),
            live.snapshot.peer_stats.live,
        )
    });
    TorrentCheckpoint::Transfer(TorrentProgress {
        received_bytes: file_progress.iter().map(|(_, received)| received).sum(),
        total_bytes: selected_files.iter().map(|file| file.size_bytes).sum(),
        speed_bytes_per_second: speed,
        uploaded_bytes: uploaded_before_session.saturating_add(stats.uploaded_bytes),
        upload_speed_bytes_per_second: upload_speed,
        peer_count: peers,
        file_progress,
        seeding: published && stats.finished,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use librqbit::TorrentStatsState;

    fn stats(state: TorrentStatsState) -> TorrentStats {
        TorrentStats {
            state,
            file_progress: vec![4, 18, 8],
            error: None,
            progress_bytes: 25,
            uploaded_bytes: 3,
            total_bytes: 30,
            finished: false,
            live: None,
        }
    }

    fn files() -> Vec<TorrentFile> {
        vec![
            TorrentFile {
                file_index: 0,
                path: "a".into(),
                size_bytes: 5,
            },
            TorrentFile {
                file_index: 2,
                path: "c".into(),
                size_bytes: 10,
            },
        ]
    }

    #[test]
    fn initializing_stats_never_replace_confirmed_download_progress() {
        for checked_bytes in [0, 25, 30] {
            let mut stats = stats(TorrentStatsState::Initializing { paused: false });
            stats.progress_bytes = checked_bytes;
            assert!(matches!(
                checkpoint(&stats, 7, false, &files()),
                TorrentCheckpoint::Checking
            ));
        }
    }

    #[test]
    fn live_progress_sums_only_selected_files_and_uses_file_sizes() {
        let TorrentCheckpoint::Transfer(progress) =
            checkpoint(&stats(TorrentStatsState::Live), 7, false, &files())
        else {
            panic!("live stats require a transfer checkpoint")
        };
        assert_eq!(progress.total_bytes, 15);
        assert_eq!(progress.received_bytes, 12);
        assert_eq!(progress.file_progress, vec![(0, 4), (2, 8)]);
        assert_eq!(progress.uploaded_bytes, 10);
    }

    #[test]
    fn confirmed_corruption_can_reduce_download_progress() {
        let mut stats = stats(TorrentStatsState::Live);
        stats.file_progress = vec![1, 18, 2];
        let TorrentCheckpoint::Transfer(progress) = checkpoint(&stats, 7, false, &files()) else {
            panic!("live stats require a transfer checkpoint")
        };
        assert_eq!(progress.received_bytes, 3);
    }

    #[test]
    fn selected_file_progress_is_bounded_by_real_file_sizes() {
        let mut stats = stats(TorrentStatsState::Paused);
        stats.file_progress = vec![9, 99, 20];
        let TorrentCheckpoint::Transfer(progress) = checkpoint(&stats, 7, false, &files()) else {
            panic!("paused stats require a transfer checkpoint")
        };
        assert_eq!(progress.received_bytes, 15);
        assert_eq!(progress.file_progress, vec![(0, 5), (2, 10)]);
    }
}
