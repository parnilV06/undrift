#!/usr/bin/env bash
set -euo pipefail

npm install
npm run typecheck
npm run build

echo "UNDRIFT scaffold is ready."
