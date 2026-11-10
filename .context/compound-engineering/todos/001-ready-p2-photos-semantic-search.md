---
status: in_progress
priority: p2
issue_id: "001"
tags: [photos, semantic-search, mac-mini]
dependencies: []
---

# Photos semantic search

## Problem Statement
Implement the accepted Mac mini embedding service and CyberOS local hybrid search plan.

## Findings
Source starts at 150a7f7eb3ffd8285e490997a4e1587ad2f6d3d0 with a clean checkout. Mac mini M4/16GiB; CyberMachine 4GiB/NVMe. The Rust Photos unit intentionally cannot network. Existing metadata queries and filters must continue working.

## Proposed Solutions
Use a separate MLX HTTP service on Mac mini and a durable TypeScript embedding worker on CyberOS. Keep vectors in ordinary SQLite BLOB tables, and execute sqlite-vec similarity queries in a reader thread.

## Recommended Action
Execute the user-approved plan on codex/photos-semantic-search. No commit or push is authorized.

## Acceptance Criteria
- [x] Mac service: locked model/runtime, authenticated image/text API, bounded priority queue, real model smoke, launchd and private Tailscale HTTPS.
- [x] Schema/config: secret redaction, profiles/cache/bindings/leased jobs, stale result rejection and recovery.
- [x] Background service: backfill, reuse, retries, circuit breaker, status and lifecycle integration.
- [x] Search: filtered hybrid ranking, calibrated threshold support, exact counts/facets, bounded snapshots, stable pagination and map parity.
- [x] UI: configuration, connection test, rebuild/retry, progress, default relevance and visible fallback, Chinese/English and mobile checks.
- [x] Verification: focused and full source gates, browser checks, real inference and isolated native Linux 100k benchmark.
- [x] Delivery: Linux amd64/arm64 packages and backed-up CyberMachine package upgrade.
- [ ] Acceptance: independent quality target and 100k device latency target; full-library backfill.

## Work Log
2026-11-05: Started authorized implementation; branch created, isolated Python 3.13 environment installation started on Mac mini.
2026-11-05: Implemented shared protocol/client, migration 011, durable inference worker and unit, SQLite native cosine reader thread, RRF and snapshots, settings and query UI. Added operator documentation at docs/src/content/docs/how-to/photos-semantic-search.md. No commit/push.
2026-11-05: Mac model pinned to revision 9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda, lock verified, launchd installed. Tailnet HTTPS 9443 added without changing 443/8443; 9443 has no Funnel. Official PyTorch/MLX comparison cosines 0.999872, 0.999852, 0.999253. Service tests 6 passed.
2026-11-05: Real 30-preview quality sample: calibration 8 positive/10 negative queries; threshold 0.327787, calibration precision 100%, validation 68.75%, both negative false-match 0%. 80% validation target is unmet. Observed image throughput 0.768/sec. Production threshold/config has not been changed.
2026-11-05: make ci passed (Vitest 1671 passed, 5 skipped; Cargo/Python/docs checks and full build passed); docs browser 18 passed. Additional meaningful race/source checks and browser tests added after that gate, requiring a final rerun.
2026-11-05: Native Linux arm64 isolated test used /var/tmp/cyberos-photos-semantic-20261105-1634, existing installed Linux better-sqlite3 and verified sqlite-vec Linux ARM64 extension. All 30 real previews indexed; 20 text queries P95 97.86 ms, pagination, cached offline vectors, lexical fallback and empty results passed. Model key cleared from the test settings afterward. Production SQLite/services untouched.
2026-11-05: macOS 100k/2048D exact benchmark returns all 100k, bounded-heap P95 1.97s / peak RSS 316.9 MiB. Linux arm64 100k benchmark completed: 20 runs, P50 5.71s, P95 11.49s, peak process RSS 251.95 MiB. Memory cgroup controller is absent, so the requested systemd MemoryMax was ineffective; V8 old heap 128 MiB was effective. The 1s local-search goal is unmet.
2026-11-05: Fresh final make ci passed: 257 Vitest files, 1672 passed and 5 skipped; protocol, Cargo, Python, typecheck, lint and full builds passed. Photos browser 13 passed; final docs browser 18 passed. Final diff check clean. Production API/Photos still active, failed-unit list empty, no production SQLite/config changes.
2026-11-05: Debian bookworm-slim base images are now available for both Linux architectures. Separate local ARM64/AMD64 build environments are installing dependencies; pinned Rust 1.95 and Node 22 toolchains are being downloaded with SHA256 checks. All source builds remain on the Mac.
2026-11-05: Both local builders are ready with verified Rust 1.95.0 / Node 22.23.2. ARM64 completed release and web/docs builds and entered full package tests; AMD64 is compiling from the same source snapshot. Snapshot fingerprint 601b1c0555ffd784ad904afc3cb0972e7d8b23be2684f00828d59d612d88c35f. Package validation and a cold-backup/rollback upgrade script are prepared but not yet executed.
2026-11-05: Additional isolated device profiling found roughly 2.4s in semantic scoring out of 3.8s per warmed query in this short sample. temp_store=MEMORY had no material benefit and increased peak RSS from about 250 to 269 MiB. Kept the verified configuration; this diagnostic sample does not replace the formal 20-run P95 above.
2026-11-05: Both Linux packages built and validated against source fingerprint 601b1c0555ffd784ad904afc3cb0972e7d8b23be2684f00828d59d612d88c35f. Each includes 12 correct-architecture ELF binaries, native SQLite/vec, migration 011, and worker/reader entries. ARM64 SHA256 3dad4dd53f765349d58f23434cb652fee88d0e49fc3cd096830faab05f87e20a; AMD64 SHA256 103fd0f470168eb48654bffbef446eef7733501cc1b5d0e268f09105394565e6.
2026-11-05: AMD64 final package tests passed: Rust/Python/docs and 257 Vitest files / 1677 tests. Fixed an emulator environment missing Lua without changing product source; full VOD suite 72 passed, and ARM64 native Lua contract also passed. Final file inspection used the same Debian file/libmagic version and identical magic database natively; 42 classifications matched and inspection was about 12x faster. Target runtime architecture remained AMD64 and was independently checked after packaging.
2026-11-05: Started the backed-up CyberMachine upgrade as transient unit photos-semantic-package-upgrade-20261105.service, independent of the SSH connection. Production enablement and full-library backfill remain off.
2026-11-05: Package upgrade succeeded with cold backups at /cyberos/system-backups/photos-semantic-20261105T102817Z. Actual previous runtime, package, configuration, state, and terminal home retained with archive checks and SHA256 records. Mac API URL/key saved server-side with enabled=false. Draft test, real text/image API, key omission/redaction, existing preview, lexical search, empty results, and map passed on the installed API. The first connection test returned a transient 502; the retry and subsequent stored-key/browser tests passed without product changes.
2026-11-05: Production UI checked at 1440px and 390px: real connection verification, 2048D/model space display, empty secret input, disabled switch, and no horizontal overflow. Final device audit preserved enablement/active state of 31 prior units, found no failed units or warning journal entries, and all four feature services had zero restarts. Health and the normal indexer rebuild were ready. Receipt: .cyberos/photos-linux-build/deployment/README.md. Task dev server and owned browser session closed; no commit/push.

## Remaining acceptance gates
- Core implementation and backed-up test deployment are complete. The independent quality target remains unmet: 68.75% against 80%; negative false-match rate in the small sample was 0%.
- The 100k device exact-search target remains unmet: P95 11.49 seconds against 1 second. The 100k end-to-end 5-second target is not established.
- Smart search stays disabled on the 6,277-photo production library; no full-library vector backfill has started. Optimize and repeat independent acceptance before claiming full production rollout.
