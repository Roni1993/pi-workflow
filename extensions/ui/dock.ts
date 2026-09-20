// T2 — dock. Ports the locked opencode-look dock (pi-opencode-ui/extensions/
// grill-dock.ts) and binds it to live pi-workflow bg-agent state. Pure render
// functions take a DockData snapshot so they are headless-testable; registerDock
// wires them to a ~1.5s poll of the read-only live contract.
import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent"
import type { Component, TUI } from "@earendil-works/pi-tui"
import {
  M,
  PAL,
  RESET,
  type AgentState,
  type Pair,
  bgOpen,
  bold,
  card,
  fg,
  fgOpen,
  lighten,
  mix,
  tinted,
  truncateAnsi,
  visibleWidth,
} from "./ui-kit"
import {
  currentOwner,
  listSessions,
  liveState,
  readLiveState,
  shortModel,
  type BgAgent,
  type LiveState,
} from "./live"

const FRAME_MS = 110
const POLL_MS = 1500
const PROMPT = "ask anything…"
/** Render caps: never draw every agent, however many the index holds. */
export const MAX_ACTIVE_ROWS = 8
export const MAX_SETTLED_ROWS = 5

export interface DockAgent {
  id: string
  model: string
  action: string
  alive: boolean
  status: string
}
export interface DockCounts {
  running: number
  queued: number
  done: number
  blocked: number
}
export interface DockData {
  agents: DockAgent[]
  counts: DockCounts
}

const GLYPH: Record<string, string> = { bash: "●", read: "●", edit: "✎", glob: "◇", write: "✚" }

const CHATBOX: Pair = { rail: M.magenta, bg: tinted(M.magenta) }
const WF: Pair = { rail: PAL.state.running, bg: tinted(PAL.state.running) }
const WF_DEEP = mix(WF.bg, "#000000", 0.22)

function safeWidth(width: number): number {
  return Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 0
}
function num(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0
}
function emptyCounts(): DockCounts {
  return { running: 0, queued: 0, done: 0, blocked: 0 }
}
function emptyData(): DockData {
  return { agents: [], counts: emptyCounts() }
}

/** Tolerate a malformed snapshot: never throw, always yield a renderable shape. */
function normalize(data: DockData): DockData {
  const raw = Array.isArray(data?.agents) ? data.agents : []
  const agents: DockAgent[] = raw.map((a) => {
    const x = (a ?? {}) as Partial<DockAgent>
    return {
      id: typeof x.id === "string" ? x.id : "?",
      model: typeof x.model === "string" ? x.model : "?",
      action: typeof x.action === "string" ? x.action : "—",
      alive: !!x.alive,
      status: typeof x.status === "string" ? x.status : "unknown",
    }
  })
  const c = data?.counts
  return {
    agents,
    counts: { running: num(c?.running), queued: num(c?.queued), done: num(c?.done), blocked: num(c?.blocked) },
  }
}

/** Render state from liveness + raw bg status. settled/stopped = done; a running
 *  agent whose tmux is gone = blocked; spawning = queued. Errors win. */
function agentState(a: DockAgent): AgentState {
  if (a.action.includes("[ERROR]")) return "blocked"
  if (a.status === "settled" || a.status === "stopped") return "done"
  if (!a.alive) return "blocked"
  if (a.status === "spawning") return "queued"
  return "running"
}
function countsOf(agents: DockAgent[]): DockCounts {
  const counts = emptyCounts()
  for (const a of agents) counts[agentState(a)]++
  return counts
}

/** Derive the render snapshot from live polls. Never throws.
 *  When `owner` is given, non-owned rows and legacy rows with no owner are
 *  dropped, so the global ~/.pi/agent/bg/index.json never bleeds into a
 *  scoped UI. The poll always passes the owner; omitting it is a headless
 *  render-test convenience only. */
export function deriveDockData(states: LiveState[], owner?: string): DockData {
  const list = Array.isArray(states) ? states : []
  const agents: DockAgent[] = []
  for (const s of list) {
    const agent = (s?.agent ?? {}) as Partial<BgAgent>
    if (owner !== undefined && agent.owner !== owner) continue
    agents.push({
      id: typeof agent.id === "string" && agent.id ? agent.id : "?",
      model: shortModel(typeof agent.model === "string" ? agent.model : undefined),
      action: typeof s?.action === "string" && s.action ? s.action : "—",
      alive: !!s?.alive,
      status: typeof agent.status === "string" && agent.status ? agent.status : "unknown",
    })
  }
  return { agents, counts: countsOf(agents) }
}

// ── shared row builders (live data only) ────────────────────────────────────
function kindOf(action: string): string {
  const m = /^([a-zA-Z_]+)\(/.exec(action)
  return m ? m[1]!.toLowerCase() : ""
}
function icon(a: DockAgent): string {
  const kind = kindOf(a.action)
  return bold(fg(PAL.icon[kind] ?? PAL.tools.rail, GLYPH[kind] ?? "●"))
}
function badge(a: DockAgent): string {
  const s = agentState(a)
  return fg(PAL.state[s], `${PAL.stateGlyph[s]} ${s}`)
}

function metaRow(data: DockData): string {
  const newest = data.agents[0]
  const model = newest ? newest.model : "no agents"
  const n = data.agents.length
  return (
    bold(fg(PAL.text, "pi-workflow")) +
    fg(PAL.dim, "  ·  ") +
    fg(PAL.text, model) +
    fg(PAL.dim, `  ·  ${n} bg agent${n === 1 ? "" : "s"}`)
  )
}
function workflowRow(data: DockData): string {
  const c = data.counts
  return (
    fg(PAL.think.rail, "⟳ ") +
    fg(PAL.text, bold("background agents")) +
    fg(PAL.dim, `   ${data.agents.length} total   `) +
    fg(PAL.state.running, `● ${c.running}`) +
    "  " +
    fg(PAL.state.queued, `○ ${c.queued}`) +
    "  " +
    fg(PAL.state.blocked, `✕ ${c.blocked}`) +
    "  " +
    fg(PAL.state.done, `✓ ${c.done}`)
  )
}

// ── locked chatbox rail: saturated band travelling magenta→primary ──────────
function railLine(width: number, bg: string, railHex: string, styled: string): string {
  const pad = Math.max(0, width - 2 - visibleWidth(styled))
  return bgOpen(bg) + fgOpen(railHex) + "▌ " + styled + " ".repeat(pad) + RESET
}
function band(width: number, phase: number, pair: Pair, content: string[]): string[] {
  const p = Number.isFinite(phase) ? phase : 0
  const all = ["", ...content, ""]
  const pos = ((Math.sin(p) + 1) / 2) * (all.length - 1)
  const hue = mix(M.magenta, M.primary, (Math.sin(p * 0.5) + 1) / 2)
  return all.map((c, i) => {
    const glow = Math.exp(-((i - pos) ** 2) / 1.6)
    return railLine(width, pair.bg, mix(pair.bg, hue, 0.16 + glow * 0.84), c)
  })
}

// ── pure render paths (every line width-guarded) ────────────────────────────
/** opencode chatbox: prompt+cursor · blank · session meta · blank · status. */
export function chatView(width: number, phase: number, data: DockData): string[] {
  const w = safeWidth(width)
  const d = normalize(data)
  const box = band(w, phase, CHATBOX, [
    fg(PAL.text, PROMPT) + fg(PAL.me.rail, "█"),
    "",
    metaRow(d),
    "",
    workflowRow(d),
  ])
  const lines = ["", ...box, "", fg(PAL.dim, "  enter send · d dashboard · rail = thinking")]
  return lines.map((l) => truncateAnsi(l, w))
}

const agentLine1 = (a: DockAgent) =>
  icon(a) + " " + fg(PAL.text, bold(a.id)) + fg(PAL.dim, `   ${a.status}   `) + badge(a) + fg(PAL.dim, a.alive ? "   alive" : "   dead")
const agentLine2 = (a: DockAgent) => fg(PAL.dim, `${a.model}   ·   `) + fg(PAL.text, a.action)

/** workflow card with nested agents — two-tone bg, deep shade from the inner ▏ rail.
 *  `counts` summarises ALL owned agents even when only `agents` (the cap) render. */
function workflowCard(width: number, agents: DockAgent[], hidden = 0, counts = countsOf(agents)): string[] {
  const c = counts
  const inner = lighten(PAL.state.running, 0.3)
  const deep = (content: string) => {
    const left = bgOpen(WF.bg) + fgOpen(WF.rail) + "▌ " + "  "
    const right = bgOpen(WF_DEEP) + fgOpen(inner) + "▏ " + content
    const pad = Math.max(0, width - 6 - visibleWidth(content))
    return left + right + " ".repeat(pad) + RESET
  }
  const lines: string[] = []
  lines.push(railLine(width, WF.bg, WF.rail, ""))
  lines.push(
    railLine(
      width,
      WF.bg,
      WF.rail,
      fg(PAL.think.rail, "⟳ ") + fg(PAL.text, bold("workflow  ")) + fg(PAL.text, bold(`${c.running + c.queued} active`)),
    ),
  )
  lines.push(railLine(width, WF.bg, WF.rail, fg(PAL.dim, `  ${c.running} running · ${c.queued} queued · ${c.done} done · ${c.blocked} blocked`)))
  lines.push(railLine(width, WF.bg, WF.rail, ""))
  if (!agents.length) lines.push(deep(fg(PAL.dim, "no active bg agents")))
  agents.forEach((a, i) => {
    lines.push(deep(agentLine1(a)))
    lines.push(deep(agentLine2(a)))
    if (i < agents.length - 1) lines.push(deep(""))
  })
  if (hidden > 0) lines.push(deep(fg(PAL.dim, `… ${hidden} more active`)))
  lines.push(railLine(width, WF.bg, WF.rail, ""))
  return lines
}

function standaloneCard(width: number, agents: DockAgent[], hidden = 0): string[] {
  const body = [fg(PAL.dim, "standalone agents   ·   settled or detached"), ""]
  if (!agents.length) body.push(fg(PAL.dim, "   none"))
  for (const a of agents) {
    body.push(icon(a) + " " + fg(PAL.text, a.id) + fg(PAL.dim, `   ${a.status}   `) + badge(a))
    body.push(fg(PAL.dim, `   ${a.model}   ·   `) + fg(PAL.text, a.action))
  }
  if (hidden > 0) body.push(fg(PAL.dim, `   … ${hidden} more`))
  return card(width, PAL.tools, body)
}

/** Cap a newest-first list, appending a "… M more" marker when truncated. */
function cap<T>(items: T[], max: number): { shown: T[]; hidden: number } {
  const n = Array.isArray(items) ? items.length : 0
  if (n <= max) return { shown: items, hidden: 0 }
  return { shown: items.slice(0, max), hidden: n - max }
}

/** Dashboard: active agents nested in the workflow card + settled in their own box.
 *  At most MAX_ACTIVE_ROWS + MAX_SETTLED_ROWS agents are drawn; the rest collapse
 *  to a count marker so the frame stays O(1) in index size. */
export function dashboardView(width: number, data: DockData): string[] {
  const w = safeWidth(width)
  const d = normalize(data)
  const active = d.agents.filter((a) => {
    const s = agentState(a)
    return s === "running" || s === "queued"
  })
  const rest = d.agents.filter((a) => {
    const s = agentState(a)
    return s === "done" || s === "blocked"
  })
  const act = cap(active, MAX_ACTIVE_ROWS)
  const done = cap(rest, MAX_SETTLED_ROWS)
  const out = [
    "",
    ...workflowCard(w, act.shown, act.hidden, d.counts),
    "",
    ...standaloneCard(w, done.shown, done.hidden),
  ]
  return out.map((l) => truncateAnsi(l, w))
}

/** Compact below-editor status card; the rail band animates from `phase`. */
export function statusView(width: number, phase: number, data: DockData): string[] {
  const w = safeWidth(width)
  const d = normalize(data)
  return band(w, phase, PAL.tools, [workflowRow(d)]).map((l) => truncateAnsi(l, w))
}

/** The below-editor widget factory: renders the status card, animates via an
 *  interval that requests a render, and clears it in dispose(). `onTick` polls
 *  live state on the same beat. */
export function statusWidget(getData: () => DockData, onTick?: () => void) {
  return (tui: TUI, _theme: Theme): Component & { dispose(): void } => {
    let phase = 0
    let disposed = false
    const timer = setInterval(() => {
      if (disposed) return
      phase += 0.32
      try {
        onTick?.()
        tui.requestRender()
      } catch {
        // a render/request failure must never take down pi
      }
    }, FRAME_MS)
    return {
      render: (width: number) => safeRender(() => statusView(width, phase, getData()), width),
      invalidate: () => {},
      dispose: () => {
        disposed = true
        clearInterval(timer)
      },
    }
  }
}

/** Last-resort guard: a throw in render or an over-wide line exits pi. */
function safeRender(fn: () => string[], width: number): string[] {
  const w = safeWidth(width)
  try {
    const lines = fn()
    if (!Array.isArray(lines)) return [""]
    return lines.map((l) => truncateAnsi(typeof l === "string" ? l : String(l), w))
  } catch {
    return [truncateAnsi(fg(M.red, "dock: render error"), w)]
  }
}

// ── live binding ────────────────────────────────────────────────────────────
export interface Poller {
  data(): DockData
  poll(): Promise<void>
  tick(): void
}

interface PollerDeps {
  readAll: () => Promise<BgAgent[]>
  listLive: () => Promise<Set<string>>
  readOne: (agent: BgAgent, live: Set<string>) => Promise<LiveState>
  owner: string
}

const defaultDeps = (owner: string): PollerDeps => ({
  readAll: async () => (await readLiveState()).agents,
  listLive: listSessions,
  readOne: async (agent, live) => liveState(agent, live),
  owner,
})

/**
 * Poll once per tick: read the index, scope to owned agents (legacy/no-owner
 * rows are dropped before any I/O), then take ONE tmux snapshot and derive
 * liveness by set membership. Non-owned rows are never enriched — no out.jsonl
 * read, no tmux spawn. Coalesces overlap and never throws.
 */
export function createPoller(owner: string = currentOwner(), deps: PollerDeps = defaultDeps(owner)): Poller {
  let current = emptyData()
  let last = 0
  let busy = false
  async function poll(): Promise<void> {
    if (busy) return
    busy = true
    try {
      const all = await deps.readAll()
      const owned = (all ?? []).filter((a) => a?.owner === deps.owner)
      // No owned agents → no liveness needed; skip the tmux spawn entirely.
      const live = owned.length > 0 ? await deps.listLive() : new Set<string>()
      const states = await Promise.all(
        owned.map(async (agent): Promise<LiveState> => {
          try {
            return await deps.readOne(agent, live)
          } catch {
            return { agent, alive: false, action: "—" }
          }
        }),
      )
      current = deriveDockData(states, deps.owner)
    } catch {
      current = emptyData()
    } finally {
      busy = false
      last = Date.now()
    }
  }
  return {
    data: () => current,
    poll,
    tick: () => {
      if (!busy && Date.now() - last >= POLL_MS) void poll()
    },
  }
}

function dockHeader(width: number, mode: "chat" | "dashboard"): string {
  const tab = (label: string, active: boolean) =>
    active ? fg(PAL.me.rail, bold(` ${label} `)) : fg(PAL.dim, ` ${label} `)
  return truncateAnsi(
    fg(PAL.text, bold("dock")) +
      "  " +
      tab("chat", mode === "chat") +
      fg(PAL.dim, "│") +
      tab("dashboard", mode === "dashboard") +
      fg(PAL.dim, "   d switch · q close"),
    width,
  )
}

export function registerDock(pi: ExtensionAPI): void {
  // Owner is resolved from the real session identity on first command use, so
  // two pi terminals never share each other's agents. Created once per process.
  let poller: Poller | undefined
  const getPoller = (ctx: ExtensionCommandContext): Poller => {
    if (!poller) poller = createPoller(currentOwner(ctx))
    return poller
  }

  pi.registerCommand("ui-dock", {
    description: "Preview the dock overlay — d chat/dashboard · q close",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const p = getPoller(ctx)
      await p.poll().catch(() => {})
      await ctx.ui.custom<string>(
        (tui, _theme, _keybindings, done) => {
          let mode: "chat" | "dashboard" = "chat"
          let phase = 0
          const timer = setInterval(() => {
            phase += 0.32
            p.tick()
            try {
              tui.requestRender()
            } catch {
              // ignore: render must never throw
            }
          }, FRAME_MS)
          const finish = (v: string) => {
            clearInterval(timer)
            done(v)
          }
          return {
            render: (width: number) =>
              safeRender(() => {
                const body =
                  mode === "chat" ? chatView(width, phase, p.data()) : dashboardView(width, p.data())
                return [dockHeader(width, mode), "", ...body]
              }, width),
            invalidate: () => {},
            handleInput: (data: string) => {
              if (data === "d") mode = mode === "chat" ? "dashboard" : "chat"
              else if (data === "q" || data === "\x1b") {
                finish(mode)
                return
              }
              try {
                tui.requestRender()
              } catch {
                // ignore
              }
            },
            dispose: () => clearInterval(timer),
          }
        },
        { overlay: true },
      )
    },
  })

  pi.registerCommand("dock", {
    description: "Install/remove the live dock below the editor (/dock on | off)",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (args.trim().startsWith("off")) {
        ctx.ui.setWidget("ui-dock", undefined)
        ctx.ui.notify("ui-dock off", "info")
        return
      }
      const p = getPoller(ctx)
      ctx.ui.setWidget("ui-dock", statusWidget(() => p.data(), () => p.tick()), { placement: "belowEditor" })
      p.tick()
      ctx.ui.notify("ui-dock installed below the editor", "info")
    },
  })
}
