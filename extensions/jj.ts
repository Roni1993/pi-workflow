import { execFile } from "node:child_process"
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent"
import { Text } from "@earendil-works/pi-tui"

function runJj(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile("jj", args, { timeout: 60_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || stdout).trim() || err.message))
      else resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

const USAGE = `usage: /jj status | log | new [msg] | describe <msg> | diff | push
  status   show current rev + change status
  log      show recent commits (jj log -n 10)
  new      create a new change (optional message)
  describe set the description of the current change
  diff     show the current change diff
  push     push to remote (always confirms first)` 

export default function jjExtension(pi: ExtensionAPI) {
  pi.registerMessageRenderer("jj-output", (message, _o, theme) => {
    return new Text(theme.fg("dim", String(message.content)), 0, 0)
  })
  const emit = (text: string) => {
    pi.sendMessage({ customType: "jj-output", content: text, display: true })
  }

  pi.registerCommand("jj", {
    description: "Jujutsu status/describe/push with confirmation (colocated repos)",
    handler: async (args, ctx) => {
      const [cmd, ...rest] = args.trim().split(/\s+/)
      try {
        switch (cmd) {
          case "status": {
            const { stdout } = await runJj(["status"])
            emit(`\`\`\`\n${stdout.trim()}\n\`\`\``)
            break
          }
          case "log": {
            const { stdout } = await runJj(["log", "-n", rest[0] ?? "10"])
            emit(`\`\`\`\n${stdout.trim()}\n\`\`\``)
            break
          }
          case "new": {
            const msg = rest.join(" ")
            const { stdout } = await runJj(msg ? ["new", "-m", msg] : ["new"])
            emit(`\`\`\`\n${stdout.trim() || "created new change"}\n\`\`\``)
            break
          }
          case "describe": {
            const msg = rest.join(" ")
            if (!msg) throw new Error("describe requires a message")
            await runJj(["describe", "-m", msg])
            emit(`described: ${msg}`)
            break
          }
          case "diff": {
            const { stdout } = await runJj(["diff", "--color", "never"])
            const truncated = stdout.length > 4000 ? stdout.slice(0, 4000) + "\n… (truncated)" : stdout
            emit(`\`\`\`\n${truncated}\n\`\`\``)
            break
          }
          case "push": {
            const remote = rest[0] ?? "origin"
            const dry = await runJj(["git", "push", "--remote", remote, "--dry-run"]).catch((e) => {
              throw new Error(`dry-run failed: ${e instanceof Error ? e.message : e}`)
            })
            const confirmed = await ctx.ui.confirm(
              `Push ${remote}?`,
              `\`\`\`\n${dry.stdout.trim()}\n\`\`\`\nProceed with jj git push --remote ${remote}?`,
            )
            if (!confirmed) {
              emit("push cancelled")
              break
            }
            const { stdout } = await runJj(["git", "push", "--remote", remote])
            emit(`\`\`\`\n${stdout.trim() || "pushed"}\n\`\`\``)
            break
          }
          default:
            emit(USAGE)
        }
      } catch (e) {
        emit(`jj error: ${e instanceof Error ? e.message : String(e)}`)
      }
    },
  })
}
