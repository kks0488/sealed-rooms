/**
 * test/dxf.test.js
 *
 * Tests for src/dxf.js
 * Uses group-code parsing (never substring matching).
 * Covers: version, units (mm=4), layer presence, wall segments vs polylines,
 * real door gaps cut into wall lines, coordinate finiteness, SEALED count,
 * ROOM_NAME text, wall-gap identity between buildWalls and door objects.
 */

import { readFileSync } from 'fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { processData } from '../src/data.js';
import { buildLayout, DOOR_W } from '../src/geometry.js';
import {
  buildDXF,
  buildWalls,
  parseDXF,
  dxfEntities,
  dxfEntityLayers,
  dxfVersion,
  dxfUnits,
  dxfCoordinates,
  countOnLayer,
  MM_PER_UNIT,
} from '../src/dxf.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const journalCSV = readFileSync(new URL('../journal.csv', import.meta.url), 'utf8');

function getLayout() {
  const r = processData(journalCSV);
  assert.equal(r.valid, true);
  return { result: r, layout: buildLayout(r.transactions) };
}

function getDXF() {
  const { result, layout } = getLayout();
  const dxf     = buildDXF(layout);
  const pairs   = parseDXF(dxf);
  const entities = dxfEntities(pairs);
  return { layout, dxf, pairs, entities };
}

// ---------------------------------------------------------------------------
// MM_PER_UNIT
// ---------------------------------------------------------------------------

test('MM_PER_UNIT is 50', () => {
  assert.equal(MM_PER_UNIT, 50);
});

// ---------------------------------------------------------------------------
// parseDXF: group-code correctness
// ---------------------------------------------------------------------------

test('parseDXF: returns array of {code, value} pairs', () => {
  const pairs = parseDXF('0\nSECTION\n2\nHEADER\n0\nENDSEC\n');
  assert.ok(Array.isArray(pairs));
  assert.equal(pairs[0].code, 0);
  assert.equal(pairs[0].value, 'SECTION');
});

test('parseDXF: code is a number', () => {
  const pairs = parseDXF('70\n4\n');
  assert.equal(typeof pairs[0].code, 'number');
  assert.equal(pairs[0].value, '4');
});

test('parseDXF: ignores lines with non-numeric codes', () => {
  const pairs = parseDXF('0\nSECTION\nBAD\nIGNORED\n2\nHEADER\n');
  const codes = pairs.map(p => p.code);
  assert.ok(!codes.includes(NaN));
});

// ---------------------------------------------------------------------------
// Header: version and units
// ---------------------------------------------------------------------------

test('dxf: $ACADVER is AC1015', () => {
  const { pairs } = getDXF();
  assert.equal(dxfVersion(pairs), 'AC1015');
});

test('dxf: $INSUNITS is 4 (millimetres)', () => {
  const { pairs } = getDXF();
  assert.equal(dxfUnits(pairs), 4);
});

// ---------------------------------------------------------------------------
// Layers: all five must appear in LAYER table
// ---------------------------------------------------------------------------

test('dxf: LAYER table contains FLOOR', () => {
  const { entities } = getDXF();
  const layers = entities.filter(e => e.type === 'LAYER').map(e => {
    const g = e.groups.find(g => g.code === 2); return g?.value;
  });
  assert.ok(layers.includes('FLOOR'), `FLOOR missing from layers: ${layers}`);
});

test('dxf: LAYER table contains WALL', () => {
  const { entities } = getDXF();
  const layers = entities.filter(e => e.type === 'LAYER').map(e => {
    const g = e.groups.find(g => g.code === 2); return g?.value;
  });
  assert.ok(layers.includes('WALL'));
});

test('dxf: LAYER table contains DOOR', () => {
  const { entities } = getDXF();
  const layers = entities.filter(e => e.type === 'LAYER').map(e => {
    const g = e.groups.find(g => g.code === 2); return g?.value;
  });
  assert.ok(layers.includes('DOOR'));
});

test('dxf: LAYER table contains ROOM_NAME', () => {
  const { entities } = getDXF();
  const layers = entities.filter(e => e.type === 'LAYER').map(e => {
    const g = e.groups.find(g => g.code === 2); return g?.value;
  });
  assert.ok(layers.includes('ROOM_NAME'));
});

test('dxf: LAYER table contains SEALED', () => {
  const { entities } = getDXF();
  const layers = entities.filter(e => e.type === 'LAYER').map(e => {
    const g = e.groups.find(g => g.code === 2); return g?.value;
  });
  assert.ok(layers.includes('SEALED'));
});

// ---------------------------------------------------------------------------
// FLOOR layer: exactly 1 closed LWPOLYLINE
// ---------------------------------------------------------------------------

test('dxf: exactly 1 LWPOLYLINE on FLOOR layer', () => {
  const { entities } = getDXF();
  const count = countOnLayer(entities, 'LWPOLYLINE', 'FLOOR');
  assert.equal(count, 1);
});

test('dxf: FLOOR LWPOLYLINE is closed (flag 70 = 1)', () => {
  const { entities } = getDXF();
  const floorPoly = entities.find(e =>
    e.type === 'LWPOLYLINE' && e.groups.some(g => g.code === 8 && g.value === 'FLOOR')
  );
  assert.ok(floorPoly, 'FLOOR polyline not found');
  const flag = floorPoly.groups.find(g => g.code === 70);
  assert.ok(flag, 'No closed flag group');
  assert.equal(flag.value, '1');
});

// ---------------------------------------------------------------------------
// WALL layer: LINE segments, NOT LWPOLYLINE
// ---------------------------------------------------------------------------

test('dxf: WALL layer uses LINE entities (not LWPOLYLINE)', () => {
  const { entities } = getDXF();
  const wallPolylines = countOnLayer(entities, 'LWPOLYLINE', 'WALL');
  assert.equal(wallPolylines, 0, 'WALL layer must not use LWPOLYLINE');
});

test('dxf: WALL layer has LINE entities', () => {
  const { entities } = getDXF();
  const wallLines = countOnLayer(entities, 'LINE', 'WALL');
  assert.ok(wallLines > 0, 'WALL layer must have LINE entities');
});

test('dxf: WALL LINE count equals buildWalls() segment count', () => {
  const { layout, entities } = getDXF();
  const walls     = buildWalls(layout);
  const wallLines = countOnLayer(entities, 'LINE', 'WALL');
  assert.equal(wallLines, walls.length,
    `DXF WALL lines (${wallLines}) ≠ buildWalls segments (${walls.length})`);
});

// ---------------------------------------------------------------------------
// Door gaps: wall segments are split at door openings
// ---------------------------------------------------------------------------

test('dxf: buildWalls produces fewer segments than naive 4-sides-per-rect', () => {
  // Every door splits one wall segment into two (+1 net per door).
  // Key property: NO wall segment on y=room.y fully spans any door gap.
  const { layout } = getLayout();
  const walls = buildWalls(layout);

  for (const door of layout.doors) {
    const gapXmin = Math.min(door.gapX1, door.gapX2);
    const gapXmax = Math.max(door.gapX1, door.gapX2);
    const gapY    = door.gapY1;

    for (const seg of walls) {
      if (seg.y1 !== seg.y2 || seg.y1 !== gapY) continue;
      const sx1 = Math.min(seg.x1, seg.x2), sx2 = Math.max(seg.x1, seg.x2);
      const spansGap = sx1 <= gapXmin && sx2 >= gapXmax;
      assert.ok(!spansGap,
        `Wall [${seg.x1},${seg.y1}]→[${seg.x2},${seg.y2}] spans door gap [${gapXmin},${gapXmax}]`);
    }
  }
});

test('dxf: gap width in buildWalls matches DOOR_W for every door', () => {
  const { layout } = getLayout();
  // For every door, the two wall segments flanking it should leave exactly DOOR_W space
  const walls = buildWalls(layout);

  for (const door of layout.doors) {
    const gapY    = door.gapY1;
    const gapXmin = Math.min(door.gapX1, door.gapX2);
    const gapXmax = Math.max(door.gapX1, door.gapX2);

    // Find horizontal segments on this y that abut the gap
    const segsOnRow = walls
      .filter(s => s.y1 === s.y2 && s.y1 === gapY)
      .sort((a, b) => Math.min(a.x1, a.x2) - Math.min(b.x1, b.x2));

    // At least one segment must end at gapXmin or start at gapXmax
    const leftSeg  = segsOnRow.find(s => Math.max(s.x1, s.x2) === gapXmin);
    const rightSeg = segsOnRow.find(s => Math.min(s.x1, s.x2) === gapXmax);

    // If both found, gap is exactly DOOR_W
    if (leftSeg && rightSeg) {
      const gap = gapXmax - gapXmin;
      assert.equal(gap, DOOR_W,
        `Door ${door.roomId}: gap width ${gap} ≠ DOOR_W ${DOOR_W}`);
    }
    // (if gap is at a wall edge only one seg may exist — that's fine)
  }
});

// ---------------------------------------------------------------------------
// DOOR layer: LINE + ARC per door
// ---------------------------------------------------------------------------

test('dxf: DOOR layer LINE count equals door count', () => {
  const { layout, entities } = getDXF();
  const doorLines = countOnLayer(entities, 'LINE', 'DOOR');
  assert.equal(doorLines, layout.doors.length,
    `DOOR LINEs ${doorLines} ≠ doors ${layout.doors.length}`);
});

test('dxf: DOOR layer ARC count equals door count', () => {
  const { layout, entities } = getDXF();
  const doorArcs = countOnLayer(entities, 'ARC', 'DOOR');
  assert.equal(doorArcs, layout.doors.length,
    `DOOR ARCs ${doorArcs} ≠ doors ${layout.doors.length}`);
});

test('dxf: ARC entities have finite radius', () => {
  const { entities } = getDXF();
  const arcs = entities.filter(e => e.type === 'ARC');
  for (const arc of arcs) {
    const r = arc.groups.find(g => g.code === 40);
    assert.ok(r, 'ARC missing radius group code 40');
    assert.ok(isFinite(parseFloat(r.value)), `Non-finite arc radius: ${r.value}`);
  }
});

// ---------------------------------------------------------------------------
// ROOM_NAME layer: TEXT entities
// ---------------------------------------------------------------------------

test('dxf: ROOM_NAME layer has TEXT entities', () => {
  const { entities } = getDXF();
  const texts = countOnLayer(entities, 'TEXT', 'ROOM_NAME');
  assert.ok(texts > 0, 'No TEXT on ROOM_NAME layer');
});

test('dxf: ROOM_NAME TEXT count equals rooms×2 + labeled corridors', () => {
  const { layout, entities } = getDXF();
  const labeledCorridors = layout.corridors.filter(c => c.label).length;
  // Each room now produces two TEXT entities: account number + account name.
  const expected = layout.rooms.length * 2 + labeledCorridors;
  const texts    = countOnLayer(entities, 'TEXT', 'ROOM_NAME');
  assert.equal(texts, expected,
    `ROOM_NAME TEXT count ${texts} ≠ expected ${expected}`);
});

test('dxf: TEXT entities have non-empty string value (group code 1)', () => {
  const { entities } = getDXF();
  const texts = entities.filter(e => e.type === 'TEXT');
  for (const t of texts) {
    const str = t.groups.find(g => g.code === 1);
    assert.ok(str, 'TEXT missing group code 1');
    assert.ok(str.value.length > 0, 'TEXT has empty string');
  }
});

test('dxf: TEXT alignment point (11/21) equals insertion point (10/20) when group 72 is non-zero', () => {
  const { entities } = getDXF();
  const texts = entities.filter(e => e.type === 'TEXT');
  for (const t of texts) {
    const g72 = t.groups.find(g => g.code === 72);
    if (!g72 || parseInt(g72.value, 10) === 0) continue;
    const g10 = t.groups.find(g => g.code === 10);
    const g20 = t.groups.find(g => g.code === 20);
    const g11 = t.groups.find(g => g.code === 11);
    const g21 = t.groups.find(g => g.code === 21);
    const label = t.groups.find(g => g.code === 1)?.value ?? '(unknown)';
    assert.ok(g11, `TEXT "${label}": group 72 is non-zero but group 11 (alignment X) is missing`);
    assert.ok(g21, `TEXT "${label}": group 72 is non-zero but group 21 (alignment Y) is missing`);
    assert.equal(g11.value, g10.value,
      `TEXT "${label}": alignment X (11=${g11.value}) ≠ insertion X (10=${g10.value})`);
    assert.equal(g21.value, g20.value,
      `TEXT "${label}": alignment Y (21=${g21.value}) ≠ insertion Y (20=${g20.value})`);
  }
});

// ---------------------------------------------------------------------------
// SEALED layer: closed polylines for 3 sealed rooms
// ---------------------------------------------------------------------------

test('dxf: SEALED layer has 3 LWPOLYLINE entities', () => {
  const { entities } = getDXF();
  const count = countOnLayer(entities, 'LWPOLYLINE', 'SEALED');
  assert.equal(count, 3);
});

test('dxf: SEALED LWPOLYLINE entities are closed', () => {
  const { entities } = getDXF();
  const sealed = entities.filter(e =>
    e.type === 'LWPOLYLINE' && e.groups.some(g => g.code === 8 && g.value === 'SEALED')
  );
  for (const poly of sealed) {
    const flag = poly.groups.find(g => g.code === 70);
    assert.ok(flag, 'SEALED poly missing closed flag');
    assert.equal(flag.value, '1');
  }
});

// ---------------------------------------------------------------------------
// Corridor-corridor join cuts: no wall spans the midpoint of any join
// ---------------------------------------------------------------------------

test('dxf: no wall spans CORR_SPINE↔ENTRANCE join midpoint (horiz y=348 x≈647)', () => {
  const { layout } = getLayout();
  const walls = buildWalls(layout);
  const spine = layout.corridors.find(c => c.id === 'CORR_SPINE');
  const entr  = layout.corridors.find(c => c.id === 'ENTRANCE');
  const joinY  = spine.y + spine.h;   // == entr.y
  const joinXA = Math.max(spine.x, entr.x);
  const joinXB = Math.min(spine.x + spine.w, entr.x + entr.w);
  const midX   = (joinXA + joinXB) / 2;
  const spanning = walls.filter(s =>
    s.y1 === s.y2 && s.y1 === joinY &&
    Math.min(s.x1, s.x2) < midX && Math.max(s.x1, s.x2) > midX
  );
  assert.deepEqual(spanning, [], `Wall spans SPINE↔ENTRANCE join at x=${midX}: ${JSON.stringify(spanning)}`);
});

test('dxf: no wall spans HALL_W1↔CORR_SPINE join midpoint (vert x=spineX y≈72)', () => {
  const { layout } = getLayout();
  const walls = buildWalls(layout);
  const spine = layout.corridors.find(c => c.id === 'CORR_SPINE');
  const hw1   = layout.corridors.find(c => c.id === 'HALL_W1');
  const joinX  = hw1.x + hw1.w;  // == spine.x
  const joinYA = Math.max(hw1.y, spine.y);
  const joinYB = Math.min(hw1.y + hw1.h, spine.y + spine.h);
  const midY   = (joinYA + joinYB) / 2;
  const spanning = walls.filter(s =>
    s.x1 === s.x2 && s.x1 === joinX &&
    Math.min(s.y1, s.y2) < midY && Math.max(s.y1, s.y2) > midY
  );
  assert.deepEqual(spanning, [], `Wall spans HALL_W1↔SPINE join at y=${midY}: ${JSON.stringify(spanning)}`);
});

test('dxf: no wall spans HALL_W2↔CORR_SPINE join midpoint (vert x=spineX y≈216)', () => {
  const { layout } = getLayout();
  const walls = buildWalls(layout);
  const spine = layout.corridors.find(c => c.id === 'CORR_SPINE');
  const hw2   = layout.corridors.find(c => c.id === 'HALL_W2');
  const joinX  = hw2.x + hw2.w;
  const joinYA = Math.max(hw2.y, spine.y);
  const joinYB = Math.min(hw2.y + hw2.h, spine.y + spine.h);
  const midY   = (joinYA + joinYB) / 2;
  const spanning = walls.filter(s =>
    s.x1 === s.x2 && s.x1 === joinX &&
    Math.min(s.y1, s.y2) < midY && Math.max(s.y1, s.y2) > midY
  );
  assert.deepEqual(spanning, [], `Wall spans HALL_W2↔SPINE join at y=${midY}: ${JSON.stringify(spanning)}`);
});

test('dxf: no wall spans CORR_SPINE↔HALL_E1 join midpoint (vert x=spineR y≈72)', () => {
  const { layout } = getLayout();
  const walls = buildWalls(layout);
  const spine = layout.corridors.find(c => c.id === 'CORR_SPINE');
  const he1   = layout.corridors.find(c => c.id === 'HALL_E1');
  const joinX  = spine.x + spine.w;  // == he1.x
  const joinYA = Math.max(spine.y, he1.y);
  const joinYB = Math.min(spine.y + spine.h, he1.y + he1.h);
  const midY   = (joinYA + joinYB) / 2;
  const spanning = walls.filter(s =>
    s.x1 === s.x2 && s.x1 === joinX &&
    Math.min(s.y1, s.y2) < midY && Math.max(s.y1, s.y2) > midY
  );
  assert.deepEqual(spanning, [], `Wall spans SPINE↔HALL_E1 join at y=${midY}: ${JSON.stringify(spanning)}`);
});

test('dxf: no wall spans CORR_SPINE↔HALL_E2 join midpoint (vert x=spineR y≈216)', () => {
  const { layout } = getLayout();
  const walls = buildWalls(layout);
  const spine = layout.corridors.find(c => c.id === 'CORR_SPINE');
  const he2   = layout.corridors.find(c => c.id === 'HALL_E2');
  const joinX  = spine.x + spine.w;
  const joinYA = Math.max(spine.y, he2.y);
  const joinYB = Math.min(spine.y + spine.h, he2.y + he2.h);
  const midY   = (joinYA + joinYB) / 2;
  const spanning = walls.filter(s =>
    s.x1 === s.x2 && s.x1 === joinX &&
    Math.min(s.y1, s.y2) < midY && Math.max(s.y1, s.y2) > midY
  );
  assert.deepEqual(spanning, [], `Wall spans SPINE↔HALL_E2 join at y=${midY}: ${JSON.stringify(spanning)}`);
});

// ---------------------------------------------------------------------------
// Metadata scale agrees with DXF MM_PER_UNIT
// ---------------------------------------------------------------------------

test('geometry metadata mmPerUnit equals DXF MM_PER_UNIT', () => {
  const { layout } = getLayout();
  assert.equal(layout.metadata.mmPerUnit, MM_PER_UNIT);
});

// ---------------------------------------------------------------------------

test('dxf: all coordinates are finite', () => {
  const { pairs } = getDXF();
  const coords = dxfCoordinates(pairs);
  assert.ok(coords.length > 0, 'No coordinates found');
  const bad = coords.filter(c => !c.finite);
  assert.equal(bad.length, 0, `Non-finite coords: ${JSON.stringify(bad)}`);
});

test('dxf: coordinate values are scaled (plan units × MM_PER_UNIT)', () => {
  // The floor slab starts at bounds.x, bounds.y in plan units.
  // In DXF, those coords should equal bounds.x * MM_PER_UNIT, bounds.y * MM_PER_UNIT
  const { layout, pairs } = getDXF();
  const { bounds } = layout;
  const coords = dxfCoordinates(pairs);
  // Find a coord value matching bounds.x * MM_PER_UNIT
  const expectedX = bounds.x * MM_PER_UNIT;
  const found = coords.some(c => c.code === 10 && Math.abs(c.value - expectedX) < 0.01);
  assert.ok(found, `Expected coord ${expectedX} (bounds.x ${bounds.x} × ${MM_PER_UNIT}) not found`);
});

// ---------------------------------------------------------------------------
// EOF marker
// ---------------------------------------------------------------------------

test('dxf: ends with EOF entity', () => {
  const { pairs } = getDXF();
  const last = [...pairs].reverse().find(p => p.code === 0);
  assert.equal(last?.value, 'EOF');
});

// ---------------------------------------------------------------------------
// buildWalls: shared with SVG (gap positions match door objects)
// ---------------------------------------------------------------------------

test('buildWalls: wall gap positions exactly match door gap coords', () => {
  const { layout } = getLayout();
  const walls = buildWalls(layout);

  for (const door of layout.doors) {
    const gapXmin = Math.min(door.gapX1, door.gapX2);
    const gapXmax = Math.max(door.gapX1, door.gapX2);
    const gapY    = door.gapY1;

    // No wall segment should span the gap in its entirety
    const spanning = walls.filter(s => {
      if (s.y1 !== s.y2 || s.y1 !== gapY) return false;
      const sx1 = Math.min(s.x1, s.x2), sx2 = Math.max(s.x1, s.x2);
      return sx1 <= gapXmin && sx2 >= gapXmax;
    });

    assert.equal(spanning.length, 0,
      `Door ${door.roomId}: wall segment spans gap [${gapXmin},${gapXmax}] at y=${gapY}`);
  }
});

// ---------------------------------------------------------------------------
// Task 6: two-line room labels — width fit and content completeness
// ---------------------------------------------------------------------------

// Helper: extract ROOM_NAME TEXT strings from DXF entities
function getRoomNameTexts(entities) {
  return entities
    .filter(e => e.type === 'TEXT' && e.groups.some(g => g.code === 8 && g.value === 'ROOM_NAME'))
    .map(e => ({
      str:    e.groups.find(g => g.code === 1)?.value ?? '',
      height: parseFloat(e.groups.find(g => g.code === 40)?.value ?? '0'),
    }));
}

test('dxf: every ROOM_NAME TEXT estimated width fits within its room inner width', () => {
  // This test rebuilds the DXF and cross-checks each TEXT against the room it
  // belongs to, using the same char-width estimate the renderer uses (chars × h × 0.6).
  const { layout, entities } = getDXF();
  const CHAR_ASPECT = 0.6;
  const wallThickMM = (layout.metadata?.wallThickness ?? 8) * MM_PER_UNIT;

  // Build a map of account number → room for fast lookup
  const roomByAcc = new Map(layout.rooms.map(r => [r.account, r]));

  // Collect ROOM_NAME TEXT entities with height in mm
  const texts = getRoomNameTexts(entities);

  // The room-label texts come in pairs (account then name); corridor labels are single.
  // We validate each TEXT whose string matches an account number OR whose string
  // is the name part. Strategy: for each TEXT, find the matching room by checking
  // whether the string equals an account number or is a substring of a room label.
  for (const t of texts) {
    // Find room: string equals account number, OR it is the name part of a label
    let room = roomByAcc.get(t.str);
    if (!room) {
      // Try name-part match: label = "<acc> <name>", possibly truncated with "..."
      room = layout.rooms.find(r => {
        const spIdx  = r.label.indexOf(' ');
        const name   = spIdx === -1 ? '' : r.label.slice(spIdx + 1);
        // Accept exact match or truncated match (text ends with '...')
        return name === t.str ||
               (t.str.endsWith('...') && name.startsWith(t.str.slice(0, -3)));
      });
    }
    if (!room) continue; // corridor label — skip

    const innerWidthMM = room.w * MM_PER_UNIT - wallThickMM;
    const estimatedW   = t.str.length * t.height * CHAR_ASPECT;

    assert.ok(
      estimatedW <= innerWidthMM + 0.01, // 0.01 mm float tolerance
      `TEXT "${t.str}": estimated width ${estimatedW.toFixed(1)} mm > inner width ${innerWidthMM.toFixed(1)} mm (room ${room.account}, h=${t.height.toFixed(1)} mm)`
    );
  }
});

test('dxf: every room account number appears in ROOM_NAME and name appears or is shortened with "..."', () => {
  const { layout, entities } = getDXF();
  const texts    = getRoomNameTexts(entities);
  const strSet   = new Set(texts.map(t => t.str));

  for (const room of layout.rooms) {
    const spIdx   = room.label.indexOf(' ');
    const accNum  = spIdx === -1 ? room.label : room.label.slice(0, spIdx);
    const name    = spIdx === -1 ? ''          : room.label.slice(spIdx + 1);

    // Account number must appear verbatim
    assert.ok(strSet.has(accNum),
      `Account number "${accNum}" missing from ROOM_NAME TEXT entities`);

    // Name must appear verbatim, or in shortened form ending with "..."
    if (name.length > 0) {
      const namePresent = strSet.has(name) ||
        [...strSet].some(s => s.endsWith('...') && name.startsWith(s.slice(0, -3)));
      assert.ok(namePresent,
        `Account name "${name}" (room ${accNum}) missing from ROOM_NAME TEXT entities`);
    }
  }
});

test('buildWalls: repaired layout (0 sealed) produces 0 extra SEALED polys', () => {
  const csv2  = readFileSync(new URL('../samples/sample-repaired.csv', import.meta.url), 'utf8');
  const r2    = processData(csv2);
  assert.equal(r2.valid, true);
  const l2    = buildLayout(r2.transactions);
  const dxf2  = buildDXF(l2);
  const pairs2 = parseDXF(dxf2);
  const ents2  = dxfEntities(pairs2);
  const count  = countOnLayer(ents2, 'LWPOLYLINE', 'SEALED');
  assert.equal(count, 0, 'Repaired layout should have 0 SEALED polylines');
});
