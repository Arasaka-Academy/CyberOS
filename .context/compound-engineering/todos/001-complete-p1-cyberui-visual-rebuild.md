---
status: complete
priority: p1
issue_id: "001"
tags: [frontend, cyberui, themes, tv, docs]
dependencies: []
---
# CyberOS CyberUI visual rebuild

## Problem Statement
Replace the visual system across Web, mobile, TV and docs, preserving layouts and workflows. Support seven palettes in light/dark with browser-local preferences and native TV controls following the TV palette.

## Findings
Approved plan in chat, CyberUI v0.2.2 at 014c3b88ce25a874b12986ccc8f2499eb8dbad43. Source checkout has unrelated dirty changes and is untouched. Isolated base 470041f57ab9370ba54ce971fbc82633523b9c29.

## Proposed Solutions
Pinned Registry source in packages/ui; shared framework-independent themes; preserve native event and overlay contracts; migrate common primitives and semantic CSS; use existing VOD channel for TV theme.

## Recommended Action
Implementation and device acceptance are complete. The user authorized commit, merge to main and push on 2026-11-07; preserve unrelated main-worktree edits during delivery.

## Acceptance Criteria
- [x] Shared source, theme persistence and switching
- [x] All Web/mobile controls and panels migrated
- [x] TV and native controls follow 14 palettes
- [x] Starlight docs themes and readable content
- [x] Focused tests, make ci and browser matrix
- [x] Package/device verification or precise blocker recorded

## Work Log
- 2026-11-06: Created isolated managed worktree and implementation tracker. Initial inspection complete; dependency installation started.
- 2026-11-06: Completed pinned CyberUI source adapters, 14 shared themes, Web/mobile controls, TV native presentation command and docs styling; preserved layouts, workflows and approval boundaries.
- 2026-11-06: Full local make ci and browser matrix passed; final Linux arm64 package built with 1717 JS tests passed, Rust tests, Node 22 typecheck and ESLint. Busy navigation contrast regression reproduced and fixed across 14 appearances.
- 2026-11-06: Backed up and installed final 2.3.5 test package on cybermachine. Verified 24 original service/timer states, SQLite, readiness, 14 actual browser themes and 34 native theme responses through Nginx; terminal connection/input and player state preserved. Temporary tab removed and original active tab restored.
- 2026-11-06: Documented the expected photos maintenance timestamp difference, existing shared-browser HTTP/1.1 SSE limit, retained backup disk usage and physical TV/audio acceptance boundaries in .cyberos/cyberui-delivery/ACCEPTANCE.md. Original checkout unchanged, source manifest matches 1428 files, no commit/push.
