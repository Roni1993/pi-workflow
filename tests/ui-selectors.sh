#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tests/lib-pi-tui.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib-pi-tui.sh"
npx --yes esbuild@0.23.1 tests/ui-selectors.test.ts --bundle --format=esm --platform=node --alias:@earendil-works/pi-tui="$PI_TUI_JS" --external:@earendil-works/pi-coding-agent --outfile=/tmp/ui-selectors.mjs --log-level=warning && node /tmp/ui-selectors.mjs
