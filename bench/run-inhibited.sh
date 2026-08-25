#!/usr/bin/env bash
# Block system suspend while the benchmark runs (desktop/KDE must not sleep mid-run).
# Starts the standalone pipeline monitor alongside the harness.
# Usage: bench/run-inhibited.sh [args for run-bench.mjs]
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec systemd-inhibit --what=sleep --mode=block --why="pi-bench run" \
  bash -c '
    set -u
    MON_PID=""
    cleanup() { [ -n "$MON_PID" ] && kill "$MON_PID" 2>/dev/null; }
    trap cleanup EXIT
    node "$1/pipeline-monitor.mjs" >> "$2/monitor.log" 2>&1 &
    MON_PID=$!
    exec node "$1/run-bench.mjs" "${@:3}"
  ' _ "$HERE" "$HERE" "$@"
