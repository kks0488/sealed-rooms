/**
 * dxf.js — DXF R2000 (AC1015) ASCII export
 *
 * Design:
 *   - WALL layer: individual LINE segments, NOT closed polylines.
 *     Door gaps are real cuts: each wall that carries a door is split into
 *     two shorter LINE segments flanking the gap. These segments are identical
 *     to the visual gaps used by the SVG renderer.
 *   - FLOOR layer: one closed LWPOLYLINE for the floor slab.
 *   - SEALED layer: closed LWPOLYLINE for each sealed room fill.
 *   - DOOR layer: a LINE across the gap opening + a swing ARC.
 *   - ROOM_NAME layer: TEXT at room centre.
 *
 * Scale: MM_PER_UNIT = 50  (1 plan unit = 50 mm)
 * Units: $INSUNITS = 4 (millimetres)
 * Version: AC1015
 *
 * Wall segments are computed from layout.walls (canonical wall list built by
 * buildWalls() below, exported so SVG renderer can share the same segments).
 */

export const MM_PER_UNIT = 50; // 1 plan unit = 50 mm

function mm(v) {
  const n = v * MM_PER_UNIT;
  if (!isFinite(n)) throw new Error(`Non-finite DXF coordinate from plan value ${v}`);
  return n.toFixed(4);
}

// ---------------------------------------------------------------------------
// Handle counter — reset per buildDXF call for determinism
// ---------------------------------------------------------------------------
let _hc = 0;
function h() { return (++_hc).toString(16).toUpperCase().padStart(4, '0'); }

// ---------------------------------------------------------------------------
// Group-code line pairs
// ---------------------------------------------------------------------------
function gc(...args) {
  // args: code0, value0, code1, value1, ...
  const out = [];
  for (let i = 0; i < args.length; i += 2) out.push(String(args[i]), String(args[i + 1]));
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
function sectionHeader() {
  return gc(
    0, 'SECTION', 2, 'HEADER',
    9, '$ACADVER', 1, 'AC1015',
    9, '$INSUNITS', 70, 4,
    0, 'ENDSEC',
  );
}

// ---------------------------------------------------------------------------
// Tables (5 layers)
// ---------------------------------------------------------------------------
const LAYER_DEFS = [
  { name: 'FLOOR',     color: 7 },
  { name: 'WALL',      color: 1 },
  { name: 'DOOR',      color: 3 },
  { name: 'ROOM_NAME', color: 2 },
  { name: 'SEALED',    color: 5 },
];

function sectionTables() {
  const entries = LAYER_DEFS.map(l => gc(
    0, 'LAYER', 5, h(),
    100, 'AcDbSymbolTableRecord',
    100, 'AcDbLayerTableRecord',
    2, l.name, 70, 0, 62, l.color, 6, 'CONTINUOUS',
  )).join('\n');

  return [
    gc(0, 'SECTION', 2, 'TABLES',
       0, 'TABLE', 2, 'LAYER', 5, h(),
       100, 'AcDbSymbolTableRecord', 100, 'AcDbSymbolTable',
       70, LAYER_DEFS.length),
    entries,
    gc(0, 'ENDTAB', 0, 'ENDSEC'),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Entity constructors
// ---------------------------------------------------------------------------

function lwPolylineClosed(layer, pts) {
  const header = gc(
    0, 'LWPOLYLINE', 5, h(),
    100, 'AcDbEntity', 8, layer,
    100, 'AcDbPolyline',
    90, pts.length, 70, 1, 43, '0.0',
  );
  const coords = pts.flatMap(([x, y]) => [gc(10, mm(x), 20, mm(y))]).join('\n');
  return header + '\n' + coords;
}

function lineEntity(layer, x1, y1, x2, y2) {
  return gc(
    0, 'LINE', 5, h(),
    100, 'AcDbEntity', 8, layer,
    100, 'AcDbLine',
    10, mm(x1), 20, mm(y1),
    11, mm(x2), 21, mm(y2),
  );
}

function arcEntity(layer, cx, cy, r, startDeg, endDeg) {
  return gc(
    0, 'ARC', 5, h(),
    100, 'AcDbEntity', 8, layer,
    100, 'AcDbCircle',
    10, mm(cx), 20, mm(cy), 30, '0.0000',
    40, mm(r),
    100, 'AcDbArc',
    50, startDeg, 51, endDeg,
  );
}

function textEntity(layer, x, y, heightPlan, str) {
  const safe = String(str).replace(/[\r\n]+/g, ' ').trim();
  return gc(
    0, 'TEXT', 5, h(),
    100, 'AcDbEntity', 8, layer,
    100, 'AcDbText',
    10, mm(x), 20, mm(y), 30, '0.0000',
    40, mm(heightPlan),
    1, safe,
    72, 1,
    11, mm(x), 21, mm(y), 31, '0.0000',
    100, 'AcDbText',
  );
}

// ---------------------------------------------------------------------------
// Canonical wall segments — union + dedup + join cuts + door gaps
//
// Algorithm:
//   1. Collect raw segments from rooms (skip north wall) and corridors (all sides).
//   2. Compute corridor-corridor join cuts:
//      - Vertical join at x: two corridors touching at x share y-interval [yMax, yMin(y+h)].
//        That y-interval must be subtracted from vertical walls at x on both sides.
//      - Horizontal join at y: two corridors touching at y share x-interval.
//        That x-interval must be subtracted from horizontal walls at y.
//   3. Union collinear segments (merge overlapping intervals by axis).
//   4. Subtract join cuts + door gaps from merged intervals.
//   5. Emit resulting LINE segments.
//
// Returns array of { x1, y1, x2, y2 }
// ---------------------------------------------------------------------------
export function buildWalls(layout) {
  const { rooms, corridors, doors } = layout;

  // ---- 1. Raw segments ----
  const raw = [];
  function addRect(rect, skipNorth) {
    const { x, y, w, h } = rect;
    if (!skipNorth) raw.push({ x1: x,     y1: y,     x2: x + w, y2: y     }); // top (horiz)
    raw.push({ x1: x + w, y1: y,     x2: x + w, y2: y + h }); // right (vert)
    raw.push({ x1: x,     y1: y + h, x2: x + w, y2: y + h }); // bottom (horiz)
    raw.push({ x1: x,     y1: y,     x2: x,     y2: y + h }); // left (vert)
  }
  for (const room of rooms)     addRect(room, true);   // rooms skip their north wall
  for (const corr of corridors) addRect(corr, false);  // corridors emit all four sides

  // ---- 2. Corridor-corridor join cuts ----
  // cutsH: Map<y, [{a,b}]>  — horizontal cuts (remove x-interval from horiz wall at y)
  // cutsV: Map<x, [{a,b}]>  — vertical cuts   (remove y-interval from vert  wall at x)
  const cutsH = new Map();
  const cutsV = new Map();
  const addCut = (map, key, a, b) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ a, b });
  };

  for (let i = 0; i < corridors.length; i++) {
    for (let j = i + 1; j < corridors.length; j++) {
      const a = corridors[i], b = corridors[j];
      // Vertical join: a's right edge == b's left edge
      if (a.x + a.w === b.x) {
        const yA = Math.max(a.y, b.y), yB = Math.min(a.y + a.h, b.y + b.h);
        if (yA < yB) addCut(cutsV, a.x + a.w, yA, yB);
      }
      if (b.x + b.w === a.x) {
        const yA = Math.max(a.y, b.y), yB = Math.min(a.y + a.h, b.y + b.h);
        if (yA < yB) addCut(cutsV, b.x + b.w, yA, yB);
      }
      // Horizontal join: a's bottom == b's top
      if (a.y + a.h === b.y) {
        const xA = Math.max(a.x, b.x), xB = Math.min(a.x + a.w, b.x + b.w);
        if (xA < xB) addCut(cutsH, a.y + a.h, xA, xB);
      }
      if (b.y + b.h === a.y) {
        const xA = Math.max(a.x, b.x), xB = Math.min(a.x + a.w, b.x + b.w);
        if (xA < xB) addCut(cutsH, b.y + b.h, xA, xB);
      }
    }
  }

  // ---- 3. Door-gap cuts (horizontal walls at y = room.y) ----
  for (const d of doors) {
    const y = d.gapY1;
    addCut(cutsH, y, Math.min(d.gapX1, d.gapX2), Math.max(d.gapX1, d.gapX2));
  }

  // ---- 4. Group raw segments by axis ----
  const hByY = new Map(); // y → [{a, b}]
  const vByX = new Map(); // x → [{a, b}]
  for (const s of raw) {
    if (s.y1 === s.y2) {
      if (!hByY.has(s.y1)) hByY.set(s.y1, []);
      hByY.get(s.y1).push({ a: Math.min(s.x1, s.x2), b: Math.max(s.x1, s.x2) });
    } else if (s.x1 === s.x2) {
      if (!vByX.has(s.x1)) vByX.set(s.x1, []);
      vByX.get(s.x1).push({ a: Math.min(s.y1, s.y2), b: Math.max(s.y1, s.y2) });
    }
  }

  // ---- Helpers ----
  function mergeIntervals(ivs) {
    if (!ivs.length) return [];
    const sorted = [...ivs].sort((a, b) => a.a - b.a);
    const out = [{ ...sorted[0] }];
    for (let i = 1; i < sorted.length; i++) {
      const last = out[out.length - 1];
      if (sorted[i].a <= last.b) last.b = Math.max(last.b, sorted[i].b);
      else out.push({ ...sorted[i] });
    }
    return out;
  }

  // Subtract merged cuts from a merged segment, emit result segments
  function subtractAndEmit(seg, cuts, emitFn) {
    const relevant = mergeIntervals(cuts.filter(c => c.b > seg.a && c.a < seg.b));
    let cur = seg.a;
    for (const cut of relevant) {
      const cs = Math.max(cut.a, seg.a);
      const ce = Math.min(cut.b, seg.b);
      if (cur < cs) emitFn(cur, cs);
      cur = ce;
    }
    if (cur < seg.b) emitFn(cur, seg.b);
  }

  // ---- 5. Emit ----
  const result = [];

  for (const [y, ivs] of hByY) {
    const cuts = cutsH.get(y) || [];
    for (const seg of mergeIntervals(ivs)) {
      subtractAndEmit(seg, cuts, (a, b) => result.push({ x1: a, y1: y, x2: b, y2: y }));
    }
  }

  for (const [x, ivs] of vByX) {
    const cuts = cutsV.get(x) || [];
    for (const seg of mergeIntervals(ivs)) {
      subtractAndEmit(seg, cuts, (a, b) => result.push({ x1: x, y1: a, x2: x, y2: b }));
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main DXF builder
// ---------------------------------------------------------------------------
export function buildDXF(layout) {
  _hc = 0;

  const { rooms, corridors, doors, windows, sealedAccounts, bounds } = layout;
  const sealedSet = new Set(sealedAccounts);
  const entities  = [];

  // FLOOR: closed slab polyline
  const { x: bx, y: by, w: bw, h: bh } = bounds;
  entities.push(lwPolylineClosed('FLOOR', [
    [bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh],
  ]));

  // WALL: individual LINE segments with door gaps cut out
  const wallSegs = buildWalls(layout);
  for (const seg of wallSegs) {
    entities.push(lineEntity('WALL', seg.x1, seg.y1, seg.x2, seg.y2));
  }

  // DOOR: gap LINE + quarter-circle swing, identical to the SVG coordinates.
  for (const door of doors) {
    entities.push(lineEntity('DOOR', door.gapX1, door.gapY1, door.gapX2, door.gapY2));
    entities.push(arcEntity('DOOR', door.arcCX, door.arcCY, door.arcR, 0, 90));
  }

  // ROOM_NAME: text at room centre
  for (const room of rooms) {
    entities.push(textEntity(
      'ROOM_NAME',
      room.x + room.w * 0.5,
      room.y + room.h * 0.5,
      6,
      room.label.replace(/\n/g, ' '),
    ));
  }
  for (const corr of corridors) {
    if (corr.label) {
      entities.push(textEntity(
        'ROOM_NAME',
        corr.x + corr.w * 0.5,
        corr.y + corr.h * 0.5,
        5,
        corr.label.replace(/\n/g, ' '),
      ));
    }
  }

  // SEALED: closed polyline fill for each sealed room
  for (const room of rooms) {
    if (sealedSet.has(room.account)) {
      entities.push(lwPolylineClosed('SEALED', [
        [room.x, room.y],
        [room.x + room.w, room.y],
        [room.x + room.w, room.y + room.h],
        [room.x, room.y + room.h],
      ]));
    }
  }

  return [
    sectionHeader(),
    sectionTables(),
    gc(0, 'SECTION', 2, 'ENTITIES'),
    entities.join('\n'),
    gc(0, 'ENDSEC', 0, 'EOF'),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// DXF parser (for tests) — parse group-code/value pairs from ASCII text
// ---------------------------------------------------------------------------
export function parseDXF(dxfText) {
  const pairs = [];
  const lines = dxfText.split('\n');
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!isNaN(code)) pairs.push({ code, value: lines[i + 1].trim() });
  }
  return pairs;
}

// Return structured entity objects: { type, groups: [{code, value}] }
export function dxfEntities(pairs) {
  const out = [];
  let cur   = null;
  for (const p of pairs) {
    if (p.code === 0) {
      if (cur) out.push(cur);
      cur = { type: p.value, groups: [] };
    } else if (cur) {
      cur.groups.push(p);
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Layer names used by entities of a given DXF type
export function dxfEntityLayers(entities, type) {
  return entities
    .filter(e => e.type === type)
    .map(e => { const g = e.groups.find(g => g.code === 8); return g?.value ?? null; });
}

// $ACADVER string
export function dxfVersion(pairs) {
  for (let i = 0; i + 1 < pairs.length; i++) {
    if (pairs[i].code === 9 && pairs[i].value === '$ACADVER') return pairs[i + 1].value;
  }
  return null;
}

// $INSUNITS integer
export function dxfUnits(pairs) {
  for (let i = 0; i + 1 < pairs.length; i++) {
    if (pairs[i].code === 9 && pairs[i].value === '$INSUNITS') return parseInt(pairs[i + 1].value, 10);
  }
  return null;
}

// All X/Y coordinates (group codes 10/20) as { code, value, finite }
export function dxfCoordinates(pairs) {
  return pairs
    .filter(p => p.code === 10 || p.code === 20)
    .map(p => ({ code: p.code, value: parseFloat(p.value), finite: isFinite(parseFloat(p.value)) }));
}

// Count entities of given type on given layer
export function countOnLayer(entities, type, layer) {
  return entities.filter(e =>
    e.type === type &&
    e.groups.some(g => g.code === 8 && g.value === layer)
  ).length;
}
