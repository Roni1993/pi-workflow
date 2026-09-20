# pi TUI screen & modal port inventory

Exhaustive work list for restyling every screen / modal / overlay / notable
component in the pi TUI to the opencode look. Complements
`docs/ui-gap-analysis.md` (which is surface-first, 35 rows); this doc is
**screen/modal-first** and enumerates every component in the installed build.

- Branch: `feat/ui-integration`
- Installed pi (the one on `PATH`): `0.85.1`,
  `/nix/store/ainnwsz3l1wdvv77p29pxjkzp703mx26-pi-coding-agent-ui-0.85.1`
  (all four local patches applied — `pi-ui.nix:42-45`).
- Extension under analysis: `extensions/ui/{index,selectors,chrome,resources,theme,editor,transcript,cards,tools,dock,questions}.ts`.
- Patch sources: `/home/roni/projects/fleek-pi-ui/pi-patches/`.

> The older `docs/ui-gap-analysis.md` cites a different store hash
> (`b3r85hp…`). Line numbers here are from the store above; the two builds are
> both 0.85.1 but the gap doc's line numbers are ~10-40 lines off from the
> patched tree. Where they differ, this doc uses the installed tree.

## Path aliases

| Alias | Expands to |
|---|---|
| `IM` | `<store>/lib/node_modules/pi-monorepo/dist/modes/interactive/interactive-mode.js` |
| `CMP` | `<store>/lib/node_modules/pi-monorepo/dist/modes/interactive/components/` |
| `TYPES` | `<store>/lib/node_modules/pi-monorepo/dist/core/extensions/types.d.ts` |
| `EXT` | `/home/roni/projects/pi-workflow/extensions/ui/` |
| `PATCH` | `/home/roni/projects/fleek-pi-ui/pi-patches/` |

## Status legend

- **styled** — our extension owns the render.
- **partial** — ours, but a fidelity/geometry gap.
- **stock** — pi default; hook may exist and be unused, or no hook exists.
- **broken** — currently defective for us.
- **dead** — component exists in the build but has no caller in the interactive TUI.
- **unreachable** — no extension hook; needs a patch.
- **pre-extension** — runs before extensions load; not reachable even with a seam.
- **unknown** — could not verify from the installed build.

`Centered?` means: does the surface render as an overlay centred on the
terminal, vs docked in the editor slot at the bottom. The distinction matters
because `IM:showSelector` (see Answers §2) puts every selector in
`editorContainer`.

---

## 1. Modals, selectors, dialogs, onboarding

| # | Surface | Trigger (command / key) | Where rendered (file:line) | Status | Centered? | Port path | Notes / effort |
|---|---|---|---|---|---|---|---|
| 1 | Settings selector (main) | `/settings` (`IM:2507`) | `showSettingsSelector` `IM:3955`; `SettingsSelectorComponent` `CMP/settings-selector.js:248`; `new` `IM:3961` | stock | No — `showSelector` → `editorContainer` (`IM:3950-3951`) | New settings seam, or generic `showSelector` overlay patch | 40+ items, callbacks at `IM:4001-4140`. L |
| 2 | Settings submenus (Select/Stepped) | navigate inside `/settings` | `CMP/settings-submenu.js:11,104`; item wiring `CMP/settings-selector.js:364` (Warnings) and `:374` (per-model thinking) | stock | No (nested in 1) | Same as 1 | `SteppedSubmenu` is a multi-step wizard. M |
| 3 | Theme submenu (inside settings) | `/settings` → Theme | `CMP/settings-selector.js:104` class, `:493-497` item | stock | No (nested in 1) | Same as 1 | This is the real theme UI; the standalone `ThemeSelectorComponent` is dead (row 10). M |
| 4 | Model selector | `/model` (`IM:2517`); `ctrl+l` (`CMP/keybinding-hints` default `core/keybindings.js:51`, wired `IM:2434`) | Seam `IM:4379-4413`; stock `CMP/model-selector.js:11`, `new` `IM:4414`; ours `EXT/selectors.ts:105` | **partial** — restyled but not centred | **No** — `showSelector` (`IM:3932-3954`) places it in `editorContainer` `IM:3950-3951` | Existing `setModelSelector` seam only swaps the component; add an overlay seam or patch `showSelector`. **Also serves the empty `/model` picker and `IM:4226,4244`** | The reported "modal isn't centred". M |
| 5 | Scoped-models selector | `/scoped-models` (`IM:2514`) | `showModelsSelector` `IM:4421`; `ScopedModelsSelectorComponent` `CMP/scoped-models-selector.js:63`; `new` `IM:4466` | stock | No | New seam, or generic `showSelector` overlay patch | Toggles which models are enabled; persists at `IM:4480`. L |
| 6 | Session selector | `/resume` (`IM:2631`) | `showSessionSelector` `IM:4701`; `SessionSelectorComponent` `CMP/session-selector.js:577`; `new` `IM:4703` | stock | No | New seam / overlay patch | Loads sessions, delete/rename keys. L |
| 7 | Session search (embedded) | typed into 6 | `CMP/session-selector-search.js:16` (`parseSearchQuery`), `:122` (`filterAndSortSessions`) | stock | n/a | Part of 6 | Regex mode `re:`, quoted phrases, name filter. S (inside 6) |
| 8 | Tree selector | `/tree` (`IM:2579`); double-escape action (`IM:2580`); `app.session.tree` (`IM:2442`) | `showTreeSelector` `IM:4582`; `TreeSelectorComponent` `CMP/tree-selector.js:1167`; `new` `IM:4591` | stock | No | New seam / overlay patch | Tree paging, filter, branch-summary prompt (`IM:4606-4618`). L |
| 9 | User-message selector (fork) | `/fork` (`IM:2569`); `app.session.fork` (`IM:2443,2570`) | `showUserMessageSelector` `IM:4534`; `UserMessageSelectorComponent` `CMP/user-message-selector.js:86`; `new` `IM:4542` | stock | No | New seam / overlay patch | L |
| 10 | Standalone theme selector | **none in TUI** | `CMP/theme-selector.js:11`; exported `CMP/index.js:27` only | **dead** | n/a | Abandon | No importer besides the barrel export (`grep`). Theme now lives in 3. |
| 11 | Standalone show-images selector | **none in TUI** | `CMP/show-images-selector.js:11`; exported `CMP/index.js:25` only | **dead** | n/a | Abandon | Show-images is an inline Settings item (`IM:3966`, `CMP/settings-selector.js`). |
| 12 | Config selector | `pi config` CLI | `cli/config-selector.js:15`; `ConfigSelectorComponent` `CMP/config-selector.js:710` | stock / **pre-extension** | unknown | opentui-only (CLI path, no extension host) | Runs as a separate CLI UI (`package-manager-cli.js`), not through `InteractiveMode`. L, low value |
| 13 | Login dialog | `/login` (`IM:2589` → `handleLoginCommand`) | `showLoginDialog` `IM:5167`; `LoginDialogComponent` `CMP/login-dialog.js:9`; shown `IM:5169-5172` | stock | No — `editorContainer` `IM:5169-5171` | New seam / overlay patch | Manual code/URL entry `CMP/login-dialog.js:105`. M |
| 14 | OAuth provider selector | `/login` / `/logout` (`IM:2595`) | `showOAuthSelector` `IM:4919`; `OAuthSelectorComponent` `CMP/oauth-selector.js:10`; `new` `IM:4900,4937` | stock | No | New seam / overlay patch | Has search input `CMP/oauth-selector.js:54`. L |
| 15 | Login auth-type selector | inside `/login` | `showLoginAuthTypeSelector` `IM:4840`; uses `ExtensionSelectorComponent` `CMP/extension-selector.js:10`; `new` `IM:4870` | stock | No (`showSelector` `IM:4869`) | Shared extension-selector restyle, or seam | OAuth vs API-key choice. M |
| 16 | Login provider selector (search) | inside `/login` | `showLoginProviderSelector` `IM:4888`; `OAuthSelectorComponent` `new` `IM:4900` | stock | No (`showSelector` `IM:4899`) | Same as 14 | M |
| 17 | Trust selector | `/trust` (`IM:2584`) | `showTrustSelector` `IM:4337`; `TrustSelectorComponent` `CMP/trust-selector.js:16`; `new` `IM:4342` | stock | No | New seam / overlay patch | Also decides package/`.pi` resources. M |
| 18 | First-time setup | first run, no settings (`main.js:519-520`) | `showFirstTimeSetup` `cli/startup-ui.js:125`; `FirstTimeSetupComponent` `CMP/first-time-setup.js:16`; added `cli/startup-ui.js:151` | stock / **pre-extension** | unknown — root `ui.addChild(component)` (`startup-ui.js:151`), not `showSelector` | opentui-only / separate patch | 2 steps (theme, analytics). Runs before extensions load, so a seam cannot see it. M |
| 19 | Extension select (`ctx.ui.select`) | extension call | `TYPES:70`; `showExtensionSelector` `IM:2093`; `ExtensionSelectorComponent` `CMP/extension-selector.js:10`; `new` `IM:2104` | stock (reachable by any extension) | No — `editorContainer.clear/addChild` `IM:2114-2115` | Theme restyles it; structural restyle shares the `ExtensionSelectorComponent` path | Also used by `/ui-questions` fallbacks. M |
| 20 | Extension confirm (`ctx.ui.confirm`) | extension call | `TYPES:72`; `showExtensionConfirm` `IM:2135` (delegates to 19) | stock | No | Same as 19 | S |
| 21 | Extension input (`ctx.ui.input`) | extension call | `TYPES:74`; `showExtensionInput` `IM:2145`; `ExtensionInputComponent` `CMP/extension-input.js:9`; `new` `IM:2156` | stock | No | Theme / shared dialog seam | Has countdown (`CMP/extension-input.js:36`). M |
| 22 | Extension editor (`ctx.ui.editor`) | extension call | `TYPES:168`; `showExtensionEditor` `IM:2186`; `ExtensionEditorComponent` `CMP/extension-editor.js:10`; `new` `IM:2188` | stock | No | Theme / shared dialog seam | Prefilled multi-line edit. M |
| 23 | Questions modal (**ours**) | `/ui-questions`; pipeline grill (`EXT/pipeline.ts`) | `EXT/questions.ts:408`; overlay options `:395-399`; backdrop `:81` | **styled** | **Yes** — `anchor: "center"` (`questions.ts:396`) + `backdrop: 0.5` (`:81`) | Done (needs T9 backdrop patch) | The only correctly-centred modal today. Reference for the others. — |
| 24 | `/ui-kit` sample overlay (**ours**) | `/ui-kit` | `EXT/index.ts:43-46` | **styled** | unknown — `{overlay:true}` with no `overlayOptions` (`index.ts:45`) | n/a | Uses pi-tui's default overlay anchor; not verified on-screen. S |
| 25 | Generic custom overlay (`ctx.ui.custom`) | extension call | `TYPES:150-160`; `showExtensionCustom` `IM:2298`; overlay branch `IM:2336-2346` | stock primitive | Yes when `overlayOptions.anchor:"center"` is passed | Already available | This is the only path with real overlay geometry + backdrop. — |
| 26 | Bordered loader (share / gist) | `/share`; gist share | `session-share.js:84` (Radius), `:131` (gist); `BorderedLoader` `CMP/bordered-loader.js:5` | stock | No — `editorContainer` `session-share.js:85-87,132-134` | Theme only; structural needs a seam | Exported from `dist/index.d.ts:28`, so an extension can *reuse* it but not replace pi's use. M |

---

## 2. Inline transcript, editor, chrome, and runtime components

| # | Surface | Trigger (command / key) | Where rendered (file:line) | Status | Centered? | Port path | Notes / effort |
|---|---|---|---|---|---|---|---|
| 27 | Startup banner + tagline + hint | session start | `IM:754` (`builtInHeader`), `IM:773-774`; setter `IM:1957`, ui-context `IM:2050`; ours `EXT/chrome.ts:76` | **styled** | n/a | Done (`setHeader`) | `renderHeader` `chrome.ts:14-20`. |
| 28 | Footer / status line | always | `CMP/footer.js:47`; container `IM:440-441`; setter `IM:1912`, ui-context `IM:2049`; ours `EXT/chrome.ts:77-81` | **styled** | n/a | Done (`setFooter`) | `renderFooter` `chrome.ts:27-33`. |
| 29 | Loaded-resources block `[Context]/[Skills]/[Prompts]/[Extensions]/[Themes]` | session start / rebind | `showLoadedResources` `IM:1323-1503`; container `IM:415,419`; sections `IM:1415,1425,1442,1451,1466`; seam `IM:1339-1364`; ours `EXT/resources.ts:73` | **styled** | n/a | Done (`setLoadedResources`, patched) | Section cards `resources.ts:29-44`. Diagnostics blocks `IM:1473-1503` are **not** intercepted. **Verified (T11):** the seam hooks only `addLoadedSection` (`IM:1339-1368`); the four diagnostics blocks bypass it via `this.loadedResourcesContainer.addChild(new Text(...))` at `IM:1473/1479/1496/1502` (stock `:1363/1369/1386/1392`), so `setLoadedResources` is never consulted for them. Widening needs a seam change in `fleek-pi-ui`, not the extension. `renderResourceSection` already styles a diagnostics-shaped name safely. |
| 30 | User turn card | each user message | seam `IM:3111-3128`; ours `EXT/transcript.ts:301`; stock `CMP/user-message.js:10` | **styled** | n/a | Done (`registerMessageRenderer("user")`, T7 seam) | — |
| 31 | Assistant text card | each assistant message (+ streaming) | seam static `IM:3157-3167`, live `IM:2756-2759`; ours `EXT/transcript.ts:310`; stock `CMP/assistant-message.js:10` | **partial** | n/a | Extend `transcript.ts` markdown rendering | Gap doc item 15: no code fences/tables when using our card; verify against current `transcript.ts`. M |
| 32 | Thinking blocks | within assistant turn | stock `CMP/assistant-message.js`; ours `EXT/transcript.ts` | **partial** | n/a | `setHiddenThinkingLabel` (`TYPES:95`) for stock; ours ignores it | `setHiddenThinkingLabel` **unused** by `EXT`. S |
| 33 | Tool call + result card | each tool call | stock `CMP/tool-execution.js:7`; ours `EXT/tools.ts:264-300` (`renderShell:"self"`) | **partial** | n/a | `registerTool` (already used) | Open/close uses "recent 3" heuristic (`tools.ts:57-74`); see `tools.ts:11-19`. M |
| 34 | Custom message cards | `/bg`, pipeline, jj, goal | `EXT/cards.ts:107`; stock `CMP/custom-message.js:7` | **styled** | n/a | Done (`registerMessageRenderer(customType)`) | — |
| 35 | Custom durable entries | extension entries | `EXT/cards.ts:111`; stock `CMP/custom-entry.js:7` | **styled** | n/a | Done (`registerEntryRenderer`) | — |
| 36 | Skill invocation message | sending a skill | stock `SkillInvocationMessageComponent` `CMP/skill-invocation-message.js:9`, `new` `IM:3137`; bypassed by seam | **broken/partial** | n/a | Extend T7 seam to a `"skill"` role, else drop the `"user"` renderer | When a `"user"` renderer is registered the seam returns at `IM:3126`, so `parseSkillBlock` `IM:3134` never runs. See `PATCH/transcript-seam.md:232-235`. M |
| 37 | Compaction summary | auto/`/compact` | stock `CMP/compaction-summary-message.js:8`, `new` `IM:3099` | **stock / unreachable** | n/a | Extend T7 seam with `"compactionSummary"` lookup | ~10 lines; `runner.getMessageRenderer` accepts any key (`PATCH/transcript-seam.md:89-94`). **Verified (T11):** registry half works, but the installed seam's `case "compactionSummary"` builds the stock component directly (`IM:3097-3103`; stock `:2934-2940`) and never calls `createBuiltinMessageComponent`. Renderer is registered in `EXT/transcript.ts` (key `"compactionSummary"`) and is inert until the call site is patched. S |
| 38 | Branch summary | `/tree` summarise | stock `CMP/branch-summary-message.js:8`, `new` `IM:3106` | **stock / unreachable** | n/a | Extend T7 seam with `"branchSummary"` lookup | Same shape as 37. **Verified (T11):** `IM:3104-3110` (stock `:2941-2947`) bypasses the helper too. S |
| 39 | Bash execution (`!` / `!!`) | `!cmd`, `!!cmd` | stock `BashExecutionComponent` `CMP/bash-execution.js:13`; replay `IM:3080`, live `IM:5691,5712` | **stock / unreachable** | n/a | New seam or theme | Not the `bash` tool (33); this is the interactive shell. `user_bash` event (`TYPES:974`) fires but has no renderer. M |
| 40 | Notifications / status toasts | `ctx.ui.notify`; internal errors | `showExtensionNotify` `IM:2286`; `showStatus` `IM:3022`; `showError` `IM:3710`; `showWarning` `IM:3715` | **stock** | n/a | Theme first; seam later | `ctx.ui.notify` (`TYPES:76`) lets *us* emit, but pi's own toasts are internal. M |
| 41 | Pending-message queue ("Steering:"/"Follow-up:") | queue while streaming | `updatePendingMessagesDisplay` `IM:3788-3802`; container `IM:421,706,720` | **stock / unreachable** | n/a | New seam or theme | Hardcoded `theme.fg("dim", …)`; theme can recolour only. M |
| 42 | Working indicator / spinner | streaming | `CMP/status-indicator.js:5,15`; `IM:1742-1786`; hook `setWorkingIndicator` `TYPES:93`, ui-context `IM:2046`; ours `EXT/chrome.ts:83-84` | **partial** | n/a | Hook exists; frames only so far | `setWorkingMessage`/`setWorkingVisible`/`setHiddenThinkingLabel` still unused. **T11:** `setWorkingMessage` + `setHiddenThinkingLabel` now called (guarded) from `applyWorkingHooks` (`chrome.ts`); `setWorkingVisible` deliberately left at pi's default (hiding the loader is not the opencode look). Live capture: `◓ Working...` rendered. S |
| 43 | Editor / chat window | always | `editorContainer` `IM:435-436`; `CustomEditor` `CMP/custom-editor.js:5`; hook `setEditorComponent` `TYPES:204`, ui-context `IM:2061`; ours `EXT/editor.ts:56` **but unwired** | **stock** | n/a | Re-wire `registerEditor` only with cursor-aware rebuild, or opentui-RPC | Unwired deliberately: `EXT/index.ts:60-62`, commit `5c8b6d9`. Our `frameEditorLines` `editor.ts:22-33` broke the box/cursor. **L** |
| 44 | Widgets above/below editor | `/dock on` | hook `setWidget` `TYPES:97-100`; container `IM:?`; ours `EXT/dock.ts:483` (`belowEditor`), preview `dock.ts:429` | **partial** (below only) | n/a | Already used | `dock.ts:478,483` toggles/installs. aboveEditor unused. S |
| 45 | Background-agent dock card | `/dock on`, `/ui-dock` | `EXT/dock.ts:429,483` | **styled** | n/a (widget) | Done | — |
| 46 | Diff rendering | edit tool result | `renderDiff` `CMP/diff.js:70`; used `core/tools/renderers/edit.js:71,94`; ours `EXT/tools.ts:110-144,216-220` | **partial** | n/a | Ours re-renders the unified diff in the tool card | Our `unifiedDiffLines`/`splitDiffLines` (`tools.ts:88,110`) replace pi's `renderDiff`; fidelity gap vs opencode. M |
| 47 | Image rendering | read/tool image blocks | `Image` import `CMP/tool-execution.js:1`; conversion `:135-164` | **partial / unknown** | n/a | Our tool renderer does not reference images (`grep` `tools.ts` → none) | Likely dropped when `tools.ts` re-registers; verify with a real image result. M |
| 48 | Mermaid diagrams | mermaid code fence | `createMermaidMarkdownTransformer` `CMP/mermaid.js:46`; wired `IM:331`, used `IM:1662-1663` | **stock** | n/a | Theme + `registerMarkdownTransformer` (`TYPES:1000`), currently unused | Setting lives at `CMP/settings-selector.js:304-309`. M |
| 49 | Markdown transform pipeline | assistant/user markdown | `CMP/markdown-transform.js:1-4`; `getMarkdownTransformers` `IM:1662`; hook `TYPES:1000` | **stock / unreachable-for-ours** | n/a | `registerMarkdownTransformer` unused by `EXT` | Our cards bypass pi's markdown path; relevant only if we render through `AssistantMessageComponent`. M |
| 50 | Terminal title / tab | session events | `updateTerminalTitle`; hook `setTitle` `TYPES:148`, ui-context `IM:2051` | **stock** | n/a | `setTitle` unused by `EXT` | S |

---

## 3. Easter eggs

| # | Surface | Trigger | Where rendered (file:line) | Status | Centered? | Port path | Notes / effort |
|---|---|---|---|---|---|---|---|
| 51 | Armin | `/arminsayshi` (`IM:2621`) | `handleArminSaysHi` `IM:5658`; `ArminComponent` `CMP/armin.js:53`; `new` `IM:5660` | stock | n/a | Unreachable (chat-only) | — |
| 52 | Earendil announcement ("demented elves") | `/dementedelves` (`IM:2626`) | `handleDementedDelves` `IM:5663`; `EarendilAnnouncementComponent` `CMP/earendil-announcement.js:23`; `new` `IM:5665` | stock | n/a | Unreachable | — |
| 53 | Daxnuts | model-select easter egg | `checkDaxnutsEasterEgg` `IM:5673`; `DaxnutsComponent` `CMP/daxnuts.js:46`; `new` `IM:5670`; called `IM:4237,4370,5007` | stock | n/a | Unreachable | Fires on model change. |

---

## 4. Support components (no user-facing surface of their own)

These ship in `CMP/` and are grouped here so the enumeration is complete. They
are building blocks for the surfaces above.

| Component | File:line | Role | Port implication |
|---|---|---|---|
| `DynamicBorder` | `CMP/dynamic-border.js:9` | top/bottom rules on every stock selector/dialog | Theme-recolourable only |
| `CountdownTimer` | `CMP/countdown-timer.js:4` | timeout label in extension input/selector, retry | Theme only |
| `keybinding-hints` | `CMP/keybinding-hints.js` (`keyHint`/`keyText`/`rawKeyHint`) | key legends inside selectors | Not used by `EXT`; theme-only |
| `visual-truncate` | `CMP/visual-truncate.js` (`truncateToVisualLines`) | truncation helper | n/a |
| `markdown-transform` | `CMP/markdown-transform.js:1` | transformer pipeline | See row 49 |
| `custom-editor` | `CMP/custom-editor.js:5` | base class for `setEditorComponent` | See row 43 |
| `footer` | `CMP/footer.js:47` | footer component (replaced by us) | See row 28 |
| `index` | `CMP/index.js` | barrel export | n/a |
| `extension-selector/input/editor` | `CMP/extension-selector.js:10`, `extension-input.js:9`, `extension-editor.js:10` | extension dialogs | See rows 19-22 |
| `settings-submenu` | `CMP/settings-submenu.js:11,104` | submenu containers | See row 2 |
| `session-selector-search` | `CMP/session-selector-search.js:16,122` | session filtering | See row 7 |
| `diff` / `mermaid` / `markdown-transform` | see rows 46,48,49 | rendering | — |

Not present as a discrete component: **image**. pi-tui's `Image` is used inside
`CMP/tool-execution.js:1,135-164`; there is no `image.js` in `CMP/`.

---

## Answers

### A. Reachability from an extension today

**Reachable now — hook exists in stock pi and our extension either uses it or
could (no patch):**

| Surface | Hook | Declared | Impl (patched IM) | Used by |
|---|---|---|---|---|
| Header/banner | `setHeader` | `TYPES:126` | `IM:1957`, ctx `IM:2050` | `EXT/chrome.ts:76` |
| Footer | `setFooter` | `TYPES:107` | `IM:1912`, ctx `IM:2049` | `EXT/chrome.ts:77` |
| Working indicator | `setWorkingIndicator` / `setWorkingMessage` / `setWorkingVisible` | `TYPES:93,82,84` | `IM:1785,2040,2045` | frames + message + hidden-thinking label (`chrome.ts`); `setWorkingVisible` unused |
| Hidden thinking label | `setHiddenThinkingLabel` | `TYPES:95` | `IM:2047` | used (`chrome.ts`), `"Thinking"` |
| Status text | `setStatus` | `TYPES:80` | ctx `IM:2035` | **unused** |
| Tools expanded | `get/setToolsExpanded` | `TYPES:222,224` | ctx `IM:2064` | **unused** |
| Editor | `setEditorComponent` | `TYPES:204` | `IM:2061` | `EXT/editor.ts:56` exists, **unwired** (`index.ts:60`) |
| Widgets | `setWidget` | `TYPES:97-100` | ctx `IM:2037` | `EXT/dock.ts:483` |
| Theme | `getTheme`/`setTheme`/`getAllThemes` | `TYPES:210-220` | ctx `IM:2067+` | `EXT/theme.ts:51` |
| Transcript turns | `registerMessageRenderer` | `TYPES:998` | seam `IM:2756,3058,3112,3158` | `EXT/transcript.ts:301,310` |
| Custom messages/entries | `registerMessageRenderer`/`registerEntryRenderer` | `TYPES:998,1002` | `IM:3044+` | `EXT/cards.ts:107,111` |
| Markdown transformer | `registerMarkdownTransformer` | `TYPES:1000` | `IM:1663` | **unused** |
| Tools | `registerTool` | see `types.d.ts` | — | `EXT/tools.ts:264` |
| Overlay/dialogs | `ctx.ui.custom/select/confirm/input/editor/notify` | `TYPES:150,70,72,74,168,76` | `IM:2298,2093,2135,2145,2186,2286` | `EXT/questions.ts:408`, `dock.ts` |
| Terminal title | `setTitle` | `TYPES:148` | ctx `IM:2051` | **unused** |

**Needs a new patch (hook absent):** rows 1-2 (settings + submenus), 5 (scoped
models), 6-7 (session + search), 8 (tree), 9 (user-message), 13-16
(login/oauth), 17 (trust), 37-38 (compaction/branch), 39 (bash execution), 40
(internal notifications), 41 (pending queue). Model selector (row 4) already has
a patch, but it is **component-level only** — centering needs more (see B).

**Effectively opentui-only / not reachable through the extension host:**

- **First-time setup** (row 18) — runs in `cli/startup-ui.js:125` before
  `InteractiveMode`/extensions exist.
- **Config selector** (row 12) — separate `pi config` CLI (`cli/config-selector.js:15`).
- **Dead exported selectors** (rows 10-11) — no caller in `InteractiveMode`; only
  the barrel `CMP/index.js` references them.

### B. Why the model modal cannot be centred with the current seam

The `setModelSelector` seam (`PATCH/model-selector-seam.mjs`) changes **which
component** renders, not **where** it renders.

1. `showModelSelector` wraps its body in `showSelector`:
   `IM:4359-4360` (`this.showSelector((done) => {`).
2. `showSelector` has no overlay concept. On creation it does:
   `this.editorContainer.clear(); this.editorContainer.addChild(created.component);`
   and focuses it (`IM:3950-3952`). `editorContainer` is the editor slot
   (`IM:435-436`), i.e. the bottom of the chat, not a centred overlay.
3. The seam returns `{ component, focus, dispose }` (`model-selector-seam.mjs:79-84`,
   patched at `IM:4405-4410`) and `showSelector` consumes only
   `created.component`/`created.focus`/`created.dispose`. There is **no field**
   for an anchor, overlay options, width, or backdrop, and no call to
   `ui.showOverlay`.
4. Real overlay geometry lives in the *other* path: `ctx.ui.custom` with
   `overlay:true` + `overlayOptions` → `showExtensionCustom` `IM:2298` →
   `this.ui.showOverlay(component, resolveOptions())` `IM:2346`. That is how our
   questions modal gets `anchor:"center"` + `backdrop` (`questions.ts:395-399`).
   `setModelSelector` never reaches it.

So centering requires one of:

- **(lazy, broadest)** patch `showSelector` (`IM:3932-3954`) to render through
  `ui.showOverlay(component, { anchor: "center", … })` instead of
  `editorContainer`. One edit centres and dims **every** `showSelector` surface
  (rows 1,2,4,5,6,8,9,13-17,19) at once. Risk: focus/dispose/restore semantics
  (`IM:3935-3952`) and selectors that intentionally occupy the editor slot.
- **(narrow)** change the model seam + `showModelSelector` to show an overlay;
  repeats for every other selector.
- **(extension-only)** stop using the seam; have the extension's own command
  render a centred `ctx.ui.custom` overlay. Does not fix `/model` or `ctrl+l`.

### C. Ranked grouping

**Port now (high daily impact, cheap or already partly done)**

1. **Generic `showSelector` overlay patch** — centres + dims rows 1,2,4,5,6,8,9,13-17,19 in one edit. Biggest visual win; fixes the reported off-centre modal.
2. **Re-wire editor, cursor-safe** (row 43) — highest always-visible surface; currently deliberately unwired (`index.ts:60`).
3. **Loaded-resources diagnostics** (row 29 remainder) — **verified not coverable by the existing seam**: the four diagnostics blocks bypass `addLoadedSection` (`IM:1473/1479/1496/1502`). Needs a seam widening in `fleek-pi-ui`; not an extension change.
4. **Compaction + branch summaries** (rows 37-38) — **verified the T7 seam's installed call sites don't consult the helper** (`IM:3097-3110`). Renderer half done in `EXT/transcript.ts` (keys `"compactionSummary"`/`"branchSummary"`), inert until the call sites are patched.
5. **Working indicator full hook** (row 42) — done: `setWorkingMessage` + `setHiddenThinkingLabel` in `chrome.ts`; live-captured.

**Port later (medium impact / medium cost)**

6. Bash execution styling (row 39).
7. Skill invocation seam (row 36).
8. Notifications + pending queue (rows 40-41).
9. Assistant markdown fidelity, thinking, tool open/close (rows 31-33).
10. Diff/image fidelity inside our tool cards (rows 46-47).
11. Mermaid via `registerMarkdownTransformer` (row 48).
12. Trust / login / OAuth selectors (rows 13-17) if the generic overlay patch lands, only colour remains.

**Abandon / opentui-only**

13. Standalone theme + show-images components (rows 10-11) — dead, superseded by settings.
14. First-time setup (row 18) and config selector (row 12) — pre-extension or separate CLI; not worth a patch.
15. Terminal title (row 50) — trivial but cosmetic; only if asked.

## Explicit unknowns

- Actual on-screen centering of `/ui-kit` (row 24) and first-time setup
  (row 18) was not observed headlessly.
- Whether our `tools.ts` drops image results (row 47); no image result was run.
- Exact current `transcript.ts` markdown fidelity (row 31) was inferred from
  `docs/ui-gap-analysis.md:48`, not re-rendered.
- `showSelector` → overlay patch (Answer B, "broadest") was not prototyped;
  focus/restore behaviour under `showOverlay` is unverified.
