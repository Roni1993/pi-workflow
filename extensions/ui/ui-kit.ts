// Shared prototype UI kit — matugen palette, colour helpers, card primitives.
// Port of pi-opencode-ui/lib/ui-kit.ts. The one change: visibleWidth is local
// (ANSI-stripped display width) so this module is headlessly testable and
// dependency-free. Display width is what the terminal actually advances, so a
// CJK/emoji line is counted as 2 cells per glyph and the width guard cannot be
// fooled by code-point counting. Powerline PUA glyphs (U+E0B0/U+E0B2) stay at
// width 1 — the deliberate compensation the locked design needs.
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

/** Zero-width code points: combining marks, zero-width joiners/spaces, VS15/16. */
function isZeroWidth(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036f) || // combining diacritical marks
    (cp >= 0x1ab0 && cp <= 0x1aff) || // combining diacritical marks extended
    (cp >= 0x1dc0 && cp <= 0x1dff) || // combining diacritical marks supplement
    (cp >= 0x20d0 && cp <= 0x20ff) || // combining marks for symbols
    (cp >= 0xfe00 && cp <= 0xfe0f) || // variation selectors
    (cp >= 0xfe20 && cp <= 0xfe2f) || // combining half marks
    cp === 0x200b || // zero width space
    cp === 0x200c || // zero width non-joiner
    cp === 0x200d || // zero width joiner
    cp === 0xfeff // zero width no-break space
  )
}

/**
 * East Asian Wide/Fullwidth + emoji-presentation ranges (2 cells).
 * Powerline PUA (U+E0B0/U+E0B2) deliberately NOT here: they stay 1 cell.
 */
function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) || // Hangul Jamo
    (cp >= 0x2e80 && cp <= 0x303e) || // CJK radicals/Kangxi
    (cp >= 0x3041 && cp <= 0x33ff) || // Hiragana..CJK compat
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK unified
    (cp >= 0xa000 && cp <= 0xa4cf) || // Yi
    (cp >= 0xac00 && cp <= 0xd7a3) || // Hangul syllables
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK compat ideographs
    (cp >= 0xfe30 && cp <= 0xfe4f) || // CJK compat forms
    (cp >= 0xff00 && cp <= 0xff60) || // fullwidth forms
    (cp >= 0xffe0 && cp <= 0xffe6) || // fullwidth signs
    (cp >= 0x1f300 && cp <= 0x1faff) || // emoji & pictographs (+ supplemental)
    (cp >= 0x1f900 && cp <= 0x1f9ff) || // supplemental symbols & pictographs
    (cp >= 0x20000 && cp <= 0x3fffd) // CJK ext B..F
  )
}

/** Display width of ONE code point, in terminal cells. */
export function charWidth(cp: number): number {
  if (isZeroWidth(cp)) return 0
  if (isWide(cp)) return 2
  return 1
}

/** Visible cell width: strip ANSI SGR sequences, then sum per-code-point widths. */
export function visibleWidth(s: string): number {
  let total = 0
  for (const ch of s.replace(/\x1b\[[0-9;]*m/g, "")) total += charWidth(ch.codePointAt(0)!)
  return total
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
 * ANSI-aware truncate to `width` visible columns, counted by display width (CJK
 * and emoji are 2 cells, combining marks 0; Powerline PUA stays 1). A wide glyph
 * is never split and a line never ends on half of one. Always ends in RESET.
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
  let stopped = false
  const push = (text: string) => {
    if (!text || stopped || col >= width) return
    let take = ""
    for (const ch of text) {
      const w = charWidth(ch.codePointAt(0)!)
      if (col + w > width) {
        stopped = true // never emit a glyph that would overflow, nor skip past it
        break
      }
      take += ch
      col += w
    }
    if (take) out += style() + take
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
    if (stopped || col >= width) break
  }
  if (!stopped && col < width) push(line.slice(last))
  return out + "\x1b[0m"
}
