#!/usr/bin/env bash
# Shared tmux helpers for the real-TUI end-to-end suite.
#
# A dedicated tmux socket (E2E_SOCK) isolates the run: global options set here
# never touch the user's tmux server, and kill-server on exit leaves nothing
# behind. Every wait is a bounded retry loop, never a bare sleep, so a run is
# tolerant of pi's startup/render jitter without being slow when things are ready.
#
# Requires from the caller: PI_BIN, EXT, WORKDIR, MODEL, API_KEY (may be empty).
# Optional: E2E_SOCK (defaults to a per-PID socket), E2E_WAIT_TIMEOUT (5s).

TMUX_BIN=${TMUX_BIN:-tmux}
E2E_SOCK=${E2E_SOCK:-piui-e2e-$$}
E2E_WAIT_TIMEOUT=${E2E_WAIT_TIMEOUT:-5}

E2E_PASS=0
E2E_FAIL=0
E2E_SKIP=0

e2e_tmux() { "$TMUX_BIN" -L "$E2E_SOCK" "$@"; }

e2e_server_up() {
  e2e_tmux start-server 2>/dev/null || true
  # Stop pi's yellow "extended-keys is off" warning from polluting captures.
  e2e_tmux set-option -g extended-keys on 2>/dev/null || true
}

e2e_new() { # name [cols] [rows]
  local name=$1 cols=${2:-120} rows=${3:-40}
  e2e_tmux kill-session -t "$name" 2>/dev/null || true
  e2e_tmux new-session -d -s "$name" -x "$cols" -y "$rows"
}

e2e_launch_pi() { # name
  local name=$1
  local cmd="cd $WORKDIR; $PI_BIN"
  [ -n "${API_KEY:-}" ] && cmd="$cmd --api-key '$API_KEY'"
  cmd="$cmd -ne -e $EXT --provider opencode-go --model $MODEL"
  # pi runs under the user's default shell (nushell here); send the line literally.
  e2e_tmux send-keys -t "$name" -l "$cmd"
  e2e_tmux send-keys -t "$name" Enter
}

e2e_type() { e2e_tmux send-keys -t "$1" -l "$2"; }
e2e_key() { local name=$1; shift; e2e_tmux send-keys -t "$name" "$@"; }

e2e_capture() { e2e_tmux capture-pane -t "$1" -p 2>/dev/null; }
e2e_capture_ansi() { e2e_tmux capture-pane -t "$1" -e -p 2>/dev/null; }

e2e_wait_for() { # name pattern [timeout]
  local name=$1 pat=$2 timeout=${3:-$E2E_WAIT_TIMEOUT}
  local deadline=$((SECONDS + timeout))
  while ((SECONDS < deadline)); do
    e2e_capture "$name" | grep -qF -- "$pat" && return 0
    sleep 0.25
  done
  return 1
}

e2e_wait_gone() { # name pattern [timeout]
  local name=$1 pat=$2 timeout=${3:-$E2E_WAIT_TIMEOUT}
  local deadline=$((SECONDS + timeout))
  while ((SECONDS < deadline)); do
    e2e_capture "$name" | grep -qF -- "$pat" || return 0
    sleep 0.25
  done
  return 1
}

e2e_wait_ready() { # name — ready once the banner or the model status bar is drawn
  # At narrow widths the long startup banner scrolls off, so the bottom model
  # status line ("<model> • high") is the width-robust ready marker.
  local name=$1 t=$((SECONDS + ${READY_TIMEOUT:-20})) model_short="${MODEL##*/}"
  while ((SECONDS < t)); do
    local cap; cap=$(e2e_capture "$name")
    if grep -qF "escape interrupt" <<<"$cap" || { [ -n "$model_short" ] && grep -qF "$model_short • high" <<<"$cap"; }; then
      return 0
    fi
    sleep 0.25
  done
  return 1
}

e2e_save() { # name label — plain-text pane capture for evidence
  mkdir -p "$E2E_ARTIFACTS"; e2e_capture "$1" > "$E2E_ARTIFACTS/$2.txt"
}
e2e_save_ansi() { # name label — ANSI pane capture for evidence
  mkdir -p "$E2E_ARTIFACTS"; e2e_capture_ansi "$1" > "$E2E_ARTIFACTS/$2.ansi"
}

e2e_session_alive() { # name — pi still owns the pane and has not crashed
  e2e_tmux has-session -t "$1" 2>/dev/null || return 1
  local dead
  dead=$(e2e_capture "$1" | grep -cE "Process exited|panic:|Unhandled|FATAL" || true)
  [ "$dead" -eq 0 ]
}

# ── assertion plumbing ──────────────────────────────────────────────────────
e2e_ok()   { printf '  PASS  %s\n' "$1"; E2E_PASS=$((E2E_PASS + 1)); }
e2e_bad()  { printf '  FAIL  %s\n' "$1"; E2E_FAIL=$((E2E_FAIL + 1)); }
e2e_skip() { printf '  SKIP  %s (%s)\n' "$1" "$2"; E2E_SKIP=$((E2E_SKIP + 1)); }

check() { # label command...
  local label=$1; shift
  if "$@"; then e2e_ok "$label"; else e2e_bad "$label"; fi
}

check_has()    { local s=$1 p=$2 l=$3; check "$l" e2e_wait_for "$s" "$p"; }
check_gone()   { local s=$1 p=$2 l=$3; check "$l" e2e_wait_gone "$s" "$p"; }
check_alive()  { local s=$1 l=$2;   check "$l" e2e_session_alive "$s"; }

e2e_cleanup() {
  e2e_tmux kill-server 2>/dev/null || true
  # kill-server can leave a dead socket file behind; remove ours specifically.
  rm -f "/tmp/tmux-$(id -u)/$E2E_SOCK" 2>/dev/null || true
}
