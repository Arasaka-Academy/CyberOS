/**
 * [INPUT]: 依赖父模块的隔离 BT 引擎和种子解析。
 * [OUTPUT]: 验证租约、网络约束与本地 peer 传输。
 * [POS]: BT 公网隔离回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use super::*;

#[tokio::test]
async fn lost_lease_stops_the_engine_without_modifying_the_new_owner() {
    use std::time::Duration;
    let root = tempfile::tempdir().expect("temporary root");
    let data = root.path().join("data");
    std::fs::create_dir_all(data.join("pool-1")).expect("pool");
    let database = root.path().join("db.sqlite");
    rusqlite::Connection::open(&database)
        .expect("database")
        .execute_batch(crate::db::TEST_SCHEMA)
        .expect("schema");
    let db = Db::open(&database).expect("database actor");
    let mut metainfo =
        b"d4:infod6:lengthi5e4:name9:hello.txt12:piece lengthi16384e6:pieces20:".to_vec();
    metainfo.extend([
        0xaa, 0xf4, 0xc6, 0x1d, 0xdc, 0xc5, 0xe8, 0xa2, 0xda, 0xbe, 0xde, 0x0f, 0x3b, 0x48, 0x2c,
        0xd9, 0xae, 0xa9, 0x43, 0x4d,
    ]);
    metainfo.extend(b"ee");
    db.test_call(move |connection| {
        connection.execute("INSERT INTO download_tasks(id,url,storage_pool_id,target_directory,target_file_name,target_path,partial_path,status,created_at,updated_at,source_kind,torrent_metainfo,total_bytes,selected_file_count) VALUES('lease-test','','pool-1','.','hello','hello','.hello.part','queued','2026-11-13T00:00:00Z','2026-11-13T00:00:00Z','torrent',?,5,1)", [metainfo]).map_err(DownloadError::database)?;
        connection.execute("INSERT INTO download_task_files VALUES('lease-test',0,'hello.txt',5,1,0)", []).map_err(DownloadError::database)?;
        Ok(())
    }).await.expect("torrent task");
    let task = db
        .claim_torrent("old-worker", TORRENT_LEASE)
        .await
        .expect("claim")
        .expect("task");
    let engine = TorrentEngine::new_isolated(root.path(), None)
        .await
        .expect("isolated engine");
    let inspect_engine = engine.clone();
    let shutdown = tokio_util::sync::CancellationToken::new();
    let db_run = db.clone();
    let stop = shutdown.clone();
    let mut run = tokio::spawn(async move {
        run_torrent_task(
            &engine,
            &db_run,
            &task,
            "old-worker",
            &TorrentRunContext {
                data_root: &data,
                require_mount: false,
                minimum_free_bytes: 0,
                shutdown: &stop,
            },
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if db.test_call(|connection| connection.query_row("SELECT last_progress_at IS NOT NULL FROM download_tasks WHERE id='lease-test'", [], |row| row.get::<_, bool>(0)).map_err(DownloadError::database)).await.expect("progress query") { break; }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }).await.expect("initial engine progress");
    db.test_call(|connection| {
        connection.execute("UPDATE download_tasks SET lease_expires_at='1970-01-01T00:00:00Z' WHERE id='lease-test'", []).map_err(DownloadError::database)?;
        Ok(())
    }).await.expect("expire lease");
    assert_eq!(db.recover_expired().await.expect("recover"), 1);
    db.claim_torrent("new-worker", TORRENT_LEASE)
        .await
        .expect("new claim")
        .expect("new owner");
    let result = tokio::time::timeout(Duration::from_secs(3), &mut run).await;
    if result.is_err() {
        shutdown.cancel();
        let _ = run.await;
    }
    assert_eq!(
        result
            .expect("old runner must stop after losing ownership")
            .expect("runner task")
            .expect("runner result"),
        TorrentTaskOutcome::Interrupted
    );
    assert_eq!(
        db.get_task("lease-test")
            .await
            .expect("task query")
            .expect("new task")
            .worker_id
            .as_deref(),
        Some("new-worker")
    );
    let count = inspect_engine
        .session
        .with_torrents(|torrents| torrents.count());
    assert_eq!(count, 0, "the old engine must release its torrent handle");
}

#[test]
fn parses_public_multifile_torrents_for_selection() {
    let parsed = parse_torrent_preview(&torrent_fixture(false, None, false)).unwrap();
    assert_eq!(parsed.name, "release");
    assert_eq!(parsed.total_bytes, 12);
    assert_eq!(parsed.files.len(), 2);
    assert_eq!(parsed.files[0].file_index, 0);
    assert_eq!(parsed.files[0].path, "a.txt");
    assert_eq!(parsed.files[1].path, "b.txt");
    assert_eq!(parsed.info_hash.len(), 40);
}

#[test]
fn rejects_private_symlink_and_local_tracker_torrents() {
    assert!(
        parse_torrent_preview(&torrent_fixture(true, None, false))
            .unwrap_err()
            .to_string()
            .contains("private")
    );
    assert!(
        parse_torrent_preview(&torrent_fixture(false, None, true))
            .unwrap_err()
            .to_string()
            .contains("symbolic link")
    );
    assert!(
        parse_torrent_preview(&torrent_fixture(
            false,
            Some("http://127.0.0.1:8080/announce"),
            false,
        ))
        .unwrap_err()
        .to_string()
        .contains("public tracker")
    );
}

#[test]
fn removes_blocked_trackers_without_changing_torrent_contents() {
    let bytes = torrent_with_trackers(&[
        "http://127.0.0.1:8080/announce",
        "udp://8.8.8.8:6969/announce",
        "file:///etc/passwd",
    ]);
    let original = librqbit::torrent_from_bytes(&bytes).unwrap();
    let parsed = parse_torrent_preview(&bytes).unwrap();
    let filtered = librqbit::torrent_from_bytes(&parsed.metainfo).unwrap();

    assert_eq!(parsed.info_hash, original.info_hash.as_string());
    assert_eq!(filtered.info.raw_bytes, original.info.raw_bytes);
    assert_eq!(parsed.total_bytes, 12);
    assert_eq!(parsed.files.len(), 2);
    assert_eq!(
        filtered
            .iter_announce()
            .map(|v| v.as_ref())
            .collect::<Vec<_>>(),
        vec![b"udp://8.8.8.8:6969/announce".as_slice()]
    );
    assert_eq!(
        filtered.announce.unwrap().as_ref(),
        b"udp://8.8.8.8:6969/announce"
    );
}

#[test]
fn identifies_the_host_and_reason_when_no_public_tracker_remains() {
    let error = parse_torrent_preview(&torrent_with_trackers(&[
        "http://127.0.0.1:8080/announce",
        "http://10.0.0.1/announce?passkey=secret",
    ]))
    .unwrap_err();

    assert_eq!(error.code, ErrorCode::TorrentUnsafe);
    assert!(error.message.contains("127.0.0.1"));
    assert!(error.message.contains("non-public"));
    assert!(!error.message.contains("secret"));
}

#[test]
fn preserves_unknown_info_fields_and_text_encoding() {
    let base = torrent_with_trackers(&["udp://8.8.8.8:6969/announce"]);
    let info_offset = base.windows(7).position(|v| v == b"4:infod").unwrap();
    let mut bytes = base[..info_offset].to_vec();
    bytes.extend_from_slice(b"8:encoding5:UTF-84:infod13:x-content-tag4:keep");
    bytes.extend_from_slice(&base[info_offset + 7..]);
    let original = librqbit::torrent_from_bytes(&bytes).unwrap();
    let parsed = parse_torrent_preview(&bytes).unwrap();
    let filtered = librqbit::torrent_from_bytes(&parsed.metainfo).unwrap();

    assert_eq!(filtered.info.raw_bytes, original.info.raw_bytes);
    assert_eq!(filtered.info_hash, original.info_hash);
    assert_eq!(filtered.encoding.unwrap().as_ref(), b"UTF-8");
}

#[tokio::test]
async fn distinguishes_dns_failure_timeout_and_non_public_results() {
    let timeout = std::time::Duration::from_millis(1);
    let error = validate_tracker_dns(
        "missing.invalid",
        async { Err(std::io::Error::from(std::io::ErrorKind::NotFound)) },
        timeout,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::Dns);
    assert!(error.retryable);
    assert!(error.message.contains("missing.invalid"));
    assert!(error.message.contains("DNS lookup failed"));

    let error = validate_tracker_dns("slow.example", std::future::pending(), timeout)
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Timeout);
    assert!(error.message.contains("slow.example"));
    assert!(error.message.contains("timed out"));

    let error = validate_tracker_dns(
        "mixed.example",
        async {
            Ok(vec![
                "8.8.8.8:80".parse().unwrap(),
                "10.255.255.254:80".parse().unwrap(),
            ])
        },
        timeout,
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::TorrentUnsafe);
    assert!(!error.retryable);
    assert!(error.message.contains("mixed.example"));
    assert!(error.message.contains("10.255.255.254"));

    let error = validate_tracker_dns("empty.example", async { Ok(Vec::new()) }, timeout)
        .await
        .unwrap_err();
    assert_eq!(error.code, ErrorCode::Dns);
    assert!(error.message.contains("no addresses"));
}

#[tokio::test]
async fn filters_magnet_trackers_without_injecting_query_parameters() {
    let source = "magnet:?xt=urn:btih:0123456789012345678901234567890123456789&dn=release&tr=http%3A%2F%2F127.0.0.1%2Fannounce&tr=udp%3A%2F%2F8.8.8.8%3A6969%2Fannounce%3Fa%3D1%26tr%3Dhttp%3A%2F%2F10.0.0.1%2Fannounce";
    let filtered = filter_magnet_trackers(source).await.unwrap();
    let magnet = librqbit::Magnet::parse(&filtered).unwrap();
    assert_eq!(
        magnet.as_id20().unwrap().as_string(),
        "0123456789012345678901234567890123456789"
    );
    assert_eq!(magnet.name.as_deref(), Some("release"));
    assert_eq!(
        magnet.trackers,
        ["udp://8.8.8.8:6969/announce?a=1&tr=http://10.0.0.1/announce"]
    );

    let error = filter_magnet_trackers(
        "magnet:?xt=urn:btih:0123456789012345678901234567890123456789&tr=http://127.0.0.1/announce",
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, ErrorCode::TorrentUnsafe);
    assert!(error.message.contains("127.0.0.1"));
}

#[tokio::test]
async fn filters_trackers_again_before_starting_the_download_engine() {
    let root = tempfile::tempdir().unwrap();
    let engine = TorrentEngine::new_isolated(root.path(), None)
        .await
        .unwrap();
    let bytes = torrent_with_trackers(&[
        "https://missing-tracker.invalid/announce",
        "http://10.0.0.1/announce",
        "udp://8.8.8.8:6969/announce",
    ]);
    let handle = engine
        .add_torrent_bytes(&bytes, &[0, 1], root.path(), Vec::new())
        .await
        .unwrap();
    let bytes = handle
        .with_metadata(|metadata| metadata.torrent_bytes.clone())
        .unwrap();
    let parsed = librqbit::torrent_from_bytes(&bytes).unwrap();
    assert_eq!(
        parsed
            .iter_announce()
            .map(|v| v.as_ref())
            .collect::<Vec<_>>(),
        vec![b"udp://8.8.8.8:6969/announce".as_slice()]
    );
    engine.remove(&handle).await.unwrap();
}

#[tokio::test]
async fn accepts_public_ipv6_trackers_and_rejects_local_ipv6() {
    validate_tracker_network("udp://[2606:4700:4700::1111]:6969/announce")
        .await
        .unwrap();
    assert!(validate_tracker("http://[::1]:8080/announce").is_err());
    assert!(validate_tracker("http://[::ffff:127.0.0.1]:8080/announce").is_err());
}

#[tokio::test]
async fn resolves_preview_when_one_tracker_has_no_dns_record() {
    let root = tempfile::tempdir().unwrap();
    let engine = TorrentEngine::new_isolated(root.path(), None)
        .await
        .unwrap();
    let preview = TorrentPreview {
        id: "mixed-trackers".to_owned(),
        source_kind: "torrent".to_owned(),
        source_uri: None,
        metainfo: Some(torrent_with_trackers(&[
            "https://missing-tracker.invalid/announce",
            "udp://8.8.8.8:6969/announce",
        ])),
    };
    let parsed = engine.resolve_preview(&preview).await.unwrap();
    let filtered = librqbit::torrent_from_bytes(&parsed.metainfo).unwrap();
    assert_eq!(
        filtered
            .iter_announce()
            .map(|v| v.as_ref())
            .collect::<Vec<_>>(),
        vec![b"udp://8.8.8.8:6969/announce".as_slice()]
    );
}

#[test]
fn rejects_torrents_with_more_than_ten_thousand_files() {
    let error = parse_torrent_preview(&torrent_with_file_count(10_001)).unwrap_err();

    assert_eq!(error.code, ErrorCode::TorrentInvalid);
    assert!(error.to_string().contains("too many files"));
}

#[test]
fn stops_seeding_at_the_first_ratio_or_time_limit() {
    assert!(!seeding_limit_reached(9, 10, 1.0, 7_199, 7_200));
    assert!(seeding_limit_reached(10, 10, 1.0, 1, 7_200));
    assert!(seeding_limit_reached(0, 10, 1.0, 7_200, 7_200));
}

#[tokio::test]
async fn downloads_from_an_isolated_local_peer() {
    let seed_root = tempfile::tempdir().unwrap();
    let download_root = tempfile::tempdir().unwrap();
    std::fs::write(seed_root.path().join("hello.txt"), b"hello").unwrap();
    let metainfo = single_file_torrent_fixture();
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let peer_address = listener.local_addr().unwrap();
    drop(listener);

    let seed = TorrentEngine::new_isolated(seed_root.path(), Some(peer_address))
        .await
        .unwrap();
    let seed_handle = seed
        .add_torrent_bytes(&metainfo, &[0], seed_root.path(), Vec::new())
        .await
        .unwrap();
    seed_handle.wait_until_initialized().await.unwrap();
    assert!(seed_handle.stats().finished);

    let download = TorrentEngine::new_isolated(download_root.path(), None)
        .await
        .unwrap();
    let handle = download
        .add_torrent_bytes(&metainfo, &[0], download_root.path(), vec![peer_address])
        .await
        .unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(10),
        handle.wait_until_completed(),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(
        std::fs::read(download_root.path().join("hello.txt")).unwrap(),
        b"hello"
    );
}

fn torrent_with_trackers(trackers: &[&str]) -> Vec<u8> {
    let mut bytes = b"d8:announce".to_vec();
    let first = trackers.first().unwrap();
    bytes.extend_from_slice(format!("{}:{}13:announce-listl", first.len(), first).as_bytes());
    for tracker in trackers {
        bytes.extend_from_slice(format!("l{}:{}e", tracker.len(), tracker).as_bytes());
    }
    bytes.push(b'e');
    bytes.extend_from_slice(&torrent_fixture(false, None, false)[1..]);
    bytes
}

fn torrent_fixture(private: bool, tracker: Option<&str>, symlink: bool) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(b"d");
    if let Some(tracker) = tracker {
        bytes.extend_from_slice(format!("8:announce{}:{}", tracker.len(), tracker).as_bytes());
    }
    bytes.extend_from_slice(b"4:infod5:filesl");
    bytes.extend_from_slice(b"d");
    if symlink {
        bytes.extend_from_slice(b"4:attr1:l");
    }
    bytes.extend_from_slice(b"6:lengthi5e4:pathl5:a.txtee");
    bytes.extend_from_slice(b"d6:lengthi7e4:pathl5:b.txtee");
    bytes.extend_from_slice(
        b"e4:name7:release12:piece lengthi16384e6:pieces20:01234567890123456789",
    );
    if private {
        bytes.extend_from_slice(b"7:privatei1e");
    }
    bytes.extend_from_slice(b"ee");
    bytes
}

fn single_file_torrent_fixture() -> Vec<u8> {
    let mut bytes =
        b"d4:infod6:lengthi5e4:name9:hello.txt12:piece lengthi16384e6:pieces20:".to_vec();
    bytes.extend_from_slice(&[
        0xaa, 0xf4, 0xc6, 0x1d, 0xdc, 0xc5, 0xe8, 0xa2, 0xda, 0xbe, 0xde, 0x0f, 0x3b, 0x48, 0x2c,
        0xd9, 0xae, 0xa9, 0x43, 0x4d,
    ]);
    bytes.extend_from_slice(b"ee");
    bytes
}

fn torrent_with_file_count(file_count: usize) -> Vec<u8> {
    let mut bytes = b"d4:infod5:filesl".to_vec();
    for index in 0..file_count {
        let name = format!("{index:05}.txt");
        bytes.extend_from_slice(format!("d6:lengthi1e4:pathl{}:{}ee", name.len(), name).as_bytes());
    }
    bytes.extend_from_slice(
        b"e4:name7:release12:piece lengthi16384e6:pieces20:01234567890123456789ee",
    );
    bytes
}
