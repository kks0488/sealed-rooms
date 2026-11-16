#!/usr/bin/env bash
# 시험: bash scripts/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p artifacts
npm test > artifacts/test.tap 2>&1
tail -10 artifacts/test.tap
for source in src/*.js scripts/*.js; do node --check "$source"; done
npm run build > artifacts/build.log 2>&1
cat artifacts/build.log
node scripts/capture.mjs > artifacts/capture.log 2>&1
cat artifacts/capture.log
