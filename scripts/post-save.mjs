#!/usr/bin/env node

/**
 * Post-save hook script for Sealed Rooms
 * 
 * Triggered by .kiro/hooks/test-on-save.json on PostFileSave events.
 * Logs hook event and runs npm test.
 */

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const artifactDir = path.resolve(repoRoot, 'artifacts');

// Ensure artifacts dir exists
if (!fs.existsSync(artifactDir)) {
  fs.mkdirSync(artifactDir, { recursive: true });
}

// Read hook event from stdin
let event = null;
try {
  const stdin = fs.readFileSync(0, 'utf-8');
  event = JSON.parse(stdin);
} catch (e) {
  // No stdin or invalid JSON
}

const timestamp = new Date().toISOString();
const filename = event?.file_path || event?.file?.path || 'unknown';
const eventName = event?.hook_event_name || 'unknown';
const payloadKeys = event ? Object.keys(event).join(',') : 'none';

// Log event to hook-events.jsonl
const eventRecord = {
  timestamp,
  filename,
  eventName,
  payloadKeys,
};
fs.appendFileSync(
  path.resolve(artifactDir, 'hook-events.jsonl'),
  JSON.stringify(eventRecord) + '\n'
);

console.log(`[${timestamp}] ${eventName}: ${filename}`);

// Run npm test
let testOutput = '';
let testExitCode = 0;
try {
  testOutput = execSync('npm test', {
    cwd: repoRoot,
    encoding: 'utf-8',
    stdio: 'pipe',
  });
} catch (e) {
  testOutput = e.stdout ? e.stdout.toString() : '';
  testExitCode = e.status || 1;
}

// Append test output to hook-tests.log
fs.appendFileSync(
  path.resolve(artifactDir, 'hook-tests.log'),
  `\n--- ${timestamp} ${filename} (exit ${testExitCode}) ---\n` + testOutput
);

// Append result summary to hook-events.jsonl
const resultRecord = {
  timestamp,
  filename,
  testExitCode,
};
fs.appendFileSync(
  path.resolve(artifactDir, 'hook-events.jsonl'),
  JSON.stringify(resultRecord) + '\n'
);

process.exit(testExitCode);
