---
status: in_progress
priority: p1
issue_id: "002"
tags: [photos, semantic-search, performance, acceptance]
dependencies: []
---

# Photos search completion and optimization

## Problem Statement
Complete the accepted follow-up in order: fix version/CI delivery, improve exact retrieval and cancellation, evaluate the final mixed search and bound stale vector retention, then roll out the real library after independent acceptance.

## Findings
Start: main 296f155e. CI failed on missing version bump. Real library has 6277 eligible assets, enabled=false and indexed=0. Earlier 30-photo independent precision was 68.75%; 100k/2048D device exact P95 was 11.49s.

## Proposed Solutions
Preserve Mac inference/NAS local SQLite architecture and all-result counts. Measure before changing vector SQL. Propagate cancellation and bound queues. Test dimension trade-offs only with independent quality gates. Add conservative retention of orphaned/old model vectors. Measure final API retrieval including lexical/RRF and recall. Use backed-up package upgrades for schema/dependency changes.

## Recommended Action
The user approved sequential execution on 2026-11-05, including ongoing scoped commit/push delivery and package deployment from this task. Do not tag or publish a release. Preserve .context and unrelated worktrees; operate sequentially in the main agent.

## Acceptance Criteria
- [x] Version bumped consistently; version policy checks against original feature base and parent pass; GitHub quality/package/docs jobs green.
- [x] Exact search improved and measured on 100k/2048D Linux ARM64, plus filtered/partial/historical-space cases; complete counts/facets preserved.
- [x] Superseded keyword searches cancel network/queued work and have bounded deadlines, with meaningful race tests.
- [x] Unreferenced cache and old-space retention bounded with safe tests and operator visibility.
- [x] Final API quality evaluator reports precision/recall, no-result positives, negative false matches and latency on separate calibration/validation.
- [x] Independent quality/latency targets met or precise residual limits recorded; no unsupported performance or rollout claims.
- [x] Full CI/browser/build/package verification, scoped code review and backed-up device upgrade.
- [ ] Real library full backfill after gates, sustained throughput/status checks and actual mixed-search acceptance. **Held:** validation precision 52.08% < 80%; representative 100k exact-search P95 10.29 s > 1 s. Production remains disabled, 6277 photos / 0 indexed. Do not start until the gates pass.

## Work Log
2026-11-05: Read current source/status/earlier acceptance. Begin version-only repair first. Existing .context/001 tracker and ignored deployment data preserved.

2026-11-05 follow-up: Version repair 7ea5fb03 pushed to main; remote Quality and docs browser passed, packages still running. Runtime follow-up prepared as 2.3.2. Local make ci passed after schema fixture updates; focused tests 45/45 and Photos browser 13/13 passed. Added bounded cancellation/coalescing/deadlines, GC with 7/30-day retention, final API evaluator and independent dimension experiments. Found real MLX 0.1.0 RoPE state leak causing repeated-request 502; fixed request isolation, pipeline 2 and new embedding space. Deployed backed-up model service; live official-reference cosine >0.999 and text/image/text repeat stable. Recomputed all real vectors. Final API validation: P@10 52.08%, recall 77.08%, positive empty 12.5%, negative false match 0%, first-page P95 343 ms on 30 images. All dimensions remain below quality gate. Ten万 exact result checks: 2048D legacy library P95 3.53 s, 512D with metadata+100k history P95 5.06 s; filtered 1% P95 499 ms. Broader 2048D scenario pending. Preview-schema snapshot invalidation regression reproduced then fixed in migration012 (15/15 relevant tests pass). Production remains disabled; no full backfill authorized before gates. Unrelated product-positioning edits appeared in working tree and must remain excluded from this change and package source.

2026-11-05 delivery: Commit 1fc44da9c2580b3922147a5d8941529b6e5ea10e fast-forwarded main and pushed; origin ref verified equal. 2.3.2 packages building from immutable git archive 048c6b70b823cab0ed2c95b24ca7eff2872d5dde05bd4adcb878c4270806a52c, all unrelated product-positioning edits excluded. Final make ci exit 0 (258 Vitest files / 1684 passed / 5 skipped), Photos browser13/13, docs browser18/18, Python unittest15/15. Version-repair remote42040665114 fully green including both package architectures. New-code remote42054938838 pending. Full 100k2048D+metadata+100k historical vectors P50 6.82 s/P95 10.29 s, peak271MiB; 1% filtered P95513ms; 50% indexed coverage P953.73s with exact50000 results and peak215MiB. Quality/performance gates still unmet; full library backfill held.

2026-11-06 closeout (Asia/Shanghai): Engineering delivery and deployment verified. main and origin/main both equal 1fc44da9c2580b3922147a5d8941529b6e5ea10e, version 2.3.2; unrelated product-positioning changes and .context remain unstaged. GitHub run42054938838 completed successfully: Quality, documentation browser, amd64 package, arm64 package; release skipped. Both local architecture packages verified against the clean source archive, checksums, 12 target ELF binaries, native SQLite/sqlite-vec, migration012 and bundled worker/reader; AMD64 execution used emulation.

2026-11-06 device acceptance: CyberMachine upgraded 2.3.0 -> 2.3.2 using the verified ARM64 package. Cold backup at /cyberos/system-backups/photos-acceptance-20261105T160603Z includes matching old package, runtime, configuration, state.tar, terminal home and SHA256 manifest. Upgrade unit success/exit0; functional API acceptance passed for migration, browsing/preview, lexical/empty/map searches, real authenticated Mac image/text testing, draft/config preservation and key redaction. Five service stability samples passed, 32 unit states preserved, health oneshot success/exit0, post-start warning/error journal empty. Production has 6277 eligible photos, 0 indexed; semantic enabled=false. No full backfill started.

2026-11-06 measured limits: Pipeline2 Mac-local HTTP inference processed 30 images in49.79s (0.6025 images/s, concurrency1), excluding NAS transfer/scheduling. The final mixed API on30 photos measured validation P@10=52.08%, recall=77.08%, positive zero-result=12.5%, negative false-match=0%; first-page P95=343ms applies only to that small test library. 100k/2048D with metadata and100k historical vectors measured P95=10.29s/peak271MiB; 1% filter P95=513ms; 50% coverage P95=3.73s with exact50000 results. Exploratory lower dimensions also fail80% precision; default2048D retained. Full backfill remains held by these acceptance gates. Final record: .cyberos/photos-linux-build/acceptance-deployment/README.md; machine summary: .cyberos/photos-validation/acceptance-summary.json.
