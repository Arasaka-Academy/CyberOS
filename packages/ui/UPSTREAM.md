# CyberUI source provenance

Upstream: https://github.com/Arasaka-Academy/CyberUI
Version: v0.2.2
Commit: 014c3b88ce25a874b12986ccc8f2499eb8dbad43

Registry items: button, icon-button, input, textarea, badge, tag, panel, card, progress, skeleton, spinner, empty-state, divider, toolbar, select.

Sources were copied from the pinned Registry. Relative TypeScript imports use .js for this repository's NodeNext resolution. Pure palette functions live in @cyberos/shared/cyberui-tokens so the API, static documentation and native-player generator can share them without importing React or CSS. Local adapters preserve CyberOS native events and navigation contracts. Component CSS remains under the upstream components layer. The scoped baseline in styles.css uses the base layer so it cannot override CyberOS responsive field sizes or native control fonts. Application customizations belong outside vendor/.

Retain src/vendor/LICENSE, UPSTREAM-LICENSE, UPSTREAM-NOTICE.md and font OFL notices. Review upstream differences before updating; never overwrite adapted code automatically.
