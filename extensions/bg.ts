import * as fs from "node:fs/promises"
import { existsSync } from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { execFile } from "node:child_process"
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"

const BG_DIR = path.join(os.homedir(), ".pi", "agent", "bg")
const INDEX = path.join(BG_DIR, "index.json")
const MONITOR_INTERVAL_MS = 5_000
const READY_WAIT_MS = 3_000

interface BgAgent {
  id: string
  tmux: string
  dir: string
  sessionDir: string
  cwd: string
  model: string
  prompt: string
  createdAt: string
  status: "spawning" | "running" | "settled" | "stopped"
  lastEventLine: number
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24)
}

function genId(name: string | undefined): string {
  const rand = Math.random().toString(36).slice(2, 6)
  const slug = name ? slugify(name) : ""
  return slug ? `${slug}-${rand}` : `bg-${rand}`
}

function runTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, { timeout: 20_000 }, (err, stdout) => {
      if (err) reject(new Error(`tmux ${args[0]}: ${err.message}`))
      else resolve(String(stdout))
    })
  })
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return fallback
  }
}

async function readIndex(): Promise<Record<string, BgAgent>> {
  return readJson<Record<string, BgAgent>>(INDEX, {})
}

async function writeIndex(index: Record<string, BgAgent>): Promise<void> {
  await fs.mkdir(BG_DIR, { recursive: true })
  await fs.writeFile(INDEX, JSON.stringify(index, null, 2))
}

async function sendRpc(session: string, payload: unknown): Promise<void> {
  await runTmux(["send-keys", "-t", session, "-l", JSON.stringify(payload)])
  await runTmux(["send-keys", "-t", session, "Enter"])
}

function getPiBinary(): string {
  const argv1 = process.argv[1]
  if (argv1 && !argv1.startsWith("/$bunfs/") && existsSync(argv1)) return argv1
  const execName = path.basename(process.execPath).toLowerCase()
  if (execName === "pi" || execName === "pi.exe") return process.execPath
  return "pi"
}

async function readAgentLog(dir: string, sinceLine: number): Promise<{ lines: string[]; nextLine: number }> {
  const file = path.join(dir, "out.jsonl")
  try {
    const content = await fs.readFile(file, "utf8")
    const lines = content.split("\n")
    return { lines: lines.slice(sinceLine), nextLine: lines.length }
  } catch {
    return { lines: [], nextLine: sinceLine }
  }
}

function describeEvent(line: string): string {
  try {
    const e = JSON.parse(line)
    switch (e.type) {
      case "agent_start":
        return "[agent_start] run began"
      case "agent_settled":
        return "[agent_settled] fully settled"
      case "message_update":
        if (e.assistantMessageEvent?.type === "text_delta") return e.assistantMessageEvent.delta
        return ""
      case "tool_execution_start":
        return `[tool] ${e.toolName}(${JSON.stringify(e.args ?? {})})`
      case "tool_execution_end":
        return `[tool done] ${e.toolName}${e.isError ? " ERROR" : ""}`
      case "queue_update":
        return `[queue] steer=${(e.steering ?? []).length} followUp=${(e.followUp ?? []).length}`
      case "extension_ui_request":
        return `[ui?] ${e.method}: ${e.title ?? e.message ?? ""}`
      default:
        return ""
    }
  } catch {
    return ""
  }
}

function parseSpawnArgs(args: string): { model?: string; tools?: string; prompt: string } {
  const tokens = args.split(/\s+/)
  let model: string | undefined
  let tools: string | undefined
  let i = 0
  while (i < tokens.length && tokens[i].startsWith("--")) {
    if (tokens[i] === "--model" && tokens[i + 1]) {
      model = tokens[i + 1]
      i += 2
    } else if (tokens[i] === "--tools" && tokens[i + 1]) {
      tools = tokens[i + 1]
      i += 2
    } else {
      i += 1
    }
  }
  const prompt = tokens.slice(i).join(" ").trim()
  if (!prompt) throw new Error("spawn requires a task prompt (usage: /bg spawn [--model M] <prompt>)")
  return { model, tools, prompt }
}

async function spawnAgent(ctx: ExtensionCommandContext, args: string): Promise<string> {
  const { model, tools, prompt } = parseSpawnArgs(args)
  const id = genId(prompt)
  const dir = path.join(BG_DIR, id)
  const sessionDir = path.join(dir, "session")
  const session = `pi-bg-${id}`
  await fs.mkdir(sessionDir, { recursive: true })
  await fs.mkdir(path.join(dir, "work"), { recursive: true })

  const modelId =
    model ??
    (ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined) ??
    "opencode-go/deepseek-v4-flash"
  const piBin = getPiBinary()
  const rpcArgs = [`--mode`, `rpc`, `--session-dir`, sessionDir, `--name`, id]
  if (modelId) rpcArgs.push("--model", modelId)
  if (tools) rpcArgs.push("--tools", tools)
  const shellCmd = `${piBin} ${rpcArgs.map((a) => JSON.stringify(a)).join(" ")} > out.jsonl 2> err.log`

  await runTmux(["new-session", "-d", "-s", session, "-c", dir, shellCmd])

  const agent: BgAgent = {
    id,
    tmux: session,
    dir,
    sessionDir,
    cwd: ctx.cwd,
    model: modelId,
    prompt,
    createdAt: new Date().toISOString(),
    status: "spawning",
    lastEventLine: 0,
  }
  const index = await readIndex()
  index[id] = agent
  await writeIndex(index)

  await new Promise((r) => setTimeout(r, READY_WAIT_MS))
  const err = await fs.readFile(path.join(dir, "err.log"), "utf8").catch(() => "")
  if (err.trim() && !err.includes("update check")) {
    const idx = await readIndex()
    if (idx[id]) idx[id].status = "stopped"
    await writeIndex(idx)
    await runTmux(["kill-session", "-t", session]).catch(() => {})
    throw new Error(`${id} failed to start:\n${err.trim().slice(0, 500)}`)
  }
  await sendRpc(session, { id: "p0", type: "prompt", message: prompt })
  const idx = await readIndex()
  if (idx[id]) idx[id].status = "running"
  await writeIndex(idx)
  return `spawned ${id}\ntmux:  tmux attach -t ${session}\nsession: ${sessionDir}\nmodel:  ${modelId}\nwatch:  /bg watch ${id}`
}

async function listAgents(): Promise<string> {
  const index = await readIndex()
  const ids = Object.keys(index)
  if (ids.length === 0) return "no background agents"
  const rows = []
  for (const id of ids) {
    const a = index[id]
    rows.push(`  ${id}  [${a.status}]  ${a.model}\n      ${a.prompt.slice(0, 80)}`)
  }
  return rows.join("\n")
}

async function watchAgent(id: string, lines: number): Promise<string> {
  const index = await readIndex()
  const a = index[id]
  if (!a) return `unknown agent ${id}`
  const { lines: events, nextLine } = await readAgentLog(a.dir, Math.max(0, a.lastEventLine))
  a.lastEventLine = nextLine
  await writeIndex(index)
  const rendered = events
    .map(describeEvent)
    .filter((s) => s.length > 0)
    .slice(-lines)
  return rendered.length > 0 ? rendered.join("\n") : "(no new events)"
}

function getAgent(id: string, index: Record<string, BgAgent>): BgAgent {
  const a = index[id]
  if (!a) throw new Error(`unknown agent ${id} (try /bg list)`)
  return a
}

export default function bgExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer("bg-output", (message, _o, theme) => {
    return new Text(theme.fg("dim", String(message.content)), 0, 0)
  })

  const emit = (text: string) => {
    pi.sendMessage({ customType: "bg-output", content: text, display: true })
  }

  pi.registerCommand("bg", {
    description:
      "Background agents: /bg spawn [--model M] <task> | list | watch <id> [n] | steer <id> <msg> | follow <id> <msg> | interrupt <id> | kill <id> | resume <id>",
    handler: async (args, ctx) => {
      const [cmd, ...rest] = args.trim().split(/\s+/)
      try {
        switch (cmd) {
          case "spawn":
            emit(await spawnAgent(ctx, rest.join(" ")))
            break
          case "list":
            emit(await listAgents())
            break
          case "watch": {
            const id = rest[0]
            const n = parseInt(rest[1] ?? "20", 10)
            emit(await watchAgent(id, n))
            break
          }
          case "steer":
          case "follow": {
            const id = rest[0]
            const message = rest.slice(1).join(" ")
            const index = await readIndex()
            const a = getAgent(id, index)
            await sendRpc(a.tmux, cmd === "steer" ? { type: "steer", message } : { type: "follow_up", message })
            emit(`steer queued for ${id}`)
            break
          }
          case "interrupt": {
            const id = rest[0]
            const index = await readIndex()
            const a = getAgent(id, index)
            await sendRpc(a.tmux, { type: "abort" })
            emit(`abort sent to ${id}`)
            break
          }
          case "kill": {
            const id = rest[0]
            const index = await readIndex()
            const a = getAgent(id, index)
            await runTmux(["kill-session", "-t", a.tmux]).catch(() => {})
            a.status = "stopped"
            await writeIndex(index)
            emit(`killed ${id}`)
            break
          }
          case "resume": {
            const id = rest[0]
            const index = await readIndex()
            const a = getAgent(id, index)
            const alive = await runTmux(["has-session", "-t", a.tmux])
              .then(() => true)
              .catch(() => false)
            if (alive) {
              emit(`${id} already running.\ntmux attach -t ${a.tmux}\nsession: ${a.sessionDir}`)
            } else {
              const piBin = getPiBinary()
              const shellCmd = `${piBin} --mode rpc --session-dir ${a.sessionDir} --name ${id} --model ${a.model} > out.jsonl 2> err.log`
              await runTmux(["new-session", "-d", "-s", a.tmux, "-c", a.dir, shellCmd])
              a.status = "running"
              await writeIndex(index)
              emit(`resumed ${id} (history preserved in ${a.sessionDir})\ntmux attach -t ${a.tmux}`)
            }
            break
          }
          case "revert": {
            const id = rest[0]
            const index = await readIndex()
            const a = getAgent(id, index)
            emit(
              `revert ${id}: interact with the agent's own tree.\n` +
                `  pi --fork ${a.sessionDir}   # open its session, use /tree to branch\n` +
                `or steer: /bg steer ${id} <revert instructions>`,
            )
            break
          }
          default:
            emit(
              `usage: /bg spawn [--model M] <task>\n       /bg list | watch <id> [n] | steer <id> <msg> | follow <id> <msg>\n       /bg interrupt <id> | kill <id> | resume <id> | revert <id> <node>`,
            )
        }
      } catch (e) {
        emit(`bg error: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  })

  const monitor = setInterval(async () => {
    try {
      const index = await readIndex()
      let changed = false
      for (const a of Object.values(index)) {
        if (a.status !== "running" && a.status !== "spawning") continue
        const file = path.join(a.dir, "out.jsonl")
        try {
          const content = await fs.readFile(file, "utf8")
          const lines = content.split("\n")
          for (let i = a.lastEventLine; i < lines.length; i++) {
            const line = lines[i]
            if (!line.trim()) continue
            try {
              const e = JSON.parse(line)
              if (e.type === "agent_settled") {
                a.status = "settled"
                changed = true
                const resultPath = path.join(a.dir, "result.md")
                await fs.writeFile(
                  resultPath,
                  `# bg agent ${a.id} settled\n\n- session: ${a.sessionDir}\n- resume: pi --fork ${a.sessionDir}\n- full tree via /bg resume ${a.id}\n`,
                )
                pi.sendMessage({
                  customType: "bg-output",
                  content: `[bg] ${a.id} settled — /bg resume ${a.id} · result: ${resultPath}`,
                  display: true,
                })
              }
            } catch {}
          }
          a.lastEventLine = lines.length
        } catch {}
      }
      if (changed) await writeIndex(index)
    } catch {}
  }, MONITOR_INTERVAL_MS)
  monitor.unref?.()
}
