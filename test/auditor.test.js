import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { processData } from '../src/data.js';
import { buildLayout, applyBankStatements } from '../src/geometry.js';
import { buildAuditWalk, isPointInRect, isSegmentInside } from '../src/auditor.js';

// Auditor tests for Sealed Rooms walkthrough validation (PostFileSave hook test)
const journalText = fs.readFileSync('./journal.csv', 'utf8');
const bankData    = JSON.parse(fs.readFileSync('./bank-statement.json', 'utf8'));

function makeLayout(csvText) {
  const r = processData(csvText);
  if (!r.valid) throw new Error(r.errors.join(', '));
  const layout = buildLayout(r.transactions);
  return applyBankStatements(layout, bankData.records, r.transactions);
}

const originalLayout = makeLayout(journalText);
const repairedText   = fs.readFileSync('./samples/sample-repaired.csv', 'utf8');
const repairedLayout = makeLayout(repairedText);

// No-evidence layout: same journal but every evidence cleared
const noEvText = (() => {
  const result = processData(journalText);
  // Blank every evidence field in the raw CSV by creating transactions with evidence=null
  // Use repaired CSV but zero out evidence column
  const lines = journalText.split('\n');
  const header = lines[0];
  const cols = header.split(',');
  const evIdx = cols.findIndex(c => c.trim() === 'evidence');
  const rows = lines.slice(1).map(line => {
    if (!line.trim()) return line;
    const parts = line.split(',');
    parts[evIdx] = '';
    return parts.join(',');
  });
  return [header, ...rows].join('\n');
})();
const noEvLayout = makeLayout(noEvText);

// ── helpers ──────────────────────────────────────────────────────────────────

function allRects(layout) {
  return [
    ...layout.rooms.map(r => ({ x: r.x, y: r.y, w: r.w, h: r.h })),
    ...layout.corridors.map(c => ({ x: c.x, y: c.y, w: c.w, h: c.h })),
  ];
}

// ── tests ─────────────────────────────────────────────────────────────────────

test('isPointInRect', () => {
  const r = { x: 10, y: 20, w: 30, h: 40 };
  assert.ok(isPointInRect({ x: 15, y: 25 }, r));
  assert.ok(isPointInRect({ x: 10, y: 20 }, r));
  assert.ok(isPointInRect({ x: 40, y: 60 }, r));
  assert.ok(!isPointInRect({ x: 5,  y: 25 }, r));
  assert.ok(!isPointInRect({ x: 50, y: 25 }, r));
});

test('isSegmentInside uses both endpoints in same rect', () => {
  const rects = [{ x: 0, y: 0, w: 100, h: 100 }];
  assert.ok( isSegmentInside({ x: 10, y: 10 }, { x: 90, y: 90 }, rects));
  assert.ok(!isSegmentInside({ x: 10, y: 10 }, { x: 110, y: 10 }, rects));
  assert.ok(!isSegmentInside({ x: 150, y: 150 }, { x: 160, y: 160 }, rects));
});

test('original: exactly 20 visited rooms', () => {
  const { visitedRooms } = buildAuditWalk(originalLayout);
  assert.equal(visitedRooms.length, 20);
});

test('repaired: exactly 23 visited rooms', () => {
  const { visitedRooms } = buildAuditWalk(repairedLayout);
  assert.equal(visitedRooms.length, 23);
});

test('no-evidence: 0 visited rooms, 1 waypoint (entrance)', () => {
  const { visitedRooms, waypoints } = buildAuditWalk(noEvLayout);
  assert.equal(visitedRooms.length, 0);
  assert.equal(waypoints.length, 1);
});

test('no sealed rooms in visitedRooms', () => {
  const { visitedRooms } = buildAuditWalk(originalLayout);
  for (const id of visitedRooms) {
    const room = originalLayout.rooms.find(r => r.id === id);
    assert.ok(room, `room ${id} not found`);
    assert.ok(!room.sealed, `room ${id} is sealed but was visited`);
  }
});

test('start and end waypoints are inside ENTRANCE rect', () => {
  const entrance = originalLayout.corridors.find(c => c.id === 'ENTRANCE');
  assert.ok(entrance, 'ENTRANCE corridor missing');
  const entranceRect = { x: entrance.x, y: entrance.y, w: entrance.w, h: entrance.h };

  const { waypoints } = buildAuditWalk(originalLayout);
  assert.ok(waypoints.length > 0, 'no waypoints');
  assert.ok(isPointInRect(waypoints[0], entranceRect), 'first waypoint not in ENTRANCE');
  assert.ok(isPointInRect(waypoints[waypoints.length - 1], entranceRect), 'last waypoint not in ENTRANCE');
});

test('every consecutive waypoint pair is inside the same convex rect', () => {
  const rects = allRects(originalLayout);
  const { waypoints } = buildAuditWalk(originalLayout);
  for (let i = 0; i < waypoints.length - 1; i++) {
    const ok = isSegmentInside(waypoints[i], waypoints[i + 1], rects);
    assert.ok(ok, `waypoints[${i}]→[${i+1}] cross rect boundary: `
      + `(${waypoints[i].x.toFixed(1)},${waypoints[i].y.toFixed(1)}) → `
      + `(${waypoints[i+1].x.toFixed(1)},${waypoints[i+1].y.toFixed(1)})`);
  }
});
