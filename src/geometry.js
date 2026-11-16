/**
 * geometry.js — Deterministic single-floor architectural layout
 *
 * All geometry is derived from the transactions array (no hardcoded amounts or sealed IDs).
 *
 * Room sizing formula:
 *   depth  = ROOM_DEPTH (constant 90 plan units)
 *   area   = max(MIN_AREA, grossCents * AREA_K)
 *   width  = area / depth
 *
 * Layout structure (y grows downward):
 *
 *   HALL_W1 (assets)    │ SPINE │ HALL_E1 (income)
 *   rooms row W1        │       │ rooms row E1
 *   HALL_W2 (liab)      │       │ HALL_E2 (expense)
 *   rooms row W2        │       │ rooms row E2
 *                       │       │
 *   ════════════ ENTRANCE LOBBY ══════════════
 *
 * Spine (CORR_SPINE) is the vertical N-S corridor for account 1000.
 * spineX = MARGIN + westWidth + GAP  (computed dynamically from row widths)
 * West halls: x=[MARGIN..spineX], y=[HALL_y..HALL_y+HALL_H]
 * East halls: x=[spineR..spineR+eastWidth], y=[HALL_y..HALL_y+HALL_H]
 * Halls touch the spine sides exactly (no overlap, no gap).
 * Rooms hang below their hall (room.y = hall.y + HALL_H).
 * Sealed rooms have no door.
 * Physical BFS: ENTRANCE → CORR_SPINE → halls → rooms via doors.
 */

import { ACCOUNT_METADATA } from './data.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
export const ROOM_DEPTH = 90;    // fixed room depth (plan units)
export const AREA_K     = 0.005; // area = grossCents * AREA_K
export const MIN_AREA   = 5400;  // 60 × 90 minimum
export const WALL       = 8;     // wall thickness
export const DOOR_W     = 14;    // door gap width
export const WINDOW_W   = 12;    // bank-match window width

const SPINE_W    = 36;   // central spine width
const HALL_H     = 24;   // corridor height
const MARGIN     = 20;   // left/right canvas margin
const GAP        = 20;   // gap between west row end and spine left edge

// First hall Y position
const HALL1_Y    = 60;
// Between-row gap (rooms depth + gap before next hall)
const ROW_GAP    = 30;
// Hall 2 Y = HALL1_Y + HALL_H + ROOM_DEPTH + ROW_GAP
const HALL2_Y    = HALL1_Y + HALL_H + ROOM_DEPTH + ROW_GAP; // 60+24+90+30=204
// Entrance Y = HALL2_Y + HALL_H + ROOM_DEPTH + ROW_GAP
const ENTRANCE_Y = HALL2_Y + HALL_H + ROOM_DEPTH + ROW_GAP; // 204+24+90+30=348
const ENTRANCE_H = 70;

// ---------------------------------------------------------------------------
// Room width from gross cents
// ---------------------------------------------------------------------------
export function calcRoomWidth(grossCents) {
  const area  = Math.max(MIN_AREA, grossCents * AREA_K);
  return Math.round(area / ROOM_DEPTH);
}

// ---------------------------------------------------------------------------
// Derive per-account gross cents (sum of cents on both sides)
// ---------------------------------------------------------------------------
function deriveGross(transactions) {
  const gross = new Map();
  for (const tx of transactions) {
    gross.set(tx.from, (gross.get(tx.from) || 0) + tx.cents);
    gross.set(tx.to,   (gross.get(tx.to)   || 0) + tx.cents);
  }
  return gross;
}

// ---------------------------------------------------------------------------
// Evidence BFS from '1000'
// ---------------------------------------------------------------------------
function evidenceBFS(transactions) {
  const adj = new Map();
  const add = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    adj.get(a).add(b);
  };
  for (const tx of transactions) {
    if (tx.evidence) { add(tx.from, tx.to); add(tx.to, tx.from); }
  }
  const visited = new Set(['1000']);
  const q = ['1000'];
  while (q.length) {
    const cur = q.shift();
    for (const nb of (adj.get(cur) ?? [])) {
      if (!visited.has(nb)) { visited.add(nb); q.push(nb); }
    }
  }
  return visited;
}

// ---------------------------------------------------------------------------
// Compute total row width for an ordered list of account IDs
// ---------------------------------------------------------------------------
function rowWidth(ids, gross) {
  return ids.reduce((s, id) => s + calcRoomWidth(gross.get(id) || 0), 0)
         + WALL * (ids.length - 1);
}

// ---------------------------------------------------------------------------
// Place a row of rooms left-to-right
// startX: x of first room, rowY: y of room top (= hall bottom)
// ---------------------------------------------------------------------------
function placeRoomRow(ids, startX, rowY, gross, reachable) {
  const rooms = [];
  let curX = startX;
  for (const id of ids) {
    const w = calcRoomWidth(gross.get(id) || 0);
    const meta = ACCOUNT_METADATA[id] || { name: id, type: 'unknown' };
    rooms.push({
      id,
      account: id,
      label: meta.name,
      x: curX,
      y: rowY,
      w,
      h: ROOM_DEPTH,
      sealed: !reachable.has(id),
      type: 'room',
      cents: gross.get(id) || 0,
      doorSide: 'north',
      doorOffset: Math.floor(w / 2),
    });
    curX += w + WALL;
  }
  return rooms;
}

// ---------------------------------------------------------------------------
// Main layout builder
// ---------------------------------------------------------------------------
export function buildLayout(transactions) {
  const gross    = deriveGross(transactions);
  const reachable = evidenceBFS(transactions);

  const allAccounts = new Set([
    ...transactions.map(t => t.from),
    ...transactions.map(t => t.to),
  ]);

  // Group accounts (bank is corridor, not leaf)
  const assets  = [...allAccounts].filter(a => a.startsWith('1') && a !== '1000').sort();
  const liabs   = [...allAccounts].filter(a => a.startsWith('2')).sort();
  const income  = [...allAccounts].filter(a => a.startsWith('4')).sort();
  const expnses = [...allAccounts].filter(a => a.startsWith('5')).sort();

  // ---- Compute dynamic spine position ----
  const westWidth = Math.max(rowWidth(assets, gross), rowWidth(liabs, gross));
  const eastWidth = Math.max(rowWidth(income, gross), rowWidth(expnses, gross));
  const spineX    = MARGIN + westWidth + GAP;
  const spineR    = spineX + SPINE_W;

  // ---- Place rooms ----
  // West: assets in row 1 (below HALL_W1), liabilities in row 2 (below HALL_W2)
  const hall1Bot = HALL1_Y + HALL_H;  // 84
  const hall2Bot = HALL2_Y + HALL_H;  // 228

  const roomsW1 = placeRoomRow(assets,  MARGIN, hall1Bot, gross, reachable);
  const roomsW2 = placeRoomRow(liabs,   MARGIN, hall2Bot, gross, reachable);
  // East: income in row 1 (below HALL_E1), expenses in row 2 (below HALL_E2)
  const roomsE1 = placeRoomRow(income,  spineR, hall1Bot, gross, reachable);
  const roomsE2 = placeRoomRow(expnses, spineR, hall2Bot, gross, reachable);

  const rooms = [...roomsW1, ...roomsW2, ...roomsE1, ...roomsE2];

  // ---- Corridors ----
  // Spine height covers from y=0 down to ENTRANCE_Y
  const spineH = ENTRANCE_Y;

  const corridors = [
    {
      id: 'CORR_SPINE', account: '1000',
      label: '1000 Operating Bank (circulation)',
      x: spineX, y: 0, w: SPINE_W, h: spineH,
      type: 'corridor',
    },
    {
      id: 'ENTRANCE', account: null,
      label: 'Entrance / Opening Balance',
      x: MARGIN, y: ENTRANCE_Y,
      w: spineX + SPINE_W + eastWidth + MARGIN,
      h: ENTRANCE_H,
      type: 'circulation',
    },
    // West halls: x from MARGIN to spineX (touch spine left face exactly)
    {
      id: 'HALL_W1', account: '1000', label: '',
      x: MARGIN, y: HALL1_Y, w: spineX - MARGIN, h: HALL_H,
      type: 'corridor',
    },
    {
      id: 'HALL_W2', account: '1000', label: '',
      x: MARGIN, y: HALL2_Y, w: spineX - MARGIN, h: HALL_H,
      type: 'corridor',
    },
    // East halls: x from spineR (touch spine right face exactly)
    {
      id: 'HALL_E1', account: '1000', label: '',
      x: spineR, y: HALL1_Y, w: eastWidth, h: HALL_H,
      type: 'corridor',
    },
    {
      id: 'HALL_E2', account: '1000', label: '',
      x: spineR, y: HALL2_Y, w: eastWidth, h: HALL_H,
      type: 'corridor',
    },
  ];

  // ---- Doors (reachable rooms only) ----
  const doors = [];
  for (const room of rooms) {
    if (room.sealed) continue;
    const { gapX1, gapY1, gapX2, gapY2 } = doorGap(room);
    const corr = findAdjacentCorridor(room, corridors);
    if (!corr) continue;
    doors.push({
      roomId: room.id,
      corridorId: corr.id,
      side: 'north',
      gapX1, gapY1, gapX2, gapY2,
      arcCX: gapX1, arcCY: gapY1, arcR: DOOR_W,
    });
  }

  // ---- Unplaced connections ----
  // A non-bank evidenced edge is unplaced when the two rooms share only a WALL gap
  // (wall thickness) but no door between them.  Adjacency (gap == WALL) means they
  // share a physical wall — but that wall carries no door opening, so the auditor
  // cannot walk through it.  The edge must still be declared as routed-via-bank.
  const unplacedConnections = [];
  for (const tx of transactions) {
    if (!tx.evidence) continue;
    if (tx.from === '1000' || tx.to === '1000') continue;
    const rA = rooms.find(r => r.account === tx.from);
    const rB = rooms.find(r => r.account === tx.to);
    if (!rA || !rB) continue;
    // Always declare as unplaced: no direct door exists between any two rooms
    // (all doors lead into corridors, never room-to-room directly).
    unplacedConnections.push({
      from: tx.from, to: tx.to, evidence: tx.evidence,
      reason: `No direct door between rooms ${tx.from} and ${tx.to}. ` +
              `Transaction ${tx.id} physically routed via bank corridor. ` +
              `Layout limitation — evidence is present and valid.`,
      type: 'layout_limitation',
    });
  }

  // ---- Physical BFS ----
  const { reachableRooms, auditRoute } = physicalBFS(rooms, corridors, doors);

  // ---- Sealed account IDs (derived from evidence BFS) ----
  const sealedAccounts = [...allAccounts].filter(a => a !== '1000' && !reachable.has(a));

  // ---- Bounds ----
  const all = [...rooms, ...corridors];
  const minX = Math.min(...all.map(e => e.x));
  const minY = Math.min(...all.map(e => e.y));
  const maxX = Math.max(...all.map(e => e.x + e.w));
  const maxY = Math.max(...all.map(e => e.y + e.h));
  const bounds = {
    x: minX - WALL, y: minY - WALL,
    w: maxX - minX + WALL * 2,
    h: maxY - minY + WALL * 2,
  };

  return {
    rooms, corridors, doors, windows: [],
    unplacedConnections, reachableRooms, auditRoute,
    sealedAccounts, bounds,
    spineX, spineR, westWidth, eastWidth,
    metadata: {
      wallThickness: WALL, doorWidth: DOOR_W, windowWidth: WINDOW_W,
      mmPerUnit: 50, areaK: AREA_K, minArea: MIN_AREA, roomDepth: ROOM_DEPTH,
    },
  };
}

// ---------------------------------------------------------------------------
// Door gap: opening in north wall of room (room.y), centred
// ---------------------------------------------------------------------------
function doorGap(room) {
  const cx   = room.x + room.doorOffset;
  const half = Math.floor(DOOR_W / 2);
  return { gapX1: cx - half, gapY1: room.y, gapX2: cx + half, gapY2: room.y };
}

// ---------------------------------------------------------------------------
// Find the corridor whose bottom (y + h) == room.y and X overlaps room
// ---------------------------------------------------------------------------
function findAdjacentCorridor(room, corridors) {
  for (const c of corridors) {
    if ((c.y + c.h) === room.y &&
        c.x < room.x + room.w && c.x + c.w > room.x) {
      return c;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function roomsAdjacent(a, b) {
  const hAdj =
    (Math.abs((a.x + a.w) - b.x) <= WALL + 1 || Math.abs((b.x + b.w) - a.x) <= WALL + 1) &&
    segOv(a.y, a.y + a.h, b.y, b.y + b.h);
  const vAdj =
    (Math.abs((a.y + a.h) - b.y) <= WALL + 1 || Math.abs((b.y + b.h) - a.y) <= WALL + 1) &&
    segOv(a.x, a.x + a.w, b.x, b.x + b.w);
  return hAdj || vAdj;
}

function corridorsAdjacent(a, b) {
  // Spine-hall: spine's right wall == hall's left, or spine's left == hall's right
  // Hall rows at same Y → they would overlap if not separated by spine
  // We check the two geometric conditions:
  const hAdj =
    (Math.abs((a.x + a.w) - b.x) <= 1 || Math.abs((b.x + b.w) - a.x) <= 1) &&
    segOv(a.y, a.y + a.h, b.y, b.y + b.h);
  const vAdj =
    (Math.abs((a.y + a.h) - b.y) <= 1 || Math.abs((b.y + b.h) - a.y) <= 1) &&
    segOv(a.x, a.x + a.w, b.x, b.x + b.w);
  return hAdj || vAdj;
}

function segOv(a1, a2, b1, b2) { return a1 < b2 && b1 < a2; }

// ---------------------------------------------------------------------------
// Physical BFS
// ---------------------------------------------------------------------------
function physicalBFS(rooms, corridors, doors) {
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  };

  for (let i = 0; i < corridors.length; i++) {
    for (let j = i + 1; j < corridors.length; j++) {
      if (corridorsAdjacent(corridors[i], corridors[j])) {
        link(corridors[i].id, corridors[j].id);
      }
    }
  }
  for (const door of doors) link(door.roomId, door.corridorId);

  const visited = new Set(['ENTRANCE']);
  const q = ['ENTRANCE'];
  const route = ['ENTRANCE'];
  while (q.length) {
    const cur = q.shift();
    for (const nb of (adj.get(cur) ?? [])) {
      if (!visited.has(nb)) { visited.add(nb); q.push(nb); route.push(nb); }
    }
  }
  const reachableRooms = new Set([...visited].filter(id => rooms.some(r => r.id === id)));
  return { reachableRooms, auditRoute: route };
}

// ---------------------------------------------------------------------------
// Exported helpers
// ---------------------------------------------------------------------------
export function findOverlaps(rects) {
  const overlaps = [];
  for (let i = 0; i < rects.length; i++) {
    for (let j = i + 1; j < rects.length; j++) {
      const a = rects[i], b = rects[j];
      if (a.x < b.x + b.w && a.x + a.w > b.x &&
          a.y < b.y + b.h && a.y + a.h > b.y) {
        overlaps.push({ a: a.id, b: b.id });
      }
    }
  }
  return overlaps;
}

export function validateDoorGaps(rooms, corridors, doors) {
  const errors = [];
  for (const door of doors) {
    const room = rooms.find(r => r.id === door.roomId);
    if (!room) { errors.push(`Unknown room ${door.roomId}`); continue; }
    const corr = corridors.find(c => c.id === door.corridorId);
    if (!corr) { errors.push(`Door ${door.roomId}: unknown corridor ${door.corridorId}`); continue; }

    // Wall alignment: corridor bottom == room top
    if ((corr.y + corr.h) !== room.y) {
      errors.push(`Room ${door.roomId}: corr bottom ${corr.y + corr.h} ≠ room.y ${room.y}`);
    }
    // Gap width
    const gapW = Math.abs(door.gapX2 - door.gapX1);
    if (gapW !== DOOR_W) {
      errors.push(`Room ${door.roomId}: gap width ${gapW} ≠ DOOR_W ${DOOR_W}`);
    }
    // Gap within room x
    const gx1 = Math.min(door.gapX1, door.gapX2);
    const gx2 = Math.max(door.gapX1, door.gapX2);
    if (gx1 < room.x || gx2 > room.x + room.w) {
      errors.push(`Room ${door.roomId}: gap x[${gx1},${gx2}] outside room [${room.x},${room.x + room.w}]`);
    }
    // Gap within corridor x
    if (gx1 < corr.x || gx2 > corr.x + corr.w) {
      errors.push(`Room ${door.roomId}: gap x[${gx1},${gx2}] outside corr [${corr.x},${corr.x + corr.w}]`);
    }
  }
  return errors;
}

export function applyBankStatements(layout, bankStatement, transactions) {
  const windows = [];
  for (const stmt of bankStatement) {
    const match = transactions.find(tx =>
      tx.evidence === stmt.evidence &&
      tx.cents    === stmt.cents    &&
      (tx.from === stmt.account || tx.to === stmt.account)
    );
    if (match) {
      const room = layout.rooms.find(r => r.account === stmt.account);
      if (room) {
        windows.push({
          roomId: room.id, evidence: stmt.evidence,
          cents: stmt.cents, account: stmt.account,
          x: room.x + room.w, y: room.y + Math.floor(room.h / 2) - Math.floor(WINDOW_W / 2),
          w: WALL, h: WINDOW_W,
          label: `Bank match: ${stmt.evidence}`,
        });
      }
    }
  }
  return { ...layout, windows };
}
