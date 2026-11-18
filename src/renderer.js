/**
 * renderer.js — SVG floorplan rendering
 *
 * Renders buildLayout output as SVG:
 * - Drafting grid background
 * - Navy/teal room fills, sealed burgundy amounts with diagonal hatch
 * - Chalk walls (stroke 3), door gaps + swing arcs teal
 * - Bank windows and dimensions (meters at 50mm/unit)
 * - Auditor walkthrough visualization
 */

import { buildWalls } from './dxf.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const NAVY = '#0b1526';
const CHALK = '#eeeeee';
const TEAL = '#2a9d8f';
const BURGUNDY = '#8b3a3a';
const ACCENT = '#4a90e2';

/**
 * Create SVG element with namespace
 */
function svgElement(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, v);
  }
  return el;
}

/**
 * Render complete floorplan to SVG
 * Returns SVG element ready to append
 */
export function renderFloorplan(layout, selectedId = null, onSelect = null, auditState = null) {
  const { bounds, rooms, corridors, doors, windows, metadata } = layout;

  // ViewBox: snug to actual content including annotation space below (scale bar = +55)
  // and minimal space above/sides for context.  The wing labels sit 13 units above each hall,
  // so the first visible content is at approximately y = HALL1_Y - 16 = 44.
  // We add a 20-unit pad on all sides for a tidy margin.
  const PAD = 20;
  const vbX = bounds.x - PAD;
  const vbY = bounds.y - PAD;
  const vbW = bounds.w + PAD * 2;
  const vbH = bounds.h + PAD * 2 + 55; // 55 extra below for dimension / scale bar

  const svg = svgElement('svg', {
    viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
    preserveAspectRatio: 'xMidYMid meet',
    class: 'floorplan',
    style: `width: 100%; height: 100%; background: ${NAVY};`,
  });

  // Defs: hatch pattern for sealed rooms
  const defs = svgElement('defs');
  const hatchPattern = svgElement('pattern', {
    id: 'sealed-hatch',
    patternUnits: 'userSpaceOnUse',
    width: '8',
    height: '8',
    patternTransform: 'rotate(45)',
  });
  const hatchLine = svgElement('line', {
    x1: '0', y1: '0', x2: '0', y2: '8',
    stroke: '#c05050',
    'stroke-width': '1.5',
    opacity: '0.45',
  });
  hatchPattern.appendChild(hatchLine);
  defs.appendChild(hatchPattern);
  svg.appendChild(defs);

  const g = svgElement('g');

  // Drafting grid
  renderDraftingGrid(g, bounds, 50);

  // Corridors (rectangles, no strokes)
  for (const corridor of corridors) {
    const rect = svgElement('rect', {
      x: String(corridor.x),
      y: String(corridor.y),
      width: String(corridor.w),
      height: String(corridor.h),
      fill: CHALK,
      stroke: 'none',
      opacity: '0.08',
    });
    if (corridor.account === '1000' && onSelect) {
      rect.setAttribute('data-account-id', '1000');
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', () => onSelect('1000'));
    }
    g.appendChild(rect);
  }

  // Rooms
  for (const room of rooms) {
    renderRoom(g, room, selectedId, onSelect, doors);
  }

  // Walls (canonical segments from buildWalls, stroke 3)
  const wallSegments = buildWalls(layout);
  for (const seg of wallSegments) {
    const line = svgElement('line', {
      x1: String(seg.x1),
      y1: String(seg.y1),
      x2: String(seg.x2),
      y2: String(seg.y2),
      stroke: CHALK,
      'stroke-width': '3',
    });
    g.appendChild(line);
  }

  // Door drawings: leaf line + swing arc, in teal
  for (const door of doors) {
    renderDoor(g, door);
  }

  // Bank windows
  for (const window of windows) {
    const rect = svgElement('rect', {
      x: String(window.x),
      y: String(window.y),
      width: String(window.w),
      height: String(window.h),
      fill: 'none',
      stroke: CHALK,
      'stroke-width': '1.5',
      'stroke-dasharray': '3,3',
      opacity: '0.6',
    });
    g.appendChild(rect);
  }

  // Auditor dot — always present at current position (idle: entrance, walking/complete: interpolated)
  if (auditState && auditState.position) {
    renderAuditorDot(g, auditState);
  }

  // Dimensions and scale
  renderDimensions(g, bounds, metadata);

  renderAnnotations(g, layout);

  svg.appendChild(g);
  return svg;
}

/**
 * Render drafting grid background
 */
function renderDraftingGrid(g, bounds, gridSize) {
  const gridGroup = svgElement('g', { opacity: '0.03' });

  // Vertical lines
  for (let x = Math.floor(bounds.x / gridSize) * gridSize; x <= bounds.x + bounds.w; x += gridSize) {
    const line = svgElement('line', {
      x1: String(x),
      y1: String(bounds.y),
      x2: String(x),
      y2: String(bounds.y + bounds.h),
      stroke: CHALK,
      'stroke-width': '0.5',
    });
    gridGroup.appendChild(line);
  }

  // Horizontal lines
  for (let y = Math.floor(bounds.y / gridSize) * gridSize; y <= bounds.y + bounds.h; y += gridSize) {
    const line = svgElement('line', {
      x1: String(bounds.x),
      y1: String(y),
      x2: String(bounds.x + bounds.w),
      y2: String(y),
      stroke: CHALK,
      'stroke-width': '0.5',
    });
    gridGroup.appendChild(line);
  }

  g.appendChild(gridGroup);
}

/**
 * Render a single room
 */
function renderRoom(g, room, selectedId, onSelect, doors) {
  const { id, account, label, x, y, w, h, sealed, cents } = room;

  // Room group
  const group = svgElement('g', {
    class: 'room-group',
    'data-room-id': id,
    tabindex: '0',
    role: 'button',
  });

  // Room fill (navy for regular, burgundy for sealed)
  const fill = sealed ? BURGUNDY : NAVY;
  const rect = svgElement('rect', {
    x: String(x),
    y: String(y),
    width: String(w),
    height: String(h),
    fill: fill,
    stroke: 'none',
    opacity: sealed ? '0.85' : '0.5',
  });
  group.appendChild(rect);

  // Sealed rooms: diagonal hatch overlay so "sealed" reads in greyscale
  if (sealed) {
    const hatch = svgElement('rect', {
      x: String(x),
      y: String(y),
      width: String(w),
      height: String(h),
      fill: 'url(#sealed-hatch)',
      stroke: 'none',
    });
    group.appendChild(hatch);
  }

  // Selection highlight
  if (id === selectedId) {
    const highlight = svgElement('rect', {
      x: String(x + 1),
      y: String(y + 1),
      width: String(w - 2),
      height: String(h - 2),
      fill: 'none',
      stroke: ACCENT,
      'stroke-width': '2',
    });
    group.appendChild(highlight);
  }

  // ---- Room text: centred in room, account number above name ----
  // The door opens from the north wall (top).  The arc swings down into the room
  // by arcR (= DOOR_W = 14) plan units.  We keep text clear of that zone.
  const thisDoor = doors ? doors.find(d => d.roomId === id) : null;
  const arcDepth = thisDoor ? thisDoor.arcR : 0;

  // Available text zone: from the door-clear zone to the bottom of the room.
  // Door occupies y .. y+arcDepth; text sits in y+arcDepth .. y+h.
  // If the room has no door (sealed), use full interior.
  const textZoneTop = y + arcDepth;
  const textZoneBot = y + h;
  const textZoneH = textZoneBot - textZoneTop;

  // Parse account number and name from label (label = "NNNN Name…")
  const spaceIdx = label.indexOf(' ');
  const accStr = spaceIdx === -1 ? label : label.slice(0, spaceIdx);
  const nameStr = spaceIdx === -1 ? '' : label.slice(spaceIdx + 1);

  // Font sizes: scale to room width, capped
  // Supervisor correction (task 8): the first sizes (7/6) were unreadable in the
  // demo capture; names now wrap instead of shrinking.
  const fontSizeAcc = Math.min(11, Math.max(8, Math.floor(w / 6)));
  const fontSizeName = Math.min(10, Math.max(8, Math.floor(w / 7)));

  // For sealed rooms, also show amount on a third line
  const amountStr = (sealed && cents > 0)
    ? `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
    : '';

  // Count wrapped name lines so the amount never lands on a name line.
  const nameLines = nameStr ? wrapText(nameStr, w - 10, fontSizeName) : [];
  const lineHeight = fontSizeName + 3;
  const lineCount = 1 + nameLines.length + (amountStr ? 1 : 0);
  const totalTextH = fontSizeAcc + (lineCount - 1) * lineHeight;

  // Centre the text block in the available zone.
  // If the zone is too tight (< totalTextH + 4px), fall back to room centre.
  let blockTop;
  if (textZoneH >= totalTextH + 4) {
    blockTop = textZoneTop + (textZoneH - totalTextH) / 2;
  } else {
    // Fallback: centre in full room interior
    blockTop = y + (h - totalTextH) / 2;
  }

  const textCX = x + w / 2;

  // Account number line
  const accText = svgElement('text', {
    x: String(textCX),
    y: String(blockTop + fontSizeAcc),
    'text-anchor': 'middle',
    'font-size': String(fontSizeAcc),
    'font-weight': '700',
    fill: CHALK,
    'font-family': 'monospace',
    opacity: '0.9',
    'pointer-events': 'none',
    'user-select': 'none',
    'data-label-type': 'account',
  });
  accText.textContent = accStr;
  group.appendChild(accText);

  // Name line
  if (nameStr) {
    let ny = blockTop + fontSizeAcc + lineHeight;
    for (const line of nameLines) {
      const nameText = svgElement('text', {
        x: String(textCX),
        y: String(ny),
        'text-anchor': 'middle',
        'font-size': String(fontSizeName),
        'font-weight': '500',
        fill: CHALK,
        opacity: '0.85',
        'pointer-events': 'none',
        'user-select': 'none',
        'data-label-type': 'name',
      });
      if (line.length * fontSizeName * 0.55 > w - 8) {
        nameText.setAttribute('textLength', String(w - 8));
        nameText.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
      nameText.textContent = line;
      group.appendChild(nameText);
      ny += lineHeight;
    }
  }

  // Amount line (sealed only)
  if (amountStr) {
    const amountText = svgElement('text', {
      x: String(textCX),
      y: String(blockTop + fontSizeAcc + lineHeight * (nameLines.length + 1)),
      'text-anchor': 'middle',
      'font-size': String(fontSizeName + 1),
      fill: '#ffdd44',
      'font-weight': '700',
      'pointer-events': 'none',
      'user-select': 'none',
      'data-label-type': 'amount',
    });
    amountText.textContent = amountStr;
    group.appendChild(amountText);
  }

  // Click handler
  if (onSelect) {
    group.addEventListener('click', () => onSelect(id));
    group.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(id);
      }
    });
  }

  g.appendChild(group);
}

/**
 * Render a door as: leaf line (across the gap) + quarter-circle swing arc.
 *
 * Layout: all doors are on the north wall of a room (y-axis = room.y).
 * Gap runs from (gapX1, gapY1) to (gapX2, gapY2) — both have same Y.
 * arcCX = gapX1, arcCY = gapY1, arcR = DOOR_W.
 *
 * In SVG (y-down):
 *   - Leaf line: (arcCX, arcCY) → (arcCX + arcR, arcCY)  [across the gap]
 *   - Swing arc: quarter circle from (arcCX + arcR, arcCY) sweeping down-left
 *     to (arcCX, arcCY + arcR), i.e. large-arc=0, sweep=1 (clockwise in SVG).
 *
 * This matches the DXF representation (arc 270°–360° after y-flip = same quarter).
 */
function renderDoor(g, door) {
  const { arcCX, arcCY, arcR, gapX1, gapY1, gapX2, gapY2 } = door;

  // Leaf line: from hinge (arcCX, arcCY) to door tip (arcCX + arcR, arcCY)
  // The gap goes gapX1 → gapX2; the leaf spans the same distance horizontally.
  const leafX2 = arcCX + arcR;
  const leafY = arcCY; // same as gapY1

  const leaf = svgElement('line', {
    x1: String(arcCX),
    y1: String(leafY),
    x2: String(leafX2),
    y2: String(leafY),
    stroke: TEAL,
    'stroke-width': '1.8',
    'stroke-linecap': 'square',
    class: 'door-leaf',
  });
  g.appendChild(leaf);

  // Swing arc: from (arcCX + arcR, arcCY) → (arcCX, arcCY + arcR)
  // Quarter circle, clockwise (sweep-flag=1 in SVG y-down)
  const arcPath = `M ${arcCX + arcR} ${arcCY} A ${arcR} ${arcR} 0 0 1 ${arcCX} ${arcCY + arcR}`;
  const arc = svgElement('path', {
    d: arcPath,
    fill: 'none',
    stroke: TEAL,
    'stroke-width': '1.2',
    'stroke-dasharray': '4,2',
    opacity: '0.85',
    class: 'door-arc',
  });
  g.appendChild(arc);
}

function renderAnnotations(g, layout) {
  const text = (x, y, label, size = 11, extra = {}) => {
    const el = svgElement('text', { x, y, fill: CHALK, 'font-size': size,
      'font-family': 'monospace', 'letter-spacing': 1.3, 'pointer-events': 'none', ...extra });
    el.textContent = label; g.appendChild(el);
  };
  for (const [id, label] of [['HALL_W1', 'ASSET WING'], ['HALL_W2', 'LIABILITY WING'],
    ['HALL_E1', 'INCOME WING'], ['HALL_E2', 'EXPENSE WING']]) {
    const hall = layout.corridors.find(c => c.id === id);
    if (hall) text(hall.x + 4, hall.y - 13, label);
  }
  const bank = layout.corridors.find(c => c.id === 'CORR_SPINE');
  if (bank) {
    const x = bank.x + bank.w / 2, y = bank.y + bank.h / 2;
    text(x, y, '1000 / OPERATING BANK', 10,
      { transform: `rotate(-90 ${x} ${y})`, 'text-anchor': 'middle' });
  }
  const entry = layout.corridors.find(c => c.id === 'ENTRANCE');
  if (entry) {
    text(entry.x + 22, entry.y + 32, 'OPENING BALANCES', 13);
    text(entry.x + 22, entry.y + 49, 'ENTRANCE / AUDIT START', 9, { opacity: .65 });
  }
  text(layout.bounds.x + layout.bounds.w - 10, layout.bounds.y + 6, 'N ↑', 12,
    { 'text-anchor': 'end' });
}

/**
 * Render auditor dot at current interpolated position
 */
function renderAuditorDot(g, auditState) {
  const pos = auditState.position;
  if (!pos) return;

  const circle = svgElement('circle', {
    cx: String(pos.x),
    cy: String(pos.y),
    r: '5',
    'data-testid': 'auditor-dot',
    fill: ACCENT,
    opacity: '0.9',
  });
  g.appendChild(circle);
}

/**
 * Render dimensions and scale bar
 */
function renderDimensions(g, bounds, metadata) {
  const botY = bounds.y + bounds.h + 20;

  // Dimension line
  const dimLineH = svgElement('line', {
    x1: String(bounds.x),
    y1: String(botY),
    x2: String(bounds.x + bounds.w),
    y2: String(botY),
    stroke: CHALK,
    'stroke-width': '0.8',
    opacity: '0.5',
  });
  g.appendChild(dimLineH);

  // Dimension text (plan units)
  const dimText = svgElement('text', {
    x: String(bounds.x + bounds.w / 2),
    y: String(botY + 12),
    'text-anchor': 'middle',
    'font-size': '9',
    fill: CHALK,
    opacity: '0.7',
  });
  const planWidth = bounds.w;
  const meters = ((planWidth * 50) / 1000).toFixed(2);
  dimText.textContent = `${meters}m`;
  g.appendChild(dimText);

  // Scale bar (100 units = 5m)
  const scaleBarW = 100;
  const scaleX = bounds.x + 20;
  const scaleY = bounds.y + bounds.h + 50;

  const scaleBarLine = svgElement('line', {
    x1: String(scaleX),
    y1: String(scaleY),
    x2: String(scaleX + scaleBarW),
    y2: String(scaleY),
    stroke: CHALK,
    'stroke-width': '1.5',
  });
  g.appendChild(scaleBarLine);

  // Scale label
  const scaleLabel = svgElement('text', {
    x: String(scaleX + scaleBarW / 2),
    y: String(scaleY + 12),
    'text-anchor': 'middle',
    'font-size': '8',
    fill: CHALK,
    opacity: '0.7',
  });
  scaleLabel.textContent = '5m';
  g.appendChild(scaleLabel);
}

/**
 * Wrap text to fit within width (px approximation using charWidth)
 */
function wrapText(text, maxWidth, fontSize = 9) {
  const charWidth = fontSize * 0.55;
  const words = text.split(' ');
  if (words.length === 1 && text.length * charWidth <= maxWidth) {
    return [text];
  }

  const lines = [];
  let line = '';
  for (const word of words) {
    const testLine = line ? line + ' ' + word : word;
    if (testLine.length * charWidth > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = testLine;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Export SVG as string (for download)
 */
export function svgToString(svg) {
  return new XMLSerializer().serializeToString(svg);
}

/**
 * Get list of rooms as {id, label} objects
 */
export function getRoomNames(layout) {
  return layout.rooms.map(r => ({ id: r.id, label: r.label }));
}
