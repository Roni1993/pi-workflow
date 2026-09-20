# Real-TUI end-to-end tests (`tests/ui-e2e.sh`)

The `tests/ui-*.sh` suites are headless: they bundle a renderer against a pi-tui
stub and assert on returned strings/widths. They prove no-crash and width-safety,
but not that the look actually reaches a terminal, that overlays open, that keys
are handled, or that the pi-tui backdrop dim engages.

This suite drives the **actual patched pi** in a tmux pane, sends the real
commands, captures the pane, and asserts on rendered text/ANSI.

## Run

```sh
bash tests/ui-e2e.sh
```

The script builds/reuses the patched pi from `fleek-pi-ui`, runs each scenario
in a private tmux server (socket `piui-e2e-<pid>`), prints `PASS`/`FAIL`/`SKIP`
per assertion, and exits non-zero if any assertion failed. It always kills its
tmux server on exit.

Useful env vars:

| Var | Meaning |
|---|---|
| `PI_BIN` | use a specific patched `bin/pi` (skips discovery) |
| `E2E_NO_BUILD=1` | skip `nix build`; reuse an existing store path |
| `E2E_MODEL` | model id for the transcript scenario (default `opencode-go/deepseek-v4-flash`) |
| `OPENCODE_API_KEY` | key for the model scenario; else read from `~/.local/share/opencode/auth.json` |

Build the patched pi by hand (if discovery cannot):

```sh
nix build --no-link --print-out-paths --impure --expr \
  'let f = builtins.getFlake (toString /home/roni/projects/fleek-pi-ui);
   in import /home/roni/projects/fleek-pi-ui/pi-ui.nix { pkgs = f.inputs.nixpkgs-pi.legacyPackages.x86_64-linux; inputs = f.inputs; }'
```

## Scenarios

| # | Session | Drives | Asserts |
|---|---|---|---|
| 1 | `main` 120x40 | `/ui-kit` then `q` | card title/subtitle/footer/close hint appear; `q` removes the overlay |
| 2 | `main` | `/ui-questions` then `esc` | powerline stepper (headers + chevron), question, preview, 3 option rows, `Type something.`, footer hints; `esc` cancels |
| 3 | `main` | `/dock on` then `/dock off` | below-editor status line renders (`background agents`, `0 total`); off notification and widget removal |
| 4 | `main` | `/ui-dock`, `d`, `q` | chat header/footer, `d` switches to dashboard, `q` closes |
| 5 | `model` 120x40 | a plain prompt | user + assistant transcript cards render with the rail; thinking box when present |
| — | `narrow` 60x24 | `/ui-kit`, `/ui-questions` | both render without crashing at narrow width |
| — | `backdrop` 120x40 | `/ui-questions` over the startup screen | numeric `backdrop` in `questions.ts` dims the base transcript: a witness line's truecolor fg is scaled ~x`BACKDROP` |

## Backdrop proof

`tests/e2e/ansi-backdrop.mjs` takes the baseline ANSI capture (before the
overlay) and the overlay capture, finds the `[Context]` witness line (outside
the overlay), reads its truecolor fg before/after, and asserts the after value
is strictly less and approximates `factor * before` per channel.

If `BACKDROP` in `extensions/ui/questions.ts` is not numeric, the scenario is
reported as `SKIP` (with the flag value) rather than failed — the dim only
engages for a numeric factor, and `questions.ts` is owned by another ticket.
The skip also fires if the running pi-tui lacks the `pi-ui:backdrop` marker.

## Files

- `tests/ui-e2e.sh` — entry point, scenario definitions, build discovery.
- `tests/e2e/lib.sh` — tmux lifecycle + bounded-retry assertion helpers.
- `tests/e2e/ansi-backdrop.mjs` — truecolor witness comparison for the dim.
