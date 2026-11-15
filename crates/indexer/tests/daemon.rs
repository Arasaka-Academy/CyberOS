mod common;

use cyberos_indexer::db::{Db, IndexerSettings};
use cyberos_indexer::scanner::run_task;
use rusqlite::Connection;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn coalesced_queue_tasks_are_claimed_with_a_lease() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("root");
    std::fs::create_dir(&root).unwrap();
    let database = directory.path().join("cyberos.sqlite");
    common::create_schema(&database, &root);
    let db = Db::open(&database).unwrap();
    db.enqueue("local", "docs", true, "incremental", 50)
        .await
        .unwrap();
    db.enqueue("local", "docs", true, "manual", 100)
        .await
        .unwrap();
    let task = db
        .claim("worker-1", &[common::storage_pool(&root)])
        .await
        .unwrap()
        .unwrap();
    assert_eq!(task.kind, "manual");
    assert_eq!(task.generation, 2);
    assert!(
        db.renew_lease(&task.id, task.generation, "worker-1")
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn completed_queue_generation_retains_a_distinct_traceable_run() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("root");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("one.txt"), "indexed text").unwrap();
    let database = directory.path().join("cyberos.sqlite");
    common::create_schema(&database, &root);
    let db = Db::open(&database).unwrap();
    db.enqueue("local", "one.txt", false, "manual", 100)
        .await
        .unwrap();
    let task = db
        .claim("worker-1", &[common::storage_pool(&root)])
        .await
        .unwrap()
        .unwrap();
    run_task(
        &db,
        &task,
        &IndexerSettings::default(),
        &CancellationToken::new(),
    )
    .await
    .unwrap();
    assert!(db.complete_task(&task, "worker-1").await.unwrap());
    let reader = Connection::open(&database).unwrap();
    let (run_id, status, indexed): (String, String, i64) = reader
        .query_row("SELECT id,status,indexed FROM index_runs", [], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .unwrap();
    assert!(run_id.starts_with(&format!("queue:{}:{}:", task.id, task.generation)));
    assert_eq!(status, "completed");
    assert_eq!(indexed, 1);
    assert_eq!(
        reader
            .query_row("SELECT COUNT(*) FROM index_queue", [], |row| row
                .get::<_, i64>(0))
            .unwrap(),
        0
    );
    let retry_run_id = db.start_task_run(&task).await.unwrap();
    assert_ne!(retry_run_id, run_id);
}
