#!/usr/bin/env node

/**
 * server.js — Local development server for Sealed Rooms
 *
 * Native Node.js HTTP server, no dependencies
 * Serves from dist/ or src/ directories
 * Binds to 127.0.0.1, PORT=0 for dynamic assignment or explicit port
 * Path traversal protection via URL.parse safe resolution
 */

import fs from 'fs';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const distDir = path.resolve(projectRoot, 'dist');

// MIME types
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return mimeTypes[ext] || 'application/octet-stream';
}

function resolveSafePath(urlPath) {
  // Strip leading slash and decode URL
  let normalized = decodeURIComponent(urlPath);
  if (normalized.startsWith('/')) {
    normalized = normalized.slice(1);
  }
  
  // Normalize path (resolve . and ..)
  normalized = path.normalize(normalized);
  
  // Reject parent directory traversal
  if (normalized.startsWith('..') || normalized.startsWith('..' + path.sep)) {
    return null;
  }
  
  // Try dist first
  const distPath = path.resolve(distDir, normalized);
  if (distPath.startsWith(distDir + path.sep) || distPath === distDir) {
    if (fs.existsSync(distPath)) {
      return distPath;
    }
  }
  
  // Try project root fallback for specific files (index.html, journal.csv, etc)
  const projectPath = path.resolve(projectRoot, normalized);
  if (projectPath.startsWith(projectRoot + path.sep) || projectPath === projectRoot) {
    if (fs.existsSync(projectPath)) {
      return projectPath;
    }
  }
  
  // Default to dist/index.html if root requested
  if (normalized === '' || normalized === '.') {
    const indexPath = path.resolve(distDir, 'index.html');
    if (fs.existsSync(indexPath)) return indexPath;
  }
  
  return null;
}

const server = http.createServer((req, res) => {
  // Parse URL safely
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const filePath = resolveSafePath(url.pathname);
  
  if (!filePath) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
    return;
  }
  
  // Check if path is a directory
  const stat = fs.statSync(filePath, { throwIfNoEntry: false });
  if (!stat) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
    return;
  }
  
  if (stat.isDirectory()) {
    const indexPath = path.join(filePath, 'index.html');
    const indexStat = fs.statSync(indexPath, { throwIfNoEntry: false });
    if (indexStat && indexStat.isFile()) {
      res.writeHead(200, { 'Content-Type': getMimeType(indexPath) });
      res.end(fs.readFileSync(indexPath));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found\n');
    return;
  }
  
  // Serve file
  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': getMimeType(filePath) });
    res.end(content);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Server Error: ${e.message}\n`);
  }
});

// Bind to 127.0.0.1, port 0 or explicit PORT env var
const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 0;
const host = '127.0.0.1';

server.listen(port, host, () => {
  const addr = server.address();
  console.log(`Sealed Rooms server: http://${addr.address}:${addr.port}`);
  console.log(`Serving from: ${distDir}`);
});

server.on('error', (err) => {
  console.error('Server error:', err.message);
  process.exit(1);
});
