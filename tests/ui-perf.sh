#!/usr/bin/env bash
set -euo pipefail
# UI performance harness. READ-ONLY against ~/.pi/agent/bg; fixtures only under /tmp.
# PERF_PROFILE=1 also runs the harness under --cpu-prof and prints the top self-time fns.
OUT=/tmp/ui-perf.mjs
# shellcheck source=tests/lib-pi-tui.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-pi-tui.sh"
npx --yes esbuild@0.23.1 tests/ui-perf.ts --bundle --format=esm --platform=node --alias:@earendil-works/pi-tui="$PI_TUI_JS" --external:@earendil-works/pi-coding-agent --outfile="$OUT" --log-level=warning

if [[ "${PERF_PROFILE:-0}" == "1" ]]; then
  PROF_DIR=/tmp/perf-prof
  rm -rf "$PROF_DIR"
  mkdir -p "$PROF_DIR"
  node --cpu-prof --cpu-prof-dir="$PROF_DIR" --cpu-prof-name=ui-perf.cpuprofile "$OUT"
  node tests/ui-prof-summary.mjs "$PROF_DIR/ui-perf.cpuprofile"
else
  node "$OUT"
fi
