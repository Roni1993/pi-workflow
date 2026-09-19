#!/usr/bin/env bash
set -euo pipefail
npx --yes esbuild@0.23.1 tests/ui-tools.test.ts --bundle --format=esm --platform=node --alias:@earendil-works/pi-tui=./tests/pi-tui-stub.mjs --external:@earendil-works/pi-coding-agent --outfile=/tmp/ui-tools.mjs --log-level=warning && node /tmp/ui-tools.mjs
