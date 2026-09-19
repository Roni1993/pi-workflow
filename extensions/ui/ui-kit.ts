// Shared prototype UI kit — matugen palette, colour helpers, card primitives.
// Port of pi-opencode-ui/lib/ui-kit.ts. The one change: visibleWidth is local
// (ANSI-stripped code-point count) so this module is headlessly testable and
// dependency-free. Code-point counting also gives the Powerline PUA glyphs the
// width-1 compensation the locked design needs.
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

export const FALLBACK = {
  primary: "#73d5e2",
  secondary: "#f3b7bc",
  tertiary: "#e4c277",
  outline: "#a08b96",
  surface_container: "#261d22",
  on_surface: "#efdee6",
  on_surface_variant: "#d8c0cc",
  red: "#c18367",
  green: "#5aa071",
  blue: "#7294c5",
  magenta: "#b780b7",
  cyan: "#629ba7",
}
export type Role = keyof typeof FALLBACK

/** Visible cell width: strip ANSI SGR sequences, then count code points. */
export function visibleWidth(s: string): number {
  return [...s.replace(/\x1b\[[0-9;]*m/g, "")].length
}

export function loadMatugen(): Record<Role, string> {
  const out = { ...FALLBACK } as Record<Role, string>
  // Deterministic builds (mock/goldens) pin the palette instead of reading the
  // live matugen scheme.
  if (process.env.PI_UI_PALETTE === "fallback") return out
  try {
    const raw = JSON.parse(readFileSync(join(homedir(), ".cache", "matugen", "scheme.json"), "utf8"))
    const c = raw?.colors ?? {}
    for (const role of Object.keys(FALLBACK) as Role[]) {
      const v = c[role]?.dark?.color ?? c[role]?.default?.color
      if (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v)) out[role] = v
    }
  } catch {
    // no matugen output — use the last-known scheme
  }
  return out
}

export const M = loadMatugen()

export function rgb(hex: string): [number, number, number] {
  return [Number.parseInt(hex.slice(1, 3), 16), Number.parseInt(hex.slice(3, 5), 16), Number.parseInt(hex.slice(5, 7), 16)]
}
export function hexOf(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((x) => Math.max(0, Math.min(255, Math.round(x))).toString(16).padStart(2, "0")).join("")}`
}
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  return hexOf(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}
export function lighten(hex: string, pct: number): string {
  const [r, g, b] = rgb(hex)
  const f = (c: number) => c + (255 - c) * pct
  return hexOf(f(r), f(g), f(b))
}

export interface Pair {
  rail: string
  bg: string
}

export const TINT = 0.14

/** Subtle tinted panel: neutral surface with a hint of the role hue. */
export function tinted(role: string, amount = TINT, lift = 0): string {
  return lighten(mix(M.surface_container, role, amount), lift)
}

export type AgentState = "running" | "queued" | "done" | "blocked"

export const PAL = {
  me: { rail: M.primary, bg: tinted(M.primary) } as Pair,
  agent: { rail: M.secondary, bg: tinted(M.secondary) } as Pair,
  think: { rail: M.tertiary, bg: tinted(M.tertiary, TINT + 0.06, 0.04) } as Pair,
  tools: { rail: M.outline, bg: tinted(M.outline, TINT - 0.06) } as Pair,
  icon: { bash: M.red, read: M.blue, edit: M.green, glob: M.magenta, write: M.cyan } as Record<string, string>,
  state: { running: M.primary, queued: M.tertiary, done: M.outline, blocked: M.red } as Record<AgentState, string>,
  stateGlyph: { running: "●", queued: "○", done: "✓", blocked: "✕" } as Record<AgentState, string>,
  text: M.on_surface,
  dim: M.on_surface_variant,
  ctx: M.outline,
  add: M.green,
}

export const RESET = "\x1b[0m"

export function fgOpen(hex: string): string {
  const [r, g, b] = rgb(hex)
  return `\x1b[38;2;${r};${g};${b}m`
}
export function bgOpen(hex: string): string {
  const [r, g, b] = rgb(hex)
  return `\x1b[48;2;${r};${g};${b}m`
}
/** Reset foreground only — a full reset would clear the card background. */
export function fg(hex: string, text: string): string {
  return fgOpen(hex) + text + "\x1b[39m"
}
export function bold(text: string): string {
  return `\x1b[1m${text}\x1b[22m`
}

export function wrap(text: string, width: number): string[] {
  const words = text.split(" ")
  const out: string[] = []
  let cur = ""
  for (const w of words) {
    if (cur && cur.length + 1 + w.length > width) {
      out.push(cur)
      cur = w
    } else {
      cur = cur ? `${cur} ${w}` : w
    }
  }
  if (cur) out.push(cur)
  return out
}

/** Padded line: background spans the full width via trailing spaces. */
export function cardLine(width: number, pair: Pair, styled = ""): string {
  const pad = Math.max(0, width - 2 - visibleWidth(styled))
  return bgOpen(pair.bg) + fgOpen(pair.rail) + "▌ " + styled + " ".repeat(pad) + RESET
}

/** A card with top/bottom buffer (default min 3 lines tall). */
export function card(width: number, pair: Pair, content: string[], buffer = 1): string[] {
  const pad = Array.from({ length: buffer }, () => cardLine(width, pair))
  return [...pad, ...content.map((c) => cardLine(width, pair, c)), ...pad]
}

/**
 * ANSI-aware truncate to `width` visible columns, counted by code point (so the
 * Powerline PUA glyphs are 1 cell, matching the terminal). Always ends in RESET.
 * This is the width-safety guard: every rendered line must pass through it or
 * pi exits with "Rendered line N exceeds terminal width".
 */
export function truncateAnsi(line: string, width: number): string {
  if (width <= 0) return ""
  const re = /\x1b\[([0-9;]*)m/g
  let fg: string | null = null
  let bg: string | null = null
  let boldOn = false
  let col = 0
  let out = ""
  let last = 0
  let m: RegExpExecArray | null
  const style = () => (fg ?? "") + (bg ?? "") + (boldOn ? "\x1b[1m" : "")
  const push = (text: string) => {
    if (!text || col >= width) return
    const chars = [...text]
    const take = chars.slice(0, width - col).join("")
    out += style() + take
    col += Math.min(chars.length, width - col)
  }
  while ((m = re.exec(line))) {
    push(line.slice(last, m.index))
    last = re.lastIndex
    const codes = m[1]!.split(";").map(Number)
    for (let i = 0; i < codes.length; i++) {
      const c = codes[i]!
      if (c === 0) { fg = null; bg = null; boldOn = false }
      else if (c === 1) boldOn = true
      else if (c === 22) boldOn = false
      else if (c === 39) fg = null
      else if (c === 49) bg = null
      else if (c === 38 && codes[i + 1] === 2) { fg = `\x1b[38;2;${codes[i + 2]};${codes[i + 3]};${codes[i + 4]}m`; i += 4 }
      else if (c === 48 && codes[i + 1] === 2) { bg = `\x1b[48;2;${codes[i + 2]};${codes[i + 3]};${codes[i + 4]}m`; i += 4 }
    }
    if (col >= width) break
  }
  if (col < width) push(line.slice(last))
  return out + "\x1b[0m"
}
