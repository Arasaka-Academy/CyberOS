use std::path::Path;

use crate::onvif::{Node, validate_endpoint};
use crate::protocol::RecordingPolicy;
use crate::storage::Storage;

#[test]
fn rejects_unsafe_paths_and_invalid_retention() {
    let mut policy = RecordingPolicy {
        storage_pool_id: Some("pool-1".into()),
        ..Default::default()
    };
    assert!(policy.validate().is_ok());
    for directory in ["../other", "/tmp", "NVR/../other", "NVR\\other", ""] {
        policy.directory = directory.into();
        assert!(policy.validate().is_err(), "{directory}");
    }
    policy.directory = "NVR".into();
    policy.retention_days = 0;
    assert!(policy.validate().is_err());
    assert!(validate_endpoint("http://camera:8000/onvif/device_service", false).is_ok());
    for endpoint in [
        "file:///etc/passwd",
        "http://user:secret@camera/",
        "http://169.254.169.254/",
        "http://camera/path?secret=yes",
    ] {
        assert!(validate_endpoint(endpoint, true).is_err());
    }
}

#[test]
fn storage_is_pinned_to_a_real_pool_and_never_follows_symlinks() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("pool-1")).unwrap();
    let storage = Storage::open(root.path(), "pool-1", "NVR", false).unwrap();
    let file = storage.create("test.ts").unwrap();
    assert!(storage.create("test.ts").is_err());
    assert!(storage.create("../outside.ts").is_err());
    assert!(storage.open_file("test.ts").is_ok());
    drop(file);
    std::os::unix::fs::symlink("/tmp", storage.path().join("escape")).unwrap();
    assert!(storage.open_file("escape/private").is_err());
    std::fs::rename(root.path().join("pool-1"), root.path().join("removed")).unwrap();
    std::fs::create_dir(root.path().join("pool-1")).unwrap();
    assert!(storage.verify().is_err());
    assert!(!Path::new(&root.path().join("pool-1/NVR/test.ts")).exists());
}

#[test]
fn xml_uses_local_names_and_rejects_entities_and_oversized_payloads() {
    let xml = r#"<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><x:GetDeviceInformationResponse xmlns:x="urn:test"><x:Manufacturer>CyberVisual</x:Manufacturer><x:SerialNumber>device&amp;one</x:SerialNumber></x:GetDeviceInformationResponse></s:Body></s:Envelope>"#;
    let document = Node::parse(xml.as_bytes()).unwrap();
    assert_eq!(document.text_of("Manufacturer"), Some("CyberVisual"));
    assert_eq!(document.text_of("SerialNumber"), Some("device&one"));
    assert!(
        Node::parse(b"<!DOCTYPE x [<!ENTITY y SYSTEM 'file:///etc/passwd'>]><x>&y;</x>").is_err()
    );
    assert!(Node::parse(&vec![b'x'; 262145]).is_err());
}

fn device(id: &str) -> crate::protocol::NvrDevice {
    crate::protocol::NvrDevice {
        id: id.into(),
        name: "Camera".into(),
        onvif_url: "http://127.0.0.1:8000/onvif/device_service".into(),
        credentials_configured: true,
        profiles: vec![],
        recording_enabled: false,
        recording_profile: "raw".into(),
        removed_at: None,
        connection: "unknown".into(),
        video: "unknown".into(),
        ptz: "unknown".into(),
        recording: "disabled".into(),
        analytics: None,
        person: None,
        vehicle: None,
        last_error: None,
        updated_at: crate::protocol::now(),
    }
}
#[test]
fn device_identity_limits_and_removed_recordings_are_preserved() {
    let db = crate::db::Db::memory();
    for n in 0..4 {
        db.add(&device(&format!("camera-{n}"))).unwrap();
    }
    assert!(db.add(&device("camera-0")).is_err());
    assert!(db.add(&device("camera-4")).is_err());
    db.update("camera-0", |d| d.removed_at = Some(crate::protocol::now()))
        .unwrap();
    db.add(&device("camera-4")).unwrap();
    assert_eq!(db.devices().unwrap().len(), 5);
    assert!(db.device("camera-0").unwrap().removed_at.is_some());
}
#[test]
fn initialization_is_not_an_alert_and_repeated_changed_events_are_deduplicated() {
    let xml = |operation: &str| {
        format!(
            r#"<NotificationMessage><Message><Message UtcTime="2026-11-07T00:00:00Z" PropertyOperation="{operation}"><Data><SimpleItem Name="Category" Value="person"/><SimpleItem Name="State" Value="true"/></Data></Message></Message></NotificationMessage>"#
        )
    };
    let initialized = Node::parse(xml("Initialized").as_bytes()).unwrap();
    assert!(
        crate::events::notification("camera", &initialized)
            .unwrap()
            .is_none()
    );
    let changed = Node::parse(xml("Changed").as_bytes()).unwrap();
    let event = crate::events::notification("camera", &changed)
        .unwrap()
        .unwrap();
    let db = crate::db::Db::memory();
    let key = crate::events::event_key(&event);
    assert!(db.event(&event, &key).unwrap());
    assert!(!db.event(&event, &key).unwrap());
    assert_eq!(db.events(None, "", "9999").unwrap().len(), 1);
}
#[test]
fn ranges_support_seeking_and_reject_multiple_or_out_of_bounds_requests() {
    use crate::server::byte_range;
    assert_eq!(byte_range(Some("bytes=3-5"), 10).unwrap(), (3, 5, true));
    assert_eq!(byte_range(Some("bytes=-3"), 10).unwrap(), (7, 9, true));
    assert_eq!(byte_range(Some("bytes=6-"), 10).unwrap(), (6, 9, true));
    for v in ["bytes=10-", "bytes=6-4", "bytes=0-1,3-4", "bytes=-0"] {
        assert!(byte_range(Some(v), 10).is_err());
    }
}
pub(crate) fn state(root: &Path) -> std::sync::Arc<crate::runtime::State> {
    std::sync::Arc::new(crate::runtime::State {
        config: crate::runtime::Config {
            root: root.into(),
            production: false,
            socket: root.join("nvr.sock"),
        },
        db: crate::db::Db::memory(),
        secrets: crate::secrets::Secrets::new(&root.join("secrets")).unwrap(),
        cameras: Default::default(),
        sessions: Default::default(),
        ptz_locks: Default::default(),
        ptz_generation: Default::default(),
        active_streams: Default::default(),
    })
}

#[test]
fn precise_events_preserve_distinct_edges_and_source_ids_within_one_second() {
    let event = |stamp: &str, id: &str| {
        crate::events::notification("camera", &Node::parse(format!(r#"<NotificationMessage><Topic>Person</Topic><Message><Message UtcTime="{stamp}" PropertyOperation="Changed"><Data><SimpleItem Name="Category" Value="person"/><SimpleItem Name="State" Value="true"/><SimpleItem Name="EventId" Value="{id}"/></Data></Message></Message></NotificationMessage>"#).as_bytes()).unwrap()).unwrap().unwrap()
    };
    let a = event("2026-11-07T00:00:00.100Z", "a");
    let b = event("2026-11-07T00:00:00.100Z", "b");
    assert_ne!(crate::events::event_key(&a), crate::events::event_key(&b));
    assert_eq!(a.occurred_at, "2026-11-07T00:00:00.100000000Z");
    let db = crate::db::Db::memory();
    db.event(&a, &crate::events::event_key(&a)).unwrap();
    db.event(&b, &crate::events::event_key(&b)).unwrap();
    assert_eq!(
        db.events(None, "2026-11-07T00:00:00Z", "2026-11-07T00:00:00.999Z")
            .unwrap()
            .len(),
        2
    );
}
#[tokio::test]
async fn cleanup_only_removes_registered_unpinned_final_segments_and_rejects_changed_mounts() {
    use crate::{db::Segment, protocol::*, runtime::Session};
    use std::io::Write;
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("data/pool-1")).unwrap();
    let s = state(root.path());
    let id = uuid::Uuid::new_v4().to_string();
    let policy = RecordingPolicy {
        storage_pool_id: Some("pool-1".into()),
        ..Default::default()
    };
    s.db.save_policy(&policy).unwrap();
    let (storage, location) = s.selected_storage(&id).unwrap();
    for (name, status) in [
        ("old", "ready"),
        ("playing", "ready"),
        ("writing", "writing"),
    ] {
        storage
            .create(&format!("{name}.ts"))
            .unwrap()
            .write_all(b"test")
            .unwrap();
        s.db.save_segment(&Segment {
            public: NvrSegment {
                id: name.into(),
                device_id: id.clone(),
                profile: "raw".into(),
                started_at: "2020-01-01T00:00:00Z".into(),
                ended_at: "2020-01-01T00:01:00Z".into(),
                duration_seconds: 60.0,
                size_bytes: 4,
                status: status.into(),
            },
            filename: format!("{name}.ts"),
            location: location.clone(),
            file_identity: {
                use std::os::unix::fs::MetadataExt;
                let m = storage
                    .open_file(&format!("{name}.ts"))
                    .unwrap()
                    .metadata()
                    .unwrap();
                Some((m.dev(), m.ino()))
            },
        })
        .unwrap();
    }
    storage.create("unregistered.ts").unwrap();
    s.sessions.write().await.insert(
        "pinned".into(),
        Session {
            public: NvrSession {
                id: "pinned".into(),
                device_id: id.clone(),
                kind: "playback".into(),
                url: String::new(),
                expires_at: now(),
            },
            touched: tokio::time::Instant::now(),
            segments: vec!["playing".into()],
            directory: None,
            process: None,
        },
    );
    crate::recording::cleanup(&s).await.unwrap();
    assert!(storage.open_file("old.ts").is_err());
    for name in ["playing.ts", "writing.ts", "unregistered.ts"] {
        assert!(storage.open_file(name).is_ok());
    }
    assert_eq!(s.db.used_bytes().unwrap(), 8);
    std::fs::rename(
        root.path().join("data/pool-1"),
        root.path().join("data/offline"),
    )
    .unwrap();
    std::fs::create_dir(root.path().join("data/pool-1")).unwrap();
    s.sessions.write().await.clear();
    assert!(crate::recording::cleanup(&s).await.is_err());
}
#[test]
fn credential_files_are_private_and_never_serialized_into_devices() {
    use std::os::unix::fs::PermissionsExt;
    let root = tempfile::tempdir().unwrap();
    let secrets = crate::secrets::Secrets::new(root.path()).unwrap();
    let id = uuid::Uuid::new_v4().to_string();
    secrets
        .save(
            &id,
            &crate::onvif::Credentials {
                username: "viewer".into(),
                password: "private-password".into(),
            },
        )
        .unwrap();
    assert_eq!(
        std::fs::metadata(root.path().join(format!("{id}.json")))
            .unwrap()
            .permissions()
            .mode()
            & 0o777,
        0o600
    );
    assert_eq!(secrets.load(&id).unwrap().password, "private-password");
    assert!(
        !serde_json::to_string(&device(&id))
            .unwrap()
            .contains("private-password")
    );
    assert!(secrets.load("../outside").is_err());
}

#[tokio::test]
#[ignore = "requires FFmpeg and FFprobe"]
async fn recovers_interrupted_h264_segments_after_service_restart() {
    use crate::db::Run;
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir_all(root.path().join("data/pool-1")).unwrap();
    let s = state(root.path());
    let id = uuid::Uuid::new_v4().to_string();
    s.db.save_policy(&RecordingPolicy {
        storage_pool_id: Some("pool-1".into()),
        ..Default::default()
    })
    .unwrap();
    let (storage, location) = s.selected_storage(&id).unwrap();
    let run = Run {
        id: uuid::Uuid::new_v4().to_string(),
        device_id: id,
        profile: "raw".into(),
        started: time::OffsetDateTime::now_utc().unix_timestamp(),
        location,
    };
    let name = format!("{}-000000.ts", run.id);
    let output = std::process::Command::new("ffmpeg")
        .args([
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "testsrc=size=160x90:rate=10",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-f",
            "mpegts",
        ])
        .arg(storage.path().join(&name))
        .output()
        .unwrap();
    assert!(output.status.success(), "{:?}", output.stderr);
    s.db.save_run(&run).unwrap();
    crate::recording::recover(&s, None).await.unwrap();
    let segment = s.db.segment(&format!("{}-000000", run.id)).unwrap();
    assert_eq!(segment.public.status, "recovered");
    assert!(segment.public.duration_seconds > 0.8);
    assert!(s.db.runs().unwrap().is_empty());
    storage.create("unrelated.ts").unwrap();
    crate::recording::recover(&s, None).await.unwrap();
    assert!(storage.open_file("unrelated.ts").is_ok());
}
