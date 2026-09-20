// Chrome: opencode-look header, footer, and working indicator. Every hook here
// exists on stock pi (no patch); each is feature-detected so older pi no-ops.
import { execFileSync } from "node:child_process"
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent"
import type { Component } from "@earendil-works/pi-tui"
import { PAL, bold, fg, truncateAnsi, visibleWidth } from "./ui-kit"

export interface FooterInfo {
  cwd: string
  branch?: string
  model?: string
}

export function renderHeader(width: number): string[] {
  const w = Math.max(0, Math.floor(width))
  if (w <= 0) return [""]
  const l1 = fg(PAL.me.rail, "▪ ") + fg(PAL.text, bold("pi")) + fg(PAL.dim, "   opencode-look")
  const l2 = fg(PAL.dim, "  escape interrupt · ctrl+o more · /ui-kit /ui-questions /ui-dock /dock /pipeline")
  return [truncateAnsi(" " + l1, w), truncateAnsi(" " + l2, w), ""]
}

function spread(width: number, left: string, right: string): string {
  const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right) - 2)
  return truncateAnsi(" " + left + " ".repeat(gap) + right, width)
}

export function renderFooter(width: number, info: FooterInfo): string[] {
  const w = Math.max(0, Math.floor(width))
  if (w <= 0) return [""]
  const left = fg(PAL.dim, info.cwd) + (info.branch ? fg(PAL.dim, "  ") + fg(PAL.me.rail, info.branch) : "")
  const right = info.model ? fg(PAL.dim, info.model) : ""
  return [spread(w, left, right)]
}

/**
 * opencode-look working state: a slow, terminal-independent spinner plus an
 * honest label. `setWorkingIndicator` frames are rendered verbatim by pi, so the
 * glyph is styled here with the palette; `setWorkingMessage` and
 * `setHiddenThinkingLabel` are separate hooks (0.85.1 `TYPES:82,95`) and are
 * feature-detected so stock/older pi no-ops.
 */
export const WORKING_FRAMES = ["◐", "◓", "◑", "◒"].map((f) => fg(PAL.me.rail, f))
export const WORKING_MESSAGE = "Working..."
export const HIDDEN_THINKING_LABEL = "Thinking"

export function applyWorkingHooks(ui: Partial<ExtensionUIContext> | undefined): void {
  if (!ui) return
  try {
    if (typeof ui.setWorkingIndicator === "function") {
      ui.setWorkingIndicator({ frames: WORKING_FRAMES, intervalMs: 120 })
    }
    if (typeof ui.setWorkingMessage === "function") ui.setWorkingMessage(WORKING_MESSAGE)
    if (typeof ui.setHiddenThinkingLabel === "function") ui.setHiddenThinkingLabel(HIDDEN_THINKING_LABEL)
  } catch {
    // stock pi / partial ui context: keep whatever pi already had
  }
}

function gitBranch(cwd: string): string | undefined {
  try {
    const out = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd,
      timeout: 1500,
      stdio: ["ignore", "pipe", "ignore"],
    })
    const s = out.toString().trim()
    return s && s !== "HEAD" ? s : undefined
  } catch {
    return undefined
  }
}

/** Memoised, throw-proof Component. */
function memoryComponent(render: (width: number) => string[]): Component & { dispose(): void } {
  let cache: { w: number; lines: string[] } | undefined
  return {
    render(width: number): string[] {
      if (cache && cache.w === width) return cache.lines
      let lines: string[]
      try {
        lines = render(width)
      } catch {
        lines = [""]
      }
      cache = { w: width, lines }
      return lines
    },
    invalidate(): void {
      cache = undefined
    },
    dispose(): void {},
  }
}

export function registerChrome(pi: ExtensionAPI): void {
  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    const ui = ctx?.ui as ExtensionUIContext | undefined
    if (!ui) return
    try {
      if (typeof ui.setHeader === "function") ui.setHeader(() => memoryComponent((w) => renderHeader(w)))
      if (typeof ui.setFooter === "function") {
        const cwd = process.cwd()
        const branch = gitBranch(cwd)
        const model = ctx?.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined
        ui.setFooter(() => memoryComponent((w) => renderFooter(w, { cwd, branch, model })))
      }
      applyWorkingHooks(ui)
    } catch {
      // any hook failure must never take down pi
    }
  })
}
