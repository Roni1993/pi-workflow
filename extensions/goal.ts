import * as fs from "node:fs/promises"
import * as path from "node:path"
import * as os from "node:os"
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"
import { Type } from "@earendil-works/pi-ai"
import { defineTool } from "@earendil-works/pi-coding-agent"

const DIR = path.join(os.homedir(), ".pi", "agent", "pi-workflow")
const STATE = path.join(DIR, "goal.json")

interface GoalState {
  goal: string
  status: "active" | "paused" | "done" | "blocked"
  planPath: string
  note?: string
  createdAt: string
  updatedAt: string
}

const EMPTY: GoalState = {
  goal: "",
  status: "paused",
  planPath: "",
  createdAt: "",
  updatedAt: "",
}

async function readState(): Promise<GoalState> {
  try {
    return { ...EMPTY, ...(JSON.parse(await fs.readFile(STATE, "utf8")) as GoalState) }
  } catch {
    return { ...EMPTY }
  }
}

async function writeState(s: GoalState): Promise<void> {
  await fs.mkdir(DIR, { recursive: true })
  s.updatedAt = new Date().toISOString()
  await fs.writeFile(STATE, JSON.stringify(s, null, 2))
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "goal"
}

const PLAN_TEMPLATE = `# Goal

<!-- expand this into a concrete plan doc; keep it a checklist you can execute -->

## Goal
- <goal statement>

## Scope
- in:
- out:

## Files
- []

## Plan
- [ ]

## Acceptance
- [ ]

## Verification
- how will you prove each acceptance item?
`

function planDocPath(goal: string): string {
  return path.join(DIR, "goals", slugify(goal), "plan.md")
}

async function ensurePlan(goal: string): Promise<string> {
  const p = planDocPath(goal)
  await fs.mkdir(path.dirname(p), { recursive: true })
  try {
    await fs.access(p)
  } catch {
    await fs.writeFile(p, PLAN_TEMPLATE.replace("## Goal\n- <goal statement>", `## Goal\n- ${goal}`))
  }
  return p
}

export default function goalExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer("goal-output", (message, _o, theme) => {
    return new Text(theme.fg("dim", String(message.content)), 0, 0)
  })
  const emit = (text: string) => {
    pi.sendMessage({ customType: "goal-output", content: text, display: true })
  }

  pi.registerCommand("goal", {
    description:
      "Goal state machine: /goal <statement> | status | pause | resume | done | blocked <reason> | clear",
    handler: async (args, _ctx) => {
      const [cmd, ...rest] = args.trim().split(/\s+/)
      const state = await readState()
      try {
        switch (cmd) {
          case "status": {
            if (!state.goal) return emit("no active goal — /goal <statement>")
            emit(
              `goal [${state.status}]: ${state.goal}\nplan: ${state.planPath || "(not set)"}${state.note ? `\nnote: ${state.note}` : ""}`,
            )
            break
          }
          case "pause": {
            state.status = "paused"
            await writeState(state)
            emit(`goal paused: ${state.goal}`)
            break
          }
          case "resume": {
            state.status = "active"
            await writeState(state)
            emit(`goal resumed: ${state.goal}`)
            break
          }
          case "done": {
            state.status = "done"
            await writeState(state)
            emit(`goal done: ${state.goal}`)
            break
          }
          case "blocked": {
            state.status = "blocked"
            state.note = rest.join(" ")
            await writeState(state)
            emit(`goal blocked: ${state.goal}\nreason: ${state.note}`)
            break
          }
          case "clear": {
            await writeState({ ...EMPTY, updatedAt: new Date().toISOString() })
            emit("goal cleared")
            break
          }
          default: {
            const goal = args.trim()
            if (!goal) {
              return emit(
                "usage: /goal <statement> | status | pause | resume | done | blocked <reason> | clear",
              )
            }
            const planPath = await ensurePlan(goal)
            const s: GoalState = {
              goal,
              status: "active",
              planPath,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
            await writeState(s)
            pi.sendUserMessage(
              `[goal] Expand and execute this goal.\n\nGoal: ${goal}\n\nPlan doc (fill it in, then work the checklist): ${planPath}\n\nRequired structure (from the workflow contract): goal / scope / files / plan / acceptance / verification. When the goal is satisfied, call goal_complete(summary). If you hit a blocker you cannot resolve, call goal_blocked(reason, evidence).`,
            )
          }
        }
      } catch (e) {
        emit(`goal error: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  })

  pi.registerTool(
    defineTool({
      name: "goal_complete",
      description: "Mark the active goal as complete with a summary of what was delivered.",
      parameters: Type.Object({
        summary: Type.String({ description: "What was delivered and how it was verified" }),
      }),
      async execute(_id, params) {
        const s = await readState()
        s.status = "done"
        s.note = params.summary
        await writeState(s)
        return { content: [{ type: "text", text: `goal complete: ${s.goal}` }], details: {} }
      },
    }),
  )

  pi.registerTool(
    defineTool({
      name: "goal_blocked",
      description:
        "Mark the active goal as blocked with a reason and evidence (use before stopping on an unresolvable blocker).",
      parameters: Type.Object({
        reason: Type.String({ description: "Why the goal is blocked" }),
        evidence: Type.String({ description: "Supporting evidence" }),
      }),
      async execute(_id, params) {
        const s = await readState()
        s.status = "blocked"
        s.note = `${params.reason}\nEvidence: ${params.evidence}`
        await writeState(s)
        return { content: [{ type: "text", text: `goal blocked: ${s.goal}` }], details: {} }
      },
    }),
  )
}
