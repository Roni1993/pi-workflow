# UI gap analysis — Pi TUI surfaces vs the opencode-look extension

Read-only analysis. No source was modified. Branch: `feat/ui-integration` @ `a65d9da`.
Extension under analysis: `extensions/ui/{index,dock,questions,tools,cards,transcript}.ts` + `ui-kit.ts`.

## How this was grounded

- **Installed pi:** `0.85.1`, nix store
  `/nix/store/b3r85hp20c28gh6s596zkkrf3hl8zqiq-pi-coding-agent-ui-0.85.1`.
  It already carries the **T7 transcript seam** (`pi-ui:transcript-seam`, 6 anchors) and the
  **T9 backdrop** (`pi-ui:backdrop`, 4 hits + `backdrop?: number` in `tui.d.ts:162`), which is
  why the transcript cards and the dim backdrop render at all.
- **Paths below are abbreviated:**
  - `IM` = `<store>/lib/node_modules/pi-monorepo/dist/modes/interactive/interactive-mode.js`
  - `CMP` = `<store>/lib/node_modules/pi-monorepo/dist/modes/interactive/components/`
  - `TYPES` = `<store>/lib/node_modules/pi-monorepo/dist/core/extensions/types.d.ts`
  - `TUI` = `<store>/lib/node_modules/pi-monorepo/node_modules/@earendil-works/pi-tui/dist/`
- **Extension hooks actually used** (grep of `extensions/ui/*.ts`): `registerMessageRenderer`
  (`cards.ts:107`, `transcript.ts:203,212`), `registerEntryRenderer` (`cards.ts:111`),
  `registerTool` (`tools.ts:264`), `ctx.ui.custom` (`dock.ts:429`, `index.ts:39`,
  `questions.ts:408`), `ctx.ui.setWidget` (`dock.ts:478,483`), `ctx.ui.notify`
  (`dock.ts:479,485`, `questions.ts:463`). **No** `setHeader`, `setFooter`,
  `setEditorComponent`, `setWorkingIndicator`, `setWorkingMessage`, `setWorkingVisible`,
  `setHiddenThinkingLabel`, `setToolsExpanded`, `setStatus`, or `registerMarkdownTransformer`
  anywhere.

## Surface inventory

Status legend: **styled** = our extension owns it; **partial** = ours but with fidelity gaps;
**stock** = pi default, hook exists but unused; **unreachable** = no extension hook; **broken** = currently defective.

| # | Surface | Where rendered | Hook that can style it | Status | What "opencode-look" means | Effort | Priority |
|---|---|---|---|---|---|---|---|
| 1 | Startup banner (logo + version) | `IM:754` (`builtInHeader`) | `setHeader` (`TYPES:111`, impl `IM:1890`) | stock | opencode wordmark, muted version, no box | M | P2 |
| 2 | Tagline / onboarding text | `IM:753` | `setHeader` | stock | dim single line under the logo | S | P3 |
| 3 | Hint line "Press ctrl+o…" | `IM:752` | `setHeader` | stock | inline key hints, muted | S | P3 |
| 4 | `[Context]` section | `IM:1372`, container `IM:398,402` | **none** | **unreachable** | tinted section header + path rows | L | P1 |
| 5 | `[Skills]` section | `IM:1382` | **none** | **unreachable** | tinted header, comma list / grouped paths | L | P1 |
| 6 | `[Prompts]` section | `IM:1399` | **none** | unreachable | header + `/name` rows | L | P3 |
| 7 | `[Extensions]` section | `IM:1408` | **none** | unreachable | header + path rows | L | P1 |
| 8 | `[Themes]` section | `IM:1423` | **none** | unreachable | header + rows | L | P3 |
| 9 | Loaded-resource *collapsed* state ("Press ctrl+o…") | `IM:752` + `ExpandableText` (`IM:1323`), state `IM:1045` | **none** | **unreachable** | styled collapsed summary row | L | P1 |
| 10 | Resource diagnostics (`[Skill conflicts]`, `[Extension issues]`, …) | `IM:1430–1460` | **none** | unreachable | warning cards | M | P3 |
| 11 | Header container (custom) | `IM:756–758`, replace at `IM:1890–1914` | `setHeader` | stock | opencode header panel | M | P2 |
| 12 | Footer / status line | `CMP/footer.js:47`, built `IM:421–424` | `setFooter` (`TYPES:107`, impl `IM:1869`), `setStatus` (`TYPES:80`, impl `IM:1683`) | stock | opencode footer bar (cwd·branch, tokens, model) | M | P1 |
| 13 | Editor / input box ("chat window") | `IM:412–419` (`CustomEditor`, `editorContainer`) | `setEditorComponent` (`TYPES:171`, impl `IM:2143`) | stock | full-width chatbox rail, prompt, animated border | L | P1 |
| 14 | User turn card | `transcript.ts:83` via seam `IM:3038–3049` | `registerMessageRenderer("user")` | styled | opencode user bar | — | done |
| 15 | Assistant text card | `transcript.ts:115` via seam `IM:3079–3085` | `registerMessageRenderer("assistant")` | partial | markdown (code fences, tables, links, lists) rendered inside the agent card | M | P1 |
| 16 | Thinking blocks | stock `CMP/assistant-message.js:89–131`; ours `transcript.ts:92–108` | seam role renderer / `setHiddenThinkingLabel` (`TYPES:95`) | partial | one collapsed thoughts box; respects hide/`ctrl+o` and streams open | S | P2 |
| 17 | Tool call + result (open/closed) | `CMP/tool-execution.js:7`; ours `tools.ts:256` (`renderShell:"self"`) | `registerTool` (`TYPES:944`) | partial | one card per call; open state follows `ctrl+o`/`app.tools.expand` exactly | M | P2 |
| 18 | Working indicator (streaming) | `CMP/status-indicator.js:15`, `IM:415,1723–1744` | `setWorkingIndicator` (`TYPES:93`), `setWorkingMessage` (`TYPES:82`), `setWorkingVisible` (`TYPES:84`) | stock | opencode spinner/rail; static glyph if desired | S | P2 |
| 19 | Spacers between messages | stock `IM:3053–3055`, `CMP/assistant-message.js:76`; seam drops them `IM:3040–3049,3080–3085` | seam patch or renderer-emitted blank | **broken** | exactly one blank row between turns | S | P1 |
| 20 | Skill invocation message | `CMP/skill-invocation-message.js:9`, `IM:3056–3067` | **none** (seam `"user"` bypasses `parseSkillBlock`) | **broken/partial** | `[skill] name` chip + styled body | M | P2 |
| 21 | Compaction summary | `CMP/compaction-summary-message.js:8`, `IM:3024–3029` | **none** | unreachable | `[compaction]` card | M | P3 |
| 22 | Branch summary | `CMP/branch-summary-message.js:8`, `IM:3031–3036` | **none** | unreachable | `[branch]` card | M | P3 |
| 23 | Custom messages | `CMP/custom-message.js:7`; ours `cards.ts:105` | `registerMessageRenderer(customType)` | styled | opencode cards | — | done |
| 24 | Custom durable entries | `CMP/custom-entry.js:7`; ours `cards.ts:111` | `registerEntryRenderer` | styled | opencode cards | — | done |
| 25 | Bash execution (`!` / `!!`) | `CMP/bash-execution.js:13`, `IM:3006–3013` | **none** (not the same as the `bash` tool) | stock | opencode bash card | M | P2 |
| 26 | Error / warning / toast notifications | `IM:2213–2222` (`showExtensionNotify`), `IM:2949` (`showStatus`), `IM:3629` (`showError`) | **none** | stock | opencode toast styling | M | P3 |
| 27 | Pending queue ("Steering:"/"Follow-up:") | `IM:3705–3721` (`pendingMessagesContainer`) | **none** | stock | styled queue rows | M | P3 |
| 28 | Widgets above/below editor | `IM:406–407`, `IM:1845–1864` | `setWidget` (`TYPES:97`) | styled (below only: dock `dock.ts:483`) | opencode dock/status band | — | partial |
| 29 | Questions modal | `questions.ts:407–420`, overlay `ctx.ui.custom` | `ctx.ui.custom({overlay})` | styled | opencode modal + backdrop | — | done |
| 30 | Model selector | `CMP/model-selector.js:11`, `IM:4994` | **none** | unreachable | opencode picker | L | P3 |
| 31 | Session selector / tree / fork | `CMP/session-selector.js:577`, `tree-selector.js:1167`, `user-message-selector.js:86`, `IM:4994` | **none** | unreachable | opencode picker | L | P3 |
| 32 | Theme / settings / config / thinking / show-images selectors | `CMP/theme-selector.js:11`, `settings-selector.js:248`, `config-selector.js:710`, `thinking-selector.js:21`, `show-images-selector.js`, `IM:4924–5108` | **none** | unreachable | opencode settings panel | L | P3 |
| 33 | OAuth / login / trust / first-time setup | `CMP/oauth-selector.js:10`, `login-dialog.js:9`, `trust-selector.js:16`, `first-time-setup.js:16` | **none** | unreachable | opencode onboarding | L | P3 |
| 34 | Bordered loader (share/gist uploads) | `CMP/bordered-loader.js:5`, used `session-share.js:84,131` | none, but exported (`dist/index.d.ts:28`) so an extension can reuse it | stock | opencode panel border | M | P3 |
| 35 | Terminal title/tab | `IM:806–815` | `setTitle` (`TYPES:115`) | stock | opencode title | S | P3 |

Not enumerated as rows because they are unreachable and low-visible: diff viewer, mermaid,
`earendil-announcement`, `armin`/`daxnuts` easter eggs, import/export preview (`IM:5054`).

## Reachability notes

### Reachable with no patch (hook exists, unused)

- **Startup banner + tagline + hint** (`setHeader`, `TYPES:111` / `IM:1890`). The built-in
  header (`IM:754`) is constructed at `IM:754` **before** extensions initialize at `IM:779`, and
  `setExtensionHeader` inserts the custom component into `headerContainer` immediately
  (`IM:1904–1914`). A custom header covers items 1–3 and the tagline. **It does not cover the
  loaded-resource sections** — those live in a sibling container (`IM:398,402`).
- **Footer/status line** (`setFooter`, `TYPES:107` / `IM:1869`; `setStatus`, `TYPES:80` /
  `IM:1683`). `FooterDataProvider` supplies git branch + extension statuses; context/token/model
  come from `ctx.getContextUsage()` / `ctx.sessionManager.getEntries()` / `ctx.model`
  (`TYPES:101–106`).
- **Editor/chat window** (`setEditorComponent`, `TYPES:171` / `IM:2143`). Extend `CustomEditor`
  (exported: `<store>/.../dist/index.d.ts:28`) and pass `super.handleInput` for app keys; the
  host wires `onSubmit`, `onChange`, autocomplete, padding, and action handlers
  (`IM:2153–2191`). This is the single biggest visual surface and is fully reachable.
- **Working indicator** (`setWorkingIndicator`, `TYPES:93` / `IM:1742`; `setWorkingMessage`
  `IM:1972`; `setWorkingVisible` `IM:1730`). Frames are rendered verbatim (`TYPES:56–59`), so an
  opencode glyph is a few lines.
- **Thinking label** (`setHiddenThinkingLabel`, `TYPES:95` / `IM:1749`). Only affects the stock
  assistant component's hidden blocks; our role renderer ignores it (`transcript.ts:158`).

### Unreachable without another local patch

1. **Loaded-resource sections** (items 4–10). `loadedResourcesContainer` is created
   (`IM:398`), mounted (`IM:402`), cleared (`IM:1308`, `IM:1600`), and populated entirely inside
   `showLoadedResources` (`IM:1306–1465`). No `ExtensionUIContext` method references it
   (`IM:1964–2017` is the complete surface). It is also re-rendered on session rebind
   (`IM:1539`, `IM:5137`), so a header cannot replace it.
   **Minimal patch (T7-shaped):** add `setLoadedResources(factory)` to
   `ExtensionUIContext` (`TYPES:68–192`) and to `IM:1964–2017`; in
   `showLoadedResources`, after the stock build, if a factory is registered, `clear()` the
   container and `addChild(factory(...))`, guarded by an extension-runner lookup so default
   stays byte-identical. Cost: **M** (one type, one context method, one call-site branch with a
   default-path guard). This is the same shape as T7: a new registry lookup at an existing
   render site, falls through when unregistered.

2. **Compaction / branch summaries** (items 21–22). `addMessageToChat` constructs them directly
   (`IM:3024–3029`, `IM:3031–3036`) and the T7 seam only looks up `"user"`/`"assistant"`
   (`IM:2991–3002`). The runner's `getMessageRenderer(key)` accepts any key, so the **minimal
   patch is two extra seam lookups** using the existing adapter:
   `this.createBuiltinMessageComponent("compactionSummary", message)` in the
   `case "compactionSummary"` branch, same for `"branchSummary"`. Cost: **S** (~10 lines,
   same default-undefined fallback, add the role keys to the T7 doc contract).

3. **Skill invocation** (item 20). When a `"user"` renderer is registered the seam returns early
   (`IM:3040–3049`) and `parseSkillBlock` at `IM:3056` never runs, so the skill-specific
   collapse/expand is lost. **Minimal patch:** in the seam's parseSkillBlock branch, consult a
   `"skill"` role renderer with the parsed `skillBlock` before constructing
   `SkillInvocationMessageComponent`, else stock. Cost: **S**. (T7 doc already flags this
   caveat: `fleek-pi-ui/pi-patches/transcript-seam.md:206–209`.)

4. **Bash execution** (item 25) and **notifications** (item 26): both are internal components
   built in `interactive-mode.js` with no renderer registry. Styling needs either a new seam or
   a theme (see below). Cost: **M** each.

### Theme as a broad, cheap lever

Every stock surface above that uses `theme.fg(...)`/`theme.bg(...)` reads `ThemeColor` /
`ThemeBg` (`<store>/.../theme/theme.d.ts:14–15`): footer, editor border, selectors, dialogs,
thinking text, tool boxes, skill/compaction/branch labels, toasts. Shipping an
opencode-palette theme (JSON, via `pi.getTheme`/`setTheme` or a package theme file) restyles
items 11–13, 18, 20–22, 24–35 **without code and without patches**. It cannot restyle the
dimensions our extension hardcodes (matugen palette in `ui-kit.ts:99`), and it cannot change
layout, only colour. Recommendation: do the theme first for breadth, then the seams above for
layout fidelity.

## Ranked gap list (highest impact first)

1. **Width crash — fatal, blocks use. Being fixed separately; not fixed here.** `✅` (U+2705) is
   counted as width 1 by us and width 2 by pi-tui, so a card line pads one cell too wide and
   pi-tui throws. See Bug cross-references §4 for the full chain. Until fixed, any emoji
   outside `U+1F300–U+1FAFF`/`U+1F900–U+1F9FF` (dingbats, misc symbols) can kill the TUI.
2. **Spacers between messages dropped by the T7 seam** (item 19). One-line fix at the seam or in
   the renderer; user-reported. See §1.
3. **Editor / "chat window" not restyled** (item 13). `setEditorComponent` exists and is unused.
   Build a `CustomEditor` subclass over `IM:2143–2191`'s contract. Highest always-visible visual
   gap. See §2.
4. **Loaded resources / intro/context/skills unstyled** (items 4–10). No hook; needs the
   `setLoadedResources` seam. User-reported. See §3.
5. **Footer/status line** (item 12). `setFooter` + `setStatus` unused; restyle via component
   factory, no patch. Effort M.
6. **Startup banner + tagline + hint** (items 1–3). `setHeader` unused; no patch. Effort M.
7. **Assistant text loses markdown** (item 15). `transcript.ts:115–125` renders raw wrapped text:
   no code fences/tables/links/lists, and images/diffs in assistant content are dropped
   (`transcript.ts:55`). Either wrap a pi-tui `Markdown` inside the card or pass the raw output
   through `registerMarkdownTransformer` (`TYPES:967`). Effort M.
8. **Working indicator** (item 18). `setWorkingIndicator({frames:[…]})` — a few lines. Effort S.
9. **Skill invocation** (item 20). Seam/`"skill"` role. Effort M.
10. **Thinking fidelity** (item 16). Our box always shows all thinking with a hardcoded
    `(ctrl+o expand)` hint that does nothing, and ignores `hideThinkingBlock` /
    `setHiddenThinkingLabel` / streaming. Effort S.
11. **Tool open/close fidelity** (item 17). Open state is a module-level "recent 3" heuristic
    (`tools.ts:57–74`), not `expanded`/`ctrl+o`. At least follow `options.expanded` as primary
    (already read at `tools.ts:311`) and drop the misleading approximation. Effort M.
12. **Compaction/branch summaries** (items 21–22). Seam extension. Effort M.
13. **Notifications** (item 26). Theme first, seam later. Effort M.
14. **Selectors / dialogs / onboarding** (items 30–35). Theme now; full opencode layout is L
    and low daily impact.

## Bug cross-references

### 1. Spacers between messages missing

- Stock user turn adds a spacer only when the transcript is non-empty:
  `IM:3053–3055` — `if (this.chatContainer.children.length > 0) this.chatContainer.addChild(new Spacer(1));`
- The T7 seam intercepts `"user"` **before** that line and breaks out:
  `IM:3040–3049` (the `break` at `IM:3048`). No spacer is added.
- Stock assistant turn relies on the component's own leading spacer:
  `CMP/assistant-message.js:76` (`if (hasVisibleContent) this.contentContainer.addChild(new Spacer(1));`).
  The seam replaces the component with `BuiltinMessageRendererComponent` (`IM:3080–3085`), whose
  `rebuild()` only does `clear()` → `addChild(component)` with no spacer (`IM:232–252`).
- Our card primitives add buffer rows *inside* the background (`ui-kit.ts:187–190`), not a
  component-level spacer, so consecutive cards read as one block.
- **Fix direction:** either re-add the stock `Spacer(1)` in the seam's user branch (mirroring
  `IM:3053–3055`) and one before the assistant adapter, or have `transcript.ts` emit a leading
  `""` when the turn is not first. The seam fix is more faithful; a renderer fix keeps it
  extension-only.

### 2. Chat window (editor) not changed

- Default editor is built at `IM:412–417` (`CustomEditor`, `embedWorkingStatus: true`) and
  mounted in `editorContainer` at `IM:418–419`.
- The hook exists: `setEditorComponent` (`TYPES:171`) → `IM:1994` → `setCustomEditorComponent`
  (`IM:2143–2209`), which wires `onSubmit`/`onChange`/autocomplete/padding/border color and
  copies action handlers when the component extends `CustomEditor` (`IM:2153–2191`).
- `grep setEditorComponent extensions/ui/*.ts` → **no hits**. The extension never calls it, so
  the input box is 100% stock. This is the reported "chat window not changed".

### 3. Intro / `[Context]` / `[Skills]` / `[Extensions]` unstyled

- The intro (logo, tagline, hint) is `this.builtInHeader` (`IM:754`), inside `headerContainer`
  (`IM:756–758`). `setHeader` can replace it (`IM:1890–1914`).
- The resource sections are a **separate** container: created `IM:398`, mounted as
  `documentContainer` child #2 `IM:402`, populated in `showLoadedResources` (`IM:1306–1465`):
  `[Context]` `IM:1372`, `[Skills]` `IM:1382`, `[Prompts]` `IM:1399`, `[Extensions]` `IM:1408`,
  `[Themes]` `IM:1423`. Each section is an `ExpandableText` (`IM:1323`) with
  `getStartupExpansionState` (`IM:1045`), and the collapsed hint is `IM:752`.
- No `ExtensionUIContext` method references `loadedResourcesContainer`; the only mentions are
  internal (`IM:398,402,1308,1324,1367,1600,…`). So `setHeader` styles the logo but **not** the
  `[Context]/[Skills]/[Extensions]` blocks — the reported gap. Needs the new seam in
  Reachability §1. The installed build confirms these render stock in the crash log
  (`/home/roni/.pi/agent/pi-tui-crash.log:14–24`).

### 4. Width crash — "Rendered line N exceeds terminal width" (being fixed separately)

Crash log (definitive): `/home/roni/.pi/agent/pi-tui-crash.log`

- Line 2: `Terminal width: 377`; Line 3: `Line 48 visible width: 378`.
- Line 54 is the offending rendered line, an assistant card body line containing
  `System operational. ✅` (U+2705 WHITE HEAVY CHECK MARK), painted with our `PAL.agent`
  background (`48;2;58;55;42`).
- Fatal throw site: `TUI/tui-main-screen.js:468–492`, message at `:485`
  (`Rendered line ${i} exceeds terminal width (...)`); it also writes the crash log
  (`:470–481`).
- Our measurer: `extensions/ui/ui-kit.ts:48–72`. `isWide` covers `U+1F300–U+1FAFF` and
  `U+1F900–U+1F9FF` (`ui-kit.ts:61–62`) plus CJK ranges, but **not** `U+2600–U+27BF`
  (Misc Symbols / Dingbats, which includes U+2705). `charWidth` therefore returns **1** for
  `✅`.
- pi-tui's measurer: `TUI/utils.js:144–159` (`graphemeWidth`), which returns **2** for any
  RGI emoji via `rgiEmojiRegex` (`:157–158`). So `cardLine` (`ui-kit.ts:181–184`) pads one cell
  too many and the emitted line is 378 cells under pi-tui's ruler while `truncateAnsi`
  (`ui-kit.ts:199–243`) believed it was 377.
- Test blind spot: `tests/ui-widechars.test.ts:50` uses only `U+1F300+` emoji; there is no
  dingbat/misc-symbol sample, so the independent-width harness never catches U+2705.
- **Status:** being fixed separately. An **uncommitted working-tree change** to
  `extensions/ui/ui-kit.ts` is present at the time of writing (20 lines added, 106 removed): it
  drops the local `isZeroWidth`/`isWide`/`charWidth` width model, imports pi-tui's
  `visibleWidth` and `truncateToWidth`, re-exports `visibleWidth`, and reimplements
  `truncateAnsi` as a thin wrapper over `truncateToWidth` — its own comment names U+2705 as the
  cause. That is the correct direction (measure with the exact engine pi validates against).
  This doc does not touch it and commits only itself. Remaining follow-up for that owner: add a
  U+2705 case to `tests/ui-widechars.test.ts` so the harness would have caught it.

## Explicit unknowns

- Whether the installed `0.85.1` store stays the target after the pending "active profile"
  switch (`REPORT.md:78–83` describes stock `0.81.1` as the active binary). This analysis is
  against the patched `0.85.1` store named at the top, which is the build the T7/T9 seam
  assumes.
- The exact crash-repro terminal (377 columns suggests a very wide/kitty pane); the crash log is
  the only artifact found and it does not record the emulator.
- The in-progress `ui-kit.ts` fix is uncommitted and was observed mid-edit; its final shape and
  whether it passes the width suites were not verified here.
- Selector/dialog internals were characterised by class + construction site, not line-by-line
  render review; per-selector effort is estimated, not measured.
