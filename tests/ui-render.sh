#!/usr/bin/env bash
set -euo pipefail
npx --yes esbuild@0.23.1 tests/ui-render.test.ts --bundle --format=esm --platform=node --outfile=/tmp/ui-render.mjs --log-level=warning && node /tmp/ui-render.mjs
