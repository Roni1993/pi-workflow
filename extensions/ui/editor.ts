// The "chat window": restyles the input editor to the opencode chatbox (rail +
// tinted background) via ctx.ui.setEditorComponent. Extends pi's CustomEditor so
// all app keybindings/editing behaviour is preserved; only the framing of the
// rendered lines changes.
//
// `CustomEditor` is imported lazily so this module stays importable by the
// headless test (which bundles pi-coding-agent as external).
import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent"
import type { EditorComponent } from "@earendil-works/pi-tui"
import { M, type Pair, bgOpen, fgOpen, tinted, truncateAnsi, visibleWidth, RESET } from "./ui-kit"

const CHATBOX: Pair = { rail: M.magenta, bg: tinted(M.magenta) }

/** Pure framing: prepend the chatbox rail + background to each editor line. */
export function frameEditorLines(lines: string[], width: number): string[] {
  const w = Math.max(0, Math.floor(width))
  if (w <= 0) return [""]
  const inner = Math.max(0, w - 2)
  return lines.map((line) => {
    const body = truncateAnsi(line, inner)
    const pad = Math.max(0, inner - visibleWidth(body))
    return bgOpen(CHATBOX.bg) + fgOpen(CHATBOX.rail) + "▌ " + body + " ".repeat(pad) + RESET
  })
}

export type EditorBase = new (...args: unknown[]) => EditorComponent

/** Build the editor subclass over an injected base (pi's CustomEditor). */
export function makeOpenCodeEditor(Base: EditorBase): EditorBase {
  return class OpenCodeEditor extends (Base as unknown as new (...a: unknown[]) => EditorComponent) {
    render(width: number): string[] {
      let lines: string[]
      try {
        lines = super.render(width)
      } catch {
        return [truncateAnsi("", width)]
      }
      try {
        return frameEditorLines(lines, width)
      } catch {
        return lines
      }
    }
  } as unknown as EditorBase
}

export function registerEditor(pi: ExtensionAPI): void {
  pi.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    const ui = ctx?.ui as ExtensionUIContext | undefined
    if (typeof ui?.setEditorComponent !== "function") return
    try {
      const mod = await import("@earendil-works/pi-coding-agent")
      const Base = (mod as { CustomEditor?: EditorBase }).CustomEditor
      if (!Base) return
      const Editor = makeOpenCodeEditor(Base)
      ui.setEditorComponent((tui, theme, keybindings) => new Editor(tui, theme, keybindings, {}))
    } catch {
      // editor hook unavailable or factory rejected — keep the stock editor
    }
  })
}
