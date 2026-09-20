// Loaded-resources styling: [Context]/[Skills]/[Prompts]/[Extensions]/[Themes].
// Consumes the pi-ui `setLoadedResources` seam (patched pi only). On stock pi
// the hook is absent, so this no-ops and pi keeps its stock sections.
//
// Diagnostics (`[Skill conflicts]`, `[Prompt conflicts]`, `[Extension issues]`,
// `[Theme conflicts]`) are NOT routed through the seam. The seam (`pi-ui:loaded-
// resources-seam`) intercepts only `addLoadedSection` (installed
// `interactive-mode.js:1339-1368`; stock 0.85.1 `:1255-1259`). The diagnostics
// bypass it: `showLoadedResources` calls
// `this.loadedResourcesContainer.addChild(new Text(\`${theme.fg("warning", …)}…\`))`
// directly for each of the four blocks (installed `:1473,1479,1496,1502`; stock
// `:1363,1369,1386,1392`). The `setLoadedResources` factory is therefore never
// consulted for them, so they stay stock. Widening the seam to cover them needs
// a patch change in fleek-pi-ui — out of scope for this extension module (see
// the report). `renderResourceSection` already handles a diagnostics-shaped
// name (hue falls back to primary), so no extension change is needed if that
// seam is later widened.
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent"
import type { Component } from "@earendil-works/pi-tui"
import { M, PAL, type Pair, bold, card, fg, tinted, truncateAnsi, wrap } from "./ui-kit"

export interface LoadedSection {
  name: string
  header: string
  collapsedBody: string
  expandedBody: string
  color: string
  expanded: boolean
}

/** Section name -> matugen hue (falls back to primary). */
const HUE: Record<string, string> = {
  Context: M.primary,
  Skills: M.tertiary,
  Prompts: M.secondary,
  Extensions: M.cyan,
  Themes: M.magenta,
}

const ANSI = /\x1b\[[0-9;]*m/g

/** Pure renderer: a tinted rail card per section, body wrapped + width-guarded. */
export function renderResourceSection(section: LoadedSection, width: number): string[] {
  const w = Math.max(0, Math.floor(width))
  if (w <= 0) return [""]
  const hue = HUE[section.name] ?? M.primary
  const pair: Pair = { rail: hue, bg: tinted(hue) }
  const marker = section.expanded ? "▾" : "▸"
  const content = [fg(hue, `${marker} `) + fg(PAL.text, bold(section.name))]
  const body = section.expanded ? section.expandedBody : section.collapsedBody
  const inner = Math.max(4, w - 4)
  for (const raw of String(body ?? "").split("\n")) {
    const text = raw.replace(ANSI, "").trim()
    if (!text) continue
    for (const line of wrap(text, inner)) content.push(fg(PAL.dim, "  " + line))
  }
  return card(w, pair, content).map((l) => truncateAnsi(l, w))
}

/** Memoised Component wrapper; invalidate() drops the cache on width change. */
export function sectionComponent(section: LoadedSection): Component {
  let cache: { w: number; lines: string[] } | undefined
  return {
    render(width: number): string[] {
      if (cache && cache.w === width) return cache.lines
      const lines = renderResourceSection(section, width)
      cache = { w: width, lines }
      return lines
    },
    invalidate(): void {
      cache = undefined
    },
  }
}

interface SeamUI {
  setLoadedResources?: (
    factory: (section: LoadedSection, tui: unknown, theme: unknown) => Component | undefined,
  ) => void
}

export function registerResources(pi: ExtensionAPI): void {
  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    const ui = ctx?.ui as unknown as (ExtensionUIContext & SeamUI) | undefined
    if (typeof ui?.setLoadedResources !== "function") return
    try {
      ui.setLoadedResources((section) => {
        try {
          return sectionComponent(section)
        } catch {
          return undefined
        }
      })
    } catch {
      // seam unavailable — keep stock sections
    }
  })
}
