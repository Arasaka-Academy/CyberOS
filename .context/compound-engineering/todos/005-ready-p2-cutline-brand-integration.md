---
status: ready
priority: p2
issue_id: "005"
tags: [branding, web, documentation]
dependencies: []
---

## Problem Statement

Integrate the approved B / Cutline CyberOS identity at existing project logo references and commit the scoped change to main.

## Findings

Existing references cover the Agent rail and skeleton, settings, mobile home, TV, startup screen, Web favicons, documentation header, and README. Other product repositories and third-party diagram marks are outside scope.

## Proposed Solutions

Reuse the approved standalone SVG masters, select black or optically corrected white artwork from the existing appearance state, and keep the current layout and application behavior.

## Recommended Action

Replace current assets, use the dedicated small-size symbol at 16–40 CSS pixels, preserve accessible names, update the normative brand reference, run focused and project/browser checks, and test-deploy static assets when the management connection permits.

## Acceptance Criteria

- [x] Existing CyberOS brand references use the approved artwork.
- [x] Dark and light modes use their respective masters without geometric distortion.
- [x] Favicons use the small-size master and docs share the same geometry.
- [x] Focused tests, full gates and browser checks have recorded results.
- [ ] Device verification or the exact access blocker is recorded separately.
- [ ] Scoped changes are committed on main without unrelated work or a formal release.

## Work Log

- 2026-11-12: Confirmed a clean main checkout, fetched origin/main, and fast-forwarded to ac4207b4 before editing. Approved source artwork is the Cutline 1.0 kit from this chat. Commit/merge is authorized; push, tags and publication are not requested.
- 2026-11-13: Imported standalone standard/small/wordmark black and optically corrected white masters, plus the shared favicon. Added appearance-aware BrandLogo without changing application state, routes, APIs or global palette tokens. Synchronized product metadata to 2.4.7 using the existing versioning policy.
- 2026-11-13: Focused Vitest checks pass (48 tests); the three new browser cases pass, covering fourteen appearances, TV, and pre-React startup at 1440/390/320 px. Reviewed dark/light screenshots. The startup fixture resolves cross-workspace stylesheet URLs explicitly while React is blocked; this is a test-harness adaptation, not a product CSS change.
- 2026-11-13: Full style-browser run: 52 pass, 3 fail. Re-ran the three failures against an archive of unmodified ac4207b4 with the same installed dependencies: all reproduce the existing TV target mismatch (actual 64 px, expected 48 px). These unrelated tests and target sizes remain unchanged.
- 2026-11-13: An unrelated existing mpv test with a 50 ms command timeout failed during concurrent validation and passed when retried alone. Re-running the full gate with RUST_TEST_THREADS=1; no tests are skipped or weakened. Device administrator access is available; its API baseline remains 2.4.5 from aefd0b72 with dirty build metadata. Static Web/docs deployment follows a clean source commit.
- 2026-11-13: The Rust-serial gate passed Rust tests, typecheck and lint, then hit three existing API/backup/photos timeouts under default Vitest concurrency. Retried those files with one worker: all 202 tests pass. Re-running the unchanged full gate with RUST_TEST_THREADS=1 and VITEST_MAX_WORKERS=1; no timeout changes or exclusions.
- 2026-11-13: SHA-256 verification confirms all seven public Web SVGs are byte-identical to the approved kit, including its web/favicon.svg; documentation mirrors the selected small-size masters and favicon.
- 2026-11-13: Full make ci passes with RUST_TEST_THREADS=1 and VITEST_MAX_WORKERS=1: protocol, typecheck, lint, Rust and Python tests, 274 Vitest files (1842 passed, 5 existing skips), eight documentation metadata tests, and the complete release/workspace/docs build. Version check passes against ac4207b4 at 2.4.7.
- 2026-11-13: All 21 documentation browser checks pass with one worker. Kept the new logo case separate from the existing palette/Mermaid case and matched the icon rel token correctly because Starlight emits shortcut icon. The focused new case passes as well; no test timeout was increased. Reviewed the real built documentation header in both modes.
