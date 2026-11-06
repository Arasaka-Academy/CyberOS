# CyberOS tracker transport patch

Source: `librqbit-tracker-comms` 9.0.1 from <https://github.com/ikatson/rqbit>.
Upstream code is Apache-2.0 licensed. The source files and UDP test resource are
retained locally because librqbit 9.0.1 exposes no custom HTTP client or DNS
resolver in `SessionOptions`.

The downloader enables `public-network-only`. With this feature, HTTP tracker
connections use validated DNS answers, reject private literals and redirect
targets, disable environment proxies and HTTPS downgrades, and enforce connection
and request timeouts. UDP announcements validate the actual resolved addresses
on every lookup. Upstream defaults remain available without this feature.

HTTP tracker responses have a 2 MiB limit, enforced while streaming even if the
server omits Content-Length. This bounds memory before parsing tracker data.

Local regression tests use real TCP listeners for unsafe and valid redirects,
HTTP resolver checks, and UDP resolver checks. The default ignored upstream UDP
test requires an external tracker and remains ignored.

When upgrading rqbit, prefer an upstream transport injection API and remove this
patch after verifying the same connection-level guarantees.
