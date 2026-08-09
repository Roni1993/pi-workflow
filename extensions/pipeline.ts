import * as fs from "node:fs/promises"
import { existsSync, readFileSync, statSync, appendFileSync } from "node:fs"
import * as path from "node:path"
import * as os from "node:os"
import { execFile } from "node:child_process"
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"

const WORKFLOW_DIR = path.join(os.homedir(), ".pi", "agent", "pi-workflow")
const PIPELINES = path.join(WORKFLOW_DIR, "pipelines", "index.json")
const BG_INDEX = path.join(os.homedir(), ".pi", "agent", "bg", "index.json")
const STANDARDS = path.join(os.homedir(), ".pi", "agent", "git", "github.com", "Roni1993", "pi-workflow", "docs", "standards.md")
const MONITOR_MS = 5_000

interface Pipeline {
  id: string
  statement: string
  phase: "planning" | "implementing" | "stuck" | "reviewing" | "fixing" | "clean" | "done" | "failed"
  model: string
  planPath: string
  dir: string
  implId?: string
  implWorkDir?: string
  implPrompt?: string
  reviewers: string[]
  fixerId?: string
  rcaId?: string
  lastRcaAt?: number
  reviewRound: number
  maxReviewRounds: number
  maxReviewers: number
  stuckMs: number
  doPr: boolean
  createdAt: string
  updatedAt: string
  log: string[]
}

interface BgAgent {
  id: string
  dir: string
  sessionDir: string
  cwd: string
  prompt: string
  status: string
}

function genId(seed: string): string {
  const rand = Math.random().toString(36).slice(2, 6)
  const slug = seed.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20)
  return (slug || "pipe") + "-" + rand
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T
  } catch {
    return fallback
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(data, null, 2))
}

function execFileAsync(cmd: string, args: string[], opts?: { cwd?: string; timeout?: number }): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: opts?.timeout ?? 30_000, cwd: opts?.cwd }, (err, stdout) => {
      if (err) reject(new Error(String(stdout || err.message)))
      else resolve({ stdout: String(stdout) })
    })
  })
}

function runTmux(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("tmux", args, { timeout: 20_000 }, (err, stdout) => {
      if (err) reject(new Error(`tmux ${args[0]}: ${err.message}`))
      else resolve(String(stdout))
    })
  })
}

function getPiBinary(): string {
  const argv1 = process.argv[1]
  if (argv1 && !argv1.startsWith("/$bunfs/") && existsSync(argv1)) return argv1
  const execName = path.basename(process.execPath).toLowerCase()
  if (execName === "pi" || execName === "pi.exe") return process.execPath
  return "pi"
}

async function isJjRepo(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("jj", ["root"], { cwd })
    return stdout.trim().length > 0
  } catch {
    return false
  }
}

async function setupJjWorkspace(cwd: string, workDir: string): Promise<string> {
  await fs.rm(workDir, { recursive: true, force: true })
  await fs.mkdir(workDir, { recursive: true })
  try {
    await execFileAsync("jj", ["workspace", "add", workDir], { cwd })
    return workDir
  } catch {
    return cwd
  }
}

interface SpawnOpts {
  prompt: string
  model: string
  cwd: string
  label: string
  jjIsolation: boolean
  id?: string
}

async function spawnBgAgent(opts: SpawnOpts): Promise<{ id: string; dir: string; cwd: string }> {
  const id = opts.id ?? genId(opts.label)
  const dir = path.join(os.homedir(), ".pi", "agent", "bg", id)
  const sessionDir = path.join(dir, "session")
  const workDir = path.join(dir, "work")
  await fs.mkdir(sessionDir, { recursive: true })
  await fs.mkdir(workDir, { recursive: true })

  const agentCwd = opts.jjIsolation && (await isJjRepo(opts.cwd))
    ? await setupJjWorkspace(opts.cwd, workDir)
    : opts.cwd

  const piBin = getPiBinary()
  const shellCmd = `${piBin} --mode rpc --session-dir ${sessionDir} --name ${id} --model ${opts.model} > ${JSON.stringify(path.join(dir, "out.jsonl"))} 2> ${JSON.stringify(path.join(dir, "err.log"))}`
  await runTmux(["new-session", "-d", "-s", `pi-bg-${id}`, "-c", agentCwd, shellCmd])

  const bgIndex = await readJson<Record<string, BgAgent>>(BG_INDEX, {})
  bgIndex[id] = {
    id,
    dir,
    sessionDir,
    cwd: agentCwd,
    prompt: opts.prompt,
    status: "spawning",
  }
  await writeJson(BG_INDEX, bgIndex)

  await new Promise((r) => setTimeout(r, 2_500))
  const err = await fs.readFile(path.join(dir, "err.log"), "utf8").catch(() => "")
  if (err.trim() && !err.includes("update check")) {
    bgIndex[id].status = "stopped"
    await writeJson(BG_INDEX, bgIndex)
    await runTmux(["kill-session", "-t", `pi-bg-${id}`]).catch(() => {})
    throw new Error(`${id} failed to start: ${err.trim().slice(0, 400)}`)
  }
  await runTmux(["send-keys", "-t", `pi-bg-${id}`, "-l", JSON.stringify({ id: "p0", type: "prompt", message: opts.prompt })])
  await runTmux(["send-keys", "-t", `pi-bg-${id}`, "Enter"])
  bgIndex[id].status = "running"
  await writeJson(BG_INDEX, bgIndex)
  return { id, dir, cwd: agentCwd }
}

function agentSettled(dir: string): boolean {
  try {
    const content = readFileSync(path.join(dir, "out.jsonl"), "utf8")
    return content.split("\n").some((l) => {
      try {
        return JSON.parse(l).type === "agent_settled"
      } catch {
        return false
      }
    })
  } catch {
    return false
  }
}

function agentLastActivity(dir: string): number {
  try {
    return statSync(path.join(dir, "out.jsonl")).mtimeMs
  } catch {
    return Date.now()
  }
}

async function readReviewVerdicts(p: Pipeline): Promise<{ files: string[]; allPass: boolean }> {
  const files: string[] = []
  let allPass = true
  for (const rId of p.reviewers) {
    const f = path.join(WORKFLOW_DIR, "pipelines", p.id, `review-${rId}.md`)
    try {
      const content = await fs.readFile(f, "utf8")
      const m = content.match(/Verdict:\s*(PASS|FAIL)/i)
      if (m?.[1]?.toUpperCase() === "FAIL") allPass = false
      files.push(f)
    } catch {
      allPass = false
    }
  }
  return { files, allPass }
}

async function collectFindings(p: Pipeline): Promise<string> {
  const parts: string[] = []
  for (const rId of p.reviewers) {
    const f = path.join(WORKFLOW_DIR, "pipelines", p.id, `review-${rId}.md`)
    try {
      const content = await fs.readFile(f, "utf8")
      const m = content.match(/## Findings([\s\S]*?)(?=## Overall|$)/)
      if (m?.[1]?.trim()) parts.push(`-- reviewer ${rId} --\n${m[1].trim()}`)
    } catch {}
  }
  return parts.join("\n\n") || "(no findings section)"
}

async function readPipelines(): Promise<Record<string, Pipeline>> {
  return readJson<Record<string, Pipeline>>(PIPELINES, {})
}

async function savePipelines(pipes: Record<string, Pipeline>): Promise<void> {
  await writeJson(PIPELINES, pipes)
}

function log(p: Pipeline, msg: string): void {
  p.log.push(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
  p.updatedAt = new Date().toISOString()
}

export default function pipelineExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer("pipe-output", (message, _o, theme) => {
    return new Text(theme.fg("dim", String(message.content)), 0, 0)
  })
  const emit = (text: string) => {
    pi.sendMessage({ customType: "pipe-output", content: text, display: true })
  }

  async function startRca(p: Pipeline): Promise<void> {
    const rcaPath = path.join(p.dir, "rca.md")
    const implDir = path.join(os.homedir(), ".pi", "agent", "bg", p.implId ?? "")
    let tail = "(empty)"
    try {
      const content = readFileSync(path.join(implDir, "out.jsonl"), "utf8")
      const events = content
        .split("\n")
        .filter(Boolean)
        .slice(-25)
        .map((l) => {
          try {
            const e = JSON.parse(l)
            const ev = e.assistantMessageEvent
            const a = e.args
            return `[${e.type}]${ev && ev.type ? ` ${ev.type}` : ""}${a && a.command ? ` cmd=${String(a.command).slice(0, 120)}` : ""}${ev && ev.delta ? ` ${String(ev.delta).slice(0, 120)}` : ""}`
          } catch {
            return ""
          }
        })
        .filter(Boolean)
        .join("\n")
      tail = events || "(empty)"
    } catch {}
    const prompt = `Investigate why a background implementation agent appears stuck (no activity).

Implementer prompt: ${(p.implPrompt ?? p.statement).slice(0, 500)}

Recent events from its log (last 25):
\`\`\`
${tail.slice(0, 3000)}
\`\`\`

Its session file lives at ${implDir}/session/ but DO NOT read it in full — reason from the prompt + events above.

Write ${rcaPath} containing exactly:
# RCA
## Root cause
<one clear paragraph>
## Evidence
- concrete events/commands showing the loop
## Proposed fix
<exact steer message for the implementer, one line starting with "STEER:" — the pipeline forwards it verbatim>

Keep it short (under 250 words) and concrete. Do not use other tools beyond the write needed to produce ${rcaPath}.`
    const { id } = await spawnBgAgent({
      prompt,
      model: p.model,
      cwd: implDir,
      label: "rca",
      jjIsolation: false,
    })
    p.rcaId = id
    p.phase = "stuck"
    log(p, `RCA agent spawned (${id})`)
  }

  async function handleRcaDone(p: Pipeline): Promise<void> {
    const rcaPath = path.join(p.dir, "rca.md")
    let steerMsg = ""
    try {
      const content = await fs.readFile(rcaPath, "utf8")
      const m = content.match(/STEER:\s*(.+)/)
      if (m?.[1]) steerMsg = m[1].trim()
    } catch {}
    emit(`[pipeline ${p.id}] watchdog: implementer was stuck; RCA complete${steerMsg ? ` → steering implementer: "${steerMsg.slice(0, 160)}"` : ""}`)
    if (steerMsg && p.implId) {
      await runTmux(["send-keys", "-t", `pi-bg-${p.implId}`, "-l", JSON.stringify({ type: "steer", message: steerMsg })])
      await runTmux(["send-keys", "-t", `pi-bg-${p.implId}`, "Enter"])
    }
    p.phase = "implementing"
    log(p, `RCA done; back to implementing${steerMsg ? " (steered)" : ""}`)
  }

  async function startReview(p: Pipeline): Promise<void> {
    const implDir = path.join(os.homedir(), ".pi", "agent", "bg", p.implId ?? "")
    const implWork = p.implWorkDir ?? implDir
    p.reviewers = []
    for (let n = 0; n < p.maxReviewers; n++) {
      const id = genId(`review${n + 1}`)
      const outFile = path.join(p.dir, `review-${id}.md`)
      const prompt = `You are reviewer #${n + 1} in the pi-workflow review pipeline.

Review the change implemented by another agent.
Change location (worktree): ${implWork}
Review standards: ${STANDARDS}

Inspect the files under ${implWork} (that is the deliverable). Grade each of the five criteria per the standards. Write your review to this exact file: ${outFile} — use the reviewer output contract from the standards doc (Verdict: PASS|FAIL, one section per criterion, ## Findings, ## Overall). No padding.`
      const { id: rId } = await spawnBgAgent({
        prompt,
        model: p.model,
        cwd: implWork,
        label: `review${n + 1}`,
        jjIsolation: false,
        id,
      })
      p.reviewers.push(rId)
    }
    p.phase = "reviewing"
    log(p, `review round ${p.reviewRound} started (${p.maxReviewers} reviewers)`)
  }

  async function startFix(p: Pipeline): Promise<void> {
    const findings = await collectFindings(p)
    const implWork = p.implWorkDir ?? path.join(os.homedir(), ".pi", "agent", "bg", p.implId ?? "")
    const prompt = `You are the fix agent in the pi-workflow pipeline. Reviewers found issues with the implementation at ${implWork}.

Findings:
${findings.slice(0, 4000)}

Fix the concrete issues directly in ${implWork} (edit the files there). Do not over-engineer — apply the minimal correct fixes. When done, summarize exactly what you changed. Stop when addressed.`
    const { id } = await spawnBgAgent({
      prompt,
      model: p.model,
      cwd: implWork,
      label: `fix${p.reviewRound}`,
      jjIsolation: false,
    })
    p.fixerId = id
    p.phase = "fixing"
    log(p, `fix round ${p.reviewRound} spawned (${id})`)
  }

  async function finishClean(p: Pipeline): Promise<void> {
    const { files } = await readReviewVerdicts(p)
    const resultPath = path.join(p.dir, "result.md")
    const prPath = path.join(p.dir, "pr.md")
    await fs.writeFile(
      resultPath,
      `# Pipeline result — ${p.id}\n\n- statement: ${p.statement}\n- implementer: ${p.implId}\n- worktree: ${p.implWorkDir}\n- plan: ${p.planPath}\n- review rounds: ${p.reviewRound}\n- reviews: ${files.join(", ")}\n- status: clean\n`,
    )
    await fs.writeFile(
      prPath,
      `# PR: ${p.statement}\n\n## Summary\n${p.statement}\n\n## Change\n- worktree: ${p.implWorkDir}\n\n## Review\n- all ${p.maxReviewers} reviewers PASS (round ${p.reviewRound})\n- standards: ${STANDARDS}\n\n## Human-verifiable artifacts\n- [ ] plan: ${p.planPath}\n- [ ] implementation worktree: ${p.implWorkDir}\n- [ ] review files: ${files.join(", ")}\n- [ ] result: ${resultPath}\n`,
    )
    p.phase = "clean"
    log(p, `all reviews PASS after ${p.reviewRound} round(s); artifacts written`)
    emit(`[pipeline ${p.id}] clean — artifacts: ${resultPath}, ${prPath}`)
    if (p.doPr) {
      p.phase = "done"
      log(p, "PR creation requested (manual): artifacts ready")
    }
  }

  async function tick(): Promise<void> {
    const pipes = await readPipelines()
    let changed = false
    for (const p of Object.values(pipes)) {
      const before = p.phase
      switch (p.phase) {
        case "implementing": {
          if (!p.implId) break
          const implDir = path.join(os.homedir(), ".pi", "agent", "bg", p.implId)
          if (agentSettled(implDir)) {
            p.phase = "reviewing"
            p.reviewRound = 0
            log(p, "implementer settled; starting review")
            await startReview(p)
          } else if (
            (!p.lastRcaAt || Date.now() - p.lastRcaAt > p.stuckMs * 2) &&
            Date.now() - agentLastActivity(implDir) > p.stuckMs
          ) {
            p.lastRcaAt = Date.now()
            log(p, "watchdog: implementer stuck (no activity); spawning RCA")
            await startRca(p)
          }
          break
        }
        case "stuck": {
          if (p.rcaId) {
            const rcaDir = path.join(os.homedir(), ".pi", "agent", "bg", p.rcaId)
            if (agentSettled(rcaDir)) await handleRcaDone(p)
          }
          break
        }
        case "reviewing": {
          let allDone = true
          for (const rId of p.reviewers) {
            const rDir = path.join(os.homedir(), ".pi", "agent", "bg", rId)
            if (!agentSettled(rDir)) allDone = false
          }
          if (allDone) {
            const { allPass } = await readReviewVerdicts(p)
            if (allPass) {
              await finishClean(p)
            } else if (p.reviewRound >= p.maxReviewRounds) {
              p.phase = "failed"
              log(p, `review FAIL persists after ${p.reviewRound} rounds`)
            } else {
              p.reviewRound += 1
              await startFix(p)
            }
          }
          break
        }
        case "fixing": {
          if (p.fixerId) {
            const fDir = path.join(os.homedir(), ".pi", "agent", "bg", p.fixerId)
            if (agentSettled(fDir)) {
              log(p, `fix round ${p.reviewRound} done; re-reviewing`)
              await startReview(p)
            }
          }
          break
        }
      }
      if (p.phase !== before) changed = true
    }
    if (changed) await savePipelines(pipes)
  }

  const monitor = setInterval(() => {
    tick().catch((e) => {
      try {
        appendFileSync(
          path.join(WORKFLOW_DIR, "pipeline-debug.log"),
          `[${new Date().toISOString()}] tick error: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`,
        )
      } catch {}
    })
  }, MONITOR_MS)
  monitor.unref?.()

  pi.registerCommand("pipeline", {
    description:
      "Full workflow pipeline: /pipeline [--no-grill] [--model M] [--reviewers N] [--max-fix-loops N] [--stuck-ms MS] [--pr] <statement> | status [id] | list | cancel <id>",
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/)
      const cmd = tokens[0]
      try {
        if (cmd === "status") {
          const pipes = await readPipelines()
          const id = tokens[1]
          const rows = id ? [pipes[id]].filter(Boolean) : Object.values(pipes)
          if (rows.length === 0) return emit(id ? `unknown pipeline ${id}` : "no pipelines")
          emit(
            rows
              .map((p) => `  ${p.id}  [${p.phase}]  round=${p.reviewRound}  ${p.statement.slice(0, 60)}`)
              .join("\n"),
          )
          if (id && pipes[id]) {
            emit(pipes[id].log.slice(-12).join("\n"))
          }
          return
        }
        if (cmd === "list") {
          const pipes = await readPipelines()
          return emit(
            Object.values(pipes).length === 0
              ? "no pipelines"
              : Object.values(pipes).map((p) => `  ${p.id}  [${p.phase}]  ${p.statement.slice(0, 60)}`).join("\n"),
          )
        }
        if (cmd === "cancel") {
          const pipes = await readPipelines()
          const p = pipes[tokens[1]]
          if (!p) return emit(`unknown pipeline ${tokens[1]}`)
          p.phase = "failed"
          p.log.push("cancelled by user")
          for (const agentId of [p.implId, p.fixerId, p.rcaId, ...p.reviewers].filter(Boolean)) {
            await runTmux(["kill-session", "-t", `pi-bg-${agentId}`]).catch(() => {})
          }
          await savePipelines(pipes)
          return emit(`pipeline ${p.id} cancelled`)
        }

        let noGrill = false
        let doPr = false
        let model = "opencode-go/deepseek-v4-flash"
        let maxReviewers = 2
        let maxRounds = 3
        let stuckMs = 120_000
        let i = 0
        while (i < tokens.length && tokens[i].startsWith("--")) {
          if (tokens[i] === "--no-grill") noGrill = true
          else if (tokens[i] === "--pr") doPr = true
          else if (tokens[i] === "--model" && tokens[i + 1]) {
            model = tokens[i + 1]
            i += 1
          } else if (tokens[i] === "--reviewers" && tokens[i + 1]) {
            maxReviewers = parseInt(tokens[i + 1], 10)
            i += 1
          } else if (tokens[i] === "--max-fix-loops" && tokens[i + 1]) {
            maxRounds = parseInt(tokens[i + 1], 10)
            i += 1
          } else if (tokens[i] === "--stuck-ms" && tokens[i + 1]) {
            stuckMs = parseInt(tokens[i + 1], 10)
            i += 1
          }
          i += 1
        }
        const statement = tokens.slice(i).join(" ").trim()
        if (!statement) return emit("usage: /pipeline [flags] <statement>")

        const id = genId(statement)
        const dir = path.join(WORKFLOW_DIR, "pipelines", id)
        await fs.mkdir(dir, { recursive: true })
        const planPath = path.join(dir, "plan.md")
        await fs.writeFile(
          planPath,
          `# Goal\n- ${statement}\n\n## Scope\n- in:\n- out:\n\n## Files\n- []\n\n## Plan\n- [ ]\n\n## Acceptance\n- [ ]\n\n## Verification\n- how will you prove each acceptance item?\n`,
        )

        if (!noGrill) {
          const criteria = await ctx.ui.input("Acceptance criteria (contracts & BDD)?", "e.g. given X when Y then Z; comma-separated")
          const constraints = await ctx.ui.input("Constraints / out-of-scope?", "none")
          const p: Pipeline = {
            id, statement, phase: "planning", model, planPath, dir, reviewers: [],
            reviewRound: 0, maxReviewRounds: maxRounds, maxReviewers, stuckMs, doPr,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), log: [],
          }
          log(p, "grilled user on contracts & BDD")
          if (criteria) log(p, `acceptance: ${criteria}`)
          if (constraints) log(p, `constraints: ${constraints}`)
          p.statement = `${statement}\n\nAcceptance: ${criteria || "(as I judge best)"}\nConstraints: ${constraints || "none"}`
          const pipes = await readPipelines()
          pipes[id] = p
          await savePipelines(pipes)
          emit(`pipeline ${id} created (grilled)`)
        } else {
          const p: Pipeline = {
            id, statement, phase: "planning", model, planPath, dir, reviewers: [],
            reviewRound: 0, maxReviewRounds: maxRounds, maxReviewers, stuckMs, doPr,
            createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), log: [],
          }
          log(p, "no-grill: starting directly")
          const pipes = await readPipelines()
          pipes[id] = p
          await savePipelines(pipes)
          emit(`pipeline ${id} created (no-grill)`)
        }

        const pipes = await readPipelines()
        const p = pipes[id]
        const implPrompt = `You are the implementation agent. Task: ${p.statement}

First expand the plan at ${p.planPath} (structure: goal / scope / files / plan / acceptance / verification), then implement it in this workspace. Work autonomously and stop when the acceptance criteria are met. Summarize what you did and how it was verified. Keep the change minimal and clean.`
        const { id: implId, cwd: implCwd } = await spawnBgAgent({
          prompt: implPrompt,
          model: p.model,
          cwd: ctx.cwd,
          label: "impl",
          jjIsolation: true,
        })
        p.implId = implId
        p.implWorkDir = implCwd
        p.implPrompt = implPrompt
        p.phase = "implementing"
        log(p, `implementer spawned (${implId}) at ${implCwd}`)
        await savePipelines(pipes)
        emit(`pipeline ${id} running — implementer ${implId}\nstatus: /pipeline status ${id}`)
      } catch (e) {
        emit(`pipeline error: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  })
}
