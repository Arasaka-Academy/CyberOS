use std::os::unix::fs::{MetadataExt, PermissionsExt};
use std::path::{Path, PathBuf};

use tokio::fs::{self, OpenOptions};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

use crate::error::HostdError;

use super::validation::{normalize_path, path_inside};

pub(super) async fn write_managed_file(
    path: &Path,
    content: &str,
    roots: &[PathBuf],
    mode: u32,
) -> Result<(), HostdError> {
    let path = normalize_path(path);
    if !roots
        .iter()
        .map(|root| normalize_path(root))
        .any(|root| path_inside(&root, &path))
    {
        return Err(HostdError::validation(format!(
            "Managed path is not allowed: {}",
            path.display()
        )));
    }
    let parent = path
        .parent()
        .ok_or_else(|| HostdError::validation("Managed path has no parent"))?;
    fs::create_dir_all(parent).await?;
    replace_file(&path, content.as_bytes(), mode).await
}

async fn replace_file(path: &Path, content: &[u8], mode: u32) -> Result<(), HostdError> {
    let parent = path
        .parent()
        .ok_or_else(|| HostdError::validation("Managed path has no parent"))?;
    let temp = parent.join(format!(
        ".{}.{}.tmp",
        path.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("hostd"),
        Uuid::new_v4()
    ));
    let result = async {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(mode)
            .open(&temp)
            .await?;
        file.write_all(content).await?;
        file.flush().await?;
        file.set_permissions(std::fs::Permissions::from_mode(mode))
            .await?;
        file.sync_all().await?;
        drop(file);
        fs::rename(&temp, path).await?;
        sync_parent(path).await?;
        Ok::<(), HostdError>(())
    }
    .await;
    if result.is_err() {
        let _ = fs::remove_file(&temp).await;
    }
    result
}

#[derive(serde::Serialize)]
pub(super) struct FileSnapshot {
    path: PathBuf,
    content: Option<Vec<u8>>,
    mode: u32,
    owner: Option<(u32, u32)>,
}

pub(super) async fn snapshot_files<'a>(
    paths: impl Iterator<Item = &'a Path>,
) -> Result<Vec<FileSnapshot>, HostdError> {
    let mut snapshot = Vec::new();
    for path in paths {
        let content = match fs::read(path).await {
            Ok(content) => Some(content),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        let metadata = if content.is_some() {
            Some(fs::metadata(path).await?)
        } else {
            None
        };
        snapshot.push(FileSnapshot {
            path: path.to_owned(),
            content,
            mode: metadata
                .as_ref()
                .map_or(0o640, |metadata| metadata.mode() & 0o777),
            owner: metadata.map(|metadata| (metadata.uid(), metadata.gid())),
        });
    }
    Ok(snapshot)
}

pub(super) async fn restore_files(snapshot: &[FileSnapshot]) -> Result<(), HostdError> {
    let mut failures = Vec::new();
    for FileSnapshot {
        path,
        content,
        mode,
        owner,
    } in snapshot
    {
        let result = async {
            match content {
                Some(content) => {
                    if let Some(parent) = path.parent() {
                        fs::create_dir_all(parent).await?;
                    }
                    replace_file(path, content, *mode).await?;
                    if nix::unistd::Uid::effective().is_root()
                        && let Some((uid, gid)) = owner
                    {
                        nix::unistd::chown(
                            path,
                            Some(nix::unistd::Uid::from_raw(*uid)),
                            Some(nix::unistd::Gid::from_raw(*gid)),
                        )
                        .map_err(|error| HostdError::operation_failed(error.to_string()))?;
                    }
                }
                None => match fs::remove_file(path).await {
                    Ok(()) => sync_parent(path).await?,
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => return Err(error.into()),
                },
            }
            Ok::<(), HostdError>(())
        }
        .await;
        if let Err(error) = result {
            failures.push(format!("{}: {}", path.display(), error.message));
        }
    }
    if failures.is_empty() {
        Ok(())
    } else {
        Err(HostdError::operation_failed(failures.join("; ")))
    }
}

async fn sync_parent(path: &Path) -> Result<(), HostdError> {
    let parent = path
        .parent()
        .ok_or_else(|| HostdError::validation("Managed path has no parent"))?;
    fs::File::open(parent).await?.sync_all().await?;
    Ok(())
}
