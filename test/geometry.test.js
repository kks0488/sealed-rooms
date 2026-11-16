/**
 * test/geometry.test.js
 *
 * Tests for src/geometry.js
 * Covers: area formula, room counts, overlap, door gaps, physical reachability
 * (original=20, repaired=23, no-evidence=0), amount-change alters geometry,
 * bank-statement window (match vs mismatch), unplaced connections.
 */

import { readFileSync } from 'fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { processData } from '../src/data.js';
import {
  buildLayout,
  findOverlaps,
  validateDoorGaps,
  applyBankStatements,
  calcRoomWidth,
  ROOM_DEPTH, AREA_K, MIN_AREA, WALL, DOOR_W,
} from '../src/geometry.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const journalCSV  = readFileSync(new URL('../journal.csv',              import.meta.url), 'utf8');
const repairedCSV = readFileSync(new URL('../samples/sample-repaired.csv', import.meta.url), 'utf8');
const bankStmt    = JSON.parse(readFileSync(new URL('../bank-statement.json', import.meta.url), 'utf8'));

function buildOriginal() {
  const r = processData(journalCSV);
  assert.equal(r.valid, true, 'fixture must be valid');
  return { result: r, layout: buildLayout(r.transactions) };
}

function buildRepaired() {
  const r = processData(repairedCSV);
  assert.equal(r.valid, true, 'repaired must be valid');
  return { result: r, layout: buildLayout(r.transactions) };
}

// Strip all evidence refs from a CSV
function stripEvidence(csv) {
  return csv.split('\n').map((line, i) => {
    if (i === 0) return line;
    const p = line.split(',');
    if (p.length < 7) return line;
    p[5] = '';
    return p.join(',');
  }).join('\n');
}

// Build a minimal valid 2-row CSV with one transaction
function miniCSV(id, debitAcc, creditAcc, cents, evidence, memo) {
  const hdr = 'transaction,date,account,debit_cents,credit_cents,evidence,memo';
  return `${hdr}\n${id},2026-09-01,${debitAcc},${cents},0,${evidence},"${memo}"\n${id},2026-09-01,${creditAcc},0,${cents},${evidence},"${memo}"\n`;
}

// ---------------------------------------------------------------------------
// calcRoomWidth formula
// ---------------------------------------------------------------------------

test('calcRoomWidth: minimum area applies when cents small', () => {
  const w = calcRoomWidth(0);
  assert.equal(w, Math.round(MIN_AREA / ROOM_DEPTH));
});

test('calcRoomWidth: scales with gross cents above minimum', () => {
  const bigCents = 2000000;
  const expected = Math.round(bigCents * AREA_K / ROOM_DEPTH);
  assert.ok(expected > Math.round(MIN_AREA / ROOM_DEPTH));
  assert.equal(calcRoomWidth(bigCents), expected);
});

test('calcRoomWidth: larger cents gives larger width', () => {
  assert.ok(calcRoomWidth(2000000) > calcRoomWidth(500000));
});

// ---------------------------------------------------------------------------
// Room counts
// ---------------------------------------------------------------------------

test('original: 23 leaf rooms (all 24 accounts minus bank)', () => {
  const { layout } = buildOriginal();
  assert.equal(layout.rooms.length, 23);
});

test('original: bank (1000) is a corridor, not a room', () => {
  const { layout } = buildOriginal();
  assert.ok(!layout.rooms.some(r => r.account === '1000'));
  assert.ok(layout.corridors.some(c => c.account === '1000'));
});

test('original: 3 sealed rooms (1090, 5080, 5090)', () => {
  const { layout } = buildOriginal();
  const sealed = layout.rooms.filter(r => r.sealed).map(r => r.id).sort();
  assert.deepEqual(sealed, ['1090', '5080', '5090']);
});

test('original: sealedAccounts list equals 3 IDs', () => {
  const { layout } = buildOriginal();
  assert.equal(layout.sealedAccounts.length, 3);
  assert.ok(layout.sealedAccounts.includes('1090'));
  assert.ok(layout.sealedAccounts.includes('5080'));
  assert.ok(layout.sealedAccounts.includes('5090'));
});

// ---------------------------------------------------------------------------
// No overlaps
// ---------------------------------------------------------------------------

test('original: no room-room overlaps', () => {
  const { layout } = buildOriginal();
  const ovl = findOverlaps(layout.rooms);
  assert.deepEqual(ovl, [], `Overlapping rooms: ${JSON.stringify(ovl)}`);
});

test('original: no corridor-corridor overlaps', () => {
  const { layout } = buildOriginal();
  const ovl = findOverlaps(layout.corridors);
  assert.deepEqual(ovl, [], `Overlapping corridors: ${JSON.stringify(ovl)}`);
});

test('original: no room-corridor overlaps', () => {
  const { layout } = buildOriginal();
  const ovl = findOverlaps([...layout.rooms, ...layout.corridors]);
  assert.deepEqual(ovl, [], `Overlapping rects: ${JSON.stringify(ovl)}`);
});

// ---------------------------------------------------------------------------
// Door gaps
// ---------------------------------------------------------------------------

test('original: 20 doors (23 rooms - 3 sealed)', () => {
  const { layout } = buildOriginal();
  assert.equal(layout.doors.length, 20);
});

test('original: all door gaps valid (wall alignment, width, within room+corridor)', () => {
  const { layout } = buildOriginal();
  const errors = validateDoorGaps(layout.rooms, layout.corridors, layout.doors);
  assert.deepEqual(errors, [], `Door errors: ${errors.join('; ')}`);
});

test('original: sealed rooms have no door', () => {
  const { layout } = buildOriginal();
  const sealedIds = new Set(layout.rooms.filter(r => r.sealed).map(r => r.id));
  for (const door of layout.doors) {
    assert.ok(!sealedIds.has(door.roomId), `Sealed room ${door.roomId} has a door`);
  }
});

test('original: door gap width equals DOOR_W', () => {
  const { layout } = buildOriginal();
  for (const door of layout.doors) {
    const gw = Math.abs(door.gapX2 - door.gapX1);
    assert.equal(gw, DOOR_W, `Room ${door.roomId} gap width ${gw}`);
  }
});

// ---------------------------------------------------------------------------
// Physical reachability
// ---------------------------------------------------------------------------

test('original: 20 physically reachable leaf rooms', () => {
  const { layout } = buildOriginal();
  assert.equal(layout.reachableRooms.size, 20);
});

test('original: sealed rooms not physically reachable', () => {
  const { layout } = buildOriginal();
  for (const id of ['1090', '5080', '5090']) {
    assert.ok(!layout.reachableRooms.has(id), `Sealed ${id} should not be reachable`);
  }
});

test('repaired: 23 physically reachable leaf rooms', () => {
  const { layout } = buildRepaired();
  assert.equal(layout.reachableRooms.size, 23);
});

test('repaired: 0 sealed rooms', () => {
  const { layout } = buildRepaired();
  assert.equal(layout.sealedAccounts.length, 0);
  assert.equal(layout.rooms.filter(r => r.sealed).length, 0);
});

test('no-evidence: 0 physically reachable leaf rooms', () => {
  const stripped = stripEvidence(journalCSV);
  const r = processData(stripped);
  assert.equal(r.valid, true);
  const layout = buildLayout(r.transactions);
  assert.equal(layout.reachableRooms.size, 0);
});

test('no-evidence: evidence BFS reaches only 1000', () => {
  const stripped = stripEvidence(journalCSV);
  const r = processData(stripped);
  assert.deepEqual([...r.reachable], ['1000']);
});

// ---------------------------------------------------------------------------
// Amount changes alter geometry
// ---------------------------------------------------------------------------

test('amount change: larger gross cents → wider room', () => {
  // Build a 1-tx layout with small amount, then big amount
  const small = miniCSV('J9001', '1010', '1000', '100000', 'EV-S1', 'small');
  const big   = miniCSV('J9001', '1010', '1000', '5000000', 'EV-S1', 'big');

  const rSmall = processData(small);
  const rBig   = processData(big);
  assert.equal(rSmall.valid, true);
  assert.equal(rBig.valid, true);

  const lSmall = buildLayout(rSmall.transactions);
  const lBig   = buildLayout(rBig.transactions);

  const roomSmall = lSmall.rooms.find(r => r.account === '1010');
  const roomBig   = lBig.rooms.find(r => r.account === '1010');
  assert.ok(roomBig.w > roomSmall.w, `Big room (${roomBig.w}) not wider than small (${roomSmall.w})`);
});

test('amount change: spineX shifts right when west accounts grow larger', () => {
  const small = miniCSV('J9001', '1010', '1000', '100000', 'EV-S1', 'small');
  const big   = miniCSV('J9001', '1010', '1000', '9999999', 'EV-S1', 'big');

  const lSmall = buildLayout(processData(small).transactions);
  const lBig   = buildLayout(processData(big).transactions);

  assert.ok(lBig.spineX > lSmall.spineX, `spineX should grow: small=${lSmall.spineX} big=${lBig.spineX}`);
});

test('new account: adding a new account ID creates a new room', () => {
  // A CSV with account 2000 that is not in the fixture
  const csv = miniCSV('J9002', '2000', '1000', '500000', 'EV-N1', 'new liab');
  const r = processData(csv);
  assert.equal(r.valid, true);
  const layout = buildLayout(r.transactions);
  assert.ok(layout.rooms.some(r => r.account === '2000'));
});

// ---------------------------------------------------------------------------
// Bank statement windows
// ---------------------------------------------------------------------------

test('bankMatch: window created for exact evidence+cents+account match', () => {
  const { result, layout } = buildOriginal();
  const withWindows = applyBankStatements(layout, bankStmt.records, result.transactions);
  assert.ok(withWindows.windows.length > 0, 'Expected at least one window');
  const ev1Window = withWindows.windows.find(w => w.evidence === 'EV-0001');
  assert.ok(ev1Window, 'EV-0001 should produce a window');
  assert.equal(ev1Window.account, '1010');
});

test('bankMatch: mismatch (wrong cents) produces no window', () => {
  const { result, layout } = buildOriginal();
  const wrongStmt = [{ evidence: 'EV-0001', cents: 999999, account: '1010' }];
  const withWindows = applyBankStatements(layout, wrongStmt, result.transactions);
  assert.equal(withWindows.windows.length, 0, 'Mismatch should not produce window');
});

test('bankMatch: mismatch (wrong account) produces no window', () => {
  const { result, layout } = buildOriginal();
  const wrongAcc = [{ evidence: 'EV-0001', cents: 18000, account: '5000' }];
  const withWindows = applyBankStatements(layout, wrongAcc, result.transactions);
  assert.equal(withWindows.windows.length, 0);
});

test('bankMatch: mismatch (wrong evidence ref) produces no window', () => {
  const { result, layout } = buildOriginal();
  const wrongEv = [{ evidence: 'EV-XXXX', cents: 18000, account: '1010' }];
  const withWindows = applyBankStatements(layout, wrongEv, result.transactions);
  assert.equal(withWindows.windows.length, 0);
});

test('bankMatch: bank participation alone does not produce window', () => {
  // Build statement that matches a bank-side posting (account 1000) but not via EV+cents+account
  const { result, layout } = buildOriginal();
  // EV-0001 debits 1010 for 18000 / credits 1000 for 18000
  // A stmt referencing account 1000 (bank) should still work if exact match
  const bankSideStmt = [{ evidence: 'EV-0001', cents: 18000, account: '1000' }];
  const withWindows = applyBankStatements(layout, bankSideStmt, result.transactions);
  // 1000 is a corridor, no room → no window even if tx matches
  assert.equal(withWindows.windows.length, 0, 'Bank corridor has no room, no window');
});

// ---------------------------------------------------------------------------
// Unplaced connections: 1010-1020 EV-C2 has no direct door so must be listed
// ---------------------------------------------------------------------------

test('original: 1010 and 1020 are physically adjacent (share wall, gap=WALL)', () => {
  const { layout } = buildOriginal();
  const r1010 = layout.rooms.find(r => r.id === '1010');
  const r1020 = layout.rooms.find(r => r.id === '1020');
  assert.ok(r1010 && r1020);
  const gap = r1020.x - (r1010.x + r1010.w);
  assert.equal(gap, WALL, `Gap between 1010 and 1020 should be WALL=${WALL}, got ${gap}`);
});

test('original: 1010-1020 EV-C2 is listed as unplaced (no direct door)', () => {
  const { layout } = buildOriginal();
  // All non-bank evidenced edges must be in unplacedConnections since no room-to-room doors exist
  const uc = layout.unplacedConnections;
  assert.ok(uc.length > 0, 'Expected at least one unplaced connection (EV-C2)');
  const ev = uc.find(u => u.evidence === 'EV-C2');
  assert.ok(ev, 'EV-C2 should be listed as unplaced connection');
  assert.equal(ev.type, 'layout_limitation');
});

// ---------------------------------------------------------------------------
// Layout bounds sanity
// ---------------------------------------------------------------------------

test('original: bounds contain all rooms and corridors', () => {
  const { layout } = buildOriginal();
  const { bounds } = layout;
  for (const r of [...layout.rooms, ...layout.corridors]) {
    assert.ok(r.x >= bounds.x, `${r.id} x=${r.x} < bounds.x=${bounds.x}`);
    assert.ok(r.y >= bounds.y, `${r.id} y=${r.y} < bounds.y=${bounds.y}`);
    assert.ok(r.x + r.w <= bounds.x + bounds.w, `${r.id} right edge outside bounds`);
    assert.ok(r.y + r.h <= bounds.y + bounds.h, `${r.id} bottom edge outside bounds`);
  }
});

test('original: spine does not overlap any room', () => {
  const { layout } = buildOriginal();
  const spine = layout.corridors.find(c => c.id === 'CORR_SPINE');
  for (const room of layout.rooms) {
    const ovl =
      spine.x < room.x + room.w && spine.x + spine.w > room.x &&
      spine.y < room.y + room.h && spine.y + spine.h > room.y;
    assert.ok(!ovl, `Spine overlaps room ${room.id}`);
  }
});

test('original: audit route starts at ENTRANCE', () => {
  const { layout } = buildOriginal();
  assert.equal(layout.auditRoute[0], 'ENTRANCE');
});

test('original: audit route contains CORR_SPINE', () => {
  const { layout } = buildOriginal();
  assert.ok(layout.auditRoute.includes('CORR_SPINE'));
});

// ---------------------------------------------------------------------------
// All rooms have positive dimensions
// ---------------------------------------------------------------------------

test('original: all rooms have positive width and depth', () => {
  const { layout } = buildOriginal();
  for (const room of layout.rooms) {
    assert.ok(room.w > 0, `Room ${room.id} width ${room.w}`);
    assert.ok(room.h > 0, `Room ${room.id} height ${room.h}`);
  }
});

test('original: all rooms have depth = ROOM_DEPTH', () => {
  const { layout } = buildOriginal();
  for (const room of layout.rooms) {
    assert.equal(room.h, ROOM_DEPTH, `Room ${room.id} h=${room.h}`);
  }
});
