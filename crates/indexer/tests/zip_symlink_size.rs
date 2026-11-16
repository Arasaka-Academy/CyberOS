use std::io::Cursor;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[test]
fn rejects_oversized_symlink_metadata_before_creating_a_link() {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .add_symlink(
            "link",
            "target.txt",
            SimpleFileOptions::default().compression_method(CompressionMethod::Stored),
        )
        .unwrap();
    let mut bytes = writer.finish().unwrap().into_inner();
    let central = bytes
        .windows(4)
        .position(|signature| signature == b"PK\x01\x02")
        .unwrap();
    bytes[22..26].copy_from_slice(&8192_u32.to_le_bytes());
    bytes[central + 24..central + 28].copy_from_slice(&8192_u32.to_le_bytes());
    let destination = tempfile::tempdir().unwrap();
    let mut archive = ZipArchive::new(Cursor::new(bytes)).unwrap();

    assert!(archive.extract(destination.path()).is_err());
    assert!(destination.path().join("link").symlink_metadata().is_err());
}
