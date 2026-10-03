#!/usr/bin/env bash
# Put `jev-triage` on your PATH, pointing at this checkout.
set -euo pipefail
repo=$(cd "$(dirname "$0")" && pwd)
bin=${JEV_TRIAGE_BIN_DIR:-$HOME/.local/bin}
mkdir -p "$bin" "$HOME/.jev/triage"
printf '#!/bin/sh\nexec node "%s/triage.mjs" "$@"\n' "$repo" > "$bin/jev-triage"
chmod +x "$bin/jev-triage"
echo "Installed $bin/jev-triage"
