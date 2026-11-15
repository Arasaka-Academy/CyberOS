use crate::{command::CommandRunner, error::HostdError};
use serde::{Deserialize, Serialize};
use std::time::Duration;

pub const UNITS: &[&str] = &[
    "cyberos-api.service",
    "cyberos-worker@1.service",
    "cyberos-hostd.service",
    "cyberos-host-accessd.service",
    "cyberos-terminald.service",
    "cyberos-monitor.service",
    "cyberos-alerter.service",
    "cyberos-indexer.service",
    "cyberos-photos.service",
    "cyberos-photos-embeddings.service",
    "cyberos-downloader.service",
    "cyberos-bluetoothd.service",
    "cyberos-nvr.service",
    "cyberos-audiod.service",
    "cyberos-media-streamer.service",
    "cyberos-vod-player.service",
    "cyberos-health.service",
    "cyberos-maintenance.service",
    "cyberos-backup-daily.service",
    "cyberos-backup-weekly.service",
    "cyberos-health.timer",
    "cyberos-maintenance.timer",
    "cyberos-backup-daily.timer",
    "cyberos-backup-weekly.timer",
    "cyberos-webdav.service",
    "cyberos-state-init.service",
    "cyberos-iscsi-prepare.service",
    "cyberos-tailscale-forwarding.service",
    "cyberos-tv-prepare.service",
    "cyberos-tv-weston.service",
    "cyberos-tv-chromium.service",
    "cyberos-tv-cec.service",
    "cyberos-tv-gamepad.service",
];

#[derive(Debug, Serialize, Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", deny_unknown_fields)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts"))]
pub enum DiagnosticsRequest {
    Status {
        unit: Option<String>,
    },
    Logs {
        unit: String,
        limit: u16,
        since: Option<String>,
    },
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts"))]
pub struct ServiceStatus {
    pub unit: String,
    pub load_state: String,
    pub active_state: String,
    pub sub_state: String,
    pub result: String,
    pub exit_status: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts"))]
pub struct ServiceLog {
    pub timestamp_micros: String,
    pub message: String,
}
#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts"))]
pub struct DiagnosticsResult {
    pub services: Vec<ServiceStatus>,
    pub logs: Vec<ServiceLog>,
    pub truncated: bool,
}
fn validate_unit(unit: &str) -> Result<(), HostdError> {
    let worker = unit
        .strip_prefix("cyberos-worker@")
        .and_then(|s| s.strip_suffix(".service"))
        .and_then(|s| s.parse::<u8>().ok())
        .is_some_and(|n| (1..=32).contains(&n));
    if UNITS.contains(&unit) || worker {
        Ok(())
    } else {
        Err(HostdError::validation("Service is not allowlisted"))
    }
}
fn redact_log(message: &str) -> String {
    let lower = message.to_ascii_lowercase();
    if [
        "password",
        "passwd",
        "authorization",
        "api_key",
        "apikey",
        "authkey",
        "auth_key",
        "secret",
        "token",
        "bearer",
        "://",
        "private key",
    ]
    .iter()
    .any(|key| lower.contains(key))
    {
        "[redacted sensitive log entry]".into()
    } else {
        message.chars().take(1024).collect()
    }
}
pub async fn handle(
    request: DiagnosticsRequest,
    runner: &dyn CommandRunner,
) -> Result<DiagnosticsResult, HostdError> {
    let mut result = DiagnosticsResult {
        services: Vec::new(),
        logs: Vec::new(),
        truncated: false,
    };
    match request {
        DiagnosticsRequest::Status { unit } => {
            if let Some(unit) = &unit {
                validate_unit(unit)?;
            }
            let units = unit.map_or_else(
                || UNITS.iter().map(|u| (*u).to_owned()).collect::<Vec<_>>(),
                |u| vec![u],
            );
            let mut args = vec![
                "show".into(),
                "--no-pager".into(),
                "--property=Id,LoadState,ActiveState,SubState,Result,ExecMainStatus".into(),
            ];
            args.extend(units);
            let output = runner
                .run(
                    "systemctl",
                    &args,
                    None,
                    Duration::from_secs(10),
                    128 * 1024,
                )
                .await?;
            // systemctl returns nonzero when some units are missing; retain their LoadState.
            for block in output.stdout.split("\n\n").filter(|s| !s.trim().is_empty()) {
                let field = |key: &str| {
                    block
                        .lines()
                        .find_map(|l| l.strip_prefix(key))
                        .unwrap_or("unknown")
                        .to_owned()
                };
                let unit = field("Id=");
                if validate_unit(&unit).is_ok() {
                    result.services.push(ServiceStatus {
                        unit,
                        load_state: field("LoadState="),
                        active_state: field("ActiveState="),
                        sub_state: field("SubState="),
                        result: field("Result="),
                        exit_status: field("ExecMainStatus="),
                    });
                }
            }
            if result.services.is_empty() {
                return Err(HostdError::unavailable("Service status is unavailable"));
            }
        }
        DiagnosticsRequest::Logs { unit, limit, since } => {
            validate_unit(&unit)?;
            if !(1..=200).contains(&limit) {
                return Err(HostdError::validation(
                    "Log limit must be between 1 and 200",
                ));
            }
            let mut args = vec![
                "--no-pager".into(),
                "--output=json".into(),
                format!("--unit={unit}"),
                format!("--lines={limit}"),
            ];
            if let Some(since) = since {
                time::OffsetDateTime::parse(&since, &time::format_description::well_known::Rfc3339)
                    .map_err(|_| HostdError::validation("Invalid log start time"))?;
                args.push(format!("--since={since}"));
            }
            let output = runner
                .run(
                    "journalctl",
                    &args,
                    None,
                    Duration::from_secs(10),
                    512 * 1024,
                )
                .await?;
            if !output.success {
                return Err(HostdError::unavailable("Service logs are unavailable"));
            }
            for line in output.stdout.lines().take(usize::from(limit)) {
                let value: serde_json::Value = serde_json::from_str(line)
                    .map_err(|_| HostdError::operation_failed("Invalid journal response"))?;
                let message = value["MESSAGE"]
                    .as_str()
                    .unwrap_or("[non-text journal entry]");
                result.logs.push(ServiceLog {
                    timestamp_micros: value["__REALTIME_TIMESTAMP"]
                        .as_str()
                        .unwrap_or("")
                        .to_owned(),
                    message: redact_log(message),
                });
                if message.chars().count() > 1024 {
                    result.truncated = true;
                }
            }
            result.truncated |= result.logs.len() == usize::from(limit);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::CommandOutput;
    use std::sync::Mutex;

    type Call = (String, Vec<String>, Duration, usize);
    struct Runner {
        output: CommandOutput,
        calls: Mutex<Vec<Call>>,
    }
    #[async_trait::async_trait]
    impl CommandRunner for Runner {
        async fn run(
            &self,
            command: &str,
            args: &[String],
            input: Option<&[u8]>,
            timeout: Duration,
            limit: usize,
        ) -> Result<CommandOutput, HostdError> {
            assert!(input.is_none());
            self.calls
                .lock()
                .unwrap()
                .push((command.into(), args.to_vec(), timeout, limit));
            Ok(self.output.clone())
        }
    }
    fn runner(stdout: &str, success: bool) -> Runner {
        Runner {
            output: CommandOutput {
                stdout: stdout.into(),
                stderr: "private error".into(),
                success,
            },
            calls: Mutex::new(Vec::new()),
        }
    }
    #[tokio::test]
    async fn status_uses_only_fixed_properties_and_retains_missing_units() {
        let runner = runner(
            "Id=cyberos-api.service\nLoadState=loaded\nActiveState=failed\nSubState=failed\nResult=exit-code\nExecMainStatus=1\n\nId=cyberos-nvr.service\nLoadState=not-found\nActiveState=inactive\n",
            false,
        );
        let result = handle(DiagnosticsRequest::Status { unit: None }, &runner)
            .await
            .unwrap();
        assert_eq!(result.services.len(), 2);
        assert_eq!(result.services[0].result, "exit-code");
        assert_eq!(result.services[1].load_state, "not-found");
        let calls = runner.calls.lock().unwrap();
        assert_eq!(calls[0].0, "systemctl");
        assert_eq!(calls[0].2, Duration::from_secs(10));
        assert_eq!(calls[0].3, 128 * 1024);
        assert!(calls[0].1.contains(
            &"--property=Id,LoadState,ActiveState,SubState,Result,ExecMainStatus".into()
        ));
        assert!(
            !calls[0]
                .1
                .iter()
                .any(|arg| arg.contains("Environment") || arg.contains("ExecStart"))
        );
    }
    #[tokio::test]
    async fn logs_validate_before_execution_and_redact_each_entry() {
        let runner = runner(
            "{\"MESSAGE\":\"index failed\",\"__REALTIME_TIMESTAMP\":\"1\"}\n{\"MESSAGE\":\"password=private\"}\n",
            true,
        );
        for request in [
            DiagnosticsRequest::Logs {
                unit: "ssh.service".into(),
                limit: 1,
                since: None,
            },
            DiagnosticsRequest::Logs {
                unit: "cyberos-api.service".into(),
                limit: 201,
                since: None,
            },
            DiagnosticsRequest::Logs {
                unit: "cyberos-api.service".into(),
                limit: 1,
                since: Some("--all".into()),
            },
        ] {
            assert!(handle(request, &runner).await.is_err());
        }
        assert!(runner.calls.lock().unwrap().is_empty());
        let result = handle(
            DiagnosticsRequest::Logs {
                unit: "cyberos-api.service".into(),
                limit: 2,
                since: Some("2026-11-15T00:00:00Z".into()),
            },
            &runner,
        )
        .await
        .unwrap();
        assert_eq!(result.logs.len(), 2);
        assert_eq!(result.logs[1].message, "[redacted sensitive log entry]");
        assert!(result.truncated);
        let calls = runner.calls.lock().unwrap();
        assert_eq!(calls[0].0, "journalctl");
        assert!(calls[0].1.contains(&"--since=2026-11-15T00:00:00Z".into()));
        assert_eq!(calls[0].3, 512 * 1024);
    }
    #[tokio::test]
    async fn unavailable_or_malformed_journal_returns_a_controlled_error() {
        for runner in [
            runner("private stdout", false),
            runner("malformed JSON", true),
        ] {
            let error = handle(
                DiagnosticsRequest::Logs {
                    unit: "cyberos-api.service".into(),
                    limit: 1,
                    since: None,
                },
                &runner,
            )
            .await
            .unwrap_err();
            assert!(!error.message.contains("private"));
            assert!(!error.message.contains("malformed JSON"));
        }
    }
    #[test]
    fn rejects_arbitrary_units_and_options() {
        for unit in [
            "ssh.service",
            "../cyberos-api.service",
            "--all",
            "cyberos-worker@999.service",
            "cyberos-api.service\nssh.service",
        ] {
            assert!(validate_unit(unit).is_err());
        }
        assert!(validate_unit("cyberos-api.service").is_ok());
        assert!(validate_unit("cyberos-worker@2.service").is_ok());
    }
    #[test]
    fn removes_credentials_and_bounds_messages() {
        assert_eq!(
            redact_log("Authorization: Bearer hidden"),
            "[redacted sensitive log entry]"
        );
        assert_eq!(
            redact_log("connection to https://user:pass@example.test"),
            "[redacted sensitive log entry]"
        );
        assert_eq!(redact_log(&"a".repeat(2000)).len(), 1024);
        assert_eq!(
            redact_log("indexer failed with exit status 1"),
            "indexer failed with exit status 1"
        );
    }
}
