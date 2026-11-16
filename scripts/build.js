#!/usr/bin/env node
/**
 * Build script for Sealed Rooms
 * Copies assets to dist/ directory for production
 * No dependencies, no network, offline operation
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.resolve(rootDir, 'dist');

/**
 * Recursively create directory if it doesn't exist
 */
function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Copy file to destination, creating parent directories as needed
 */
function copyFile(src, dst) {
  const dstDir = path.dirname(dst);
  ensureDir(dstDir);
  fs.copyFileSync(src, dst);
}

/**
 * Recursively copy directory contents
 */
function copyDir(src, dst) {
  ensureDir(dst);
  const entries = fs.readdirSync(src, { withFileTypes: true });
  
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      copyFile(srcPath, dstPath);
    }
  }
}

/**
 * Main build function
 */
function build() {
  console.log('Building Sealed Rooms...');
  
  // Ensure dist directory exists
  ensureDir(distDir);
  
  // Check required files exist
  const requiredFiles = {
    'index.html': path.join(rootDir, 'index.html'),
    'journal.csv': path.join(rootDir, 'journal.csv'),
    'bank-statement.json': path.join(rootDir, 'bank-statement.json'),
    'src/main.js': path.join(rootDir, 'src', 'main.js'),
    'src/renderer.js': path.join(rootDir, 'src', 'renderer.js'),
    'src/style.css': path.join(rootDir, 'src', 'style.css'),
  };
  
  const missing = [];
  for (const [name, filePath] of Object.entries(requiredFiles)) {
    if (!fs.existsSync(filePath)) {
      missing.push(name);
    }
  }
  
  if (missing.length > 0) {
    throw new Error(`Build failed: missing required files: ${missing.join(', ')}`);
  }
  
  // Copy index.html
  const indexSrc = path.join(rootDir, 'index.html');
  copyFile(indexSrc, path.join(distDir, 'index.html'));
  console.log('✓ Copied index.html');
  
  // Copy journal.csv
  const journalSrc = path.join(rootDir, 'journal.csv');
  copyFile(journalSrc, path.join(distDir, 'journal.csv'));
  console.log('✓ Copied journal.csv');
  
  // Copy bank-statement.json
  const bankSrc = path.join(rootDir, 'bank-statement.json');
  copyFile(bankSrc, path.join(distDir, 'bank-statement.json'));
  console.log('✓ Copied bank-statement.json');
  
  // Copy entire src/ directory
  const srcDir = path.join(rootDir, 'src');
  const distSrcDir = path.join(distDir, 'src');
  copyDir(srcDir, distSrcDir);
  console.log('✓ Copied src/');
  
  // Copy samples directory
  const samplesSrc = path.join(rootDir, 'samples');
  if (fs.existsSync(samplesSrc)) {
    const samplesDst = path.join(distDir, 'samples');
    copyDir(samplesSrc, samplesDst);
    console.log('✓ Copied samples/');
  }
  
  console.log(`Build complete! Output: ${distDir}`);
}

// Run build
try {
  build();
} catch (err) {
  console.error('Build failed:', err.message);
  process.exit(1);
}
