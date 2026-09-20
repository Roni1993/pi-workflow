#!/usr/bin/env bash
set -euo pipefail
npx --yes esbuild@0.23.1 tests/ui-widechars.test.ts --bundle --format=esm --platform=node --alias:@earendil-works/pi-tui=./tests/pi-tui-stub.mjs --alias:@earendil-works/pi-coding-agent=./tests/pi-coding-agent-stub.mjs --outfile=/tmp/ui-widechars.mjs --log-level=warning && node /tmp/ui-widechars.mjs
