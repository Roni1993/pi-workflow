#!/usr/bin/env bash
# Resolve the REAL installed @earendil-works/pi-tui so the headless suites
# measure with the same engine pi validates rendered lines with.
#
# The old tests/pi-tui-stub.mjs hand-rolled visibleWidth/truncateToWidth and
# counted ✅ (U+2705) as 1 while pi counts 2 — the exact blind spot that let a
# card line pass the suite and crash pi. Do not go back to a stub.
#
# Sourced by tests/ui-*.sh. Exports:
#   PI_TUI_JS   absolute path to @earendil-works/pi-tui/dist/index.js
#   PI_BIN_RESOLVED
#
# Resolution: `pi` lives at <store>/bin/pi and pi-tui at
# <store>/lib/node_modules/pi-monorepo/node_modules/@earendil-works/pi-tui/dist/index.js.
# PI_BIN overrides the PATH lookup. Fails loudly rather than falling back.
set -euo pipefail

resolve_pi_tui() {
  local pi_bin="" store="" candidate=""
  if [ -n "${PI_BIN:-}" ] && [ -x "${PI_BIN}" ]; then
    pi_bin="$PI_BIN"
  else
    pi_bin="$(command -v pi || true)"
  fi
  if [ -n "$pi_bin" ]; then
    store="$(dirname "$(dirname "$(readlink -f "$pi_bin")")")"
    candidate="$store/lib/node_modules/pi-monorepo/node_modules/@earendil-works/pi-tui/dist/index.js"
    if [ -f "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  fi
  # No `pi` on PATH (CI): use any pi-coding-agent that ships pi-tui.
  for candidate in /nix/store/*-pi-coding-agent-*/lib/node_modules/pi-monorepo/node_modules/@earendil-works/pi-tui/dist/index.js; do
    [ -f "$candidate" ] && { printf '%s' "$candidate"; return 0; }
  done
  return 1
}

PI_BIN_RESOLVED="$(readlink -f "$(command -v pi 2>/dev/null)" 2>/dev/null || true)"
PI_TUI_JS="$(resolve_pi_tui)" || {
  echo "FATAL: real @earendil-works/pi-tui not found." >&2
  echo "       Put a patched pi on PATH, or set PI_BIN=/nix/store/.../bin/pi." >&2
  exit 2
}
export PI_TUI_JS PI_BIN_RESOLVED
