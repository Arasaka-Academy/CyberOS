/**
 * [INPUT]: 依赖 Db 的 BT 进度、预览与发布接口。
 * [OUTPUT]: 验证 BT 所有权和持久化状态。
 * [POS]: 复用共享测试的隔离任务 fixture。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use super::tests::*;
use super::*;

#[tokio::test]
async fn torrent_claims_and_seeding_are_isolated_from_http_slots() {
    let directory = tempfile::tempdir().unwrap();
    let db = Db::open(&directory.path().join("test.sqlite")).unwrap();
    db.test_call(|connection| {
        connection
            .execute_batch(TEST_SCHEMA)
            .map_err(DownloadError::database)?;
        insert_queued_task(connection, "http")?;
        insert_queued_torrent_task(connection, "torrent")?;
        Ok(())
    })
    .await
    .unwrap();

    let http = db
        .claim("http-worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(http.id, "http");
    assert!(
        db.claim("http-worker", Duration::from_secs(30))
            .await
            .unwrap()
            .is_none()
    );

    let torrent = db
        .claim_torrent("torrent-worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(torrent.id, "torrent");
    assert_eq!(torrent.source_kind, "magnet");
    assert_eq!(torrent.selected_file_indices, vec![0]);
    db.reserve_space(&torrent, 10, 100, 5).await.unwrap();

    assert_eq!(
        db.torrent_progress(
            &torrent,
            "torrent-worker",
            Duration::from_secs(30),
            &TorrentProgress {
                received_bytes: 10,
                total_bytes: 10,
                speed_bytes_per_second: 0,
                uploaded_bytes: 4,
                upload_speed_bytes_per_second: 2,
                peer_count: 3,
                file_progress: vec![(0, 10)],
                seeding: false,
            },
        )
        .await
        .unwrap(),
        TorrentProgressUpdate::Updated
    );
    db.begin_torrent_publish(&torrent, "torrent-worker")
        .await
        .unwrap();
    db.publish_torrent(&torrent, "torrent-worker")
        .await
        .unwrap();
    let seeding = db.get_task("torrent").await.unwrap().unwrap();
    assert_eq!(seeding.status, "seeding");
    assert_eq!(seeding.uploaded_bytes, 4);
    let published = db.test_call(|connection| {
        let operation: String = connection.query_row(
            "SELECT operation FROM file_operations WHERE id = 'download:torrent'",
            [],
            |row| row.get(0),
        ).map_err(DownloadError::database)?;
        let recursive: i64 = connection.query_row(
            "SELECT recursive FROM index_queue WHERE storage_pool_id = 'pool-1' AND path = 'release'",
            [],
            |row| row.get(0),
        ).map_err(DownloadError::database)?;
        let reservations: i64 = connection.query_row(
            "SELECT COUNT(*) FROM download_space_reservations WHERE task_id = 'torrent'",
            [],
            |row| row.get(0),
        ).map_err(DownloadError::database)?;
        Ok((operation, recursive, reservations))
    }).await.unwrap();
    assert_eq!(published, ("download".to_owned(), 1, 0));

    db.complete_torrent(&seeding, "torrent-worker")
        .await
        .unwrap();
    let completed = db.get_task("torrent").await.unwrap().unwrap();
    assert_eq!(completed.status, "completed");
    assert!(completed.worker_id.is_none());
}

#[tokio::test]
async fn pausing_seeding_preserves_published_content_and_clears_live_stats() {
    let directory = tempfile::tempdir().unwrap();
    let db = Db::open(&directory.path().join("test.sqlite")).unwrap();
    db.test_call(|connection| {
        connection
            .execute_batch(TEST_SCHEMA)
            .map_err(DownloadError::database)?;
        insert_queued_torrent_task(connection, "torrent")?;
        Ok(())
    })
    .await
    .unwrap();

    let task = db
        .claim_torrent("torrent-worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    db.begin_torrent_publish(&task, "torrent-worker")
        .await
        .unwrap();
    db.publish_torrent(&task, "torrent-worker").await.unwrap();
    assert_eq!(
        db.torrent_progress(
            &task,
            "torrent-worker",
            Duration::from_secs(30),
            &TorrentProgress {
                received_bytes: 10,
                total_bytes: 10,
                speed_bytes_per_second: 0,
                uploaded_bytes: 7,
                upload_speed_bytes_per_second: 4,
                peer_count: 3,
                file_progress: vec![(0, 10)],
                seeding: true,
            },
        )
        .await
        .unwrap(),
        TorrentProgressUpdate::Updated
    );

    db.finish_control(&task, false).await.unwrap();

    let paused = db.get_task("torrent").await.unwrap().unwrap();
    assert_eq!(paused.status, "paused");
    assert!(paused.content_completed_at.is_some());
    assert!(paused.seed_started_at.is_some());
    assert_eq!(paused.uploaded_bytes, 7);
    assert_eq!(paused.upload_speed_bytes_per_second, 0);
    assert_eq!(paused.peer_count, 0);
}

#[tokio::test]
async fn restart_requeues_staging_torrents_but_keeps_published_torrents_seeding() {
    let directory = tempfile::tempdir().unwrap();
    let db = Db::open(&directory.path().join("test.sqlite")).unwrap();
    db.test_call(|connection| {
        connection
            .execute_batch(TEST_SCHEMA)
            .map_err(DownloadError::database)?;
        insert_queued_torrent_task(connection, "staging")?;
        insert_queued_torrent_task(connection, "published")?;
        Ok(())
    })
    .await
    .unwrap();

    let staging = db
        .claim_torrent("staging-worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    let published = db
        .claim_torrent("published-worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    db.begin_torrent_publish(&published, "published-worker")
        .await
        .unwrap();
    db.publish_torrent(&published, "published-worker")
        .await
        .unwrap();
    assert_eq!(
        db.torrent_progress(
            &published,
            "published-worker",
            Duration::from_secs(30),
            &TorrentProgress {
                received_bytes: 10,
                total_bytes: 10,
                speed_bytes_per_second: 0,
                uploaded_bytes: 2,
                upload_speed_bytes_per_second: 1,
                peer_count: 2,
                file_progress: vec![(0, 10)],
                seeding: true,
            },
        )
        .await
        .unwrap(),
        TorrentProgressUpdate::Updated
    );
    db.test_call(|connection| {
        connection
            .execute(
                "UPDATE download_tasks SET lease_expires_at = '1970-01-01T00:00:00Z' WHERE id IN ('staging', 'published')",
                [],
            )
            .map_err(DownloadError::database)?;
        Ok(())
    })
    .await
    .unwrap();

    assert_eq!(db.recover_expired().await.unwrap(), 2);
    let staging = db.get_task(&staging.id).await.unwrap().unwrap();
    assert_eq!(staging.status, "queued");
    assert!(staging.content_completed_at.is_none());
    let published = db.get_task(&published.id).await.unwrap().unwrap();
    assert_eq!(published.status, "seeding");
    assert!(published.content_completed_at.is_some());
    assert_eq!(published.upload_speed_bytes_per_second, 0);
    assert_eq!(published.peer_count, 0);
}

#[tokio::test]
async fn restart_preserves_torrent_publication_recovery_marker() {
    let directory = tempfile::tempdir().unwrap();
    let db = Db::open(&directory.path().join("test.sqlite")).unwrap();
    db.test_call(|connection| {
        connection
            .execute_batch(TEST_SCHEMA)
            .map_err(DownloadError::database)?;
        insert_queued_torrent_task(connection, "publishing")?;
        Ok(())
    })
    .await
    .unwrap();

    let task = db
        .claim_torrent("first-worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    db.begin_torrent_publish(&task, "first-worker")
        .await
        .unwrap();
    db.test_call(|connection| {
        connection
            .execute(
                "UPDATE download_tasks SET lease_expires_at = '1970-01-01T00:00:00Z' WHERE id = 'publishing'",
                [],
            )
            .map_err(DownloadError::database)?;
        Ok(())
    })
    .await
    .unwrap();

    assert_eq!(db.recover_expired().await.unwrap(), 1);
    let recovered = db
        .claim_torrent("recovery-worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(recovered.id, "publishing");
    assert_eq!(recovered.phase.as_deref(), Some("publishing"));
}

#[tokio::test]
async fn torrent_preview_resolution_is_lease_owned_and_atomic() {
    let directory = tempfile::tempdir().unwrap();
    let db = Db::open(&directory.path().join("test.sqlite")).unwrap();
    db.test_call(|connection| {
        connection.execute_batch(TEST_SCHEMA).map_err(DownloadError::database)?;
        connection.execute(
            "INSERT INTO torrent_previews (id, source_kind, metainfo, status, created_at, updated_at, expires_at) \
             VALUES ('preview', 'torrent', x'64617461', 'queued', ?, ?, ?)",
            params![now_iso(), now_iso(), future_iso(Duration::from_secs(60))],
        ).map_err(DownloadError::database)?;
        Ok(())
    }).await.unwrap();

    let preview = db
        .claim_torrent_preview("resolver", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(preview.id, "preview");
    assert_eq!(preview.metainfo.as_deref(), Some(b"data".as_slice()));
    assert!(
        db.renew_torrent_preview_lease("preview", "resolver", Duration::from_secs(30))
            .await
            .unwrap()
    );
    assert!(
        !db.renew_torrent_preview_lease("preview", "other", Duration::from_secs(30))
            .await
            .unwrap()
    );
    assert!(
        db.claim_torrent_preview("other", Duration::from_secs(30))
            .await
            .unwrap()
            .is_none()
    );

    db.complete_torrent_preview(
        &preview,
        "resolver",
        &ResolvedTorrentPreview {
            info_hash: "0123456789012345678901234567890123456789".to_owned(),
            name: "release".to_owned(),
            metainfo: b"normalized".to_vec(),
            total_bytes: 12,
            files: vec![TorrentFile {
                file_index: 0,
                path: "release.bin".to_owned(),
                size_bytes: 12,
            }],
        },
    )
    .await
    .unwrap();

    let stored = db.test_call(|connection| {
        let preview = connection.query_row(
            "SELECT status, info_hash, name, total_bytes, file_count, metainfo FROM torrent_previews WHERE id = 'preview'",
            [],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?, row.get::<_, i64>(4)?, row.get::<_, Vec<u8>>(5)?)),
        ).map_err(DownloadError::database)?;
        let file = connection.query_row(
            "SELECT file_index, path, size_bytes FROM torrent_preview_files WHERE preview_id = 'preview'",
            [],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?, row.get::<_, i64>(2)?)),
        ).map_err(DownloadError::database)?;
        Ok((preview, file))
    }).await.unwrap();
    assert_eq!(
        stored.0,
        (
            "ready".to_owned(),
            "0123456789012345678901234567890123456789".to_owned(),
            "release".to_owned(),
            12,
            1,
            b"normalized".to_vec()
        )
    );
    assert_eq!(stored.1, (0, "release.bin".to_owned(), 12));
}

#[tokio::test]
async fn torrent_verification_preserves_confirmed_bytes_and_fences_updates() {
    let directory = tempfile::tempdir().unwrap();
    let db = Db::open(&directory.path().join("verify.sqlite")).unwrap();
    db.test_call(|connection| {
        connection.execute_batch(TEST_SCHEMA).map_err(DownloadError::database)?;
        insert_queued_torrent_task(connection, "torrent")?;
        connection.execute("UPDATE download_tasks SET received_bytes=4,total_bytes=10,speed_bytes_per_second=99,uploaded_bytes=3,upload_speed_bytes_per_second=88,peer_count=2 WHERE id='torrent'", []).map_err(DownloadError::database)?;
        connection.execute("UPDATE download_task_files SET received_bytes=4 WHERE task_id='torrent'", []).map_err(DownloadError::database)?;
        Ok(())
    }).await.unwrap();
    let task = db
        .claim_torrent("owner", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        db.torrent_checking(&task, "owner", Duration::from_secs(30), 10)
            .await
            .unwrap(),
        TorrentProgressUpdate::Updated
    );
    let checking = db.get_task(&task.id).await.unwrap().unwrap();
    assert_eq!(checking.received_bytes, 4);
    assert_eq!(checking.total_bytes, Some(10));
    assert_eq!(checking.phase.as_deref(), Some("verifying"));
    assert_eq!(
        (
            checking.speed_bytes_per_second,
            checking.upload_speed_bytes_per_second,
            checking.peer_count
        ),
        (0, 0, 0)
    );
    assert_eq!(checking.uploaded_bytes, 3);
    assert!(checking.lease_expires_at.is_some());
    let file_bytes = db
        .test_call(|connection| {
            connection
                .query_row(
                    "SELECT received_bytes FROM download_task_files WHERE task_id='torrent'",
                    [],
                    |row| row.get::<_, i64>(0),
                )
                .map_err(DownloadError::database)
        })
        .await
        .unwrap();
    assert_eq!(file_bytes, 4);
    db.test_call(|connection| {
        connection
            .execute(
                "UPDATE download_tasks SET control_requested='pause' WHERE id='torrent'",
                [],
            )
            .map_err(DownloadError::database)?;
        Ok(())
    })
    .await
    .unwrap();
    assert_eq!(
        db.torrent_checking(&task, "owner", Duration::from_secs(30), 1)
            .await
            .unwrap(),
        TorrentProgressUpdate::ControlPending
    );
    assert_eq!(
        db.get_task(&task.id).await.unwrap().unwrap().total_bytes,
        Some(10)
    );
    assert_eq!(
        db.torrent_checking(&task, "old-owner", Duration::from_secs(30), 1)
            .await
            .unwrap(),
        TorrentProgressUpdate::LeaseLost
    );
    db.finish_control(&task, false).await.unwrap();
    assert_eq!(
        db.torrent_checking(&task, "owner", Duration::from_secs(30), 1)
            .await
            .unwrap(),
        TorrentProgressUpdate::LeaseLost
    );
}

#[tokio::test]
async fn published_torrent_verification_keeps_completion_until_real_check_results() {
    let directory = tempfile::tempdir().unwrap();
    let db = Db::open(&directory.path().join("published.sqlite")).unwrap();
    db.test_call(|connection| {
        connection
            .execute_batch(TEST_SCHEMA)
            .map_err(DownloadError::database)?;
        insert_queued_torrent_task(connection, "torrent")?;
        connection
            .execute(
                "UPDATE download_tasks SET total_bytes=10 WHERE id='torrent'",
                [],
            )
            .map_err(DownloadError::database)?;
        Ok(())
    })
    .await
    .unwrap();
    let task = db
        .claim_torrent("owner", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    db.begin_torrent_publish(&task, "owner").await.unwrap();
    db.publish_torrent(&task, "owner").await.unwrap();
    assert_eq!(
        db.torrent_checking(&task, "owner", Duration::from_secs(30), 10)
            .await
            .unwrap(),
        TorrentProgressUpdate::Updated
    );
    let checking = db.get_task(&task.id).await.unwrap().unwrap();
    assert_eq!(checking.status, "seeding");
    assert_eq!(checking.received_bytes, 10);
    assert!(checking.content_completed_at.is_some());
    assert_eq!(checking.phase.as_deref(), Some("verifying"));
    assert_eq!(
        db.torrent_progress(
            &task,
            "owner",
            Duration::from_secs(30),
            &TorrentProgress {
                received_bytes: 3,
                total_bytes: 10,
                speed_bytes_per_second: 0,
                uploaded_bytes: 0,
                upload_speed_bytes_per_second: 0,
                peer_count: 0,
                file_progress: vec![(0, 3)],
                seeding: false,
            }
        )
        .await
        .unwrap(),
        TorrentProgressUpdate::Updated
    );
    assert_eq!(
        db.get_task(&task.id).await.unwrap().unwrap().received_bytes,
        3
    );
}
