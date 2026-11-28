#!/usr/bin/env bash
# Verify: bash scripts/verify.sh
set -euo pipefail
cd "$(dirname "$0")/.."
output_dir=${1:-artifacts}
mkdir -p "$output_dir"
npm test > "$output_dir/test.tap" 2>&1
tail -10 "$output_dir/test.tap"
for source in src/*.js scripts/*.js; do node --check "$source"; done
npm run build > "$output_dir/build.log" 2>&1
cat "$output_dir/build.log"
node scripts/capture.mjs "$@" > "$output_dir/capture.log" 2>&1
cat "$output_dir/capture.log"
