// Registers and applies the bundled "opencode" theme (themes/opencode.json).
//
// `setTheme` persists the selection, so on the NEXT startup pi tries to load
// "opencode" before `resources_discover` runs and prints
// 'Failed to load theme "opencode": Theme not found' (falling back to dark).
// A discovered path is too late for that first load. So we also install the
// theme file into pi's own theme store (~/.pi/agent/themes/) where it is found
// at startup, then select it once the registry exposes it.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
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

/** Copy our theme into pi's user theme store so it loads at startup. Idempotent. */
function installTheme(): void {
  const dir = themeDir()
  if (!dir) return
  const src = join(dir, "opencode.json")
  const destDir = join(homedir(), ".pi", "agent", "themes")
  const dest = join(destDir, "opencode.json")
  try {
    const body = readFileSync(src, "utf8")
    if (existsSync(dest) && readFileSync(dest, "utf8") === body) return
    mkdirSync(destDir, { recursive: true })
    writeFileSync(dest, body)
  } catch {
    // read-only FS / no home — the resources_discover path still applies it per session
  }
}

type ThemeUI = {
  getTheme?: (name: string) => unknown
  setTheme?: (theme: string) => { success?: boolean } | undefined
}

/** Select the theme only when the registry already knows it. */
function apply(ctx: ExtensionContext | undefined): boolean {
  const ui = ctx?.ui as ThemeUI | undefined
  if (!ui || typeof ui.setTheme !== "function") return false
  try {
    if (typeof ui.getTheme === "function" && !ui.getTheme("opencode")) return false
    return ui.setTheme("opencode")?.success !== false
  } catch {
    return false
  }
}

export function registerTheme(pi: ExtensionAPI): void {
  // Single source of truth: the theme file in pi's own store. We deliberately
  // do NOT also return it via `resources_discover` (nor `pi.themes` in
  // package.json) — registering the same theme name from two paths makes pi
  // print a "[Theme conflicts] opencode collision" and skip one.
  installTheme()

  pi.on("session_start", (_event: unknown, ctx: ExtensionContext) => {
    // Poll until the registry exposes the theme, then select it (bounded ~6s).
    let tries = 0
    const timer = setInterval(() => {
      tries += 1
      if (apply(ctx) || tries > 40) clearInterval(timer)
    }, 150)
  })
}
