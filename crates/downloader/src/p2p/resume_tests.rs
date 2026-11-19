/**
 * [INPUT]: 依赖隔离 BT peer、临时业务库与受限存储。
 * [OUTPUT]: 验证真实传输的暂停、恢复、发布和进度。
 * [POS]: 运行生产 BT 循环；不访问公网或产品任务。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use super::*;
use crate::db::Task;
use std::num::NonZeroU32;
use std::path::PathBuf;
use std::time::Duration;

const CONTENT_BYTES: usize = 1024 * 1024;
const PIECE_BYTES: usize = 16 * 1024;

fn fixture() -> Vec<u8> {
    let mut metainfo = format!("d4:infod6:lengthi{CONTENT_BYTES}e4:name11:payload.bin12:piece lengthi{PIECE_BYTES}e6:pieces{}:", CONTENT_BYTES / PIECE_BYTES * 20).into_bytes();
    let hash = [
        18, 255, 52, 123, 79, 39, 214, 158, 31, 50, 142, 111, 75, 85, 115, 227, 102, 110, 18, 47,
    ];
    for _ in 0..CONTENT_BYTES / PIECE_BYTES {
        metainfo.extend_from_slice(&hash);
    }
    metainfo.extend_from_slice(b"ee");
    metainfo
}

fn spawn_runner(
    engine: TorrentEngine,
    db: Db,
    task: Task,
    data: PathBuf,
    peer: SocketAddr,
    shutdown: tokio_util::sync::CancellationToken,
) -> tokio::task::JoinHandle<Result<TorrentTaskOutcome, DownloadError>> {
    tokio::spawn(async move {
        run_torrent_task_with_peers(
            &engine,
            &db,
            &task,
            "peer-test",
            &TorrentRunContext {
                data_root: &data,
                require_mount: false,
                minimum_free_bytes: 0,
                shutdown: &shutdown,
            },
            vec![peer],
        )
        .await
    })
}

async fn task_with_progress(db: &Db, after: u64) -> Task {
    tokio::time::timeout(Duration::from_secs(12), async {
        loop {
            let current = db.get_task("resume-test").await.unwrap().unwrap();
            assert_eq!(current.total_bytes, Some(CONTENT_BYTES as u64));
            if current.received_bytes > after && current.phase.as_deref() == Some("downloading") {
                return current;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("local peer must produce confirmed download progress")
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn local_peer_pause_resume_preserves_progress_and_publishes() {
    let root = tempfile::tempdir().unwrap();
    let seed_root = root.path().join("seed");
    let data = root.path().join("data");
    std::fs::create_dir_all(&seed_root).unwrap();
    std::fs::create_dir_all(data.join("pool-1")).unwrap();
    let content = vec![b'a'; CONTENT_BYTES];
    std::fs::write(seed_root.join("payload.bin"), &content).unwrap();
    let metainfo = fixture();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let peer = listener.local_addr().unwrap();
    drop(listener);
    let seed = TorrentEngine::new_isolated(&seed_root, Some(peer))
        .await
        .unwrap();
    seed.session
        .ratelimits
        .set_upload_bps(NonZeroU32::new(64 * 1024));
    let seed_handle = seed
        .add_torrent_bytes(&metainfo, &[0], &seed_root, Vec::new())
        .await
        .unwrap();
    seed_handle.wait_until_initialized().await.unwrap();
    assert!(seed_handle.stats().finished);

    let database = root.path().join("db.sqlite");
    rusqlite::Connection::open(&database)
        .unwrap()
        .execute_batch(crate::db::TEST_SCHEMA)
        .unwrap();
    let db = Db::open(&database).unwrap();
    db.test_call(move |connection| {
        connection.execute("INSERT INTO download_tasks(id,url,storage_pool_id,target_directory,target_file_name,target_path,partial_path,status,created_at,updated_at,source_kind,torrent_metainfo,total_bytes,selected_file_count,seed_ratio_limit) VALUES('resume-test','','pool-1','.','release','release','.release.part','queued','2026-11-19T00:00:00Z','2026-11-19T00:00:00Z','torrent',?, ?,1,0)", rusqlite::params![metainfo, CONTENT_BYTES as i64]).map_err(DownloadError::database)?;
        connection.execute("INSERT INTO download_task_files VALUES('resume-test',0,'payload.bin',?,1,0)", [CONTENT_BYTES as i64]).map_err(DownloadError::database)?;
        Ok(())
    }).await.unwrap();
    let engine = TorrentEngine::new_isolated(root.path(), None)
        .await
        .unwrap();
    let shutdown = tokio_util::sync::CancellationToken::new();
    let _stop_on_exit = shutdown.clone().drop_guard();
    let task = db
        .claim_torrent("peer-test", TORRENT_LEASE)
        .await
        .unwrap()
        .unwrap();
    let run = spawn_runner(
        engine.clone(),
        db.clone(),
        task,
        data.clone(),
        peer,
        shutdown.clone(),
    );
    let downloading = task_with_progress(&db, 0).await;
    assert!(downloading.received_bytes < CONTENT_BYTES as u64);
    db.test_call(|connection| {
        connection
            .execute(
                "UPDATE download_tasks SET control_requested='pause' WHERE id='resume-test'",
                [],
            )
            .map_err(DownloadError::database)?;
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(4), run)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        TorrentTaskOutcome::Interrupted
    );
    let paused = db.get_task("resume-test").await.unwrap().unwrap();
    assert_eq!(paused.status, "paused");
    assert!(paused.received_bytes >= downloading.received_bytes);
    assert!(paused.received_bytes < CONTENT_BYTES as u64);
    assert_eq!(paused.speed_bytes_per_second, 0);
    assert_eq!(engine.session.with_torrents(|torrents| torrents.count()), 0);
    db.test_call(|connection| {
        connection
            .execute(
                "UPDATE download_tasks SET status='queued' WHERE id='resume-test'",
                [],
            )
            .map_err(DownloadError::database)?;
        Ok(())
    })
    .await
    .unwrap();
    let task = db
        .claim_torrent("peer-test", TORRENT_LEASE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(task.received_bytes, paused.received_bytes);
    let run = spawn_runner(
        engine.clone(),
        db.clone(),
        task,
        data.clone(),
        peer,
        shutdown.clone(),
    );
    let resumed = task_with_progress(&db, paused.received_bytes).await;
    assert!(
        resumed.received_bytes < CONTENT_BYTES as u64,
        "checksum scan must not masquerade as completed content"
    );
    seed.session.ratelimits.set_upload_bps(None);
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(15), run)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        TorrentTaskOutcome::Complete
    );
    let completed = db.get_task("resume-test").await.unwrap().unwrap();
    assert_eq!(completed.status, "completed");
    assert_eq!(completed.received_bytes, CONTENT_BYTES as u64);
    assert_eq!(completed.total_bytes, Some(CONTENT_BYTES as u64));
    assert_eq!(
        std::fs::read(data.join("pool-1/release/payload.bin")).unwrap(),
        content
    );
    assert_eq!(engine.session.with_torrents(|torrents| torrents.count()), 0);
}
