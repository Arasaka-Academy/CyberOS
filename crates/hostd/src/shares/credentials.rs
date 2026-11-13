use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;

use nix::unistd::{Gid, Group, Uid, chown};
use tokio::fs;

use crate::command::{CommandRunner, run_checked};
use crate::error::HostdError;

use super::files::{FileSnapshot, restore_files, snapshot_files, write_managed_file};
use super::model::{SharePaths, ShareSettings};

// This is also the config used by the packaged smbd.service override.
const SAMBA_CONFIGURATION: &str = "/usr/share/cyberos/samba.conf";
const SAMBA_SNAPSHOT: &str = include_str!("samba_snapshot.py");

pub(super) struct CredentialTransaction {
    directory: PathBuf,
    htpasswd: Vec<FileSnapshot>,
    username: String,
    user_existed: bool,
    user_creation_attempted: bool,
    user_created: bool,
}

impl CredentialTransaction {
    pub(super) async fn prepare(
        settings: &ShareSettings,
        paths: &SharePaths,
        runner: &dyn CommandRunner,
    ) -> Result<Option<Self>, HostdError> {
        if settings.account.password.is_none() {
            return Ok(None);
        }
        let htpasswd = snapshot_files(std::iter::once(paths.htpasswd.as_path())).await?;
        let parent = paths
            .htpasswd
            .parent()
            .ok_or_else(|| HostdError::validation("Credential path has no parent"))?;
        fs::create_dir_all(parent).await?;
        let directory = parent.join(format!(".credential-recovery-{}", uuid::Uuid::new_v4()));
        fs::DirBuilder::new().mode(0o700).create(&directory).await?;
        let mut transaction = Self {
            directory,
            htpasswd,
            username: settings.account.username.clone(),
            user_existed: false,
            user_creation_attempted: false,
            user_created: false,
        };
        let preparation = async {
            let output = runner.run("id", &["-u".into(), transaction.username.clone()], None,
                crate::command::DEFAULT_COMMAND_TIMEOUT, crate::command::DEFAULT_OUTPUT_LIMIT).await?;
            transaction.user_existed = output.success;
            let record = serde_json::json!({ "files": transaction.htpasswd, "username": transaction.username, "userExisted": transaction.user_existed });
            write_managed_file(&transaction.directory.join("htpasswd.json"), &record.to_string(), std::slice::from_ref(&transaction.directory), 0o600).await?;
            transaction.samba(runner, "snapshot").await
        }.await;
        if let Err(error) = preparation {
            let _ = fs::remove_dir_all(&transaction.directory).await;
            return Err(error);
        }
        Ok(Some(transaction))
    }

    async fn samba(&self, runner: &dyn CommandRunner, action: &str) -> Result<(), HostdError> {
        let request = serde_json::to_vec(&serde_json::json!({
            "action": action,
            "backup": self.directory.join("samba.json"),
            "username": self.username,
            "configuration": SAMBA_CONFIGURATION,
        }))
        .map_err(|error| HostdError::operation_failed(error.to_string()))?;
        run_checked(runner, "python3", &["-c", SAMBA_SNAPSHOT], Some(&request)).await?;
        Ok(())
    }

    pub(super) async fn rollback(&self, runner: &dyn CommandRunner) -> Result<(), HostdError> {
        let mut failures = Vec::new();
        let samba = self.samba(runner, "restore").await;
        let samba_restored = samba.is_ok();
        if let Err(error) = samba {
            failures.push(error.message);
        }
        if let Err(error) = restore_files(&self.htpasswd).await {
            failures.push(error.message);
        }
        if samba_restored && self.user_created {
            // No --remove: rollback must never delete home directories or user data.
            if let Err(error) = run_checked(runner, "userdel", &[&self.username], None).await {
                failures.push(error.message);
            }
        } else if self.user_creation_attempted && !self.user_created {
            let state = runner
                .run(
                    "id",
                    &["-u".into(), self.username.clone()],
                    None,
                    crate::command::DEFAULT_COMMAND_TIMEOUT,
                    crate::command::DEFAULT_OUTPUT_LIMIT,
                )
                .await;
            match state {
                Ok(output) if !output.success => {},
                _ => failures.push("new OS account creation outcome is uncertain; inspect the recovery record before cleanup".into()),
            }
        }
        if failures.is_empty()
            && let Err(error) = fs::remove_dir_all(&self.directory).await
        {
            failures.push(error.to_string());
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(HostdError::operation_failed(format!(
                "credential rollback failed: {}; recovery record: {}",
                failures.join("; "),
                self.directory.display()
            )))
        }
    }

    pub(super) async fn commit(self) {
        if let Err(error) = fs::remove_dir_all(&self.directory).await {
            // The application succeeded. A failed backup cleanup is not a failed
            // password change, and the private record remains available for cleanup.
            tracing::warn!(%error, path = %self.directory.display(), "failed to remove committed credential recovery record");
        }
    }
}

pub(super) async fn apply_credentials(
    settings: &ShareSettings,
    paths: &SharePaths,
    runner: &dyn CommandRunner,
    group: &str,
    transaction: Option<&mut CredentialTransaction>,
) -> Result<(), HostdError> {
    if let Some(password) = settings.account.password.as_deref() {
        if let Some(parent) = paths.htpasswd.parent() {
            fs::create_dir_all(parent).await?;
        }
        run_checked(
            runner,
            "htpasswd",
            &[
                "-Bci",
                &paths.htpasswd.to_string_lossy(),
                &settings.account.username,
            ],
            Some(format!("{password}\n").as_bytes()),
        )
        .await?;
    }
    let credentials_exist = fs::try_exists(&paths.htpasswd).await?;
    if credentials_exist {
        fs::set_permissions(&paths.htpasswd, std::fs::Permissions::from_mode(0o640)).await?;
    }
    if credentials_exist
        && Uid::effective().is_root()
        && let Some(group) = Group::from_name(group)
            .map_err(|error| HostdError::operation_failed(error.to_string()))?
    {
        let _ = chown(
            &paths.htpasswd,
            Some(Uid::from_raw(0)),
            Some(Gid::from_raw(group.gid.as_raw())),
        );
    }
    let Some(password) = settings.account.password.as_deref() else {
        return Ok(());
    };
    let transaction = transaction
        .ok_or_else(|| HostdError::operation_failed("Credential recovery was not prepared"))?;
    if !transaction.user_existed {
        transaction.user_creation_attempted = true;
        run_checked(
            runner,
            "useradd",
            &[
                "--system",
                "--no-create-home",
                "--home-dir",
                "/cyberos/home/share",
                "--shell",
                "/usr/sbin/nologin",
                &settings.account.username,
            ],
            None,
        )
        .await?;
        transaction.user_created = true;
    }
    run_checked(
        runner,
        "smbpasswd",
        &[
            "-c",
            SAMBA_CONFIGURATION,
            "-s",
            "-a",
            &settings.account.username,
        ],
        Some(format!("{password}\n{password}\n").as_bytes()),
    )
    .await?;
    run_checked(
        runner,
        "smbpasswd",
        &["-c", SAMBA_CONFIGURATION, "-e", &settings.account.username],
        None,
    )
    .await?;
    Ok(())
}
