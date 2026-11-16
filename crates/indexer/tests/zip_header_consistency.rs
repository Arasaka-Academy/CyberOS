use std::io::{Cursor, Write};

use cyberos_indexer::db::IndexerSettings;
use cyberos_indexer::extractor::extract_file;
use zip::write::SimpleFileOptions;

#[tokio::test]
async fn rejects_ooxml_with_different_local_and_central_names() {
    let mut writer = zip::ZipWriter::new(Cursor::new(Vec::new()));
    writer
        .start_file("word/document.xml", SimpleFileOptions::default())
        .unwrap();
    writer.write_all(b"<w:t>cloaked document</w:t>").unwrap();
    let mut bytes = writer.finish().unwrap().into_inner();
    bytes[30..47].copy_from_slice(b"word/malware_.xml");
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("cloaked.docx");
    std::fs::write(&path, bytes).unwrap();

    let error = extract_file(
        std::fs::File::open(path).unwrap(),
        "cloaked.docx",
        &IndexerSettings::default(),
        false,
    )
    .await
    .unwrap_err();

    assert_eq!(error.code.as_str(), "CORRUPT_DOCUMENT");
}
