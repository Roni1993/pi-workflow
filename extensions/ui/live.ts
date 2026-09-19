// Read-only live state contract (SAME as Tracer B / pi-workflow extensions/bg.ts).
//   ~/.pi/agent/bg/index.json          -> id -> BgAgent
//   ~/.pi/agent/bg/<id>/out.jsonl      -> tail; current action = last tool_execution_start
//   tmux has-session -t pi-bg-<id>     -> liveness
// No session JSONL parsing for tokens/cost. Every path is defensive: missing
// files, malformed JSON and undefined model/prompt must never throw.
import { execFile } from "node:child_process"
import { readFile, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export const BG_DIR = join(homedir(), ".pi", "agent", "bg")
export const INDEX = join(BG_DIR, "index.json")

export type AgentState = "running" | "queued" | "done" | "blocked"
export type BgStatus = "spawning" | "running" | "settled" | "stopped" | string

export interface BgAgent {
  id: string
  tmux: string
  dir: string
  sessionDir: string
  cwd: string
  model: string
  prompt: string
  createdAt: string
  status: BgStatus
}

/** Coerce a raw index entry into a fully-populated BgAgent. Never throws. */
function normalize(id: string, raw: unknown): BgAgent {
  const a = (raw ?? {}) as Partial<BgAgent>
  return {
    id: typeof a.id === "string" && a.id ? a.id : id,
    tmux: typeof a.tmux === "string" && a.tmux ? a.tmux : `pi-bg-${id}`,
    dir: typeof a.dir === "string" ? a.dir : join(BG_DIR, id),
    sessionDir: typeof a.sessionDir === "string" ? a.sessionDir : "",
    cwd: typeof a.cwd === "string" ? a.cwd : "",
    model: typeof a.model === "string" ? a.model : "",
    prompt: typeof a.prompt === "string" ? a.prompt : "",
    createdAt: typeof a.createdAt === "string" ? a.createdAt : "",
    status: typeof a.status === "string" ? a.status : "unknown",
  }
}

async function readIndex(): Promise<Record<string, BgAgent>> {
  try {
    const raw = JSON.parse(await readFile(INDEX, "utf8")) as unknown
    if (!raw || typeof raw !== "object") return {}
    const out: Record<string, BgAgent> = {}
    for (const [id, v] of Object.entries(raw as Record<string, unknown>)) out[id] = normalize(id, v)
    return out
  } catch {
    return {}
  }
}

/** Sorted newest-first. */
export async function listAgents(): Promise<BgAgent[]> {
  const idx = await readIndex()
  return Object.values(idx).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/** Liveness via tmux. Any failure (no tmux, no server, no session) = false. */
export function hasSession(tmuxName: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      execFile("tmux", ["has-session", "-t", tmuxName], { timeout: 5_000 }, (err) => resolve(!err))
    } catch {
      resolve(false)
    }
  })
}

/** Tail the agent log (bounded), tolerating a missing or unreadable file. */
async function readLines(file: string, maxBytes = 131_072): Promise<string[]> {
  try {
    await stat(file)
    const raw = (await readFile(file, "utf8")).slice(-maxBytes)
    return raw.split("\n")
  } catch {
    return []
  }
}

function oneLine(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length > max ? t.slice(0, max - 1) + "…" : t
}

/** Reference reducer: pi-workflow/extensions/bg.ts describeEvent(). */
export function describeEvent(line: string): string {
  try {
    const e = JSON.parse(line)
    switch (e.type) {
      case "agent_start":
        return "run began"
      case "agent_settled":
        return "fully settled"
      case "message_update":
        if (e.assistantMessageEvent?.type === "text_delta") return String(e.assistantMessageEvent.delta ?? "")
        return ""
      case "tool_execution_start":
        return `${e.toolName}(${oneLine(JSON.stringify(e.args ?? {}), 60)})`
      case "tool_execution_end":
        return `${e.toolName}${e.isError ? " ERROR" : ""}`
      case "queue_update":
        return `queue steer=${(e.steering ?? []).length} followUp=${(e.followUp ?? []).length}`
      case "auto_retry_start":
        return `retrying: ${oneLine(String(e.errorMessage ?? e.reason ?? ""), 60)}`
      case "extension_error":
        return `extension_error: ${oneLine(String(e.error ?? e.message ?? ""), 60)}`
      case "extension_ui_request":
        return `${e.method}: ${oneLine(String(e.title ?? e.message ?? ""), 50)}`
      default:
        return ""
    }
  } catch {
    return ""
  }
}

export interface LiveState {
  agent: BgAgent
  alive: boolean
  action: string
}

/** Latest meaningful action for one agent, reduced from the out.jsonl tail. */
export async function liveState(agent: BgAgent): Promise<LiveState> {
  const lines = await readLines(join(agent.dir, "out.jsonl"))
  let action = ""
  let error = ""
  let lastTool = ""
  let lastToolError = false
  for (const line of lines) {
    let e: any
    try {
      e = JSON.parse(line)
    } catch {
      continue
    }
    if (e?.type === "auto_retry_start" || e?.type === "extension_error") {
      error = describeEvent(line)
    } else if (e?.type === "tool_execution_start") {
      lastTool = `${e.toolName}(${oneLine(JSON.stringify(e.args ?? {}), 60)})`
      lastToolError = false
    } else if (e?.type === "tool_execution_end") {
      if (lastTool) lastToolError = !!e.isError
    } else if (e?.type === "agent_settled") {
      lastTool = "settled"
    }
  }
  if (lastTool) action = lastTool + (lastToolError ? " [ERROR]" : "")
  else if (error) action = error
  return { agent, alive: await hasSession(agent.tmux), action: action || "—" }
}

/** Poll entry point. Never throws. */
export async function readLiveState(): Promise<{ agents: BgAgent[] }> {
  try {
    return { agents: await listAgents() }
  } catch {
    return { agents: [] }
  }
}

export function shortModel(model: string | undefined): string {
  if (!model) return "?"
  const parts = model.split("/")
  return parts[parts.length - 1] || model
}

export function shortPrompt(prompt: string | undefined, max = 64): string {
  return oneLine(prompt ?? "", max) || "(no prompt)"
}
