---
status: ready
priority: p1
issue_id: "004"
tags: [nvr, cybervisual, ptz]
dependencies: []
---

# CyberOS NVR and PD42S1 integration

## Problem Statement

Implement the user-approved 2026-11-07 plan across CyberOS and CyberVisual: up to four cameras, persistent continuous recording, cyclic retention, live/playback/events, and RS485 PD42S1 pan/tilt with manual center calibration.

## Findings

- CyberVisual provides ONVIF/RTSP, PullPoint, MJPEG and shared REST/ONVIF PTZ; this task adds the native PD42S1 driver.
- Both checkouts have pre-existing user edits; preserve them. No commit/push is authorized.
- Official V1.2 files downloaded by the user have been read and hashed. Manual/XLSX contradictions and conservative configuration gates are documented in CyberVisual `docs/pd42s1.md`.
- CyberMachine package upgrade and device-browser checks passed. Jetson was deployed through Tailscale and its real USB camera is registered in NVR. The user says the motors are not installed and explicitly deferred physical motor acceptance; motion remains disabled.

## Proposed Solutions

Use an independent non-root Rust NVR daemon, Unix-socket Fastify adapter, generated shared types, native React panel, and a Python 3.6-compatible CyberVisual PD42S1 driver. Record RTSP/TCP H.264 without re-encoding; use configured storage pools only.

## Recommended Action

Execute the approved plan sequentially, with focused regression tests and full repository gates. Package/schema/unit changes require a backed-up package upgrade for device verification.

## Acceptance Criteria

- [x] Official protocol source acquired and driver golden frames verified.
- [x] NVR daemon, persistence, ONVIF, recording/recovery/retention and playback implemented.
- [x] Fastify API and generated shared contracts integrated.
- [x] Responsive bilingual NVR panel integrated with desktop/mobile navigation.
- [x] PD42S1 transport, calibration, bounded motion and shared PTZ integration implemented.
- [x] Packaging, local development, documentation and tests integrated.
- [x] Software ONVIF/media/browser checks completed and evidence recorded.
- [x] CyberMachine backed-up package upgrade and actual service/browser checks completed.
- [x] Jetson driver/video deployment and actual camera/NVR connection verified.
- [x] User-authorized scoped commits pushed to both main branches; CyberOS deployed from clean committed source.
- [ ] Physical motor acceptance: explicitly deferred by the user because motors are not installed; serial stays closed and movement is disabled.
- [ ] Four-camera 24-hour acceptance completed. Requires four real streams and explicit recording storage selection.

## Work Log

### 2026-11-07 — Implementation started

Reviewed the approved plan and both dirty working trees. Existing changes are preserved; implementation does not authorize commits or pushes. Defaults: recording disabled until selected pool/directory, raw profile, seven days/100 GiB total quota; PD42S1 addresses 1/2, 115200 8N1, manual center confirmation.

### 2026-11-07 — Software implementation and package validated

Implemented the independent Rust daemon, Unix Fastify adapter, generated contracts, migration, four-tab bilingual panel, service/installer/dev integration, and CyberVisual PTZ supervision/readiness/calibration integration. Four synthetic CyberVisual cameras passed authentication/identity checks, simultaneous RTSP recording, HLS/Range/download, API-process independence, daemon restart recovery, source reconnect and directory-identity replacement checks.

CyberOS full local gates passed; Linux arm64 package build passed all Rust tests and 263 Vitest files / 1770 tests. NVR browser checks passed 12 tests, with both languages at 1440/820/560/390/320 px; docs browser passed 20 tests. CyberVisual backend passed 114 tests and frontend passed 124 tests and build. Evidence and remaining boundaries are recorded in `../reports/nvr-cybervisual-acceptance-20261107.md`.

### 2026-11-07 — Official protocol, native serial driver and package upgrade verified

The user supplied downloaded official V1.2 PDF/XLSX files. Verified them against official C examples and implemented the native serial bus, strict framing, stop preemption, no motion replay, finite targets, feedback supervision and int32 travel validation. Manual/XLSX enabled-bit contradictions require explicit per-axis confirmation; unknown settings keep the port closed. Stop replaces the target with zero displacement and retains holding torque; no heating brake latch or driver-disable command is used.

CyberVisual backend full suite passed 166 tests; after the final int32 guard, the focused serial/driver/PTZ/management suite passed 78 tests. Frontend full suite passed 126 tests; isolated source built and passed both calibration/reconnect UI tests. Real pyserial with a pseudo-TTY responder is software validation only.

CyberMachine upgraded from 2.3.42 to 2.3.43 after verifying a recovery package and complete reconstructed cold state backup. NVR runs as non-root and survives API restart; services and storage checks passed, with only the pre-existing stale_index health finding. Actual Nginx browser checks passed 10 bilingual/responsive cases. Updated protocol documentation was deployed separately as `dev-20261107035649479-31013` and read back.

Jetson was discovered through Tailscale and authenticated. Its legacy application, unit, models and captures have a hashed complete backup. A real USB camera exists at `/dev/video1`, while the old service still uses index 0 and reports disconnection. Scoped source and offline Python wheels are staged for a reversible non-root service upgrade. USB RS485, verified axis parameters, physical motors and four-camera 24-hour acceptance remain pending. No commit or push has been made.

### 2026-11-07 — Jetson deployed and real camera connected; motors deferred

Completed the reversible service switch to non-root `cybervisual.service` under `/opt/cybervisual`, with isolated Python 3.6 dependencies and private runtime/configuration files. The original application, user configuration, model and captures are retained, and the legacy service is disabled. The real camera now runs at index 1 with TensorRT at about 5.8 FPS. NVR contains the real `Jetson Nano` UUID, with recording disabled and no storage pool selected.

Resolved real-device Python 3.6 SOAP serialization, Pillow 8.4 bitmap font measurement and Jetson H.264 IDR interval compatibility. The full backend suite passed 174 tests; after the final encoder-only change, all 16 media interop tests passed. Initial and late-joining real HLS clients both decoded 640×480 H.264 segments without errors. Final device checks verified 32 runtime file hashes, non-root service/NRestarts=0, camera/model readiness, unchanged legacy configuration and no current-process error journal entries.

The user explicitly deferred physical motor work because the motors are not installed. The serial port has not been opened; PTZ remains unavailable, uncalibrated and movement-locked. Four real cameras recording for 24 hours and physical mount-loss recovery remain unverified. No commit or push has been made.

### 2026-11-07 — Preview transport deployed and actual browser acceptance completed

Real browser inspection identified HTTP/1 connection queuing from persistent event streams and previews. Added bounded, same-origin WebSocket JPEG preview transport with cancellation and slow-client frame dropping; adjusted HLS fetch priority/timeouts and its sliding window. No dependencies, database schema, service units or credentials changed. Final CyberOS gates passed: 264 Vitest files / 1778 passed / 5 skipped, Rust workspace, protocol/typecheck/lint/build/version checks; transport-specific tests passed 15 cases and NVR browser fixtures passed 13 cases.

Deployed API, NVR, Web and docs as `dev-20261107050957-nvr-preview`, preserving a backup and receipt. Verified 125 protected package-source files against the installed package before using the existing locked runtime deployment and rollback procedure. This supplements the initial 2.3.43 package; it is not a replacement formal release.

Actual Chrome against the CyberMachine Nginx entrypoint passed all 10 bilingual/responsive cases with real Jetson JPEG decoding. Raw HLS decoded 640×480 and advanced its playback clock. Checked the wide-screen HLS and 320px Chinese layout visually; no device/recording writes or motor commands were sent, and temporary HLS sessions were removed. Final CyberMachine services are non-root, active/running, NRestarts=0, with no failed units or current-process error journal entries. The latest Jetson receipt is `2026-11-07T05:15:07Z`, PID 7946, with all 32 runtime file hashes verified.

Implementation and software/device-video deployment are complete. Recording remains disabled until a pool/directory is selected. Physical motors remain explicitly deferred, and four real cameras / 24-hour recording remain pending. No commit or push has been made.

### 2026-11-07 — Main delivery and committed-source rapid deployment

The user authorized committing, integrating into main and pushing both repositories, with rapid deployment for CyberOS. Committed only the verified task snapshots, preserving unrelated working-tree changes and theme snapshots. CyberOS main is `eccde69c4223f23ff090c5437ada52984b918ea2`, with the required coordinated version increment to 2.3.44. CyberVisual main is `909f3a7d59427b2fc5eed7c379022c3694eef4d1`, including the native driver and freshly generated tracked device assets required by its CI. Local and remote main refs were verified equal; CyberOS upstream/main was also refreshed.

Built CyberOS from a clean isolated main commit. Version/protocol/type checks, 30 focused version/packaging tests, API/Web/docs builds and the Linux arm64 NVR build passed. Deployed api/nvr/web/docs as `dev-20261107053500-nvr-main`, using the existing locked, backed-up runtime apply and rollback procedure. Compared 125 protected source files with the previously installed NVR package: 90 were identical and 35 contained only the coordinated product version metadata. No new dependency, schema, unit or installer behavior was applied. The installed package remains 2.3.43; the rapid components use 2.3.44 source.

Final services, binary/static hashes, storage readiness and journals passed. Four actual-camera browser cases passed (en/zh-CN × 1440/320px), including decoded JPEG, advancing 640×480 HLS and all four tabs. No recording or motor commands were sent; temporary HLS sessions were removed. CyberVisual main CI passed in full. CyberOS cloud Quality passed in full (version/protocol/type/lint/test/build); the automatically triggered amd64/arm64 package and documentation-browser stages are still running and recorded separately. Evidence: `.cyberos/nvr-upgrade/main-delivery/verification.json` and the acceptance report. Physical motor and four-camera 24-hour gates remain deferred/pending as above.
