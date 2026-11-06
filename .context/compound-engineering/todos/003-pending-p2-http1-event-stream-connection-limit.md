---
status: pending
priority: p2
issue_id: "003"
tags: [frontend, reliability, sse, bluetooth, networking]
dependencies: []
---
# HTTP/1.1 event streams can block initial Bluetooth data

## Problem Statement
The shipped Nginx HTTP entrypoint uses HTTP/1.1. Long-lived same-origin EventSource connections can occupy the browser connection pool, leaving Bluetooth settings and transfers queued. Review separately from the completed design migration; preserve event, reconnect and background lifecycles.

## Findings
- Previous delivery recorded the Web/TV same-origin limit in `.cyberos/cyberui-delivery/ACCEPTANCE.md`.
- This review reproduced four persistent Web streams (audio history, music, playback, session), followed by Bluetooth status/transfers streams. Initial settings/transfer fetch requests remained pending while their API handlers answered 200 separately.
- `.cyberos/component-review/bluetooth-live-diagnostic.json` records pending requests over 20 seconds; direct settings API returned 200 in about 0.17 seconds.
- A temporary local HTTP/2 proxy to the same device allowed both languages and five widths to finish with actual loaded settings. No production HTTP configuration changed.

## Proposed Solutions
Evaluate multiplexing related subscriptions or coordinating subscriptions with initial fetches; separately evaluate HTTP/2 deployment support. Choose based on browser evidence and deployment constraints. Do not bypass origin checks or discard required updates to reduce stream count.

## Recommended Action
Pending prioritization. Reproduce on the normal device HTTP/1.1 entrypoint and choose a scoped transport fix. Outside the completed component/design change.

## Acceptance Criteria
- [ ] Bluetooth initial settings/transfers finish on HTTP/1.1 with all required Web subscriptions active
- [ ] Updates, reconnect, background/foreground and navigation cleanup remain correct
- [ ] Web and TV co-running behavior checked explicitly
- [ ] Origin restrictions and API contracts preserved
- [ ] Device/browser evidence distinguishes HTTP/1.1 and HTTP/2 paths

## Work Log
- 2026-11-07: Recorded device/browser evidence during whole-frontend review. Loaded visual states verified through temporary HTTP/2; production transport/subscriptions preserved.
