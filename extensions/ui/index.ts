// The single extension entry. pi loads `extensions/ui/index.ts` as ONE extension
// and does NOT auto-load sibling files, so every module is wired here.
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent"
import type { Component } from "@earendil-works/pi-tui"
import { registerDock } from "./dock"
import { registerQuestions } from "./questions"
import { registerTools } from "./tools"
import { registerCards } from "./cards"
import { registerTranscript } from "./transcript"
import { registerTheme } from "./theme"
import { registerChrome } from "./chrome"
import { registerResources } from "./resources"
import { registerSelectors } from "./selectors"
import { PAL, card, fg, bold, truncateAnsi } from "./ui-kit"

/** Standalone component that renders a sample card, width-guarded. */
class UiKitCard implements Component {
  constructor(private done: (v: string) => void) {}

  handleInput(data: string): void {
    if (data === "q" || data === "\x1b") this.done("closed")
  }

  invalidate(): void {}

  render(width: number): string[] {
    const w = Math.max(8, width)
    const header = fg(PAL.me.rail, bold("ui-kit")) + fg(PAL.dim, "   q close")
    const content = [
      fg(PAL.text, bold("opencode-look")),
      fg(PAL.dim, "extensions/ui · shared kit loaded"),
      fg(PAL.add, "✓ registerDock/questions/tools/cards"),
    ]
    const lines = [header, "", ...card(w - 2, PAL.me, content), "", fg(PAL.dim, "sample card — width-safe")]
    return lines.map((l) => truncateAnsi(l, w))
  }
}

function registerUiKit(pi: ExtensionAPI): void {
  pi.registerCommand("ui-kit", {
    description: "UI kit: render a sample opencode-look card overlay",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      await ctx.ui.custom<string>(
        (_tui, _theme, _keybindings, done) => new UiKitCard(done),
        { overlay: true },
      )
    },
  })
}

export default function (pi: ExtensionAPI) {
  registerDock(pi)
  registerQuestions(pi)
  registerTools(pi)
  registerCards(pi)
  registerTranscript(pi)
  registerTheme(pi)
  registerChrome(pi)
  registerResources(pi)
  // NOTE: registerEditor is intentionally NOT wired — a custom EditorComponent
  // that re-frames the stock editor breaks its box/cursor. Revisit only with a
  // from-scratch cursor-aware editor, or the opentui-RPC path.
  registerSelectors(pi)
  registerUiKit(pi)
}
