#!/usr/bin/env bash
set -euo pipefail
npx --yes esbuild@0.23.1 tests/ui-questions.test.ts --bundle --format=esm --platform=node --alias:@earendil-works/pi-tui=./tests/pi-tui-stub.mjs --external:@earendil-works/pi-coding-agent --outfile=/tmp/ui-questions.mjs --log-level=warning && node /tmp/ui-questions.mjs
