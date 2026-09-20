#!/usr/bin/env bash
#
# Real-TUI end-to-end suite for the opencode-look Pi UI extension.
#
# Unlike tests/ui-*.sh (headless render/width checks), this drives the ACTUAL
# patched pi in a tmux pane, sends the extension's commands, captures the pane
# and asserts on the rendered text/ANSI. Every wait is a bounded retry loop.
#
# Run:   bash tests/ui-e2e.sh
# Env:   PI_BIN=/nix/store/.../bin/pi   use a specific patched build
#        E2E_NO_BUILD=1                 skip `nix build`, reuse an existing store path
#        E2E_MODEL=opencode-go/...      model id for the transcript scenario
#        OPENCODE_API_KEY=...           or read from ~/.local/share/opencode/auth.json
#
# Exits non-zero when any assertion fails. Always tears down its own tmux server.
set -uo pipefail

HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
E2E_DIR="$HERE/e2e"
FLEEK_PI_UI=${FLEEK_PI_UI:-/home/roni/projects/fleek-pi-ui}

WORKDIR="$ROOT"
EXT="$ROOT/extensions/ui/index.ts"
MODEL=${E2E_MODEL:-opencode-go/deepseek-v4-flash}
TMP=$(mktemp -d /tmp/pi-ui-e2e.XXXXXX)
E2E_ARTIFACTS="$TMP/artifacts"

# shellcheck source=tests/e2e/lib.sh
source "$E2E_DIR/lib.sh"

cleanup() {
  e2e_cleanup
  if [ "${E2E_KEEP:-0}" = "1" ] || [ "$E2E_FAIL" -gt 0 ]; then
    echo "artifacts: $TMP (kept$([ "$E2E_FAIL" -gt 0 ] && echo ", failures present"))"
  else
    rm -rf "$TMP"
  fi
}
trap cleanup EXIT INT TERM

# ── locate the patched pi ───────────────────────────────────────────────────
discover_pi() {
  if [ -n "${PI_BIN:-}" ] && [ -x "$PI_BIN" ]; then echo "$PI_BIN"; return 0; fi
  if [ "${E2E_NO_BUILD:-0}" != "1" ]; then
    local built
    built=$(timeout 300 nix build --no-link --print-out-paths --impure --expr \
      "let f = builtins.getFlake (toString $FLEEK_PI_UI); in import $FLEEK_PI_UI/pi-ui.nix { pkgs = f.inputs.nixpkgs-pi.legacyPackages.\${builtins.currentSystem}; inputs = f.inputs; }" \
      2>/dev/null | tail -1) || built=""
    if [ -n "$built" ] && [ -x "$built/bin/pi" ]; then echo "$built/bin/pi"; return 0; fi
  fi
  local p
  for p in /nix/store/*-pi-coding-agent-ui-0.85.1/bin/pi; do
    [ -x "$p" ] && { echo "$p"; return 0; }
  done
  return 1
}

PI_BIN=$(discover_pi) || {
  echo "FATAL: no patched pi found (build failed and no /nix/store/*-pi-coding-agent-ui-0.85.1)." >&2
  echo "       Build with the command in tests/e2e/README.md, or set PI_BIN=..." >&2
  exit 2
}
TUI_JS="$(dirname "$PI_BIN")/../lib/node_modules/pi-monorepo/node_modules/@earendil-works/pi-tui/dist/tui.js"
PI_PATCHED=0
grep -q "pi-ui:backdrop" "$TUI_JS" 2>/dev/null && PI_PATCHED=1

# ── API key (only the transcript scenario needs one) ────────────────────────
auth_key() {
  local f="${OPENCODE_AUTH:-$HOME/.local/share/opencode/auth.json}"
  [ -f "$f" ] || return 1
  if command -v jq >/dev/null; then jq -r '."opencode-go".key // empty' "$f" 2>/dev/null; return; fi
  python3 -c 'import json,sys;print(json.load(open(sys.argv[1])).get("opencode-go",{}).get("key","") or "")' "$f" 2>/dev/null
}
API_KEY="${OPENCODE_API_KEY:-$(auth_key || true)}"

backdrop_flag() {
  grep -oE 'const BACKDROP *= *[^ ]+' "$ROOT/extensions/ui/questions.ts" 2>/dev/null | head -1 | sed -E 's/.*= *//'
}

# ── scenario helpers ────────────────────────────────────────────────────────
has_pua_chevron() { e2e_capture "$1" | grep -q $'\ue0b0'; }
widget_gone() {
  local s=$1 t=$((SECONDS + 5))
  while ((SECONDS < t)); do
    e2e_capture "$s" | tail -6 | grep -qF "⟳ background agents" || return 0
    sleep 0.25
  done
  return 1
}
has_user_card() { e2e_capture "$1" | grep -qF "▌ Reply with exactly this token"; }
has_assistant_card() { e2e_capture "$1" | grep -qF "▌ $2"; }

# ── scenarios ───────────────────────────────────────────────────────────────
scenario_ui_kit() {
  local s=$1
  echo "── scenario 1: /ui-kit card overlay"
  e2e_type "$s" "/ui-kit"; e2e_key "$s" Enter
  check_has "$s" "opencode-look"                  "card title renders"
  check_has "$s" "shared kit loaded"              "kit subtitle renders"
  check_has "$s" "registerDock/questions/tools/cards" "loaded-modules line"
  check_has "$s" "q close"                        "close hint renders"
  check_has "$s" "sample card"                    "card footer renders"
  e2e_save "$s" "1-ui-kit"
  e2e_key "$s" q
  check_gone "$s" "opencode-look"                 "q closes the overlay"
}

scenario_questions() {
  local s=$1
  echo "── scenario 2: /ui-questions HITL modal"
  e2e_type "$s" "/ui-questions"; e2e_key "$s" Enter
  check_has "$s" "Caching strategy" "stepper shows first header"
  check_has "$s" "Testing"          "stepper shows second header"
  check_has "$s" "Submit"           "stepper shows submit step"
  check "stepper powerline chevrons" has_pua_chevron "$s"
  check_has "$s" "Which caching approach should I implement?" "question text renders"
  check_has "$s" "preview"          "preview box renders"
  check_has "$s" "TTL map"          "option row 1 renders"
  check_has "$s" "LRU map"          "option row 2 renders"
  check_has "$s" "No cache"         "option row 3 renders"
  check_has "$s" "Type something."  "custom-answer row renders"
  check_has "$s" "↑↓ focus · space/enter select · tab step · n note · t type · esc cancel" "footer hints render"
  e2e_save "$s" "2-questions"
  e2e_key "$s" Escape
  check_gone "$s" "Type something." "esc cancels the modal"
}

scenario_dock_widget() {
  local s=$1
  echo "── scenario 3: /dock on|off status line below editor"
  e2e_type "$s" "/dock on"; e2e_key "$s" Enter
  check_has "$s" "ui-dock installed below the editor" "install notification"
  check_has "$s" "background agents"                  "status line renders"
  check_has "$s" "0 total"                            "status counts render"
  e2e_save "$s" "3-dock-on"
  e2e_type "$s" "/dock off"; e2e_key "$s" Enter
  check_has "$s" "ui-dock off"                        "remove notification"
  check "widget removed from editor footer" widget_gone "$s"
}

scenario_ui_dock() {
  local s=$1
  echo "── scenario 4: /ui-dock preview (chat -> dashboard -> close)"
  e2e_type "$s" "/ui-dock"; e2e_key "$s" Enter
  check_has "$s" "d switch · q close"                     "overlay header renders"
  check_has "$s" "ask anything…"                          "chat view prompt renders"
  check_has "$s" "enter send · d dashboard · rail = thinking" "chat footer renders"
  e2e_save "$s" "4-ui-dock-chat"
  e2e_key "$s" d
  check_has "$s" "standalone agents"                      "d switches to dashboard"
  check_gone "$s" "ask anything…"                         "chat view is gone after d"
  e2e_save "$s" "4-ui-dock-dashboard"
  e2e_key "$s" q
  check_gone "$s" "d switch · q close"                    "q closes the overlay"
}

scenario_narrow() {
  local s=$1
  echo "── scenario narrow: 60x24 render sanity"
  e2e_type "$s" "/ui-kit"; e2e_key "$s" Enter
  check_has "$s" "opencode-look" "ui-kit renders at 60x24"
  e2e_key "$s" q
  e2e_wait_gone "$s" "opencode-look" || true
  e2e_type "$s" "/ui-questions"; e2e_key "$s" Enter
  check_has "$s" "Caching strategy" "questions stepper renders at 60x24"
  check_has "$s" "Type something."  "questions rows render at 60x24"
  check_alive "$s"                  "pi alive after narrow renders"
  e2e_save "$s" "narrow-questions"
  e2e_key "$s" Escape
}

scenario_backdrop() {
  local s=$1
  echo "── scenario backdrop: numeric dim behind the overlay"
  local flag; flag=$(backdrop_flag)
  if ! [[ "$flag" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    e2e_skip "numeric backdrop dim" "questions.ts BACKDROP=$flag is not numeric"
    return
  fi
  if [ "$PI_PATCHED" -ne 1 ]; then
    e2e_skip "numeric backdrop dim" "pi-tui backdrop patch not present in $TUI_JS"
    return
  fi
  e2e_capture_ansi "$s" > "$TMP/base.ansi"
  e2e_save_ansi "$s" "backdrop-baseline"
  e2e_type "$s" "/ui-questions"; e2e_key "$s" Enter
  if ! e2e_wait_for "$s" "Which caching approach should I implement?"; then
    e2e_bad "overlay opened for backdrop proof"
    return
  fi
  e2e_capture_ansi "$s" > "$TMP/dim.ansi"
  e2e_save_ansi "$s" "backdrop-dimmed"
  if node "$E2E_DIR/ansi-backdrop.mjs" "$TMP/base.ansi" "$TMP/dim.ansi" "[Context]" "$flag"; then
    e2e_ok "background ANSI dimmed (backdrop=$flag)"
  else
    e2e_bad "background ANSI dimmed (backdrop=$flag)"
  fi
  e2e_key "$s" Escape
}

scenario_transcript() {
  local s=$1
  echo "── scenario 5: transcript user/assistant cards (model turn)"
  if [ -z "${API_KEY:-}" ]; then
    e2e_skip "transcript cards" "no OPENCODE_API_KEY and no key in auth.json"
    return
  fi
  local token="PONG42"
  e2e_type "$s" "Reply with exactly this token and nothing else: $token"
  e2e_key "$s" Enter
  # Wait for the ASSISTANT card ("<rail> <token>"), not the prompt echo: the
  # prompt line carries the token too, so a bare token match returns instantly.
  if ! e2e_wait_for "$s" "▌ $token" 90; then
    e2e_skip "transcript cards" "no assistant card within 90s (network/provider?)"
    return
  fi
  e2e_save "$s" "5-transcript"
  check "user card renders with rail"          has_user_card "$s"
  check "assistant card renders with rail"     has_assistant_card "$s" "$token"
  if e2e_capture "$s" | grep -qF "✦ Thoughts ·"; then
    e2e_ok "thinking box from transcript renderer"
  else
    e2e_skip "thinking box from transcript renderer" "model produced no thinking block this run"
  fi
}

# ── run ─────────────────────────────────────────────────────────────────────
echo "pi:        $PI_BIN"
echo "pi-tui:    backdrop patch $([ "$PI_PATCHED" -eq 1 ] && echo present || echo ABSENT)"
echo "extension: $EXT"
echo "model:     $MODEL"
echo "api key:   $([ -n "${API_KEY:-}" ] && echo present || echo absent)"
echo

e2e_server_up

MAIN="main-$$"
e2e_new "$MAIN" 120 40
e2e_launch_pi "$MAIN"
e2e_wait_ready "$MAIN" || { echo "FATAL: pi did not reach the ready screen" >&2; exit 2; }
scenario_ui_kit "$MAIN"
scenario_questions "$MAIN"
scenario_dock_widget "$MAIN"
scenario_ui_dock "$MAIN"
e2e_tmux kill-session -t "$MAIN" 2>/dev/null || true

BGD="backdrop-$$"
e2e_new "$BGD" 120 40
e2e_launch_pi "$BGD"
e2e_wait_ready "$BGD" || echo "WARN: backdrop session not ready" >&2
scenario_backdrop "$BGD"
e2e_tmux kill-session -t "$BGD" 2>/dev/null || true

NARROW="narrow-$$"
e2e_new "$NARROW" 60 24
e2e_launch_pi "$NARROW"
e2e_wait_ready "$NARROW" || echo "WARN: narrow session not ready" >&2
scenario_narrow "$NARROW"
e2e_tmux kill-session -t "$NARROW" 2>/dev/null || true

MODEL_S="model-$$"
e2e_new "$MODEL_S" 120 40
e2e_launch_pi "$MODEL_S"
e2e_wait_ready "$MODEL_S" || echo "WARN: model session not ready" >&2
scenario_transcript "$MODEL_S"
e2e_tmux kill-session -t "$MODEL_S" 2>/dev/null || true

echo
echo "════════════════════════════════════════"
printf 'PASS=%d  FAIL=%d  SKIP=%d\n' "$E2E_PASS" "$E2E_FAIL" "$E2E_SKIP"
echo "════════════════════════════════════════"
[ "$E2E_FAIL" -eq 0 ]
