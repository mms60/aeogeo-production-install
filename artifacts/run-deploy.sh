#!/bin/bash
set -euo pipefail
STAGE=/workspace/chats/7d63e5ed87185ce38da4c709/artifacts/deploy-2026-11-20
cd "$STAGE"
rm -rf site .netlify
cp -a ../../site site
set -a
. /workspace/chats/7d63e5ed87185ce38da4c709/.env.local
set +a
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
exec npx --yes netlify@27.20.1 deploy --build --prod --site 5e907ce6-0971-4862-9d52-651026e37c00 --message "Add footer AI visibility disclaimer"
