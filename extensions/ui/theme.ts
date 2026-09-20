// Registers the bundled "opencode" theme (themes/opencode.json) on session
// start. Kept defensive so the extension still loads on stock/older pi where
// `setTheme` may be absent.
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

export function registerTheme(pi: ExtensionAPI): void {
  pi.on("session_start", (_event, ctx: ExtensionContext) => {
    const ui = ctx?.ui
    if (typeof ui?.setTheme !== "function") return
    try {
      ui.setTheme("opencode")
    } catch {
      // theme not registered (older pi / missing asset) — keep the current one
    }
  })
}
