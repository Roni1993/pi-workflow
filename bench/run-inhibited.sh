#!/usr/bin/env bash
# Block system suspend while the benchmark runs (desktop/KDE must not sleep mid-run).
# Usage: bench/run-inhibited.sh [args for run-bench.mjs]
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec systemd-inhibit --what=sleep --mode=block --why="pi-bench run" \
  node "$HERE/run-bench.mjs" "$@"
