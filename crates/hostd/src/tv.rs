/**
 * [INPUT]: 依赖已确认的 TV 模式和 HDMI 选择器请求。
 * [OUTPUT]: 调用固定 TV 宿主脚本执行启停或输出重配。
 * [POS]: 特权 TV 操作边界；拒绝任意命令和连接器参数。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use serde::{Deserialize, Serialize};

use crate::command::{CommandRunner, DEFAULT_OUTPUT_LIMIT};
use crate::error::HostdError;
use std::time::Duration;

const TV_MODE_COMMAND: &str = "/usr/lib/cyberos/scripts/cyberos-tv-mode";

#[derive(Debug, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts", rename = "HostdTvRequest"))]
#[serde(deny_unknown_fields)]
pub(crate) struct TvRequest {
    enabled: bool,
    confirmed: bool,
    #[serde(default)]
    #[cfg_attr(test, ts(optional))]
    reconfigure: Option<bool>,
    #[serde(default, rename = "drmConnector")]
    #[cfg_attr(test, ts(optional))]
    drm_connector: Option<String>,
}

#[derive(Debug, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
#[cfg_attr(test, ts(export_to = "hostd.ts", rename = "HostdTvResult"))]
pub(crate) struct TvResult {
    enabled: bool,
    #[cfg_attr(test, ts(type = "true"))]
    applied: bool,
}

#[cfg(test)]
pub(crate) fn export_protocol_bindings(config: &ts_rs::Config) {
    use ts_rs::TS;

    TvRequest::export_all(config).unwrap();
    TvResult::export_all(config).unwrap();
}

pub(crate) async fn apply(
    request: TvRequest,
    runner: &dyn CommandRunner,
) -> Result<TvResult, HostdError> {
    if !request.confirmed {
        return Err(HostdError::validation("TV mode confirmation is required"));
    }
    let reconfigure = request.reconfigure.unwrap_or(false);
    if reconfigure && !request.enabled {
        return Err(HostdError::validation(
            "TV mode must be enabled for output reconfiguration",
        ));
    }
    let connector = request.drm_connector.as_deref().unwrap_or("auto");
    if connector != "auto"
        && !connector.strip_prefix("HDMI-A-").is_some_and(|suffix| {
            !suffix.is_empty()
                && !suffix.starts_with('0')
                && suffix.len() <= 8
                && suffix.bytes().all(|byte| byte.is_ascii_digit())
        })
    {
        return Err(HostdError::validation(
            "TV output must be a HDMI connector or automatic",
        ));
    }
    let action = if reconfigure {
        "reconfigure"
    } else if request.enabled {
        "enable"
    } else {
        "disable"
    };
    let arguments = if request.enabled {
        vec![action, connector]
    } else {
        vec![action]
    };
    let arguments = arguments
        .iter()
        .map(|argument| argument.to_string())
        .collect::<Vec<_>>();
    let result = runner
        .run(
            TV_MODE_COMMAND,
            &arguments,
            None,
            Duration::from_secs(300),
            DEFAULT_OUTPUT_LIMIT,
        )
        .await?;
    if !result.success {
        return Err(HostdError::operation_failed(
            if result.stderr.trim().is_empty() {
                "TV mode command failed"
            } else {
                result.stderr.trim()
            },
        ));
    }
    Ok(TvResult {
        enabled: request.enabled,
        applied: true,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Mutex;
    use std::time::Duration;

    #[derive(Default)]
    struct FakeRunner {
        calls: Mutex<Vec<(String, Vec<String>)>>,
    }

    #[async_trait]
    impl CommandRunner for FakeRunner {
        async fn run(
            &self,
            command: &str,
            args: &[String],
            _input: Option<&[u8]>,
            _command_timeout: Duration,
            _output_limit: usize,
        ) -> Result<crate::command::CommandOutput, HostdError> {
            self.calls
                .lock()
                .unwrap()
                .push((command.to_owned(), args.to_vec()));
            Ok(crate::command::CommandOutput {
                stdout: String::new(),
                stderr: String::new(),
                success: true,
            })
        }
    }

    #[tokio::test]
    async fn reconfigures_only_validated_hdmi_connectors() {
        let runner = FakeRunner::default();
        let request: TvRequest = serde_json::from_value(serde_json::json!({
            "enabled": true, "confirmed": true, "reconfigure": true, "drmConnector": "HDMI-A-2"
        }))
        .unwrap();
        apply(request, &runner).await.unwrap();
        assert_eq!(
            runner.calls.lock().unwrap()[0].1,
            vec!["reconfigure", "HDMI-A-2"]
        );
        let request: TvRequest = serde_json::from_value(serde_json::json!({
            "enabled": true, "confirmed": true, "reconfigure": true, "drmConnector": "HDMI-A-2\nmode=off"
        })).unwrap();
        assert!(apply(request, &runner).await.is_err());
        assert_eq!(runner.calls.lock().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn maps_boolean_state_to_the_fixed_tv_mode_command() {
        let runner = FakeRunner::default();
        for enabled in [true, false] {
            let result = apply(
                TvRequest {
                    enabled,
                    confirmed: true,
                    reconfigure: None,
                    drm_connector: None,
                },
                &runner,
            )
            .await
            .unwrap();
            assert_eq!(result.enabled, enabled);
            assert!(result.applied);
        }
        assert_eq!(
            runner.calls.lock().unwrap().as_slice(),
            &[
                (
                    TV_MODE_COMMAND.to_owned(),
                    vec!["enable".to_owned(), "auto".to_owned()]
                ),
                (TV_MODE_COMMAND.to_owned(), vec!["disable".to_owned()])
            ]
        );
    }

    #[tokio::test]
    async fn rejects_unconfirmed_requests_without_running_a_command() {
        let runner = FakeRunner::default();
        assert!(
            apply(
                TvRequest {
                    enabled: true,
                    confirmed: false,
                    reconfigure: None,
                    drm_connector: None,
                },
                &runner,
            )
            .await
            .is_err()
        );
        assert!(runner.calls.lock().unwrap().is_empty());
    }
}
