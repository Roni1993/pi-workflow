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
  const l2 = fg(PAL.dim, "  /ui-kit · /ui-questions · /ui-dock · /dock · /pipeline")
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
      if (typeof ui.setWorkingIndicator === "function") {
        ui.setWorkingIndicator({ frames: ["◐", "◓", "◑", "◒"] })
      }
    } catch {
      // any hook failure must never take down pi
    }
  })
}
