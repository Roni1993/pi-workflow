// T4 — tools box. Re-registers every built-in tool with a self-rendered locked
// row (prototype pi-opencode-ui `toolLine` / `diffLines`), delegating execute()
// to the original built-in factory so behaviour is preserved.
//
// HOW THE MECHANISM WORKS (verified by tracer-a-pi-tui probe-transcript.ts):
//   pi.registerTool({ name: "<builtin>", ... })
// REPLACES that built-in entirely — execute included. To keep behaviour we
// obtain the original via its factory (`createBashTool(cwd)` etc.) and forward
// execute(). `renderShell: "self"` drops pi's default boxed shell.
//
// HONEST LIMITATION (do not "fix" by guessing):
//   Real pi renders each tool call as its OWN ToolExecutionComponent. The
//   prototype drew ONE card around ALL calls, with a single padding section and
//   one blank line between rows. That cross-call grouping is not reachable from
//   a per-tool renderer: each call gets its own `card()`. The achievable locked
//   look is one card per call, with a blank buffer line (pi prepends one for
//   renderShell:"self"), and the latest calls' bodies expanded. A module-level
//   "recent toolCallIds" list approximates the latest-3-open rule; it is
//   best-effort only and must never be relied on as exact.
import {
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type ExtensionAPI,
} from "@earendil-works/pi-coding-agent"
import { PAL, bold, card, fg, truncateAnsi, visibleWidth } from "./ui-kit"

/** Glyph per tool kind, exactly the prototype map. */
export const GLYPH: Record<string, string> = {
  bash: "●",
  read: "●",
  edit: "✎",
  glob: "◇",
  write: "✚",
}

/** Built-in name -> prototype kind (the icon palette only knows these kinds). */
export const KIND_ALIAS: Record<string, string> = {
  find: "glob",
}

/** Raw body input accepted by renderToolBody. */
export type ToolBodyInput =
  | string
  | string[]
  | { diff?: string; old?: string[]; new?: string[] }

/** A no-op component for renderResult when the body should stay collapsed. */
const EMPTY = { render: () => [] as string[], invalidate: () => {} }

// Best-effort "latest N calls expanded" state. renderCall notes ids; renderResult
// reads the tail. Never exact across processes/reloads, by design.
const RECENT: string[] = []
const RECENT_MAX = 12
const OPEN_TAIL = 3
// Result-derived summaries keyed by toolCallId, so the (already rendered) row
// can show `→ summary` once the result lands.
const SUMMARY = new Map<string, string>()

function noteRecent(id: string): void {
  const i = RECENT.indexOf(id)
  if (i !== -1) RECENT.splice(i, 1)
  RECENT.push(id)
  while (RECENT.length > RECENT_MAX) RECENT.shift()
}

function isRecent(id: string | undefined): boolean {
  if (typeof id !== "string") return false
  return RECENT.slice(-OPEN_TAIL).includes(id)
}

// ── pure render helpers (exported for the headless width test) ──────────────

function toolLine(kind: string, name: string, detail: string, summary: string): string {
  const k = KIND_ALIAS[kind] ?? kind
  const col = PAL.icon[k] ?? PAL.tools.rail
  const glyph = GLYPH[k] ?? "●"
  const head = detail ? `${name}  ${detail}` : name
  const label = summary ? `${head}  →  ${summary}` : head
  return bold(fg(col, glyph)) + " " + fg(col, label)
}

/** Prototype side-by-side diff (generateDiffString is unified; this is for old/new). */
function splitDiffLines(oldL: string[], newL: string[], width: number): string[] {
  const half = Math.max(8, Math.floor((width - 5) / 2))
  const rows: string[] = []
  const n = Math.max(oldL.length, newL.length)
  for (let i = 0; i < n; i++) {
    const l = oldL[i]
    const r = newL[i]
    const lc = l === undefined ? "" : truncateAnsi(fg(PAL.ctx, l), half)
    let rc = ""
    if (r !== undefined) {
      rc =
        l !== undefined && r === l
          ? truncateAnsi(fg(PAL.ctx, r), half)
          : truncateAnsi(fg(PAL.add, bold(r)), half)
    }
    const gap = " ".repeat(Math.max(0, half - visibleWidth(lc)))
    rows.push(lc + gap + fg(PAL.tools.rail, " │ ") + rc)
  }
  return rows
}

/** Unified diff string (edit result details.diff) colourised line by line. */
function unifiedDiffLines(diff: string): string[] {
  const out: string[] = []
  for (const raw of String(diff).split("\n")) {
    if (raw === "") continue
    const c = raw[0]
    if (c === "+") out.push(fg(PAL.add, bold("   " + raw)))
    else if (c === "-") out.push(fg(PAL.state.blocked, "   " + raw))
    else out.push(fg(PAL.ctx, "   " + raw))
  }
  return out
}

/** A locked tool row: one card, prototype `Name  detail  →  summary`. */
export function renderToolRow(
  kind: string,
  name: string,
  detail: string,
  summary: string,
  width: number,
): string[] {
  const content = [toolLine(kind, name, detail, summary)]
  return card(width, PAL.tools, content).map((l) => truncateAnsi(l, width))
}

/** A locked body card: text lines or a diff, always width-guarded. */
export function renderToolBody(
  _kind: string,
  body: ToolBodyInput,
  width: number,
): string[] {
  let lines: string[]
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as { diff?: string; old?: string[]; new?: string[] }
    if (Array.isArray(b.old) && Array.isArray(b.new)) lines = splitDiffLines(b.old, b.new, width)
    else if (typeof b.diff === "string") lines = unifiedDiffLines(b.diff)
    else lines = []
  } else {
    const arr = Array.isArray(body) ? body : typeof body === "string" ? body.split("\n") : []
    lines = arr.filter((l) => String(l) !== "").map((l) => fg(PAL.text, "   " + String(l)))
  }
  const content = lines.length ? lines : [fg(PAL.dim, "   (no output)")]
  return card(width, PAL.tools, content).map((l) => truncateAnsi(l, width))
}

// ── arg / result derivation (defensive: render only known fields) ───────────

function oneLine(s: unknown, max = 120): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim()
  return t.length > max ? t.slice(0, max - 1) + "…" : t
}

function argDetail(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, any>
  switch (name) {
    case "bash":
      return oneLine(a.command)
    case "read": {
      let d = oneLine(a.path ?? a.file_path)
      if (a.offset != null || a.limit != null) {
        const start = typeof a.offset === "number" ? a.offset : 1
        d += `:${start}${typeof a.limit === "number" ? `-${start + a.limit - 1}` : ""}`
      }
      return d
    }
    case "edit":
    case "write":
      return oneLine(a.path ?? a.file_path)
    case "find":
    case "grep":
      return oneLine(a.pattern)
    case "ls":
      return oneLine(a.path) || "."
    default:
      try {
        return oneLine(JSON.stringify(a))
      } catch {
        return ""
      }
  }
}

function argSummary(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, any>
  if (name === "edit" && Array.isArray(a.edits)) {
    return `${a.edits.length} edit${a.edits.length === 1 ? "" : "s"}`
  }
  if (name === "write" && typeof a.content === "string") return `${a.content.length}b`
  if (name === "grep" && a.glob) return oneLine(a.glob)
  return ""
}

function resultTextLines(result: unknown): string[] {
  const content = Array.isArray((result as any)?.content) ? (result as any).content : []
  return content
    .filter((c: any) => c?.type === "text")
    .map((c: any) => String(c?.text ?? ""))
    .join("\n")
    .split("\n")
    .filter((l: string) => l !== "")
}

function summarizeResult(
  name: string,
  result: unknown,
): { summary: string; body: ToolBodyInput } {
  const diff = (result as any)?.details?.diff
  if (name === "edit" && typeof diff === "string") {
    const lines = diff.split("\n")
    const plus = lines.filter((l: string) => l.startsWith("+")).length
    const minus = lines.filter((l: string) => l.startsWith("-")).length
    return { summary: `+${plus} −${minus}`, body: { diff } }
  }
  const lines = resultTextLines(result)
  const n = lines.length
  switch (name) {
    case "find":
      return { summary: `${n} file${n === 1 ? "" : "s"}`, body: lines }
    case "grep":
      return { summary: `${n} line${n === 1 ? "" : "s"}`, body: lines }
    case "ls":
      return { summary: `${n} entr${n === 1 ? "y" : "ies"}`, body: lines }
    case "read":
      return { summary: `${n} line${n === 1 ? "" : "s"}`, body: lines }
    case "write":
      return { summary: lines[0] ?? "written", body: lines }
    case "bash":
      return { summary: n ? `${n} line${n === 1 ? "" : "s"}` : "done", body: lines }
    default:
      return { summary: n ? `${n} line${n === 1 ? "" : "s"}` : "done", body: lines }
  }
}

// ── registration ────────────────────────────────────────────────────────────

/** tool name -> built-in factory (top-level import: registration is synchronous,
 * so the replacements land BEFORE pi reads the tool registry — no async race). */
const FACTORIES: Array<[string, (cwd: string, options?: any) => any]> = [
  ["bash", createBashTool],
  ["read", createReadTool],
  ["edit", createEditTool],
  ["write", createWriteTool],
  ["find", createFindTool],
  ["grep", createGrepTool],
  ["ls", createLsTool],
]

export function registerTools(pi: ExtensionAPI): void {
  if (typeof (pi as any)?.registerTool !== "function") return
  for (const [name, factory] of FACTORIES) {
    try {
      if (typeof factory !== "function") continue
      const original = factory(process.cwd())
      if (!original) continue
      const kind = KIND_ALIAS[name] ?? name
      ;(pi as any).registerTool({
        name,
        label: original.label ?? name,
        description: original.description ?? "",
        parameters: original.parameters,
        // Forward every behaviour-bearing field: prompt metadata (keeps the
        // tool in the system-prompt Available tools section), constrained
        // sampling, prepareArguments (edit normalizes arg shapes through it)
        // and executionMode.
        promptSnippet: original.promptSnippet,
        promptGuidelines: original.promptGuidelines,
        constrainedSampling: original.constrainedSampling,
        prepareArguments: original.prepareArguments,
        executionMode: original.executionMode,
        renderShell: "self",
        execute: (...a: any[]) => (original.execute as any)(...a),
        renderCall: (args: any, _theme: any, context: any) => {
          const id = context?.toolCallId
          if (typeof id === "string") noteRecent(id)
          const summary =
            (typeof id === "string" ? SUMMARY.get(id) : undefined) ?? argSummary(name, args)
          const detail = argDetail(name, args)
          const display = name.charAt(0).toUpperCase() + name.slice(1)
          return {
            render: (width: number) => renderToolRow(kind, display, detail, summary, width),
            invalidate: () => {},
          }
        },
        renderResult: (result: any, options: any, _theme: any, context: any) => {
          const id = context?.toolCallId
          let summary = ""
          let body: ToolBodyInput = []
          try {
            const s = summarizeResult(name, result)
            summary = s.summary
            body = s.body
          } catch {
            // unknown result shape — render nothing extra
          }
          if (typeof id === "string" && summary && SUMMARY.get(id) !== summary) {
            SUMMARY.set(id, summary)
            try {
              context?.invalidate?.()
            } catch {
              // renderer must never throw into pi's render loop
            }
          }
          const expanded = !!options?.expanded || !!context?.expanded || isRecent(id)
          if (!expanded) return EMPTY
          return {
            render: (width: number) => renderToolBody(kind, body, width),
            invalidate: () => {},
          }
        },
      })
    } catch {
      // A missing/renamed/new built-in must never break registration.
    }
  }
}

