/**
 * PROTOTYPE — throwaway. Dock, LOCKED on #24.
 *
 * chat mode: opencode-style chatbox — prompt, blank, session meta, blank,
 * workflow status; the rail is a live thinking indicator.
 * dashboard mode: the workflow card with its agents nested — two-tone
 * background (deep shade starting at the inner rail) + a tinted inner rail,
 * indent matching the chatbox. Then a separate standalone-agents box.
 *
 *   Run:  pi --extension ~/projects/pi-opencode-ui/extensions/grill-dock.ts
 *   Then: /grill-dock        (d toggles chat/dashboard · q closes)
 *         /dock on          install the status line below the editor
 *         /dock off
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { matchesKey, truncateToWidth, visibleWidth, type Component } from "@earendil-works/pi-tui"
import { M, PAL, RESET, type Pair, bgOpen, bold, card, fg, fgOpen, lighten, mix, tinted, truncateAnsi } from "../lib/ui-kit"

type State = "running" | "queued" | "done" | "blocked"

interface Agent {
  name: string
  kind: string
  role: string
  state: State
  model: string
  elapsed: string
  tokens: string
  action: string
}

const GLYPH: Record<string, string> = { bash: "●", read: "●", edit: "✎", glob: "◇", write: "✚" }

const FLOW = { name: "add-caching", phases: ["Plan", "Implement", "Review", "Verify"], current: 2, status: "running" as State, elapsed: "2m46s", tokens: "27.1k" }

const FLOW_AGENTS: Agent[] = [
  { name: "impl-3f2a", kind: "edit", role: "implementer", state: "running", model: "deepseek-v4-pro", elapsed: "2m14s", tokens: "18.4k", action: "Edit src/client.ts" },
  { name: "review1-9c", kind: "read", role: "verifier", state: "running", model: "glm-5.3-flash", elapsed: "42s", tokens: "6.1k", action: "Read src/cache.ts" },
  { name: "review2-7b", kind: "read", role: "verifier", state: "queued", model: "glm-5.3-flash", elapsed: "—", tokens: "—", action: "waiting for review1" },
  { name: "rca-1a", kind: "bash", role: "recovery", state: "done", model: "deepseek-v4-pro", elapsed: "18s", tokens: "3.2k", action: "diagnosed stuck loop" },
]

const STANDALONE: Agent[] = [
  { name: "scout-9d", kind: "glob", role: "researcher", state: "running", model: "glm-5.3-flash", elapsed: "1m03s", tokens: "4.4k", action: "scanning auth middleware" },
]

const DRAFT = "test message that i was typing before the agent started"
const CHATBOX: Pair = { rail: M.magenta, bg: tinted(M.magenta) }
const WF: Pair = { rail: PAL.state.running, bg: tinted(PAL.state.running) }
const WF_DEEP = mix(WF.bg, "#000000", 0.22)
const SESSION = { agent: "Build", approval: "auto", model: "DeepSeek V4.1 Flash", provider: "OpenCode Go", effort: "high", ctx: "42%", cost: "$0.18", path: "~/projects/pi-opencode-ui" }

function icon(a: Agent): string {
  return bold(fg(PAL.icon[a.kind] ?? PAL.tools.rail, GLYPH[a.kind] ?? "●"))
}
function badge(a: { state: State }): string {
  return fg(PAL.state[a.state], `${PAL.stateGlyph[a.state]} ${a.state}`)
}
function counts(agents: Agent[]) {
  return {
    running: agents.filter((a) => a.state === "running").length,
    queued: agents.filter((a) => a.state === "queued").length,
    done: agents.filter((a) => a.state === "done").length,
  }
}
function phaseBar(): string {
  return FLOW.phases
    .map((p, i) => {
      if (i < FLOW.current) return fg(PAL.add, `✓ ${p}`)
      if (i === FLOW.current) return fg(PAL.think.rail, `⟳ ${p}`)
      return fg(PAL.dim, `· ${p}`)
    })
    .join(fg(PAL.dim, "   "))
}

export function workflowRow(): string {
  const c = counts(FLOW_AGENTS)
  return (
    fg(PAL.think.rail, "⟳ ") + fg(PAL.text, bold(FLOW.name)) +
    fg(PAL.dim, `   ${FLOW.phases[FLOW.current]} ${FLOW.current + 1}/${FLOW.phases.length}`) +
    fg(PAL.dim, "   ") +
    fg(PAL.state.running, `● ${c.running}`) + "  " +
    fg(PAL.state.queued, `○ ${c.queued}`) + "  " +
    fg(PAL.state.done, `✓ ${c.done}`) +
    fg(PAL.dim, `   ${FLOW.elapsed}  ${FLOW.tokens}`)
  )
}
function metaRow(): string {
  return (
    fg(PAL.text, bold(SESSION.agent)) + fg(PAL.dim, ` ${SESSION.approval}`) +
    fg(PAL.dim, "  ·  ") +
    fg(PAL.text, SESSION.model) + fg(PAL.dim, ` ${SESSION.provider}`) +
    fg(PAL.dim, "  ·  ") + fg(PAL.think.rail, SESSION.effort) +
    fg(PAL.dim, "  ·  ") + fg(PAL.dim, `ctx ${SESSION.ctx}`) +
    fg(PAL.dim, "   ") + fg(PAL.dim, SESSION.cost) +
    fg(PAL.dim, "   ") + fg(PAL.dim, SESSION.path)
  )
}

function railLine(width: number, bg: string, railHex: string, styled: string): string {
  const pad = Math.max(0, width - 2 - visibleWidth(styled))
  return bgOpen(bg) + fgOpen(railHex) + "▌ " + styled + " ".repeat(pad) + RESET
}

function chatbox(width: number, phase: number, content: string[]): string[] {
  const all = ["", ...content, ""]
  const n = all.length
  const pos = ((Math.sin(phase) + 1) / 2) * (n - 1)
  const hue = mix(M.magenta, M.primary, (Math.sin(phase * 0.5) + 1) / 2)
  return all.map((c, i) => {
    const glow = Math.exp(-((i - pos) ** 2) / 1.6)
    const railHex = mix(CHATBOX.bg, hue, 0.16 + glow * 0.84)
    return railLine(width, CHATBOX.bg, railHex, c)
  })
}

export function chatView(width: number, phase: number): string[] {
  const out: string[] = []
  out.push("")
  out.push(...card(width, PAL.agent, [fg(PAL.text, "On it — reading the client and the existing tests first.")]))
  out.push("")
  out.push(...chatbox(width, phase, [
    fg(PAL.text, DRAFT) + fg(PAL.me.rail, "█"),
    "",
    metaRow(),
    "",
    workflowRow(),
  ]))
  out.push(fg(PAL.dim, "  enter send · d dashboard · rail = thinking"))
  return out.map((l) => truncateAnsi(l, width))
}

// ── locked nesting: two-tone bg + tinted inner rail ─────────────────────────
const agentLine1 = (a: Agent) =>
  icon(a) + " " + fg(PAL.text, bold(a.name)) + fg(PAL.dim, `   ${a.role}`) + "   " + badge(a) + fg(PAL.dim, `   ${a.elapsed}   ${a.tokens} tok`)
const agentLine2 = (a: Agent) => fg(PAL.dim, `${a.model}   ·   `) + fg(PAL.text, a.action)

function workflowCard(width: number, agents: Agent[]): string[] {
  const c = counts(agents)
  const inner = lighten(PAL.state.running, 0.3)
  const deep = (content: string) => {
    const left = bgOpen(WF.bg) + fgOpen(WF.rail) + "▌ " + "  "
    const right = bgOpen(WF_DEEP) + fgOpen(inner) + "▏ " + content
    const pad = Math.max(0, width - 6 - visibleWidth(content))
    return left + right + " ".repeat(pad) + RESET
  }
  const lines: string[] = []
  lines.push(railLine(width, WF.bg, WF.rail, "")) // top buffer
  lines.push(railLine(width, WF.bg, WF.rail, fg(PAL.think.rail, "⟳ ") + fg(PAL.text, bold("workflow  ")) + fg(PAL.text, bold(FLOW.name)) + "  " + fg(PAL.state[FLOW.status], "running")))
  lines.push(railLine(width, WF.bg, WF.rail, "  " + phaseBar()))
  lines.push(railLine(width, WF.bg, WF.rail, fg(PAL.dim, `  ${FLOW.elapsed}  ·  ${agents.length} agents  ·  ${FLOW.tokens} tokens  ·  ● ${c.running}  ○ ${c.queued}  ✓ ${c.done}`)))
  lines.push(railLine(width, WF.bg, WF.rail, ""))
  agents.forEach((a, i) => {
    lines.push(deep(agentLine1(a)))
    lines.push(deep(agentLine2(a)))
    if (i < agents.length - 1) lines.push(deep(""))
  })
  lines.push(railLine(width, WF.bg, WF.rail, "")) // bottom buffer
  return lines
}

function standaloneCard(width: number): string[] {
  const body = [fg(PAL.dim, "standalone agents   ·   not part of a workflow"), ""]
  for (const a of STANDALONE) {
    body.push(icon(a) + " " + fg(PAL.text, a.name) + fg(PAL.dim, `   ${a.role}`) + "   " + badge(a) + fg(PAL.dim, `   ${a.elapsed}   ${a.tokens} tok`))
    body.push(fg(PAL.dim, `   ${a.model}   ·   `) + fg(PAL.text, a.action))
  }
  return card(width, PAL.tools, body)
}

export function dashboardView(width: number): string[] {
  const out: string[] = []
  out.push(...card(width, CHATBOX, [fg(PAL.text, DRAFT.slice(0, 34) + "…") + fg(PAL.dim, "   draft kept · esc restores")]))
  out.push("")
  out.push(...workflowCard(width, FLOW_AGENTS))
  out.push("")
  out.push(...standaloneCard(width))
  return out.map((l) => truncateAnsi(l, width))
}

class DockExample implements Component {
  private mode: "chat" | "dashboard" = "chat"
  private phase = 0
  private readonly done: (v: string | null) => void
  private cachedWidth?: number
  private cached?: string[]

  constructor(done: (v: string | null) => void) {
    this.done = done
  }

  tick(): void {
    this.phase += 0.32
    this.invalidate()
  }

  handleInput(data: string): void {
    if (data === "d" || matchesKey(data, "tab")) this.mode = this.mode === "chat" ? "dashboard" : "chat"
    else if (data === "q" || matchesKey(data, "escape")) {
      this.done(this.mode)
      return
    }
    this.invalidate()
  }

  invalidate(): void {
    this.cachedWidth = undefined
    this.cached = undefined
  }

  render(width: number): string[] {
    if (this.cached && this.cachedWidth === width) return this.cached
    const tab = (label: string, active: boolean) => (active ? fg(PAL.me.rail, bold(` ${label} `)) : fg(PAL.dim, ` ${label} `))
    const header =
      fg(PAL.text, bold("dock")) + "  " + tab("chat", this.mode === "chat") + fg(PAL.dim, "│") + tab("dashboard", this.mode === "dashboard") +
      fg(PAL.dim, "   d switch · q close")
    const lines: string[] = [truncateToWidth(header, width), ""]
    lines.push(...(this.mode === "chat" ? chatView(width, this.phase) : dashboardView(width)))
    lines.push("", fg(PAL.dim, "PROTOTYPE — dock locked on #24; next: /grill-questions."))
    this.cachedWidth = width
    this.cached = lines.map((l) => truncateToWidth(l, width))
    return this.cached
  }
}

export function statusWidget(_tui: unknown, _theme: unknown) {
  return { render: (w: number) => card(w, PAL.tools, [workflowRow()]).map((l) => truncateAnsi(l, w)), invalidate: () => {} }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("grill-dock", {
    description: "PROTOTYPE: locked dock — chatbox + dashboard",
    handler: async (_args, ctx) => {
      await ctx.ui.custom<string | null>(
        (tui, _theme, _keybindings, done) => {
          let iv: ReturnType<typeof setInterval> | undefined
          const finish = (v: string | null) => {
            if (iv) clearInterval(iv)
            done(v)
          }
          const comp = new DockExample(finish)
          iv = setInterval(() => {
            comp.tick()
            tui.requestRender()
          }, 110)
          return {
            render: (w: number) => comp.render(w),
            invalidate: () => comp.invalidate(),
            handleInput: (data: string) => {
              comp.handleInput(data)
              tui.requestRender()
            },
          }
        },
        { overlay: true },
      )
    },
  })

  pi.registerCommand("dock", {
    description: "PROTOTYPE: install/remove the persistent status line (/dock on | off)",
    handler: async (args, ctx) => {
      if (args.trim().startsWith("off")) {
        ctx.ui.setWidget("agent-dock", undefined)
        ctx.ui.notify("dock off", "info")
        return
      }
      ctx.ui.setWidget("agent-dock", statusWidget, { placement: "belowEditor" })
      ctx.ui.notify("status line installed below the editor", "info")
    },
  })
}
