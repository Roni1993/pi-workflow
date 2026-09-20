// Registers and applies the bundled "opencode" theme (themes/opencode.json).
//
// Two registration paths so it works both installed and via `-e`:
//  - package.json `pi.themes` (read on `pi install`)
//  - the `resources_discover` event returning `themePaths` (read for `-e` loads)
// `session_start` fires before `resources_discover`, so we also retry the
// selection once after discovery. Everything is defensive.
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

function themeDir(): string | undefined {
  try {
    return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "themes")
  } catch {
    return undefined
  }
}

function apply(ctx: ExtensionContext | undefined): void {
  const ui = ctx?.ui
  if (typeof ui?.setTheme !== "function") return
  try {
    ui.setTheme("opencode")
  } catch {
    // theme not registered yet (older pi / missing asset) — keep the current one
  }
}

export function registerTheme(pi: ExtensionAPI): void {
  // Do NOT apply on session_start: it fires before resources_discover, so the
  // theme registry is still empty and pi prints "Theme not found: opencode".
  // Register the theme path, then select it on a short backoff once the
  // registry has consumed themePaths.
  pi.on("resources_discover", (_event: unknown, ctx: ExtensionContext) => {
    const dir = themeDir()
    if (!dir) return undefined
    for (const ms of [150, 600, 1500]) setTimeout(() => apply(ctx), ms)
    return { themePaths: [dir] }
  })
}
