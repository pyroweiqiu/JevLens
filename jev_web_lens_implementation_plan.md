# Jev Web Lens — Browser Extension Implementation Plan

> **Goal:** Build a Chrome/Chromium browser extension that adds an AI attention and action layer over the web using Jev.
>
> **Product progression:** **SEE → FIND → ACT**
>
> - **SEE / Highlight:** automatically highlight what matters on the current page.
> - **FIND / Navigator:** user types an intent; re-rank and navigate to the most relevant content.
> - **ACT / Cursor:** user gives a goal; Jev recommends the next browser action and, with explicit permission, can execute it.
>
> **Hackathon constraint:** ~10 hours. The MVP must prioritize polish and demo reliability over universal coverage.
>
> **Primary target:** Chrome/Chromium Manifest V3. Keep architecture portable to Edge/Firefox later.
>
> **Document date:** 2026-09-27

---

## 0. Executive summary

Build a persistent browser side panel called **Jev Web Lens**. It continuously inspects the visible document, extracts meaningful text blocks, segments them into **sentences by default** or **paragraphs in low-cost mode**, and sends compact batches to Jev for importance scoring.

The extension then renders a **Highlight Map** in the side panel and highlights the corresponding text on the page. The page and side panel stay synchronized in both directions:

- hover a Highlight card → corresponding page text glows;
- click a Highlight card → smooth-scroll to the exact text;
- scroll the page → the active Highlight card updates automatically.

At the bottom of the panel, the user can type an **Intent** such as:

> “I want to understand how RLCD is trained.”

The same extracted units are re-scored for intent relevance. The extension jumps to the best match and lets the user move through the next relevant matches. This is **Navigator**.

An advanced shortcut activates **Cursor**. Cursor changes the candidate set from text units to actionable page elements such as links, buttons, inputs, tabs, menus, and controls. Jev ranks/selects the next action given the page, user goal, and recent interaction history. The action is highlighted first; execution is human-approved by default.

The key architectural principle is that these are not three unrelated features. They share one pipeline:

```text
Current browser state
  = page + intent + history + viewport
                │
                ▼
        Candidate extraction
          text / actions
                │
                ▼
               Jev
                │
         probability/score
                │
     ┌──────────┼──────────┐
     ▼          ▼          ▼
 Highlight   Navigator    Cursor
    SEE         FIND        ACT
```

Jev is a good fit because it is designed for **typed probabilistic decisions**, rather than arbitrary text generation. Its `Score`, `Choice`, and `Noul` primitives can return scores, probability distributions, and confidence values directly to application code.

---

# 1. Product definition

## 1.1 One-sentence product statement

**Jev Web Lens adds an intelligent attention layer over every webpage: it shows what matters, finds what you need, and guides what to do next.**

## 1.2 Non-goals for the hackathon

Do **not** try to build all of the following in 10 hours:

- a fully autonomous general web agent;
- perfect support for every canvas-based web app;
- OCR for scanned PDFs;
- a general-purpose chat assistant;
- automatic summaries for every Highlight;
- account sync, billing, or collaboration;
- broad cross-browser support;
- production-grade agent safety for purchases/authentication/deletion.

The MVP should feel excellent on a carefully selected set of representative pages.

## 1.3 Core modes

### Mode A — Highlight / SEE

Default state after the panel opens.

Input:

```text
page content
```

Conceptual model:

```text
P(importance | page, section, unit)
```

Output:

- important sentence/paragraph ranges;
- importance score;
- confidence;
- topic/section association.

### Mode B — Navigator / FIND

Activated by typing in the bottom Intent box.

Input:

```text
page + user intent
```

Conceptual model:

```text
P(relevance | page, intent, unit)
```

Output:

- ranked relevant sentences/paragraphs;
- top result auto-selected;
- next/previous match navigation.

### Mode C — Cursor / ACT

Activated by a dedicated command / shortcut.

Input:

```text
page + goal + recent action history + actionable candidates
```

Conceptual model:

```text
P(next_action | page, goal, history)
```

Output:

- next recommended element/action;
- probability/confidence;
- visible page overlay;
- optional execute action after approval.

---

# 2. UX specification

## 2.1 Side panel layout

Use Chrome's native Side Panel API, not an injected fixed-position sidebar. This avoids breaking page layout and gives the extension a persistent browser-native surface.

Conceptual layout:

```text
┌─────────────────────────────────────┐
│ JEV LENS                        ●   │
│ Current lens: General understanding │
│                                     │
│ [Sentence] [Paragraph]      Density │
│                                     │
│ HIGHLIGHTS                          │
│                                     │
│ 01  Model architecture        96%   │
│     Critical                        │
│     “Jev evaluates typed…”          │
│                                     │
│ 02  Training                  88%   │
│     High                            │
│     “The model is trained…”         │
│                                     │
│ 03  Results                   74%   │
│     Medium                          │
│     “On the benchmark…”             │
│                                     │
│ ...                                 │
│                                     │
├─────────────────────────────────────┤
│ What are you looking for?      [↵]  │
│ Ask, find, or state your intent     │
│                                     │
│ Cursor: ⌘⇧J / Alt+Shift+J           │
└─────────────────────────────────────┘
```

## 2.2 Side placement

The extension should respect the browser/user side-panel preference. Chrome exposes the current side (`left` or `right`) but the extension should not pretend it controls the user's global side placement.

## 2.3 Open/close commands

The product requirement is “easy open / easy close”, but avoid browser-reserved shortcuts such as `Cmd+N` and `Cmd+O`.

Recommended command names:

```text
toggle-lens
focus-intent
activate-cursor
stop-cursor
```

Suggested defaults to test for conflicts:

| Command | macOS suggestion | Windows/Linux suggestion |
|---|---|---|
| Toggle Lens | `Command+Shift+L` | `Alt+Shift+L` |
| Focus Intent | `Command+Shift+F` | `Alt+Shift+F` |
| Activate Cursor | `Command+Shift+J` | `Alt+Shift+J` |
| Stop Cursor | `Esc` while panel/overlay active | same |

All commands should be remappable through Chrome's extension-shortcut settings.

## 2.4 Highlight card anatomy

Each card should contain:

```ts
interface HighlightCard {
  id: string;
  topic: string;          // preferably derived from DOM heading hierarchy
  excerpt: string;
  importance: number;     // normalized 0..1 for UI
  confidence: number;     // 0..1 when available
  level: 'critical' | 'high' | 'medium' | 'low';
  unitIds: string[];
  locator: PageLocator;
}
```

Avoid generating long summaries in the MVP. The card's text should be the original sentence or a short original excerpt. This makes the product trustworthy and cheaper.

## 2.5 Topic naming

**Important:** Jev is not an arbitrary string generator. Do not ask it to invent free-form topic names.

Use the following deterministic priority:

1. nearest preceding `h1`–`h6` heading;
2. section `aria-label` / accessible name;
3. table caption / figure caption / list title;
4. document outline / PDF heading when available;
5. otherwise a short clipped original excerpt such as the first 5–10 meaningful words.

A separate generative model can be added later for naming, but it is not needed for the hackathon.

## 2.6 Bidirectional synchronization

### Side panel → page

- hover card → temporary stronger highlight;
- click card → `scrollIntoView({behavior: 'smooth', block: 'center'})`;
- selected card → persistent outline/glow on page;
- `Enter` on focused card behaves like click for accessibility.

### Page → side panel

Use `IntersectionObserver` on block anchors:

- track which highlighted block is closest to viewport center;
- send `ACTIVE_BLOCK_CHANGED` to side panel;
- make corresponding card active;
- do not auto-scroll side-panel list aggressively if the user is manually scrolling it; debounce/soft-follow.

---

# 3. Sentence mode vs paragraph mode

## 3.1 Default: sentence-level highlighting

Sentence mode is the premium/precise experience.

Advantages:

- visually precise;
- avoids painting entire paragraphs for one important claim;
- ideal for papers, news, blogs, documentation;
- makes Navigator matches feel exact.

Segmentation:

```ts
const segmenter = new Intl.Segmenter(locale, {
  granularity: 'sentence'
});
```

For every logical block, retain exact text-node offsets so the sentence can be mapped back to one or more DOM `Range`s.

## 3.2 Paragraph mode: lower cost

Paragraph mode treats each logical block (`p`, `li`, table cell group, etc.) as one inference unit.

Advantages:

- fewer Jev questions;
- fewer returned answers;
- less range bookkeeping;
- faster on very long pages;
- good enough for browsing/scanning.

The UI toggle should be visible near the top:

```text
Precision
● Sentence
○ Paragraph (faster / lower cost)
```

Do not claim an exact percentage cost saving until measured against real `usage.input_tokens/output_tokens`. Instrument usage from day one.

## 3.3 Optional later mode: section-level pre-filter

For very large documents:

```text
sections → rank sections → analyze only top sections → sentence scoring
```

This creates a hierarchical pipeline and can reduce total work dramatically.

---

# 4. Recommended technical stack

## 4.1 Extension framework

Recommended:

```text
WXT
React
TypeScript
Manifest V3
Tailwind CSS or CSS Modules
Zustand (optional) for UI state
Zod for runtime schemas
Vitest
Playwright for browser E2E
```

Why WXT:

- modern extension-focused build system;
- good TypeScript ergonomics;
- browser API wrappers;
- multi-browser path later;
- fast HMR/dev loop, useful in a hackathon.

A plain Vite + MV3 project is also viable, but WXT reduces boilerplate.

## 4.2 Repository layout

```text
jev-web-lens/
├── entrypoints/
│   ├── background.ts
│   ├── content.ts
│   ├── sidepanel/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx
│   │   └── components/
│   └── pdf-viewer/
│       ├── index.html
│       ├── main.ts
│       └── viewer/
├── src/
│   ├── extraction/
│   │   ├── htmlExtractor.ts
│   │   ├── sentenceSegmenter.ts
│   │   ├── blockClassifier.ts
│   │   ├── headingTree.ts
│   │   ├── locator.ts
│   │   └── pdfExtractor.ts
│   ├── highlight/
│   │   ├── cssHighlightRenderer.ts
│   │   ├── markFallbackRenderer.ts
│   │   └── overlayRenderer.ts
│   ├── jev/
│   │   ├── client.ts
│   │   ├── prompts.ts
│   │   ├── batcher.ts
│   │   ├── highlightScorer.ts
│   │   ├── navigatorScorer.ts
│   │   └── cursorRanker.ts
│   ├── cursor/
│   │   ├── actionExtractor.ts
│   │   ├── actionExecutor.ts
│   │   └── safetyGate.ts
│   ├── cache/
│   │   ├── indexedDb.ts
│   │   └── contentHash.ts
│   ├── messaging/
│   │   ├── protocol.ts
│   │   └── transport.ts
│   ├── shared/
│   │   ├── schemas.ts
│   │   ├── types.ts
│   │   └── constants.ts
│   └── analytics/
│       └── telemetry.ts
├── tests/
│   ├── unit/
│   ├── fixtures/
│   └── e2e/
├── wxt.config.ts
├── package.json
└── README.md
```

---

# 5. Browser architecture

## 5.1 Components

```text
┌──────────────────────── Chrome ────────────────────────┐
│                                                       │
│  Web page                                              │
│  ┌─────────────────────────────────────────────────┐  │
│  │ content script                                  │  │
│  │ - DOM extraction                                │  │
│  │ - sentence/paragraph segmentation               │  │
│  │ - CSS highlights                                │  │
│  │ - action candidate extraction                   │  │
│  │ - viewport observation                          │  │
│  └──────────────────────┬──────────────────────────┘  │
│                         │ runtime messaging            │
│                         ▼                              │
│  ┌─────────────────────────────────────────────────┐  │
│  │ background/service worker                       │  │
│  │ - lifecycle                                     │  │
│  │ - commands                                      │  │
│  │ - side panel open/close                         │  │
│  │ - API request coordination                      │  │
│  │ - cache coordination                            │  │
│  └───────────────┬────────────────┬────────────────┘  │
│                  │                │                   │
│            ┌─────▼─────┐    ┌────▼────────────────┐  │
│            │ SidePanel │    │ PDF.js viewer       │  │
│            │ React UI  │    │ + text layer        │  │
│            └───────────┘    └─────────────────────┘  │
└───────────────────────┬──────────────────────────────┘
                        │ HTTPS
                        ▼
               ┌─────────────────┐
               │ Backend proxy   │
               │ Jev API key     │
               │ rate limiting   │
               └────────┬────────┘
                        ▼
                  TypeSafe / Jev
```

## 5.2 API key policy

### Hackathon

Fastest option:

- local development key in `.env.local`;
- never commit it;
- load unpacked extension only.

### Public Chrome Web Store build

Do **not** ship a Jev secret in extension JavaScript.

Use a tiny backend proxy:

```text
extension → your backend → TypeSafe/Jev
```

Backend responsibilities:

- hold TypeSafe key;
- authenticate anonymous/device/user session;
- rate-limit;
- enforce max state/question sizes;
- basic abuse prevention;
- log usage metrics without storing private page text by default.

---

# 6. HTML content extraction

## 6.1 Do not rely only on article extraction

Libraries such as Readability are useful for news/blogs, but docs, GitHub, pricing pages, search pages, and product pages are not always “articles”. Use a general DOM block extractor first.

## 6.2 Candidate block selectors

Start from visible elements matching:

```css
h1, h2, h3, h4, h5, h6,
p,
li,
blockquote,
figcaption,
caption,
td,
th,
pre,
code,
dd,
dt
```

Then merge/split intelligently.

## 6.3 Exclusion rules

Ignore descendants of likely chrome/noise elements:

```text
nav
header (except article-local headers when clearly content)
footer
aside (unless main article aside is meaningful)
script
style
noscript
svg text unless explicitly supported
input
textarea
select
option
[contenteditable="true"] by default
hidden/display:none/visibility:hidden
aria-hidden=true
cookie banners
ads/sponsored containers where recognizable
```

Privacy default: **never extract typed form values or drafts for Highlight mode**.

## 6.4 Block record

```ts
interface BlockRecord {
  blockId: string;
  tag: string;
  role?: string;
  text: string;
  headingPath: string[];
  nearestHeading?: string;
  domPath: string;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  textNodes: TextNodeSlice[];
  inViewport: boolean;
  language?: string;
  contentHash: string;
}

interface TextNodeSlice {
  nodeKey: string;
  startInBlock: number;
  endInBlock: number;
}
```

## 6.5 Sentence units

```ts
interface TextUnit {
  unitId: string;        // e.g. S001
  blockId: string;
  text: string;
  startInBlock: number;
  endInBlock: number;
  headingPath: string[];
  locator: PageLocator;
}
```

A sentence may span multiple inline DOM text nodes. Store the logical block offsets, then resolve those offsets back to concrete DOM `Range`s at render time.

## 6.6 Paragraph units

For paragraph mode, one meaningful block ≈ one unit.

Do not combine unrelated `li` items or table rows blindly.

---

# 7. Rendering highlights without breaking pages

## 7.1 Preferred renderer: CSS Custom Highlight API

Use document `Range`s + `Highlight` + `CSS.highlights`.

Advantages:

- no wrapping/reparenting page DOM;
- lower risk of breaking React/Vue hydration;
- easy to clear/re-register;
- supports exact sentence ranges.

Recommended named highlight layers:

```text
jev-important-critical
jev-important-high
jev-important-medium
jev-hover
jev-selected
jev-navigator
jev-cursor-target
```

Use subtle styling. The product should feel like an augmented page, not a highlighter pen explosion.

## 7.2 Fallback renderer

If `CSS.highlights` is unavailable or a page behaves badly:

- avoid invasive `<mark>` wrapping unless necessary;
- alternative: absolute overlay rectangles from `Range.getClientRects()`;
- mark fallback should be behind a feature flag.

## 7.3 Dynamic layout

Recompute overlay/range geometry on:

- resize;
- zoom-related layout change;
- font/content mutation;
- route/navigation changes.

Do not poll every frame.

---

# 8. Dynamic sites and SPAs

## 8.1 MutationObserver

Observe the document, but debounce aggressively.

Pseudo-flow:

```text
DOM mutation
   ↓
collect changed roots
   ↓ 150–300 ms debounce
re-extract only affected subtrees
   ↓
content-hash compare
   ↓
score only new/changed units
```

## 8.2 Route changes

Detect:

- `history.pushState` / `replaceState`;
- `popstate`;
- title changes;
- root-content hash changes.

Treat a major route/page transition as a new document context.

## 8.3 Infinite feeds

Do not attempt to score an infinite page all at once.

Use:

```text
viewport + N screens ahead + N screens behind
```

Default suggestion:

- current viewport first;
- ~2 screens above and below;
- score newly encountered blocks as the user scrolls.

---

# 9. Progressive analysis strategy

A good UX should show something useful in <1–2 seconds even on a large page.

## Phase 1 — immediate

1. extract visible viewport and nearby blocks;
2. render skeleton cards;
3. score nearby units;
4. paint first highlights.

## Phase 2 — background completion

1. extract the rest of the document;
2. score batches by section;
3. update Highlight Map incrementally.

## Phase 3 — idle optimization

- cache results;
- optional re-score ambiguous/low-confidence units;
- precompute action candidates for Cursor.

---

# 10. Jev integration

Official API shape:

```http
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer <API_KEY>
Content-Type: application/json
```

Top-level request:

```json
{
  "state": "...",
  "model": "jev-latest",
  "questions": {}
}
```

Jev supports `Choice`, `Score`, and `Noul`. Questions in the same request are evaluated against the same state and can be answered in parallel.

## 10.1 Highlight scoring

### Batch state format

Use explicit unit IDs inside state:

```text
PAGE TITLE: Introducing System One Models & Jev
URL: https://typesafe.ai/...
PAGE TYPE: article

SECTION: Introduction
[S01] Models have been superhuman at chat for years...
[S02] This has been my driving question...
[S03] ...

SECTION: Frontiers, Old and New
[S04] ...
```

### One Score per unit

Example question:

```json
{
  "importance_S01": {
    "type": "score",
    "instructions": "How important is sentence S01 for understanding the main information, argument, instruction, result, or decision-relevant content of this page?",
    "criteria": [
      "Navigation, boilerplate, repetition, decoration, or low-value detail that can be skipped",
      "Supporting context or secondary detail; useful but safe to skip on a first read",
      "Substantive information that materially helps understand the page",
      "Core claim, instruction, result, warning, conclusion, or decision-critical information"
    ]
  }
}
```

Normalize for UI:

```ts
normalizedImportance = score / 3;
```

Keep `confidence` separately.

### Batching starting point

Tune empirically, but begin with:

```text
Sentence mode:   ~16–24 units per request
Paragraph mode:  ~8–12 units per request
```

This is not a protocol limit; it is an engineering starting point balancing state size, latency, output size, and cost.

### Thresholding

Do not use only a single raw fixed threshold across every page type.

Recommended:

```text
1. compute normalized importance
2. discard obvious low scores
3. rank within page/section
4. highlight roughly top 15–25% of useful units
5. cap contiguous highlight density
```

A simple MVP rule:

```ts
const selected = units
  .filter(u => u.importance >= 0.55)
  .sort(descending)
  .slice(0, Math.ceil(units.length * density));
```

with user-configurable density, e.g. 10% / 20% / 35%.

## 10.2 Deterministic pre-filter to save cost

Before Jev, drop obvious noise:

- tiny fragments (`< 20` meaningful chars, unless heading);
- repeated nav labels;
- timestamps alone;
- share-button text;
- cookie/privacy menus;
- duplicated mobile/desktop nav;
- empty/stylistic elements.

Do not over-filter. Better to send a little noise than to remove substantive content.

---

# 11. Navigator implementation

## 11.1 Intent input

Sticky at bottom of side panel.

Examples:

```text
How was this model trained?
What GPU resources did they use?
Find the installation instructions.
I want to reproduce this experiment.
What are the main limitations?
Where is the refund policy?
Which plan supports SSO?
```

## 11.2 Relevance score

State contains page units plus intent:

```text
USER INTENT: I want to reproduce this experiment.

[S01] ...
[S02] ...
...
```

Per-unit Score:

```json
{
  "relevance_S01": {
    "type": "score",
    "instructions": "How relevant is S01 to satisfying the user's stated intent?",
    "criteria": [
      "Unrelated",
      "Only tangentially related",
      "Useful for the intent",
      "Directly answers or is necessary to fulfill the intent"
    ]
  }
}
```

## 11.3 Navigator UX

After response:

```text
Lens: “I want to reproduce this experiment”

1 / 6 matches

01 Experimental setup       97%
02 Training configuration   91%
03 Appendix                 74%
```

Behavior:

- auto-scroll to result 1;
- apply stronger navigator color to matches;
- Up/Down or explicit arrow buttons move through matches;
- `Esc` clears intent and restores general Highlight view;
- keep original general importance available in cached state.

## 11.4 Long-page optimization

For large pages, Navigator can first rank blocks/sections, then sentence-score only the top few sections.

```text
Intent
  ↓
section-level relevance
  ↓
top K sections
  ↓
sentence-level relevance
```

This should be the post-hackathon optimization path.

---

# 12. Cursor implementation

Cursor is the advanced layer. In the hackathon, implement one polished constrained flow, not universal autonomy.

## 12.1 Action candidate extraction

Collect visible, enabled actionable elements:

```text
a[href]
button
input:not([type=hidden])
textarea
select
[role=button]
[role=link]
[role=tab]
[role=menuitem]
[contenteditable=true] only when explicitly needed
```

Candidate record:

```ts
interface ActionCandidate {
  id: string;                 // A01
  role: string;
  accessibleName: string;
  text?: string;
  href?: string;
  inputType?: string;
  valuePresent?: boolean;     // do not include sensitive value by default
  nearestHeading?: string;
  disabled: boolean;
  visible: boolean;
  rect: DOMRectLike;
  locator: PageLocator;
  riskHints: string[];
}
```

Use accessible names rather than raw CSS structure wherever possible.

## 12.2 Candidate choice

For moderate candidate count:

```text
GOAL: Install this project locally.
HISTORY:
- User opened repository README.

A01 button: Code
A02 link: Issues
A03 link: Releases
A04 link: Installation
...
```

Jev Choice:

```json
{
  "next_action": {
    "type": "choice",
    "instructions": "Which visible element is the best next action toward the user's goal?",
    "criteria": {
      "A01": "Button 'Code' in repository header",
      "A02": "Link 'Issues'",
      "A03": "Link 'Releases'",
      "A04": "Link 'Installation' in README",
      "none": "None of the listed elements is a good next action"
    }
  }
}
```

Jev Choice supports a large option set, but do not blindly send hundreds of low-quality DOM candidates. Candidate quality is more important than theoretical cardinality.

## 12.3 Two-stage ranking when many candidates exist

```text
all actionable candidates
        ↓
cheap deterministic filters
        ↓
Noul/Score relevance or section filtering
        ↓
top K (e.g. 20–40)
        ↓
Choice
```

## 12.4 Cursor UI

Before execution:

```text
AGENT ACTIVE
Goal: Install this project locally

Next action
Code button                    91%

[Execute]     [Skip]     [Stop]
```

The target page element gets a visible halo/outline.

## 12.5 Safety defaults

Cursor should never auto-execute the following in MVP:

- payment/checkout/financial transactions;
- password or credential submission;
- OAuth authorization;
- deletion/destructive actions;
- publishing/posting externally;
- sending email/messages;
- installing unknown executables;
- changing account/security settings.

For risky actions:

```text
recommend → highlight → explain action type → require explicit user click
```

A later system can add a separate risk `Score`/`Noul` before execution.

---

# 13. PDF support

PDF support must be treated as a first-class architecture path, not a hack around the built-in Chrome PDF viewer.

## 13.1 Why a custom viewer is needed

Browser built-in PDF viewers are privileged/internal contexts. A normal content script should not be assumed to inject into and control the built-in viewer like a normal webpage.

Therefore use an extension-owned viewer based on **PDF.js**.

## 13.2 Preferred path on modern Chrome

Chrome's MIME handler API (available in current modern Chrome) can register the extension to handle `application/pdf` streams.

Conceptually:

```json
{
  "mime_types_handler": {
    "application/pdf": {
      "handler_url": "pdf-viewer/index.html",
      "can_embed": true
    }
  }
}
```

Benefits:

- keep original PDF URL;
- handle already-received response stream;
- support top-level and embedded PDFs;
- avoids a second network fetch in the modern path.

## 13.3 Compatibility fallback

For older Chromium versions where MIME handling is unavailable:

1. expose **Open in Jev PDF Viewer** in toolbar/context menu;
2. pass the original URL to the extension viewer;
3. PDF.js loads/renders it subject to permissions/CORS strategy;
4. optionally use narrow URL redirect rules for direct PDF URLs only after testing.

Do not build the entire hackathon around complex PDF network interception.

## 13.4 PDF.js integration

Bundle PDF.js locally with the extension. Do not load remote executable JavaScript due extension CSP / Web Store policy concerns.

Viewer structure:

```text
PDF stream/url
   ↓
PDF.js
   ├── canvas layer
   └── text layer
          ↓
    page text spans
          ↓
 sentence/paragraph segmenter
          ↓
         Jev
          ↓
 text-layer highlight overlays
```

## 13.5 PDF text extraction

For each PDF page:

```ts
interface PdfPageRecord {
  pageNumber: number;
  text: string;
  spans: PdfTextSpan[];
  headings?: PdfHeadingGuess[];
}
```

Reconstruct logical lines/paragraphs using PDF text item position, font size, spacing, and line breaks.

For hackathon simplicity:

- prefer PDF.js text layer order;
- join nearby spans conservatively;
- sentence-segment reconstructed text;
- map sentence offsets back to text-layer spans.

Do **not** implement OCR for image-only PDFs in the first 10 hours.

## 13.6 Progressive PDF analysis

For a 30-page paper:

```text
current page
±1 adjacent page
abstract/introduction/conclusion if outline detectable
then remaining pages progressively
```

For arXiv papers specifically, prioritize:

- abstract;
- introduction;
- method;
- results/experiments;
- limitations/conclusion;
- captions where substantive.

## 13.7 PDF Navigator

Intent search should work exactly like HTML Navigator:

```text
intent → rank PDF units → jump to page → scroll exact text → highlight
```

Side-panel cards should show page number:

```text
Training setup — p. 7 — 94%
```

---

# 14. Page locator design

Do not use raw CSS selectors alone; SPA rerenders often invalidate them.

Use a resilient locator union:

```ts
type PageLocator =
  | {
      kind: 'html-text';
      blockHash: string;
      headingPath: string[];
      textPrefix: string;
      startOffset: number;
      endOffset: number;
    }
  | {
      kind: 'html-action';
      role?: string;
      accessibleName?: string;
      href?: string;
      domPath?: string;
    }
  | {
      kind: 'pdf-text';
      page: number;
      textPrefix: string;
      startOffset: number;
      endOffset: number;
    };
```

Resolution order should combine semantic and structural signals, then verify the recovered text before acting.

---

# 15. State and messaging protocol

## 15.1 Document state

```ts
interface LensDocumentState {
  tabId: number;
  url: string;
  title: string;
  documentId: string;
  pageType: PageType;
  mode: 'highlight' | 'navigator' | 'cursor';
  granularity: 'sentence' | 'paragraph';
  intent?: string;
  blocks: BlockRecord[];
  units: TextUnit[];
  scoredUnits: ScoredUnit[];
  activeUnitId?: string;
  analysisStatus: 'idle' | 'extracting' | 'scoring' | 'ready' | 'error';
}
```

## 15.2 Message types

```text
PAGE_READY
DOCUMENT_EXTRACTED
UNITS_CHANGED
ANALYSIS_REQUEST
ANALYSIS_RESULT
HIGHLIGHT_APPLY
HIGHLIGHT_CLEAR
SIDEBAR_HOVER_UNIT
SIDEBAR_SELECT_UNIT
ACTIVE_BLOCK_CHANGED
INTENT_SET
INTENT_CLEAR
CURSOR_START
CURSOR_CANDIDATES
CURSOR_SUGGESTION
CURSOR_EXECUTE
CURSOR_STOP
ERROR
```

Use Zod schemas at the message boundary.

---

# 16. Caching and cost control

## 16.1 Cache key

```text
normalized URL
+ content hash
+ granularity
+ intent hash (or GENERAL)
+ scoring prompt version
+ model version
```

Use IndexedDB for document-sized records; use `chrome.storage.local` only for small preferences/settings.

## 16.2 Reuse strategy

If the page revisits the same content hash:

- render cached highlights immediately;
- optionally refresh only if cache is stale/model version changed.

If one block changes:

- rescore only changed/new block;
- keep scores for unchanged hashes.

## 16.3 Instrument real cost

Log locally:

```ts
interface InferenceMetric {
  timestamp: number;
  mode: 'highlight' | 'navigator' | 'cursor';
  granularity: 'sentence' | 'paragraph';
  inputTokens?: number;
  outputTokens?: number;
  units: number;
  latencyMs: number;
  cacheHit: boolean;
}
```

Build a hidden developer stats panel:

```text
This page
Sentence mode: 118 units
Requests: 6
Latency p50: ...
Input tokens: ...
Cache hit: ...
```

This lets the team empirically compare sentence vs paragraph economics.

---

# 17. Privacy and security

## 17.1 Default extraction policy

Send only visible document content needed for the feature.

Exclude by default:

- password fields;
- input/textarea values;
- contenteditable drafts;
- cookies;
- localStorage/sessionStorage;
- hidden DOM;
- authorization headers;
- browser history outside the current task;
- private file contents unless the user intentionally opens the file through the extension.

## 17.2 Sensitive domains

Post-hackathon, consider a domain privacy mode:

```text
banking / health / email / internal enterprise
```

Default behavior can be:

- disabled until user explicitly activates;
- or local extraction with no remote inference until user opts in.

## 17.3 Chrome Web Store preparation

Before publishing:

- clear privacy policy;
- explain what page text is sent to the backend/model;
- explain retention policy;
- request minimum host permissions;
- prefer optional permissions where practical;
- no remote executable code;
- make Cursor action execution explicit and understandable.

---

# 18. Performance budget

Target UX budgets for the MVP:

| Operation | Target |
|---|---:|
| Side panel first paint | < 300 ms after open |
| Local visible DOM extraction | < 100 ms typical article |
| First highlighted batch visible | ideally < 1–2 s including network |
| Hover highlight response | < 50 ms |
| Click → scroll start | immediate |
| Intent submit → loading state | < 100 ms |
| Dynamic update debounce | ~150–300 ms |

Do not block the page main thread with full-document extraction. Chunk work using idle callbacks / microtasks / batched traversal.

---

# 19. Highlight visual design

Use a quiet hierarchy instead of many loud colors.

Suggested semantic levels:

```text
Critical  → stronger background + left-edge marker
High      → normal highlight
Medium    → very light highlight or sidebar only
Low       → no page paint; optionally listed when density is high
```

Navigator matches should temporarily override general Highlight colors.

Cursor target must look different from reading highlights, e.g. outline/halo rather than text background.

Accessibility:

- do not encode importance with color alone;
- sidebar has text labels;
- maintain readable contrast;
- keyboard focus is visible;
- highlighted text remains selectable.

---

# 20. Error and unsupported-page states

Define graceful states from day one.

### No meaningful text

```text
No readable text found on this page.
Try Cursor mode or open a document/article page.
```

### Canvas-heavy app

```text
This page renders most content in a canvas, so sentence highlighting is limited.
```

### Scanned PDF

```text
This PDF has no usable text layer. OCR is not enabled in this version.
```

### API unavailable

Keep old highlights and show:

```text
Jev is temporarily unavailable. Cached highlights are still shown.
```

### Low confidence

Do not hide uncertainty. Display a subtle “uncertain” state rather than pretending the ranking is authoritative.

---

# 21. Hackathon 10-hour build plan

## Hour 0–1 — Scaffold and Jev proof

Deliverables:

- WXT + React + TypeScript project;
- side panel opens;
- content script communicates with side panel;
- successful Jev request using sample text;
- schemas for Score response.

**Exit criterion:** clicking a dev button sends one sample state to Jev and renders score + confidence.

## Hour 1–2 — DOM extractor and segmentation

Deliverables:

- visible block extraction;
- heading-path association;
- sentence segmentation using `Intl.Segmenter`;
- paragraph toggle;
- block/unit IDs;
- render extracted units in dev panel.

**Exit criterion:** works on TypeSafe blog, MDN, GitHub README.

## Hour 2–4 — Highlight pipeline

Deliverables:

- batch Jev scoring;
- importance normalization;
- CSS Custom Highlight renderer;
- cards grouped by topic/heading;
- click card → scroll;
- hover card → emphasize;
- page scroll → active card via IntersectionObserver.

**Exit criterion:** polished SEE demo works on 3–5 pages.

## Hour 4–5 — Cost/caching/polish

Deliverables:

- sentence vs paragraph toggle fully working;
- content-hash cache;
- loading/skeleton state;
- density threshold;
- developer latency/token instrumentation.

## Hour 5–6 — Navigator

Deliverables:

- sticky Intent box;
- relevance Score request;
- top-match auto-scroll;
- next/previous match;
- clear intent restores Highlight mode.

**Exit criterion:** at least five prepared intent queries work reliably on 3 page types.

## Hour 6–7.5 — PDF path

Deliverables:

- PDF.js extension viewer;
- direct arXiv PDF opens in viewer through the chosen modern/fallback path;
- text extraction for current PDF pages;
- sentence highlight overlay on PDF text layer;
- side panel shows page numbers;
- Navigator can jump to PDF page/match.

**If MIME interception consumes too much time:** ship an explicit **Open in Jev Lens PDF Viewer** button for the demo and continue. Do not sacrifice Highlight/Navigator quality.

## Hour 7.5–8.5 — Cursor vertical slice

One scripted yet real task, e.g. GitHub:

```text
Goal: Find how to install this repository.
```

Implement:

- actionable candidate extraction;
- Jev Choice;
- target halo;
- user-approved click;
- 2–3 step loop.

Do not generalize more than needed.

## Hour 8.5–9.5 — Smoke test and fixes

Test P0 cases:

- 3 blogs/articles;
- 3 docs;
- 2 GitHub pages;
- 2 news pages;
- 3 arXiv PDFs;
- one long PDF;
- one SPA;
- one product page.

Fix only demo-breaking bugs.

## Hour 9.5–10 — Demo polish

Prepare a deterministic 2–3 minute flow:

1. Open a long article → important sentences appear.
2. Switch sentence ↔ paragraph to show precision/cost tradeoff.
3. Open arXiv PDF → same interaction works.
4. Ask an Intent → jump to exact relevant passage.
5. Open GitHub → Cursor highlights the next action and clicks with approval.

Pitch:

```text
SEE what matters.
FIND what you need.
ACT on what comes next.
```

---

# 22. Post-hackathon 7-day plan

## Day 1 — Reliability

- extraction fixtures;
- shadow DOM coverage where possible;
- iframe strategy;
- deterministic locators;
- crash/error reporting.

## Day 2 — 120-case regression harness

- automate load/open;
- snapshot extracted units;
- manual golden highlights for a smaller benchmark subset;
- measure precision/coverage/latency.

## Day 3 — PDF hardening

- multi-column academic papers;
- page outline/headings;
- embedded PDFs;
- local PDF permission UX;
- large-document progressive scoring.

## Day 4 — Cost optimization

- section-first hierarchy;
- cache reuse;
- deduplication;
- paragraph default option for free tier;
- usage dashboard.

## Day 5 — Navigator quality

- intent rewrite/normalization only if needed;
- top-K section prefilter;
- multi-match grouping;
- next/previous keyboard navigation.

## Day 6 — Cursor safety

- risk gate;
- sensitive-action confirmation;
- action-history state;
- robust rerender recovery;
- undo/stop.

## Day 7 — Web Store packaging

- permissions audit;
- privacy policy;
- onboarding;
- icons/screenshots;
- error telemetry opt-in;
- release build.

---

# 23. Acceptance criteria

## Highlight MVP

- [ ] Side panel opens/closes reliably via toolbar and shortcut.
- [ ] Works on ordinary article/blog pages.
- [ ] Sentence-level is the default.
- [ ] Paragraph-level toggle changes inference granularity.
- [ ] At least 3 importance levels are visually distinguishable.
- [ ] Side panel cards map back to exact original text.
- [ ] Hover/click interactions are smooth.
- [ ] Scroll state updates active card.
- [ ] Dynamic pages do not trigger runaway inference loops.

## Navigator MVP

- [ ] Intent input is always accessible at bottom.
- [ ] Relevance replaces/reorders general highlights.
- [ ] Top result auto-scrolls.
- [ ] Next/previous matches work.
- [ ] Clearing intent restores general Highlight state without re-fetch when cached.

## PDF MVP

- [ ] An arXiv PDF can be opened through Jev Lens PDF viewer.
- [ ] Text-layer sentences can be highlighted.
- [ ] Side-panel cards include page number.
- [ ] Clicking a card jumps to exact PDF page/area.
- [ ] Navigator works on PDF text.
- [ ] Scanned/no-text PDF fails gracefully.

## Cursor demo

- [ ] Collects actionable elements with accessible names.
- [ ] Jev returns a next candidate.
- [ ] Candidate is highlighted before execution.
- [ ] User approval is required by default.
- [ ] Stop command works.

---

# 24. Testing methodology

Do not judge quality only by “looks good”. Track explicit metrics.

## 24.1 Extraction metrics

For a page fixture:

```text
content recall = meaningful visible text extracted / meaningful visible text present
noise ratio    = boilerplate extracted / all extracted text
```

Manual estimation is enough during hackathon.

## 24.2 Highlight metrics

Create a small human-labeled set of ~20 pages after hackathon.

For each sentence:

```text
0 = not important
1 = useful
2 = important
3 = core
```

Measure:

- rank correlation;
- precision@top-20%;
- recall of human “core” sentences;
- contiguous over-highlighting rate.

## 24.3 Navigator metrics

For each page, write 3–5 intents and mark relevant passages.

Measure:

- top-1 hit;
- top-3 recall;
- median scroll distance from selected passage;
- time to target vs browser Ctrl+F/manual search.

## 24.4 Cursor metrics

On constrained tasks:

- next-action top-1 accuracy;
- top-3 accuracy;
- task completion rate;
- unsafe-action false-positive/false-negative rates;
- number of approvals per task.

## 24.5 Performance metrics

- extraction time;
- API latency p50/p95;
- end-to-first-highlight;
- total token usage per page;
- cache hit rate;
- sentence vs paragraph cost ratio.

---

# 25. 120 real-world QA / demo cases

> These are intentionally varied. Some sites may change markup, require login, geo-gate content, show a paywall, or block automated fetching. That is useful: this is a **browser-extension compatibility suite**, not a crawler benchmark. The expected behavior is to analyze only content the user's browser can legitimately access; never bypass a paywall or authentication boundary.

## Category A — Academic papers and publication pages (1–8)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 1 | https://arxiv.org/abs/2608.18682 | arXiv abstract HTML | abstract, contribution, metadata links | compact scientific structure |
| 2 | https://arxiv.org/pdf/2608.18682 | arXiv PDF | abstract, method, experiment, conclusion | PDF, equations, multi-column |
| 3 | https://arxiv.org/abs/1706.03762 | classic arXiv abstract | abstract, key contribution | stable baseline |
| 4 | https://arxiv.org/pdf/1706.03762 | classic paper PDF | architecture/results/conclusion | multi-column PDF |
| 5 | https://arxiv.org/pdf/2505.16421 | agent paper PDF | method, environment, results | tables/figures |
| 6 | https://arxiv.org/pdf/2605.26579 | research PDF | method definitions/results | equations + long sections |
| 7 | https://proceedings.neurips.cc/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html | conference proceedings | abstract, paper links, bibliographic info | structured page |
| 8 | https://www.sciencedirect.com/science/article/pii/S0004370221000862 | journal article page | abstract, highlights, conclusions | complex journal chrome/paywall variants |

## Category B — AI research/project/blog pages (9–16)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 9 | https://typesafe.ai/blog/introducing-system-one-models-and-jev | long launch blog | Jev definition, RLCD, performance, use cases | rich marketing + technical content |
| 10 | https://openreview.net/forum?id=MYqAKKsjF9 | review/forum paper | abstract, reviews/decision when visible | repeated comments / nested threads |
| 11 | https://tongyi-mai.github.io/Qwen-UI-Agent/ | project page | method, benchmarks, resources | image-heavy project layout |
| 12 | https://mostik.ai/read-more | technical/company article | technical thesis, key claims | custom design |
| 13 | https://yifanzhang-pro.github.io/FlashREINFORCE/ | research project page | core method, results, ablations | equations/images |
| 14 | https://yifanzhang-pro.github.io/recurrent-looped-tranformer/ | research project page | architecture, claims, experiments | custom project page |
| 15 | https://contrastive-lm.notion.site/ | Notion-published technical page | architecture/training/inference | Notion DOM/dynamic rendering |
| 16 | https://github.com/NandhaKishorM/laya | repository landing page | README overview/install/usage | GitHub page chrome |

## Category C — Developer documentation (17–24)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 17 | https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide | docs index/article | definitions/examples/warnings | dense sidebar/navigation |
| 18 | https://docs.python.org/3/tutorial/index.html | classic docs | tutorial structure/key instructions | nested TOC |
| 19 | https://docs.pytorch.org/docs/main/fsdp.html | API docs | signatures, warnings, usage | long API reference/code |
| 20 | https://kubernetes.io/docs/concepts/workloads/controllers/deployment/ | technical guide | deployment behavior/config/examples | huge docs navigation |
| 21 | https://cloud.google.com/iam/docs | cloud docs | key concepts/instructions | dynamic docs chrome |
| 22 | https://developer.apple.com/documentation/swiftui/navigationstack | API docs | definition, key API behavior | client-rendered docs |
| 23 | https://nextjs.org/docs/app | framework docs | concepts/links/getting started | SPA navigation |
| 24 | https://doc.rust-lang.org/book/ch04-00-understanding-ownership.html | online book | definitions/rules/examples | prose + code |

## Category D — Code hosting and developer communities (25–32)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 25 | https://github.com/browser-use/browser-use | GitHub repo | README overview/install/examples | many action buttons |
| 26 | https://github.com/browser-use/browser-use/issues | issue list | issue titles/status/labels | list-style content |
| 27 | https://github.com/browser-use/browser-use/pulls | PR list | PR titles/status | dynamic list |
| 28 | https://github.com/browser-use/browser-use/blob/main/README.md | file viewer | rendered README substantive sections | duplicate raw/rendered regions |
| 29 | https://stackoverflow.com/questions/43638938/updating-an-object-with-setstate-in-react | Q&A | question + accepted/high-score answer | ads, related links, comments |
| 30 | https://news.ycombinator.com/ | discussion/news list | story titles/points/comments depending page | dense uniform list |
| 31 | https://www.reddit.com/r/MachineLearning/ | community feed | post title/body; ignore nav/recommendations | infinite scroll/login prompts |
| 32 | https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct | model card | model description, usage, limitations | tabs, code, model metadata |

## Category E — Company engineering / tech blogs (33–40)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 33 | https://openai.com/index/ | company article index | article title/lead content | dynamic marketing site |
| 34 | https://www.anthropic.com/research | research listing | research summaries and key links | card layout |
| 35 | https://vercel.com/blog | blog index/article | article content, key technical claims | React/Next rendering |
| 36 | https://pytorch.org/blog/ | technical blog | main technical content | code/images |
| 37 | https://blog.cloudflare.com/ | engineering blog | thesis, incident detail, technical findings | long rich posts |
| 38 | https://netflixtechblog.com/ | publication/blog | article body/key findings | Medium-style layout |
| 39 | https://engineering.atspotify.com/ | engineering blog | system/method/results | cards + articles |
| 40 | https://slack.engineering/ | engineering blog | architecture/key lessons | WordPress-style content |

## Category F — News and media (41–48)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 41 | https://www.reuters.com/technology/ | news index/article | lede, verified facts, key quotes | dynamic page / consent |
| 42 | https://www.theguardian.com/technology/artificialintelligenceai | topic/news | headline/lede/article body | ads/related modules |
| 43 | https://www.theverge.com/ai-artificial-intelligence | tech news | headline, lede, key details | rich media |
| 44 | https://techcrunch.com/category/artificial-intelligence/ | tech news | article key claims | ads + cards |
| 45 | https://www.wired.com/tag/artificial-intelligence/ | magazine/news | article main content | paywall variants |
| 46 | https://arstechnica.com/ai/ | tech news | technical facts/conclusions | long article pages |
| 47 | https://apnews.com/hub/artificial-intelligence | news hub | factual lede/body | dynamic widgets |
| 48 | https://www.aljazeera.com/tag/artificial-intelligence/ | news hub/article | lede/facts/quotes | video/related modules |

## Category G — Government, law, regulation, public policy (49–56)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 49 | https://eur-lex.europa.eu/eli/reg/2024/1689/oj | EU regulation | operative requirements/definitions/articles | very long legal text |
| 50 | https://www.gov.uk/government/publications/ai-playbook-for-the-uk-government | government guidance | obligations/recommendations | publication metadata |
| 51 | https://www.smartnation.gov.sg/initiatives/artificial-intelligence/ | government strategy | goals/programs/key policy | government CMS |
| 52 | https://www.imda.gov.sg/activities/activities-catalogue/artificial-intelligence | regulator/AI | frameworks/resources | multi-card page |
| 53 | https://www.sec.gov/edgar/browse/?CIK=320193 | SEC filing index | filing type/date/doc links | dense table |
| 54 | https://www.irs.gov/instructions | tax instruction index | instruction name/critical notices | huge indexed lists |
| 55 | https://www.who.int/publications | public-health publications | title/summary/key metadata | search/filter UI |
| 56 | https://www.nhtsa.gov/vehicle-safety/automated-vehicles-safety | government safety page | definitions/safety principles | long public info page |

## Category H — Education and learning (57–64)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 57 | https://ocw.mit.edu/courses/18-06sc-linear-algebra-fall-2011/ | online course | learning goals/material links | many navigation links |
| 58 | https://www.khanacademy.org/math/calculus-1 | interactive course | lesson titles/key explanations where visible | client-side app/login |
| 59 | https://www.coursera.org/learn/machine-learning | course landing | syllabus/outcomes/requirements | marketing + structured sections |
| 60 | https://www.edx.org/learn/computer-science/harvard-university-cs50-s-introduction-to-computer-science | course landing | curriculum/outcomes | marketing sections |
| 61 | https://cs229.stanford.edu/ | course site | schedule/materials/announcements | tables/lists |
| 62 | https://rail.eecs.berkeley.edu/deeprlcourse/ | course site | lectures/assignments/resources | simple academic HTML |
| 63 | https://www.3blue1brown.com/topics/linear-algebra | visual learning site | topic summaries/key links | rich media/card layout |
| 64 | https://en.wikipedia.org/wiki/Transformer_(deep_learning_architecture) | encyclopedia | definition, architecture/history | citations/infobox/TOC |

## Category I — E-commerce and product discovery (65–72)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 65 | https://www.apple.com/sg/shop/buy-iphone | product configurator | model differences/price/critical options | interactive configurator |
| 66 | https://www.amazon.com/s?k=mechanical+keyboard | search results | product title/price/rating; avoid sponsored chrome | highly dynamic / personalization |
| 67 | https://www.ikea.com/us/en/search/?q=office%20chair | retail search | product title/price/key attributes | card grid/infinite loading |
| 68 | https://www.bestbuy.com/site/searchpage.jsp?st=laptop | retail search | price/spec/availability | ads/cards |
| 69 | https://www.ebay.com/sch/i.html?_nkw=mechanical+keyboard | marketplace search | listing title/price/shipping | repeated listings |
| 70 | https://www.etsy.com/search?q=desk%20mat | marketplace search | listing title/price/rating | lazy loading |
| 71 | https://store.steampowered.com/app/730/CounterStrike_2/ | game product page | description/requirements/reviews | age/region modals |
| 72 | https://www.sephora.com/search?keyword=sunscreen | retail search | product attributes/rating | client-rendered cards |

## Category J — Finance, business, dashboards, pricing (73–80)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 73 | https://finance.yahoo.com/quote/AAPL/ | market quote | price/key company stats/news labels | rapidly updating DOM |
| 74 | https://www.google.com/finance/quote/AAPL:NASDAQ | market quote | price/change/key metrics | dynamic app |
| 75 | https://www.coinbase.com/price/bitcoin | crypto price page | price/market stats/description | live updates |
| 76 | https://stripe.com/pricing | SaaS pricing | fee numbers/conditions | marketing sections |
| 77 | https://aws.amazon.com/ec2/pricing/ | cloud pricing | pricing models/caveats | very long mixed content |
| 78 | https://openai.com/api/pricing/ | API pricing | model prices/key constraints | tables/cards |
| 79 | https://investor.apple.com/investor-relations/default.aspx | investor relations | earnings/releases/filings links | enterprise CMS |
| 80 | https://www.macrotrends.net/stocks/charts/AAPL/apple/revenue | financial data page | chart labels/historical values | chart-heavy/ads |

## Category K — Travel and local services (81–88)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 81 | https://www.booking.com/searchresults.html?ss=Singapore | hotel search | hotel name/price/rating/cancellation | dynamic personalized search |
| 82 | https://www.tripadvisor.com/Hotels-g294265-Singapore-Hotels.html | travel listing | rating/location/price signals | heavy cards/ads |
| 83 | https://www.airbnb.com/s/Singapore/homes | accommodation search | title/price/rating | map + infinite cards |
| 84 | https://www.expedia.com/Hotel-Search?destination=Singapore | travel search | price/rating/fees | dynamic filters |
| 85 | https://www.skyscanner.com/transport/flights/sins/tyoa/ | flight search | route/price/duration/stops | dynamic application |
| 86 | https://www.singaporeair.com/en_UK/sg/home | airline site | booking fields/travel notices | forms + marketing |
| 87 | https://www.google.com/maps/search/restaurants+Singapore | map application | place names/ratings where DOM-accessible | canvas/map-heavy partial support |
| 88 | https://www.rome2rio.com/map/Singapore/Kuala-Lumpur | route comparison | transport modes/time/cost | dynamic route cards |

## Category L — Standards, reference, security (89–96)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 89 | https://en.wikipedia.org/wiki/Deep_learning | encyclopedia | definition/key concepts/history | huge article |
| 90 | https://www.britannica.com/technology/artificial-intelligence | reference article | definition/key historical facts | subscription/ads variants |
| 91 | https://www.rfc-editor.org/rfc/rfc9110.html | technical standard | normative requirements/definitions | very long structured document |
| 92 | https://html.spec.whatwg.org/ | living standard | normative text/definitions | enormous single page |
| 93 | https://tc39.es/ecma262/ | language specification | algorithms/definitions | huge spec, custom structure |
| 94 | https://www.law.cornell.edu/constitution | legal reference | clauses/articles/amendments | legal hierarchy |
| 95 | https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API | API reference | concept/steps/compatibility | code + prose |
| 96 | https://owasp.org/www-project-top-ten/ | security reference | risks/descriptions/mitigations | cards + docs links |

## Category M — Social publishing, video, feeds (97–104)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 97 | https://medium.com/tag/artificial-intelligence | publishing feed | story titles/excerpts | infinite feed/login prompts |
| 98 | https://substack.com/home | publishing feed | post titles/excerpts | personalized/auth variants |
| 99 | https://www.notion.com/blog | company publishing | article title/lede/key claims | dynamic layout |
| 100 | https://www.youtube.com/watch?v=aircAruvnKk | video page | title/description/transcript only if DOM-visible | video UI/dynamic comments |
| 101 | https://dev.to/t/artificialintelligence | developer feed | post title/excerpt/metadata | feed layout |
| 102 | https://hashnode.com/n/artificial-intelligence | developer feed | post title/excerpt | client-side feed |
| 103 | https://www.producthunt.com/topics/artificial-intelligence | product directory | product name/tagline/description | dense cards/login |
| 104 | https://x.com/OpenAI | social profile/feed | post text only if visible | login wall/infinite dynamic feed |

## Category N — PDF-specific stress tests (105–112)

| # | URL | Archetype | Expected Highlight focus | Special challenge |
|---:|---|---|---|---|
| 105 | https://arxiv.org/pdf/1706.03762 | academic PDF | core architecture/results | two-column + equations |
| 106 | https://arxiv.org/pdf/2608.18682 | academic PDF | method/experiments | modern arXiv PDF |
| 107 | https://cdn.who.int/media/docs/default-source/digital-health-documents/who_brochure_ai_web.pdf | brochure/report PDF | key guidance/headings | graphic layout |
| 108 | https://www.nhtsa.gov/sites/nhtsa.gov/files/2023-06/Automated-Vehicles-Report-to-Congress-06302023.pdf | government report PDF | conclusions/recommendations | long report/tables |
| 109 | https://www.imda.gov.sg/-/media/imda/files/programme/ai-data-innovation/model-ai-governance-framework---first-edition.pdf | policy PDF | principles/requirements | multi-section report |
| 110 | https://cs229.stanford.edu/main_notes.pdf | course notes PDF | definitions/theorems/key derivations | long technical notes |
| 111 | https://www.irs.gov/pub/irs-pdf/i1040gi.pdf | government instruction PDF | deadlines/rules/warnings | long complex forms guidance |
| 112 | https://tongyi-mai.github.io/Qwen-UI-Agent/Qwen-UI-Agent-Technical-Report.pdf | technical report PDF | model/training/benchmarks | paper-style PDF |

## Category O — Edge/platform behavior (113–120)

| # | URL / pattern | Archetype | Expected behavior | Special challenge |
|---:|---|---|---|---|
| 113 | https://react.dev/learn | React SPA docs | highlight article; update after client navigation | SPA route changes |
| 114 | https://mail.google.com/ | authenticated web app | privacy-first: disable remote Highlight by default or explicit opt-in | sensitive/private content |
| 115 | https://docs.google.com/document/d/* | editor app | detect unsupported/contenteditable mode; avoid sending drafts | canvas/contenteditable/editor internals |
| 116 | https://www.figma.com/* | canvas-heavy app | show graceful limited-support state; Cursor may use accessible DOM only | canvas/WebGL |
| 117 | https://www.youtube.com/watch?v=* | complex media app | analyze DOM-visible description/transcript; ignore player canvas/video | SPA + dynamic comments |
| 118 | https://www.reddit.com/* | infinite feed/thread | progressive viewport scoring | mutations/infinite scrolling |
| 119 | https://www.ft.com/* | paywalled news | analyze only legitimately visible DOM; never bypass paywall | paywall/consent |
| 120 | file://*.pdf | local PDF | supported only through explicit user permission / modern MIME path; never upload silently | local-file privacy/permissions |

---

# 26. Prioritized demo/test subset

The 120 cases are a broad regression matrix, but the hackathon needs a small deterministic set.

## P0 — Must work before demo

1. TypeSafe Jev launch blog.
2. MDN CSS Custom Highlight API page.
3. Rust Book ownership chapter.
4. Browser-Use GitHub README.
5. Stack Overflow Q&A.
6. Wikipedia Transformer page.
7. one Reuters/AP/Guardian article accessible during demo.
8. Stripe pricing.
9. arXiv Attention Is All You Need PDF.
10. one recent arXiv PDF.
11. CS229 notes PDF.
12. React Learn SPA.

## P1 — Validate after core is stable

- PyTorch docs;
- Kubernetes docs;
- Hugging Face model card;
- OpenReview;
- GitHub issue list;
- course page;
- product listing;
- government/legal page;
- dynamic finance page;
- Reddit thread.

## P2 — Expect graceful degradation initially

- Gmail;
- Google Docs;
- Figma;
- Google Maps;
- X login-walled feeds;
- scanned/no-text PDFs.

---

# 27. Example demo intents by page type

## Research paper

```text
What is the main technical contribution?
How is the model trained?
What GPUs or compute are used?
What are the strongest experimental results?
What are the limitations?
```

## Developer docs

```text
How do I install this?
Show me the minimal example.
Where is the API signature?
What are the warnings or caveats?
How do I configure authentication?
```

## GitHub

```text
How do I run this locally?
Where are the model weights?
What license does this use?
Find the benchmark results.
Find open issues about installation.
```

## News

```text
What actually happened?
What evidence supports the headline?
What are the concrete dates and numbers?
What did each side say?
What remains uncertain?
```

## Pricing

```text
What will I actually pay?
Which plan has SSO?
Find usage limits.
Show hidden/extra fees or conditions.
```

## Government/legal

```text
What is required rather than recommended?
When does this rule apply?
Find definitions for this term.
What are the exceptions?
What deadlines are specified?
```

## Travel

```text
Which option is nonstop?
Find cancellation conditions.
Which price includes baggage?
Where are check-in requirements?
```

---

# 28. AI coding agent work breakdown

Give the coding agent this order. Do not let it jump directly into Cursor.

## Task 1 — Build shell

```text
Create WXT MV3 extension with:
- React side panel
- background service worker
- content script
- typed runtime messaging
- keyboard command registration
- toolbar opens side panel
Do not implement AI yet.
```

Definition of done:

- side panel can open;
- current tab URL/title appear;
- content script sends a ping.

## Task 2 — Extract page model

```text
Implement HTML document extraction.
Build heading hierarchy.
Extract visible meaningful blocks.
Exclude forms/navigation/hidden content.
Return stable BlockRecords.
Add unit tests against saved HTML fixtures.
```

## Task 3 — Segment and map ranges

```text
Implement sentence mode with Intl.Segmenter and paragraph mode.
Every unit must map back to exact DOM Range(s).
Expose a dev overlay that highlights arbitrary selected unit IDs without Jev.
```

Definition of done:

- choose any unit in side panel → exact page sentence paints correctly.

## Task 4 — Jev adapter

```text
Implement TypeSafe/Jev client behind an interface.
Add mock client for tests.
Support batching and cancellation.
Parse Score/Choice responses using Zod.
Collect latency/token usage.
```

## Task 5 — Highlight scorer

```text
Send unit batches to Jev Score.
Normalize scores.
Apply density selection.
Render CSS Custom Highlights.
Group cards by nearest heading.
```

## Task 6 — Sync UX

```text
Implement hover/select/scroll bidirectional synchronization.
Use IntersectionObserver.
No AI changes in this task.
```

## Task 7 — Navigator

```text
Implement sticky Intent input.
Score relevance to intent.
Rank matches.
Auto-scroll top result.
Add next/previous navigation and Escape-to-clear.
```

## Task 8 — PDF viewer

```text
Bundle PDF.js.
Build extension PDF viewer.
Extract PDF text layer into the same TextUnit abstraction.
Reuse Highlight and Navigator APIs.
Implement modern Chrome MIME handler when available and explicit Open-in-Lens fallback.
```

## Task 9 — Cursor prototype

```text
Extract visible actionable elements.
Convert them to ActionCandidate records using accessible names.
Use Jev Choice to select next action for a user goal.
Highlight target.
Require user confirmation before click.
Implement Stop.
```

## Task 10 — Regression harness

```text
Create Playwright/manual hybrid QA harness using the 120-case list.
Automate pages that permit it.
For pages requiring auth/paywall, keep manual test entries.
Capture:
- extraction succeeded?
- number of units
- analysis latency
- highlighted count
- errors
```

---

# 29. Master prompt to paste into an AI coding tool

Copy the following prompt together with this file:

```text
You are implementing the project specified in jev_web_lens_implementation_plan.md.

Treat that document as the product and architecture specification.

Priority order is strict:
1. Chrome MV3 extension shell and side panel
2. HTML text extraction
3. exact sentence/paragraph range mapping
4. Jev Highlight scoring
5. Highlight Map UX + bidirectional sync
6. Navigator
7. PDF.js support
8. one constrained Cursor flow
9. broader compatibility

Important constraints:
- Use WXT + React + TypeScript unless the repository already has an equivalent MV3 stack.
- Do not inject a fake fixed sidebar into pages; use Chrome Side Panel API.
- Use CSS Custom Highlight API for text highlighting when available; avoid mutating page DOM.
- Sentence mode is the default; paragraph mode is a user-selectable lower-cost mode.
- Use Intl.Segmenter for locale-aware sentence segmentation.
- Do not send form values, password fields, contenteditable drafts, cookies, localStorage, or hidden DOM to the model.
- Do not embed the production Jev API secret in extension code. Create a clean API adapter; local development may use an env key, production uses a backend proxy.
- Jev provides typed decisions; do not rely on it to generate free-form topic labels. Derive topic labels from page headings/structure.
- PDF support must use an extension-owned PDF.js viewer. Prefer Chrome's modern MIME handler when available and provide a fallback Open-in-Lens path.
- Cursor must highlight a proposed action before execution and require human confirmation by default.
- Do not auto-execute payments, credential submission, deletion, authorization, posting, or other sensitive actions.
- Keep code modular so HTML and PDF share the same TextUnit / scoring / sidebar abstractions.
- Add runtime schema validation and a mock Jev client so UI/extraction can be tested without API calls.
- Add instrumentation for API latency and token usage.

Work incrementally. After each milestone:
1. run typecheck/lint/tests;
2. load/build the extension;
3. report what works;
4. list any known limitation;
5. continue to the next priority without rewriting working modules unnecessarily.

For hackathon scope, optimize for a reliable, polished demo rather than universal website coverage.
```

---

# 30. Suggested first implementation contracts

These interfaces force clean separation between extraction, scoring, and rendering.

```ts
export type Granularity = 'sentence' | 'paragraph';

export interface DocumentAdapter {
  canHandle(ctx: DocumentContext): boolean;
  extract(ctx: DocumentContext, granularity: Granularity): Promise<ExtractedDocument>;
  resolveTextLocator(locator: PageLocator): Promise<ResolvedTextRange | null>;
  scrollTo(locator: PageLocator): Promise<void>;
}

export interface DecisionProvider {
  scoreImportance(batch: TextUnitBatch): Promise<ImportanceResult[]>;
  scoreRelevance(batch: TextUnitBatch, intent: string): Promise<RelevanceResult[]>;
  chooseAction(input: CursorDecisionInput): Promise<CursorDecision>;
}

export interface HighlightRenderer {
  render(items: RenderHighlight[]): void;
  emphasize(id: string | null): void;
  clear(layer?: string): void;
}
```

Adapters:

```text
HtmlDocumentAdapter
PdfDocumentAdapter
```

Providers:

```text
JevDecisionProvider
MockDecisionProvider
```

Renderers:

```text
CssCustomHighlightRenderer
PdfTextLayerHighlightRenderer
OverlayFallbackRenderer
```

---

# 31. Suggested page-type heuristics

```ts
type PageType =
  | 'article'
  | 'docs'
  | 'academic'
  | 'code'
  | 'forum'
  | 'feed'
  | 'product'
  | 'pricing'
  | 'legal'
  | 'dashboard'
  | 'pdf'
  | 'app'
  | 'unknown';
```

Use deterministic signals first:

- `article` tag density;
- `schema.org` metadata;
- hostname patterns for known archetypes;
- heading/text ratio;
- repeated card structure;
- PDF context.

Do not create a giant site-specific adapter system in the hackathon. General extraction first; adapters only after real failures.

---

# 32. Potential future product layers

These are explicitly post-MVP.

## 32.1 Personal Lens

Learn what the user tends to expand, click, dwell on, or ignore.

```text
P(importance | page, user preference)
```

## 32.2 Task Lens

Persistent intent across multiple pages/tabs:

```text
“I'm evaluating whether to use library X.”
```

Every opened page highlights content relevant to that task.

## 32.3 Multi-tab Navigator

Rank relevant passages across all open tabs.

## 32.4 Research trail

Store selected original passages + URL + locator, not generated summaries.

## 32.5 System-1 / System-2 escalation

Jev handles cheap/routine ranking. If confidence is low or a task needs actual synthesis/reasoning:

```text
Jev low confidence / complex reasoning required
                 ↓
             LLM escalation
```

Keep this optional; the core product should remain useful without chat.

---

# 33. Key implementation risks and mitigations

| Risk | Why it matters | Mitigation |
|---|---|---|
| DOM extraction includes nav/ads | bad highlights destroy trust | deterministic noise filter + content density heuristics |
| Sentence range breaks across inline tags | wrong text highlighted | logical block offsets → multi-node Range resolver |
| SPA rerender invalidates ranges | highlights disappear | MutationObserver + content hashes + locator re-resolution |
| Long page is expensive | poor latency/cost | viewport-first, batching, paragraph mode, caching, hierarchical scoring |
| PDF built-in viewer inaccessible | PDF feature fails | own PDF.js viewer + MIME handler/fallback |
| PDF reading order wrong | scientific papers become nonsense | PDF text-layer reconstruction; prioritize common arXiv layouts; graceful fallback |
| Jev cannot generate labels | sidebar looks unlabeled | derive labels from headings/structure |
| Side panel shortcuts conflict | poor UX | non-reserved defaults + user remapping |
| Extension leaks private page text | serious trust problem | strict extraction policy, opt-in for sensitive contexts, backend privacy controls |
| Cursor takes destructive action | safety/reputation risk | approval-by-default + hard block categories |
| Site changes markup | brittle tests | semantic extraction and accessible names, not hostname-specific selectors first |

---

# 34. Research references used for this plan

## Jev / TypeSafe

- TypeSafe — Introducing System One Models & Jev\
  https://typesafe.ai/blog/introducing-system-one-models-and-jev
- TypeSafe Docs — Introduction\
  https://docs.typesafe.ai/introduction
- TypeSafe Docs — Quick start\
  https://docs.typesafe.ai/introduction/quickstart
- TypeSafe Docs — Choice\
  https://docs.typesafe.ai/primitives/choice
- TypeSafe Docs — Score\
  https://docs.typesafe.ai/primitives/score

## Chrome extension APIs

- Chrome Side Panel API\
  https://developer.chrome.com/docs/extensions/reference/api/sidePanel
- Chrome Commands API\
  https://developer.chrome.com/docs/extensions/reference/api/commands
- Chrome MIME Handler API\
  https://developer.chrome.com/docs/extensions/reference/api/mimeHandler

## Browser text APIs

- MDN CSS Custom Highlight API\
  https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API
- MDN Intl.Segmenter\
  https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter
- MDN MutationObserver\
  https://developer.mozilla.org/en-US/docs/Web/API/MutationObserver
- MDN IntersectionObserver\
  https://developer.mozilla.org/en-US/docs/Web/API/Intersection_Observer_API

## PDF

- Mozilla PDF.js repository\
  https://github.com/mozilla/pdf.js
- PDF.js Chrome extension notes\
  https://github.com/mozilla/pdf.js/wiki/PDF-Viewer-%28Chrome-extension%29
- PDF.js setup guidance\
  https://github.com/mozilla/pdf.js/wiki/Setup-PDF.js-in-a-website

## Extension framework

- WXT\
  https://wxt.dev/
- WXT introduction\
  https://wxt.dev/guide/introduction

---

# 35. Final build priority — if time runs out

If the clock is running out, preserve this order:

```text
1. Beautiful side panel
2. Correct HTML sentence highlighting
3. Highlight Map sync
4. Navigator
5. Sentence/paragraph toggle
6. One arXiv PDF path
7. One Cursor demo
8. Everything else
```

A polished **SEE + FIND** product is already a coherent extension. A half-working universal Cursor is not worth sacrificing the core.

The strongest hackathon story is:

> **The web was built to show everything. Jev Lens decides what deserves your attention.**
>
> **SEE what matters → FIND what you need → ACT on what comes next.**
