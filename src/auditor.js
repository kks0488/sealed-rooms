/**
 * auditor.js — Auditor walkthrough path generation
 *
 * Nodes: all corridors + all rooms
 * Edges: doors (room↔corridor via gap midpoint) + shared corridor edges (via shared-edge midpoint)
 * Start: ENTRANCE corridor
 *
 * buildAuditWalk(layout):
 *   For each non-sealed reachable leaf (sorted by id), route from current node
 *   to target via shortest path; collect portal midpoints + destination rect center.
 *   Then route back to ENTRANCE.
 *   Returns { waypoints:[{x,y}], visitedRooms:[id] }
 */

import { buildWalls } from './dxf.js';

function rectCenter(r) {
  return { x: r.x + r.w / 2, y: r.y + r.h / 2 };
}

/** Build node map: id → {x,y,w,h} for all corridors and rooms */
function buildNodeMap(rooms, corridors) {
  const nodes = new Map();
  for (const c of corridors) nodes.set(c.id, c);
  for (const r of rooms)     nodes.set(r.id, r);
  return nodes;
}

/** Build adjacency: id → [{nodeId, portalX, portalY}] */
function buildAdjacency(rooms, corridors, doors) {
  const adj = new Map();
  const allIds = [...corridors.map(c => c.id), ...rooms.map(r => r.id)];
  for (const id of allIds) adj.set(id, []);

  // Door edges: room ↔ corridor
  for (const door of doors) {
    const px = (door.gapX1 + door.gapX2) / 2;
    const py = (door.gapY1 + door.gapY2) / 2;
    adj.get(door.roomId)?.push({ nodeId: door.corridorId, portalX: px, portalY: py });
    adj.get(door.corridorId)?.push({ nodeId: door.roomId,  portalX: px, portalY: py });
  }

  // Corridor shared-edge edges
  for (let i = 0; i < corridors.length; i++) {
    for (let j = i + 1; j < corridors.length; j++) {
      const portal = sharedEdgePortal(corridors[i], corridors[j]);
      if (portal) {
        adj.get(corridors[i].id).push({ nodeId: corridors[j].id, portalX: portal.x, portalY: portal.y });
        adj.get(corridors[j].id).push({ nodeId: corridors[i].id, portalX: portal.x, portalY: portal.y });
      }
    }
  }

  return adj;
}

/** Midpoint of shared edge between two axis-aligned rectangles, or null */
function sharedEdgePortal(a, b) {
  const aR = a.x + a.w, aB = a.y + a.h;
  const bR = b.x + b.w, bB = b.y + b.h;

  if (aR === b.x) { // a is left of b
    const y1 = Math.max(a.y, b.y), y2 = Math.min(aB, bB);
    if (y1 < y2) return { x: aR, y: (y1 + y2) / 2 };
  } else if (bR === a.x) { // b is left of a
    const y1 = Math.max(a.y, b.y), y2 = Math.min(aB, bB);
    if (y1 < y2) return { x: bR, y: (y1 + y2) / 2 };
  } else if (aB === b.y) { // a is above b
    const x1 = Math.max(a.x, b.x), x2 = Math.min(aR, bR);
    if (x1 < x2) return { x: (x1 + x2) / 2, y: aB };
  } else if (bB === a.y) { // b is above a
    const x1 = Math.max(a.x, b.x), x2 = Math.min(aR, bR);
    if (x1 < x2) return { x: (x1 + x2) / 2, y: bB };
  }
  return null;
}

/** BFS shortest path from `from` to `to`; returns ordered edge list [{nodeId,portalX,portalY}] or null */
function shortestPath(from, to, adj) {
  if (from === to) return [];
  const prev = new Map(); // nodeId → {via: neighborEntry, from: nodeId}
  const queue = [from];
  prev.set(from, null);

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === to) break;
    for (const edge of (adj.get(cur) || [])) {
      if (!prev.has(edge.nodeId)) {
        prev.set(edge.nodeId, { edge, from: cur });
        queue.push(edge.nodeId);
      }
    }
  }

  if (!prev.has(to)) return null; // unreachable

  // Reconstruct edge list from to→from, reverse
  const path = [];
  let cur = to;
  while (prev.get(cur) !== null) {
    const entry = prev.get(cur);
    path.push(entry.edge); // edge = {nodeId: cur, portalX, portalY}
    cur = entry.from;
  }
  path.reverse();
  return path;
}

/**
 * Build auditor walk
 */
export function buildAuditWalk(layout) {
  const { rooms, corridors, doors, reachableRooms } = layout;

  const nodes = buildNodeMap(rooms, corridors);
  const adj   = buildAdjacency(rooms, corridors, doors);

  const entrance = nodes.get('ENTRANCE');
  if (!entrance) return { waypoints: [], visitedRooms: [] };

  // Reachable non-sealed leaf rooms sorted by id
  const targets = rooms
    .filter(r => !r.sealed && reachableRooms?.has(r.id))
    .map(r => r.id)
    .sort();

  if (targets.length === 0) {
    // Return single entrance waypoint
    return { waypoints: [rectCenter(entrance)], visitedRooms: [] };
  }

  const waypoints = [rectCenter(entrance)];
  const visitedRooms = [];
  let currentNodeId = 'ENTRANCE';

  for (const targetId of targets) {
    const path = shortestPath(currentNodeId, targetId, adj);
    if (!path) continue; // skip unreachable

    // Append portal midpoints + destination center
    for (const edge of path) {
      waypoints.push({ x: edge.portalX, y: edge.portalY });
      const dest = nodes.get(edge.nodeId);
      if (dest) waypoints.push(rectCenter(dest));
    }

    visitedRooms.push(targetId);
    currentNodeId = targetId;
  }

  // Route back to entrance
  const returnPath = shortestPath(currentNodeId, 'ENTRANCE', adj);
  if (returnPath) {
    for (const edge of returnPath) {
      waypoints.push({ x: edge.portalX, y: edge.portalY });
      const dest = nodes.get(edge.nodeId);
      if (dest) waypoints.push(rectCenter(dest));
    }
  }

  return { waypoints, visitedRooms };
}

/** Check if point is strictly inside (or on border of) rect */
export function isPointInRect(pt, r) {
  return pt.x >= r.x && pt.x <= r.x + r.w && pt.y >= r.y && pt.y <= r.y + r.h;
}

/** Both endpoints of segment must be inside the SAME rect */
export function isSegmentInside(p1, p2, rects) {
  return rects.some(r => isPointInRect(p1, r) && isPointInRect(p2, r));
}
