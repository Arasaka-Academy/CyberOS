/**
 * [INPUT]: 依赖父模块数据库接口和隔离 schema。
 * [OUTPUT]: 验证任务控制、并发领取和检查点。
 * [POS]: 保留 HTTP 与共享数据库回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use super::*;

#[test]
fn download_settings_support_one_to_ten_http_downloads() {
    for concurrency in 1..=10 {
        let settings = DownloadSettings {
            concurrency,
            ..DownloadSettings::default()
        };
        assert_eq!(settings.validate().unwrap().concurrency, concurrency);
    }
    for concurrency in [0, 11] {
        let settings = DownloadSettings {
            concurrency,
            ..DownloadSettings::default()
        };
        assert!(settings.validate().is_err());
    }
}

async fn segment_contention_fixture() -> (tempfile::TempDir, Db, Connection) {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("test.sqlite");
    let db = Db::open(&path).unwrap();
    db.test_call(|connection| {
        connection
            .execute_batch(TEST_SCHEMA)
            .map_err(DownloadError::database)?;
        insert_queued_task(connection, "task")?;
        insert_queued_task(connection, "other")?;
        connection
            .execute_batch(
                "UPDATE download_tasks SET status='running', worker_id='owner' WHERE id='task';
             INSERT INTO download_segments VALUES ('task', 0, 100, 25, 'before');
             INSERT INTO download_segments VALUES ('other', 0, 50, 10, 'before');",
            )
            .map_err(DownloadError::database)?;
        Ok(())
    })
    .await
    .unwrap();
    let writer = Connection::open(path).unwrap();
    writer
        .execute_batch(
            "BEGIN IMMEDIATE;
         INSERT INTO system_settings VALUES ('other-service', '{}', 'now');",
        )
        .unwrap();
    (directory, db, writer)
}

#[tokio::test]
async fn torrent_admission_defaults_to_three_and_observes_live_limits() {
    let directory = tempfile::tempdir().unwrap();
    let db = Db::open(&directory.path().join("test.sqlite")).unwrap();
    db.test_call(|connection| {
        connection
            .execute_batch(TEST_SCHEMA)
            .map_err(DownloadError::database)?;
        for index in 0..12 {
            insert_queued_torrent_task(connection, &format!("torrent-{index:02}"))?;
        }
        insert_queued_task(connection, "http")?;
        Ok(())
    })
    .await
    .unwrap();
    for _ in 0..3 {
        assert!(
            db.claim_torrent("worker", Duration::from_secs(30))
                .await
                .unwrap()
                .is_some()
        );
    }
    assert!(
        db.claim_torrent("worker", Duration::from_secs(30))
            .await
            .unwrap()
            .is_none()
    );
    assert!(
        db.claim("http", Duration::from_secs(30))
            .await
            .unwrap()
            .is_some()
    );
    for (limit, admitted) in [(1, 0), (10, 7)] {
        db.test_call(move |connection| {
            connection
                .execute(
                    "INSERT OR REPLACE INTO system_settings VALUES ('download_settings', ?, 'now')",
                    [format!(r#"{{"btConcurrency":{limit}}}"#)],
                )
                .map_err(DownloadError::database)?;
            Ok(())
        })
        .await
        .unwrap();
        for _ in 0..admitted {
            assert!(
                db.claim_torrent("worker", Duration::from_secs(30))
                    .await
                    .unwrap()
                    .is_some()
            );
        }
        assert!(
            db.claim_torrent("worker", Duration::from_secs(30))
                .await
                .unwrap()
                .is_none()
        );
    }
    assert_eq!(db.torrent_running_count().await.unwrap(), 10);
    db.test_call(|connection| {
        connection
            .execute(
                "UPDATE download_tasks SET status = 'seeding' WHERE id = 'torrent-00'",
                [],
            )
            .map_err(DownloadError::database)?;
        Ok(())
    })
    .await
    .unwrap();
    assert!(
        db.claim_torrent("worker", Duration::from_secs(30))
            .await
            .unwrap()
            .is_some()
    );
    assert_eq!(db.torrent_running_count().await.unwrap(), 10);
    db.test_call(|connection| {
        connection.execute("UPDATE download_tasks SET worker_id = NULL, lease_expires_at = NULL WHERE id = 'torrent-00'", [])
            .map_err(DownloadError::database)?;
        Ok(())
    }).await.unwrap();
    let seed = db
        .claim_torrent("worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(seed.status, "seeding");
    assert_eq!(db.torrent_running_count().await.unwrap(), 10);
}

#[tokio::test]
async fn http_admission_serializes_competing_workers_at_each_limit() {
    for limit in [1, 3, 10] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.sqlite");
        let db = Db::open(&path).unwrap();
        db.test_call(move |connection| {
            connection
                .execute_batch(TEST_SCHEMA)
                .map_err(DownloadError::database)?;
            connection
                .execute(
                    "INSERT INTO system_settings VALUES ('download_settings', ?, 'now')",
                    [format!(r#"{{"concurrency":{limit}}}"#)],
                )
                .map_err(DownloadError::database)?;
            for index in 0..12 {
                insert_queued_task(connection, &format!("http-{index:02}"))?;
            }
            Ok(())
        })
        .await
        .unwrap();
        let other = Db::open(&path).unwrap();
        let results = futures_util::future::join_all((0..12).map(|index| {
            let database = if index % 2 == 0 { &db } else { &other };
            async move {
                database
                    .claim(&format!("worker-{index}"), Duration::from_secs(30))
                    .await
                    .unwrap()
            }
        }))
        .await;
        assert_eq!(results.iter().filter(|task| task.is_some()).count(), limit);
        assert_eq!(db.running_count().await.unwrap(), limit);
    }
}

#[tokio::test]
async fn torrent_admission_serializes_competing_workers_at_each_limit() {
    for limit in [1, 3, 10] {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("test.sqlite");
        let db = Db::open(&path).unwrap();
        db.test_call(move |connection| {
            connection
                .execute_batch(TEST_SCHEMA)
                .map_err(DownloadError::database)?;
            connection
                .execute(
                    "INSERT INTO system_settings VALUES ('download_settings', ?, 'now')",
                    [format!(r#"{{"btConcurrency":{limit}}}"#)],
                )
                .map_err(DownloadError::database)?;
            for index in 0..12 {
                insert_queued_torrent_task(connection, &format!("torrent-{index:02}"))?;
            }
            Ok(())
        })
        .await
        .unwrap();
        let other = Db::open(&path).unwrap();
        let results = futures_util::future::join_all((0..12).map(|index| {
            let database = if index % 2 == 0 { &db } else { &other };
            async move {
                database
                    .claim_torrent(&format!("worker-{index}"), Duration::from_secs(30))
                    .await
                    .unwrap()
            }
        }))
        .await;
        assert_eq!(results.iter().filter(|task| task.is_some()).count(), limit);
        assert_eq!(db.torrent_running_count().await.unwrap(), limit);
    }
}

async fn replace_segments_during_write(db: &Db, writer: Connection) -> DbResult<()> {
    let (release, requested) = mpsc::channel();
    let writer_thread = std::thread::spawn(move || {
        // Own the real WAL writer lock before invoking the Db actor. The
        // bounded hold schedules a commit; elapsed time is not asserted.
        let _ = requested.recv_timeout(Duration::from_millis(250));
        writer.execute_batch("COMMIT").unwrap();
    });
    let result = db
        .replace_segments(
            "task",
            "owner",
            &[
                Segment {
                    start: 0,
                    end: 50,
                    next: 0,
                },
                Segment {
                    start: 50,
                    end: 100,
                    next: 50,
                },
            ],
        )
        .await;
    let _ = release.send(());
    writer_thread.join().unwrap();
    result
}

async fn assert_original_segments(db: &Db) {
    let segments = db.segments("task").await.unwrap();
    assert_eq!(segments.len(), 1);
    assert_eq!(
        (segments[0].start, segments[0].end, segments[0].next),
        (0, 100, 25)
    );
}

#[tokio::test]
async fn replacing_segments_waits_for_a_concurrent_writer_and_keeps_other_tasks() {
    let (_directory, db, writer) = segment_contention_fixture().await;

    replace_segments_during_write(&db, writer).await.unwrap();

    let segments = db.segments("task").await.unwrap();
    assert_eq!(
        segments
            .iter()
            .map(|segment| (segment.start, segment.end, segment.next))
            .collect::<Vec<_>>(),
        vec![(0, 50, 0), (50, 100, 50)]
    );
    let other = db.segments("other").await.unwrap();
    assert_eq!(other.len(), 1);
    assert_eq!((other[0].start, other[0].end, other[0].next), (0, 50, 10));
}

#[tokio::test]
async fn replacing_segments_rechecks_owner_after_a_concurrent_commit() {
    let (_directory, db, writer) = segment_contention_fixture().await;
    writer
        .execute(
            "UPDATE download_tasks SET worker_id='replacement' WHERE id='task'",
            [],
        )
        .unwrap();

    let error = replace_segments_during_write(&db, writer)
        .await
        .unwrap_err();

    assert_eq!(
        error.message,
        "download task lease or control ownership was lost"
    );
    assert_original_segments(&db).await;
    assert_eq!(
        db.get_task("task")
            .await
            .unwrap()
            .unwrap()
            .worker_id
            .as_deref(),
        Some("replacement")
    );
}

#[tokio::test]
async fn replacing_segments_rechecks_control_after_a_concurrent_commit() {
    let (_directory, db, writer) = segment_contention_fixture().await;
    writer
        .execute(
            "UPDATE download_tasks SET control_requested='pause' WHERE id='task'",
            [],
        )
        .unwrap();

    let error = replace_segments_during_write(&db, writer)
        .await
        .unwrap_err();

    assert_eq!(
        error.message,
        "download task lease or control ownership was lost"
    );
    assert_original_segments(&db).await;
    assert_eq!(
        db.get_task("task")
            .await
            .unwrap()
            .unwrap()
            .control_requested
            .as_deref(),
        Some("pause")
    );
}

#[tokio::test]
async fn journal_fences_claims_and_live_recovery() {
    let directory = tempfile::tempdir().unwrap();
    let db = Db::open(&directory.path().join("test.sqlite")).unwrap();
    db.test_call(|connection| {
        connection
            .execute_batch(TEST_SCHEMA)
            .map_err(DownloadError::database)?;
        connection
            .execute(
                "INSERT INTO download_tasks (id, url, storage_pool_id, target_directory, \
               target_file_name, target_path, partial_path, status, worker_id, lease_expires_at, \
               created_at, updated_at) VALUES \
               ('task', 'https://example.com/file', 'pool-1', '.', 'file', 'file', '.part', \
                'running', 'owner', ?, ?, ?)",
                params![future_iso(Duration::from_secs(60)), now_iso(), now_iso()],
            )
            .map_err(DownloadError::database)?;
        connection
            .execute(
                "INSERT INTO download_publish_journal \
               (task_id, operation_id, worker_id, device, inode, size_bytes, created_at) \
               VALUES ('task', 'download:task', 'owner', 1, 2, 3, ?)",
                [now_iso()],
            )
            .map_err(DownloadError::database)?;
        Ok(())
    })
    .await
    .unwrap();

    assert!(
        db.claim("other", Duration::from_secs(30))
            .await
            .unwrap()
            .is_none()
    );
    assert!(!db.recover_unpublished("task").await.unwrap());
    assert_eq!(
        db.get_task("task").await.unwrap().unwrap().status,
        "running"
    );
    assert_eq!(db.journals().await.unwrap().len(), 1);

    db.test_call(|connection| {
        connection.execute(
            "UPDATE download_tasks SET lease_expires_at = '1970-01-01T00:00:00Z', control_requested = 'pause' WHERE id = 'task'",
            [],
        ).map_err(DownloadError::database)?;
        Ok(())
    }).await.unwrap();
    assert_eq!(db.recover_expired().await.unwrap(), 0);
    assert!(db.recover_unpublished("task").await.unwrap());
    let recovered = db.get_task("task").await.unwrap().unwrap();
    assert_eq!(recovered.status, "paused");
    assert!(recovered.worker_id.is_none());
    assert!(db.journals().await.unwrap().is_empty());
}

#[tokio::test]
async fn database_actor_executes_transfer_and_retry_state_machine() {
    let directory = tempfile::tempdir().unwrap();
    let db = Db::open(&directory.path().join("test.sqlite")).unwrap();
    db.test_call(|connection| {
        connection
            .execute_batch(TEST_SCHEMA)
            .map_err(DownloadError::database)?;
        connection
            .execute(
                "INSERT INTO system_settings (key, value_json, updated_at) \
             VALUES ('download_settings', '{\"concurrency\":10}', '2026-01-01T00:00:00Z')",
                [],
            )
            .map_err(DownloadError::database)?;
        insert_queued_task(connection, "complete")?;
        Ok(())
    })
    .await
    .unwrap();

    let settings = db.settings().await.unwrap();
    assert_eq!(settings.concurrency, 10);
    assert_eq!(settings.parallel_requests_per_task, 4);
    db.register_worker("worker", "test").await.unwrap();
    db.heartbeat_worker("worker").await.unwrap();
    let task = db
        .claim("worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    assert!(
        db.progress(
            &task.id,
            "worker",
            Duration::from_secs(30),
            Progress {
                received_bytes: 1,
                total_bytes: Some(10),
                speed_bytes_per_second: 1,
                etag: Some("\"v1\""),
                last_modified: None,
                phase: "downloading",
                mode: "segmented",
                segment_count: 1,
            },
        )
        .await
        .unwrap()
    );
    db.reset_transfer(&task.id, "worker").await.unwrap();
    db.replace_segments(
        &task.id,
        "worker",
        &[Segment {
            start: 0,
            end: 10,
            next: 0,
        }],
    )
    .await
    .unwrap();
    db.reserve_space(&task, 10, 100, 5).await.unwrap();
    assert!(
        db.checkpoint_segment(
            &task.id,
            "worker",
            SegmentCheckpoint {
                start: 0,
                next: 10,
                total: 10,
                speed_bytes_per_second: 5,
            },
            Duration::from_secs(30),
        )
        .await
        .unwrap()
    );
    assert!(
        db.set_actual_checksum(&task.id, "worker", &"a".repeat(64))
            .await
            .unwrap()
    );
    let journal = PublishJournal {
        task_id: task.id.clone(),
        operation_id: "download:complete".to_owned(),
        worker_id: "worker".to_owned(),
        device: 1,
        inode: 2,
        size_bytes: 10,
        sha256: Some("a".repeat(64)),
    };
    db.begin_publish(journal.clone()).await.unwrap();
    db.finalize_publish(&journal, &task, "segmented")
        .await
        .unwrap();
    db.finalize_publish(&journal, &task, "segmented")
        .await
        .unwrap();
    assert_eq!(
        db.get_task(&task.id).await.unwrap().unwrap().status,
        "completed"
    );
    let queued_index = db
        .test_call(|connection| {
            connection
                .query_row(
                    "SELECT storage_pool_id, path, generation, status FROM index_queue WHERE storage_pool_id = 'pool-1' AND path = 'complete.bin'",
                    [],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )
                .map_err(DownloadError::database)
        })
        .await
        .unwrap();
    assert_eq!(
        queued_index,
        (
            "pool-1".to_owned(),
            "complete.bin".to_owned(),
            1,
            "queued".to_owned()
        )
    );

    db.test_call(|connection| insert_queued_task(connection, "retry"))
        .await
        .unwrap();
    let retry_task = db
        .claim("worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    let retry_error = DownloadError::new(ErrorCode::Connect, "disconnected", true);
    assert!(
        db.fail_or_retry(
            &retry_task,
            &retry_error,
            &DownloadSettings::default(),
            Some(Duration::from_secs(1)),
        )
        .await
        .unwrap()
    );
    let retry_task = db.get_task("retry").await.unwrap().unwrap();
    assert_eq!(retry_task.status, "queued");
    assert_eq!(retry_task.retry_count, 1);
    assert!(retry_task.next_retry_at.is_some());

    db.test_call(|connection| insert_queued_task(connection, "shutdown"))
        .await
        .unwrap();
    let shutdown_task = db
        .claim("worker", Duration::from_secs(30))
        .await
        .unwrap()
        .unwrap();
    let shutdown_task_id = shutdown_task.id.clone();
    db.test_call(move |connection| {
        connection
            .execute(
                "UPDATE download_tasks SET control_requested = 'pause' WHERE id = ?",
                [shutdown_task_id],
            )
            .map_err(DownloadError::database)?;
        Ok(())
    })
    .await
    .unwrap();
    assert!(
        !db.extend_lease(&shutdown_task.id, "worker", Duration::from_secs(30))
            .await
            .unwrap()
    );
    db.requeue_owned("worker").await.unwrap();
    assert_eq!(
        db.get_task("shutdown").await.unwrap().unwrap().status,
        "paused"
    );

    db.remove_worker("worker").await.unwrap();
}

pub(super) fn insert_queued_task(connection: &Connection, id: &str) -> DbResult<()> {
    connection
        .execute(
            "INSERT INTO download_tasks (id, url, storage_pool_id, target_directory, \
           target_file_name, target_path, partial_path, status, created_at, updated_at) \
         VALUES (?, 'https://example.com/file', 'pool-1', '.', ?, ?, ?, 'queued', ?, ?)",
            params![
                id,
                format!("{id}.bin"),
                format!("{id}.bin"),
                format!(".{id}.part"),
                now_iso(),
                now_iso()
            ],
        )
        .map_err(DownloadError::database)?;
    Ok(())
}

pub(super) fn insert_queued_torrent_task(connection: &Connection, id: &str) -> DbResult<()> {
    connection
        .execute(
            "INSERT INTO download_tasks (id, url, storage_pool_id, target_directory, \
           target_file_name, target_path, partial_path, status, created_at, updated_at, \
           source_kind, torrent_info_hash, torrent_name, torrent_metainfo, selected_file_count) \
         VALUES (?, 'magnet:?xt=urn:btih:0123456789012345678901234567890123456789', \
           'pool-1', '.', 'release', 'release', '.release.part', 'queued', ?, ?, 'magnet', \
           '0123456789012345678901234567890123456789', 'release', x'64617461', 1)",
            params![id, now_iso(), now_iso()],
        )
        .map_err(DownloadError::database)?;
    connection
        .execute(
            "INSERT INTO download_task_files (task_id, file_index, path, size_bytes, selected) \
         VALUES (?, 0, 'release.bin', 10, 1)",
            [id],
        )
        .map_err(DownloadError::database)?;
    Ok(())
}
