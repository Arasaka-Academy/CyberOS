---
status: ready
priority: p1
issue_id: "003"
tags: [photos, quality, performance]
dependencies: []
---

# Photos quality and 100k retrieval remediation

## Problem Statement
The user authorized investigating and implementing sound solutions on 2026-11-06. Separate retrieval errors from device limits and preserve complete results, facets, snapshots, offline fallback, API key handling, and existing unrelated dirty work.

## Findings
Starting commit1fc44da9, version2.3.2. Device Cortex-A76 4x2.4GHz/4GB. Prior validation P@10=52.08%; representative100k P95=10.29s. Fresh baseline after warm-up ~4.76-5.06s: vectorSQL2.64-2.76s, lexical0.35s, facets1.2s, metadata status0.18s. Model conflates related scenes; one true small-object query ranks second below the fixed threshold. Need independently labeled, frozen validation before selecting prompt/threshold/model changes.

## Proposed Solutions
1. Profile full SQL and native distance separately; test bounded memory-mapping and normalized-vector L2 equivalence before changing the metric. Cache only bounded metadata/derived counts by exact source revision and aggregate facets once where safe.
2. Compare task-specific text prompting, calibrated per-query score window, and official Qwen3-VL-Reranker-2B in isolation. Do not lower thresholds on the test set or silently cap semantic results.
3. If exact NAS distance retains a hardware floor above1s, report it and validate optional Mac acceleration before proposing a new data flow. Do not add an unverified vector database.
4. Implement only measured improvements, regression tests, full project/browser/package gates as applicable, then backed-up device verification. Full-library backfill remains disabled until independent quality and latency acceptance.

## Recommended Action
Execute sequentially in the primary agent. User has pre-authorized implementation once a sound approach is confirmed; avoid repeated approval questions. Existing commit/push delivery authorization remains scoped to Photos. Branch codex/photos-quality-scale preserves all unrelated working tree edits.

## Acceptance Criteria
- [x] Root causes and hardware floor measured with source/workload details.
- [x] Quality approach evaluated on frozen calibration and new validation; precision, recall, negative false matches and latency all reported.
- [x] Full result IDs/counts/facets/pagination remain consistent; no hidden top-K truncation.
- [x] Performance improvements verified on the actual100k ARM64 device workload, with memory and failure behavior.
- [x] Relevant tests and full checks pass; delivery and deployment reported separately.
- [x] Production full backfill remains held unless agreed quality and latency gates pass.
- [ ] Independent quality acceptance reaches precision >=80% and negative false matches <=10%; current candidates fail.
- [ ] Cold queries and alternate sorting meet the original latency target; current hot relevance passes only.

## Work Log
2026-11-06: Read prior acceptance and current implementation. Confirmed device online and clean deployed2.3.2. Began SQL/native microprofiles and immutable official reranker download into a separate model directory; existing model service remains running. Download uses upstream Git/LFS digest verification. No production semantic configuration changed.

2026-11-06: Committed and pushed db140085 (2.3.3) to main. Actual Cortex-A76/NVMe 100k current + 100k historical2048D benchmark: default relevance P95=921.07ms/60queries; real reader/service scheduling=919.63ms/60queries with model responses stubbed; extra512MiB pressure=977.70ms; broad literal100k=1454.02ms; name sort=2683.61ms. Complete results retained. Reader first query=7.92s; cold and alternate-sort targets remain open. 128MiB reader heap failed;256MiB passed. 2GiB cgroup with swap disabled completed engine/reader; no OOM, reclaim events occurred. Device memory controller absent; zram usage increased after pressure.

2026-11-06: Frozen60-image experiment (agent-reviewed labels, no human review) found default2B68.75% precision/20% negative errors; English image prompt75%/10%; reranker38464.38%/0%, reranker76868.23%/0% and8.20s per8candidates. All failed80% quality. Offline calibrated relative-score-window hypothesis raises exploratory precision above80%, but negative errors remain20%, so rejected for production. Third-party pinned8B4bit artifact download is in progress; sources and checksums verified before any isolated inference. New independent validation and implementation/reference checks are still required before adopting a candidate.

2026-11-06: Full make ci passed (259Vitest files,1699passed,5skipped, Rust/type/lint/build); Photos browser13/13; docs browser18/18. Version/docs checks passed after final documentation update. Clean-archive amd64/arm64 package builds in progress. User's unrelated dirty changes remain excluded.

2026-11-06: Added real Mac text inference to the NAS synthetic100k service/reader benchmark:22uncached inference calls,20warm query samples,934.01ms total P95,89.32ms text request P95. Benchmark-only vector-space adapter and absolute threshold -1 retain all100k synthetic matches; original fixture thresholds restored. This is a latency experiment, not real-photo quality acceptance.

2026-11-06: Completed checksum-verified isolated8B4bit experiment. Same frozen dataset: precision68.54%, recall75%, negative errors0%. Image P95=2.853s, text P95=.148s, Metal peak6.158GiB under7GiB cap. Third-party conversion has no completed official numerical comparison. Candidate and relative-window variants fail quality gates, so production model and configuration remain unchanged.

2026-11-06: CyberMachine upgraded to2.3.3/db140085 after cold backup at /cyberos/system-backups/photos-quality-scale-20261106T011454Z. Migration013, configured memory budget, previews, browse, lexical/empty/map search, Mac real image/text tests, worker heartbeat and key redaction passed. Five stability samples preserved32unit states; health oneshot success, no warning/error journal in observed resident services. Production6277photos,0vectors,semantic disabled. Both Linux build test suites passed1702tests; final amd64 archive/validation pending. QEMU's repeated file subprocesses were profiled and accelerated with an identical-version native Linux ARM64 libmagic helper; magic database hash and classifications matched, target runtime unchanged.

2026-11-06: Both final Debian archive validations passed (arm64 and amd64), including source inventory, ELF architecture, native SQLite/vec execution, migrations012/013, memory budget and bundled reader/worker. Delivery evidence: .cyberos/photos-remediation-20261106/deployment/README.md. Independent quality acceptance, cold latency and alternate-sort latency remain explicitly open.

2026-11-06: Final origin/main=db140085. GitHub workflow42139468295 completed SUCCESS; Quality, docs-browser and both architecture package jobs passed. Release skipped for non-tag push. Performance delivery verified; quality and cold/alternate-sort acceptance remain open.
