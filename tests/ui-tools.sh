#!/usr/bin/env bash
set -euo pipefail
# tools.ts imports the built-in tool factories at top level (synchronous
# registration), so the headless bundle aliases pi-coding-agent to a stub
# exporting fake create*Tool factories instead of marking it --external.
npx --yes esbuild@0.23.1 tests/ui-tools.test.ts --bundle --format=esm --platform=node --alias:@earendil-works/pi-tui=./tests/pi-tui-stub.mjs --alias:@earendil-works/pi-coding-agent=./tests/pi-coding-agent-stub.mjs --outfile=/tmp/ui-tools.mjs --log-level=warning && node /tmp/ui-tools.mjs
