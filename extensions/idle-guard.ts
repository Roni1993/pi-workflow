import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"

export const MARKER = path.join(os.homedir(), ".cache/opencode/active")
export const HEARTBEAT_MS = 30_000

export async function touchMarker(): Promise<void> {
  await fs.mkdir(path.dirname(MARKER), { recursive: true })
  await fs.writeFile(MARKER, String(Date.now()))
}

export async function clearMarker(): Promise<void> {
  await fs.rm(MARKER, { force: true })
}

interface IdleGuardOptions {
  heartbeatMs?: number
}

export function createIdleGuard(
  pi: { on: (name: string, handler: (event: unknown, ctx: ExtensionContext) => void) => void },
  options: IdleGuardOptions = {},
) {
  const heartbeatMs = options.heartbeatMs ?? HEARTBEAT_MS
  let heartbeat: ReturnType<typeof setInterval> | undefined

  const stop = () => {
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = undefined
    }
  }
  const start = async () => {
    if (heartbeat) return
    await touchMarker()
    heartbeat = setInterval(() => {
      void touchMarker()
    }, heartbeatMs)
    heartbeat.unref?.()
  }
  const isInteractive = (ctx: ExtensionContext) => ctx.mode === "tui"
  const markActive = async (ctx: ExtensionContext) => {
    if (isInteractive(ctx)) await start()
  }
  const markIdle = async (ctx: ExtensionContext) => {
    if (isInteractive(ctx)) {
      stop()
      await clearMarker()
    }
  }
  const markIdleSafe = async (ctx: ExtensionContext) => {
    try {
      await markIdle(ctx)
    } catch {
      // stale ctx after session replacement (e.g. ephemeral rpc) — skip;
      // never clears the shared marker from a non-tui/stale context
    }
  }

  pi.on("session_start", () => stop())
  pi.on("agent_start", (_e, ctx) => markActive(ctx))
  pi.on("tool_call", (_e, ctx) => markActive(ctx))
  pi.on("message_update", (_e, ctx) => markActive(ctx))
  pi.on("agent_settled", async (_e, ctx) => {
    try {
      if (isInteractive(ctx) && ctx.isIdle()) await markIdle(ctx)
    } catch {
      // stale ctx — ignore
    }
  })
  pi.on("session_end", (_e, ctx) => markIdleSafe(ctx))
  pi.on("session_shutdown", (_e, ctx) => markIdleSafe(ctx))
}

export default function idleGuard(pi: ExtensionAPI) {
  createIdleGuard(pi)
}
