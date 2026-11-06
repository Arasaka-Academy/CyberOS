---
status: complete
priority: p1
issue_id: "002"
tags: [frontend, design-system, components, accessibility]
dependencies: []
---
# Frontend design and component review

## Problem Statement
Review the entire frontend against frontend-design.md and refactor component structure, beyond theme/CSS replacement. Keep the full Web/mobile/TV/docs scope until each area is reviewed, migrated where needed and verified.

## Findings
- Baseline: 94 production Web/TV TSX files; 604 UiButton sites; Button infers its role from CSS names.
- 75 settings-section-card sites duplicate headers/frames. The design requires clear full-width sections without nested decorative cards.
- 212 native inputs and duplicated Field/NumberField helpers; labels, errors and descriptions are not owned by one field contract.
- Empty/error/status markup is repeated across settings, management and media.
- The normative document retains outdated fixed-color/dark-only/no-theme text that contradicts its shared 14-theme contract.
- Previous implementation and deployment remain uncommitted in this worktree. Original checkout must stay untouched.

## Proposed Solutions
Explicit native-contract button variants; shared fields/controls, section/header, feedback/status and dialog/data primitives; migrate consumers by responsibility. Keep feature state, approvals, remote navigation and media/terminal lifecycles intact. Verify actual rendered states and workflows.

## Recommended Action
Completed under the user's whole-frontend goal. Final ownership, area matrix, evidence and runtime/physical limits are in ../reviews/frontend-component-design-review.md. The user authorized commit, merge to main and push on 2026-11-07.

## Acceptance Criteria
- [x] Normative specification is internally consistent and identifies component owners
- [x] Buttons/fields/select/switch/feedback have reusable structure and explicit semantics
- [x] Settings sections, headers and form rows use shared components
- [x] Management tables/lists, creation flows and dialogs reviewed and structurally refactored
- [x] Files/photos/music/video/chat/playback/notifications/mobile reviewed and structurally refactored
- [x] TV and docs reviewed against the shared design contract
- [x] Chinese/English, 14 themes, responsive matrix, keyboard/focus/Escape/reduced motion verified
- [x] Full gates and authorized cybermachine deployment/acceptance completed or concrete blockers recorded

## Work Log
- 2026-11-06: Started current-state audit; saved counts in .cyberos/component-review/baseline-inventory.json. First pass focuses on shared component contracts and real consumer migration, not page-local CSS overrides.
- 2026-11-07: Migrated 604 explicit UiButton sites, 228 fields, 69 sections, shared feedback/dialog/details consumers; reviewed all 25 settings categories and 12 business panels across Chinese/English and five widths. Corrected media report labels and waited for loaded content.
- 2026-11-07: Browser inspection found zero-width mobile viewer and zero-height map; regression checks failed before fixes and passed after moving Portal rules to viewport breakpoints and MapLibre CSS into the named legacy layer. Fixed filter surfaces and error/success tones.
- 2026-11-07: Final make ci passed (260 Vitest files, 1712 passed / 5 skipped plus Rust and all builds). Browser checks: styles 30, feature chains 62, TV 62, mobile 30, docs 19; real API matrix 370 with zero layout failures.
- 2026-11-07: Deployed web/docs dev-20261106164401532-39356, verified local/installed/receipt hashes, services and device UI. Fourteen themes preserve terminal/player sessions; 33 native theme commands accepted. Photos filters/viewer/search/map passed in both languages. Existing HTTP/1.1 connection limit tracked separately in 003; physical TV/remote/audio remain acceptance boundaries. No commit/push.
- 2026-11-07: User authorized source delivery. Feature commit e8946577 integrates main 6a0c24d5 and advances the coordinated version to 2.3.39. Integration make ci and 141 browser checks pass; the review records the initial unconfirmed terminald socket-test failure and successful default rerun separately. Device evidence remains tied to the earlier test build.
