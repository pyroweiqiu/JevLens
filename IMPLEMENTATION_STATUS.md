# Jev Web Lens — implementation status

Implemented from `jev_web_lens_implementation_plan.md` on 2026-09-27. Scope: its Hackathon MVP and regression tooling; the explicitly post-MVP product layers are not included.

| Milestone                   | Delivered                                                                                                                                                                                       |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Extension shell          | WXT MV3, React native side panel, service worker, content script, typed commands, toolbar/shortcuts, current tab                                                                                |
| 2. HTML extraction          | Semantic blocks, heading paths, hidden/form/draft exclusions, stable content IDs                                                                                                                |
| 3. Segmentation and mapping | Locale-aware Intl.Segmenter, paragraph mode, exact per-text-node ranges, inline-code retention                                                                                                  |
| 4. Jev adapter              | Live HTTP Score/Choice contract, Zod validation, explicit Demo provider, cancellable batches, official/OpenRouter/custom connections with independent user keys, optional server-side key proxy |
| 5. Highlight scoring        | Viewport-prioritized batches, density selection, score/confidence separation, CSS highlights and overlay fallback                                                                               |
| 6. Synchronization          | Hover, exact-range scrolling, selected layer, viewport observation and restrained sidebar following                                                                                             |
| 7. Navigator                | Sticky intent, relevance ranking, first-match jump, previous/next, Escape, cached general scores                                                                                                |
| 8. PDF                      | Bundled PDF.js/worker, text-layer paragraph reconstruction, shared scoring and ranges, lazy canvas painting, progressive extraction, local/URL entry and MIME registration                      |
| 9. Cursor                   | Visible candidates, semantic labels, Choice proposal, halo, explicit approved single click, skip/stop, risk and stale-target checks                                                             |
| 10. Regression              | 120-case generated matrix, deterministic fixtures, unit/integration tests, actual MV3 Chromium E2E, external-page screenshot/report harness                                                     |

## Verification evidence

- `npm run check`: formatting check, TypeScript, **30 unit/integration tests**, production MV3 build passed.
- `npm run test:e2e`: **4 Chromium tests** passed, covering actual content-script extraction/highlighting/Cursor, side-panel Navigator and precision controls, PDF extraction/highlight/selection, and API settings persistence/provider isolation/connection probes.
- PDF styling received a subsequent focused E2E and screenshot review after aligning PDF.js text-layer scale and compositing highlights over canvas glyphs.
- Dependency installation audit after upgrading PDF.js, WXT and Vitest: **0 reported vulnerabilities**.
- Seven public-page fixtures were exercised: arXiv Attention Is All You Need PDF, TypeSafe Jev blog, MDN JavaScript guide, Rust Book ownership overview, Browser-Use GitHub repository, MDN CSS Custom Highlight API, React Learn.
- All seven returned readable units and accepted page highlights. This measures extraction/rendering with local heuristic scores, **not AI relevance quality**. Raw counts, timing and errors are in `qa-results/report.json`.
- The full 120-case matrix is generated, **not fully executed or certified**. Authentication/paywall/private-app cases remain manual.

## Still requires external validation

- An OpenRouter key was supplied on 2026-09-27. Both the Decisions endpoint and the independent key-authentication endpoint returned HTTP 401. Live scoring/ranking quality, latency and cost remain unverified pending valid credentials. Contract tests use explicit mocked responses. `npm run qa:live` reads credentials in-process, uses a disposable browser profile, and writes a redacted report to `qa-results/live-openrouter/report.json`.
- Chrome's native toolbar/side-panel chrome and OS keyboard shortcut conflicts need interactive checking in the user's normal browser. E2E drives the actual side-panel document in an extension tab.
- Modern Chrome MIME stream interception is implemented from the documented API, but automated PDF tests use the explicit viewer path. MIME streams and embedded PDFs need a compatible Chrome 151+ session.
- Complex PDF reading order, inaccessible frames/Shadow DOM, canvas apps, and very large documents retain the limitations documented in README.
- No Web Store publication, backend deployment, OCR, automatic form filling, autonomous click loop, multi-tab research, or personalization was performed.

## Ready to run

Load `output/chrome-mv3` at `chrome://extensions`. Start `npm run demo` for the deterministic article, or visit a normal document page. See `README.md` for setup, privacy, real Jev connection, and commands.

## API settings update

The button immediately above the intent input opens a modal with Jev Official, OpenRouter Decisions, Custom, and local Demo choices. Each remote provider has an independent endpoint/model/key profile. Save commits atomically; Cancel leaves the active connection unchanged. Connection testing sends fixed synthetic Score and Choice samples. Legacy proxy settings migrate to Custom. Protocol tests and the Chromium settings flow use mocked responses. The subsequent live OpenRouter attempt was blocked by HTTP 401 authentication rejection; no successful real inference was observed.

## Find / Act usability update

Find now visibly activates before a query is submitted and offers page-heading examples, keyword/semantic-mode guidance and actionable empty states. Act offers actual safe page-control examples, searches up to 200 non-hidden controls in the loaded DOM, and scrolls an offscreen proposal into view before asking for approval. Risk checks and stale-target verification still run before clicks.

The owned PDF viewer accepts explicit English/Chinese page commands (for example `go to page 10` and `跳到第10页`) and navigates only after approval, without a model request. Invalid/unloaded pages get a range/loading explanation. Chrome's native PDF toolbar is not controlled; use Open PDF to enter Jev PDF Viewer. This does not add autonomous navigation, menu expansion or form filling.

Validation for this update: formatting and TypeScript checks, 32 unit/integration tests, production build, and 6 Chromium E2E tests passed. Added coverage includes Find mode activation, offscreen target preview before approval, English/Chinese PDF page-10 navigation, invalid pages and stale PDF targets. Remote inference quality remains unverified; these tests use Demo or mocked provider responses.

## PDF section navigation

PDF Act now resolves section titles from embedded bookmarks and named destinations, including appendix aliases where the title itself omits “Appendix”. It falls back to matching short text-layer lines for PDFs without matching bookmarks. Supports `go to Appendix`, `跳到附录`, `go to Appendix B`, and exact chapter titles, with approval before navigation and no model request.

Verified with the actual 48-page arXiv 2609.13356 PDF: English/Chinese Appendix commands and the exact `Pre-Training Details` title all navigate to page 30. The optional source-paper E2E is enabled with `JEV_PDF_QA_PATH`; a generated PDF covers no-bookmark fallback. Formatting, type checking, 34 unit tests, build, and all 7 E2E tests passed with that source fixture. Screenshots are in `test-results/source-paper-appendix*.png`. No API credentials were read or used in this update.

## HTML outline navigation

Act now indexes up to 300 loaded HTML headings (including ARIA headings) and same-document TOC anchor labels. Targets can be headings without IDs, encoded/legacy anchors, or non-heading sections such as tables. The panel exposes the page outline; exact titles, normalized numbering, and common Chinese/English section aliases resolve locally without API calls. Repeated titles retain distinct destinations and can be selected by numbered examples or Skip. Approval scrolls to the section without clicking TOC links or changing the URL; hidden, edited, or disconnected targets are rejected.

This supports readable, loaded HTML structures, not arbitrary cross-page menus, collapsed/unloaded content, canvas or cross-origin frames. Existing button/link actions and PDF page/section navigation remain available. Coverage includes a structured HTML fixture, aliases and numbered headings, TOC-only targets, duplicate names, privacy exclusions, stale/hidden targets, and the original source-paper PDF regression.
