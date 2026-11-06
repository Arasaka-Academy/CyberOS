mod common;

use std::path::Path;

use cyberos_indexer::db::Db;
use cyberos_indexer::media::run_media_scan;
use rusqlite::{Connection, params};
use tokio_util::sync::CancellationToken;

fn queue_scan(database: &Path, source_path: &str, scan_id: &str, generation: &str) {
    let connection = Connection::open(database).unwrap();
    connection
        .execute(
            "INSERT OR IGNORE INTO media_sources (
           id, name, kind, storage_pool_id, path, enabled, created_at, updated_at
         ) VALUES ('movies', 'Movies', 'movie', 'local', ?, 1, 'now', 'now')",
            [source_path],
        )
        .unwrap();
    connection.execute(
        "INSERT INTO media_scan_runs (id, source_id, status, generation, created_at, updated_at) \
         VALUES (?, 'movies', 'queued', ?, 'now', 'now')",
        params![scan_id, generation],
    ).unwrap();
}

async fn claim_and_run(
    db: &Db,
    worker: &str,
    storage_pool_path: &Path,
) -> Result<(), cyberos_indexer::error::IndexerError> {
    let task = db
        .claim_media_scan(worker, &[common::storage_pool(storage_pool_path)])
        .await
        .unwrap()
        .unwrap();
    run_media_scan(db, &task, worker, &CancellationToken::new()).await
}

#[tokio::test]
async fn expired_media_scan_cannot_replace_the_catalog() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("root");
    std::fs::create_dir_all(root.join("Movies")).unwrap();
    std::fs::write(root.join("Movies/Arrival.2016.mkv"), b"video").unwrap();
    let database = directory.path().join("cyberos.sqlite");
    common::create_schema(&database, &root);
    queue_scan(&database, "Movies", "original", "generation-1");
    let db = Db::open(&database).unwrap();
    claim_and_run(&db, "worker", &root).await.unwrap();
    queue_scan(&database, "Movies", "expired", "generation-2");
    let task = db
        .claim_media_scan("worker", &[common::storage_pool(&root)])
        .await
        .unwrap()
        .unwrap();
    let connection = Connection::open(&database).unwrap();
    connection
        .execute(
            "UPDATE media_scan_runs SET lease_expires_at='1970-01-01T00:00:00Z' WHERE id='expired'",
            [],
        )
        .unwrap();
    assert!(db.publish_media_scan(&task, "worker", &[]).await.is_err());
    assert!(!db.renew_media_scan_lease(&task, "worker").await.unwrap());
    assert!(
        !db.update_media_scan_progress(&task, "worker", 0, 0, None)
            .await
            .unwrap()
    );
    assert_eq!(
        connection
            .query_row("SELECT count(*) FROM media_files", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn slow_media_requests_keep_the_scan_lease_alive() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("root");
    std::fs::create_dir_all(root.join("Movies")).unwrap();
    std::fs::write(root.join("Movies/Arrival.2016.mkv"), b"video").unwrap();
    std::fs::write(
        root.join("Movies/movie.nfo"),
        "<movie><tmdbid>329865</tmdbid></movie>",
    )
    .unwrap();
    let database = directory.path().join("cyberos.sqlite");
    common::create_schema(&database, &root);
    queue_scan(&database, "Movies", "slow", "generation-1");
    let proxy = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = proxy.local_addr().unwrap().port();
    let connection = Connection::open(&database).unwrap();
    connection.execute("INSERT INTO system_settings(key,value_json,updated_at) VALUES ('media_library_settings',?,'now')", [r#"{"tmdbReadAccessToken":"test-token","tmdbUseProxy":true}"#]).unwrap();
    connection.execute("INSERT INTO system_settings(key,value_json,updated_at) VALUES ('system_proxy_settings',?,'now')", [format!(r#"{{"protocol":"http","host":"127.0.0.1","port":{port}}}"#)]).unwrap();
    let db = Db::open(&database).unwrap();
    let pools = [common::storage_pool(&root)];
    let task = db
        .claim_media_scan("worker", &pools)
        .await
        .unwrap()
        .unwrap();
    let shutdown = CancellationToken::new();
    let mut scan = {
        let db = db.clone();
        let shutdown = shutdown.clone();
        tokio::spawn(async move { run_media_scan(&db, &task, "worker", &shutdown).await })
    };
    let (_stalled_proxy, _) =
        tokio::time::timeout(std::time::Duration::from_secs(2), proxy.accept())
            .await
            .unwrap()
            .unwrap();
    let deadline = (time::OffsetDateTime::now_utc() + time::Duration::seconds(6))
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap();
    connection
        .execute(
            "UPDATE media_scan_runs SET lease_expires_at=? WHERE id='slow'",
            [deadline],
        )
        .unwrap();
    tokio::time::sleep(std::time::Duration::from_secs(7)).await;
    let competing = db.claim_media_scan("competitor", &pools).await.unwrap();
    shutdown.cancel();
    let result = tokio::time::timeout(std::time::Duration::from_secs(1), &mut scan).await;
    if result.is_err() {
        scan.abort();
        let _ = scan.await;
    }
    assert!(result.is_ok(), "cancelled scan did not stop promptly");
    assert!(competing.is_none(), "a slow active scan lost its lease");
}

#[tokio::test]
async fn scan_captures_proxy_settings_when_claimed() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("root");
    std::fs::create_dir_all(root.join("Movies")).unwrap();
    let database = directory.path().join("cyberos.sqlite");
    common::create_schema(&database, &root);
    queue_scan(&database, "Movies", "scan-proxy", "generation-1");
    let connection = Connection::open(&database).unwrap();
    let snapshot = r#"{"protocol":"socks5","host":"127.0.0.1","port":1080}"#;
    connection.execute("INSERT INTO system_settings (key,value_json,updated_at) VALUES ('system_proxy_settings',?,'now')", [snapshot]).unwrap();
    let db = Db::open(&database).unwrap();
    let task = db
        .claim_media_scan("media-worker", &[common::storage_pool(&root)])
        .await
        .unwrap()
        .unwrap();
    connection
        .execute(
            "UPDATE system_settings SET value_json='{}' WHERE key='system_proxy_settings'",
            [],
        )
        .unwrap();
    assert_eq!(task.proxy_settings_json.as_deref(), Some(snapshot));
}

#[tokio::test]
async fn proxy_failure_during_details_preserves_the_previous_catalog() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("root");
    let movies = root.join("Movies");
    std::fs::create_dir_all(&movies).unwrap();
    std::fs::write(movies.join("Arrival.2016.mkv"), b"video").unwrap();
    std::fs::write(
        movies.join("movie.nfo"),
        r#"<movie><title>Arrival</title><uniqueid type="tmdb">329865</uniqueid></movie>"#,
    )
    .unwrap();
    let database = directory.path().join("cyberos.sqlite");
    common::create_schema(&database, &root);
    queue_scan(&database, "Movies", "scan-direct", "generation-1");
    let db = Db::open(&database).unwrap();
    claim_and_run(&db, "media-worker", &root).await.unwrap();

    let connection = Connection::open(&database).unwrap();
    let unused_port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    connection.execute("INSERT INTO system_settings (key,value_json,updated_at) VALUES ('media_library_settings',?,'now')", [r#"{"tmdbReadAccessToken":"test-token","tmdbUseProxy":true}"#]).unwrap();
    connection.execute("INSERT INTO system_settings (key,value_json,updated_at) VALUES ('system_proxy_settings',?,'now')", [format!(r#"{{"protocol":"http","host":"127.0.0.1","port":{unused_port}}}"#)]).unwrap();
    queue_scan(&database, "Movies", "scan-proxy-failure", "generation-2");
    let error = claim_and_run(&db, "media-worker", &root)
        .await
        .expect_err("Proxy failure during details must fail the scan");
    assert!(error.to_string().contains("TMDB details unavailable"));
    assert_eq!(
        connection
            .query_row("SELECT scan_generation FROM media_files", [], |row| row
                .get::<_, String>(
                0
            ))
            .unwrap(),
        "generation-1"
    );
}

#[tokio::test]
async fn scan_prefers_nfo_and_ignores_symlinked_media() {
    use std::os::unix::fs::symlink;

    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("root");
    let movies = root.join("Movies/Arrival (2016)");
    std::fs::create_dir_all(&movies).unwrap();
    std::fs::write(movies.join("Arrival.2016.mkv"), b"video").unwrap();
    std::fs::write(
        movies.join("movie.nfo"),
        r#"<movie><title>降临</title><originaltitle>Arrival</originaltitle><year>2016</year><plot>本地简介</plot><uniqueid type="tmdb">329865</uniqueid></movie>"#,
    ).unwrap();
    std::fs::write(movies.join("poster.jpg"), b"image").unwrap();
    let outside = directory.path().join("outside.mkv");
    std::fs::write(&outside, b"outside").unwrap();
    symlink(&outside, movies.join("linked.mkv")).unwrap();

    let database = directory.path().join("cyberos.sqlite");
    common::create_schema(&database, &root);
    queue_scan(&database, "Movies", "scan-1", "generation-1");
    let db = Db::open(&database).unwrap();
    claim_and_run(&db, "media-worker", &root).await.unwrap();

    let connection = Connection::open(&database).unwrap();
    let title = connection
        .query_row(
            "SELECT title, original_title, year, metadata_source, match_status, tmdb_id \
         FROM media_titles WHERE source_id = 'movies'",
            [],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                ))
            },
        )
        .unwrap();
    assert_eq!(
        title,
        (
            "降临".to_owned(),
            "Arrival".to_owned(),
            2016,
            "nfo".to_owned(),
            "matched".to_owned(),
            329865
        )
    );
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM media_files", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT COUNT(*) FROM media_artwork WHERE source = 'local'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn successful_generation_removes_stale_files() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("root");
    let movies = root.join("Movies");
    std::fs::create_dir_all(&movies).unwrap();
    std::fs::write(movies.join("First.2020.mkv"), b"first").unwrap();
    std::fs::write(movies.join("Second.2021.mkv"), b"second").unwrap();
    let database = directory.path().join("cyberos.sqlite");
    common::create_schema(&database, &root);
    queue_scan(&database, "Movies", "scan-1", "generation-1");
    let db = Db::open(&database).unwrap();
    claim_and_run(&db, "media-worker", &root).await.unwrap();

    std::fs::remove_file(movies.join("Second.2021.mkv")).unwrap();
    queue_scan(&database, "Movies", "scan-2", "generation-2");
    claim_and_run(&db, "media-worker", &root).await.unwrap();

    let connection = Connection::open(&database).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM media_files", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        connection
            .query_row(
                "SELECT removed FROM media_scan_runs WHERE id = 'scan-2'",
                [],
                |row| row.get::<_, i64>(0)
            )
            .unwrap(),
        1
    );
}

#[tokio::test]
async fn failed_scan_preserves_the_previous_catalog() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("root");
    let movies = root.join("Movies");
    std::fs::create_dir_all(&movies).unwrap();
    std::fs::write(movies.join("Stable.2022.mkv"), b"stable").unwrap();
    let database = directory.path().join("cyberos.sqlite");
    common::create_schema(&database, &root);
    queue_scan(&database, "Movies", "scan-1", "generation-1");
    let db = Db::open(&database).unwrap();
    claim_and_run(&db, "media-worker", &root).await.unwrap();

    std::fs::rename(&movies, root.join("Movies-offline")).unwrap();
    queue_scan(&database, "Movies", "scan-2", "generation-2");
    assert!(claim_and_run(&db, "media-worker", &root).await.is_err());

    let connection = Connection::open(&database).unwrap();
    assert_eq!(
        connection
            .query_row("SELECT COUNT(*) FROM media_files", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        connection
            .query_row("SELECT scan_generation FROM media_files", [], |row| row
                .get::<_, String>(
                0
            ))
            .unwrap(),
        "generation-1"
    );
}

#[tokio::test]
async fn scan_groups_ep_numbered_files_into_one_series_and_season() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("root");
    let show = root.join("TV Series/大明王朝1566");
    std::fs::create_dir_all(&show).unwrap();
    for name in [
        "大明王朝1566.EP41.2007.D9.480P.AC3.X264.mkv",
        "大明王朝1566.ep08.mkv",
    ] {
        std::fs::write(show.join(name), b"video").unwrap();
    }
    let database = directory.path().join("cyberos.sqlite");
    common::create_schema(&database, &root);
    queue_scan(&database, "TV Series", "scan-series", "generation-series");
    let connection = Connection::open(&database).unwrap();
    connection
        .execute("UPDATE media_sources SET kind = 'series'", [])
        .unwrap();
    let db = Db::open(&database).unwrap();
    claim_and_run(&db, "media-worker", &root).await.unwrap();
    let titles: i64 = connection
        .query_row(
            "SELECT count(*) FROM media_titles WHERE kind = 'series'",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(titles, 1);
    let mut statement = connection.prepare("SELECT s.season_number, e.episode_number FROM media_episodes e JOIN media_seasons s ON s.id = e.season_id ORDER BY e.episode_number").unwrap();
    let episodes: Vec<(i64, i64)> = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap();
    assert_eq!(episodes, vec![(1, 8), (1, 41)]);
}
