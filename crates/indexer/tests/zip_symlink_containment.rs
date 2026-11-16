#![cfg(unix)]

use std::io::{Cursor, Write};

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipArchive, ZipWriter};

#[test]
fn rejects_absolute_symlink_chains_that_overwrite_outside_the_destination() {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().canonicalize().unwrap();
    let destination = root.join("destination");
    let outside = root.join("outside");
    std::fs::create_dir(&destination).unwrap();
    std::fs::create_dir_all(outside.join("sub")).unwrap();
    let protected = outside.join("sub/protected.txt");
    std::fs::write(&protected, b"original").unwrap();
    let options = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .add_symlink("bridge", outside.to_str().unwrap(), options)
        .unwrap();
    writer
        .add_symlink(
            "alias",
            destination.join("bridge/sub").to_str().unwrap(),
            options,
        )
        .unwrap();
    writer.start_file("alias/protected.txt", options).unwrap();
    writer.write_all(b"overwritten").unwrap();
    let mut archive = ZipArchive::new(writer.finish().unwrap()).unwrap();

    let result = archive.extract(&destination);

    assert_eq!(std::fs::read(&protected).unwrap(), b"original");
    assert!(result.is_err());
}
