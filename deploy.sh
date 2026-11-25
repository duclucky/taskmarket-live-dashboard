#!/bin/bash
# One-command deploy: refresh the data, then publish to GitHub Pages (main branch).
# First-time setup, once: in the repository settings, enable GitHub Pages with
# source "Deploy from a branch", branch "main", folder "/ (root)".
# After that, this script is the whole deploy.
set -euo pipefail
cd "$(dirname "$0")"
node scripts/fetch.mjs
git add -A
git commit -m "Refresh market data" || true
git push origin HEAD:main
echo "Deployed. Live URL: https://duclucky.github.io/taskmarket-live-dashboard/"
