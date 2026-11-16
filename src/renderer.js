/**
 * renderer.js — SVG floorplan rendering
 *
 * Renders buildLayout output as SVG:
 * - Drafting grid background
 * - Navy/teal room fills, sealed burgundy amounts
 * - Chalk walls (stroke 3), door swings teal
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

  // ViewBox: bounds + margins
  const vbX = bounds.x - 30;
  const vbY = bounds.y - 40;
  const vbW = bounds.w + 60;
  const vbH = bounds.h + 100;

  const svg = svgElement('svg', {
    viewBox: `${vbX} ${vbY} ${vbW} ${vbH}`,
    preserveAspectRatio: 'xMidYMid meet',
    class: 'floorplan',
    style: `width: 100%; height: 100%; background: ${NAVY};`,
  });

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
    renderRoom(g, room, selectedId, onSelect);
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

  // Door swing arcs (teal)
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
function renderRoom(g, room, selectedId, onSelect) {
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

  // Room label (wrapped, with account ID separate)
  const labelGroup = svgElement('g');
  const lines = wrapText(label.replace(/^\d+\s*/, ''), w - 6);
  let yOffset = y + 24;
  for (const line of lines) {
    const text = svgElement('text', {
      x: String(x + w / 2),
      y: String(yOffset),
      'text-anchor': 'middle',
      'font-size': '10',
      'font-weight': '600',
      fill: CHALK,
    });
    text.textContent = line;
    labelGroup.appendChild(text);
    yOffset += 12;
  }

  // Account ID below label
  const accountText = svgElement('text', {
    x: String(x + w / 2),
    y: String(y + 11),
    'text-anchor': 'middle',
    'font-size': '8',
    'font-weight': '400',
    fill: CHALK,
    opacity: '0.7',
  });
  accountText.textContent = account;
  labelGroup.appendChild(accountText);

  group.appendChild(labelGroup);

  // Amount label for sealed rooms (inside, burgundy/gold)
  if (sealed && cents > 0) {
    const amountText = svgElement('text', {
      x: String(x + w / 2),
      y: String(y + h - 12),
      'text-anchor': 'middle',
      'font-size': '11',
      fill: '#ffdd44',
      'font-weight': '700',
    });
    amountText.textContent = `$${(cents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
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
 * Render door swing arc (teal)
 */
function renderDoor(g, door) {
  const { arcCX, arcCY, arcR, gapX1, gapY1, gapX2, gapY2 } = door;
  g.appendChild(svgElement('line', { x1: arcCX, y1: arcCY, x2: arcCX, y2: arcCY + arcR,
    stroke: TEAL, 'stroke-width': 1.1 }));

  // Door swing arc (teal dashed)
  if (arcR && arcR > 0) {
    const path = svgElement('path', {
      d: doorArcPath(gapX1, gapY1, gapX2, gapY2, arcCX, arcCY, arcR),
      fill: 'none',
      stroke: TEAL,
      'stroke-width': '1.2',
      'stroke-dasharray': '3,2',
      opacity: '0.7',
    });
    g.appendChild(path);
  }
}

/**
 * Generate door swing arc SVG path
 */
function doorArcPath(x1, y1, x2, y2, cx, cy, r) {
  return `M ${cx + r} ${cy} A ${r} ${r} 0 0 1 ${cx} ${cy + r}`;
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
 * Render metrics display (data-driven counts)
 */
function renderMetrics(g, layout, auditState, bounds) {
  const { rooms, unplacedConnections } = layout;

  const sealedCount = rooms.filter(r => r.sealed).length;
  const sealedCents = rooms
    .filter(r => r.sealed)
    .reduce((sum, r) => sum + r.cents, 0);
  const totalCents = rooms.reduce((sum, r) => sum + r.cents, 0);

  const metricsY = bounds.y - 25;
  const metricsText = svgElement('text', {
    x: String(bounds.x + 10),
    y: String(metricsY),
    'font-size': '9',
    fill: CHALK,
    opacity: '0.8',
  });

  let info = `Rooms: ${rooms.length} | Sealed: ${sealedCount} ($${(sealedCents / 100).toFixed(0)})`;
  if (unplacedConnections && unplacedConnections.length > 0) {
    info += ` | Unplaced routes: ${unplacedConnections.length} (via bank)`;
  }

  metricsText.textContent = info;
  g.appendChild(metricsText);

  // Auditor status
  if (auditState) {
    const statusY = metricsY - 12;
    const statusText = svgElement('text', {
      x: String(bounds.x + 10),
      y: String(statusY),
      'font-size': '8',
      fill: CHALK,
      opacity: '0.6',
    });
    statusText.textContent = `Status: ${auditState.state}`;
    g.appendChild(statusText);
  }
}

/**
 * Wrap text to fit within width
 */
function wrapText(text, maxWidth) {
  const chars = Array.from(text);
  // Don't split words like "Inventory"
  const words = text.split(' ');
  if (words.length === 1 && chars.length <= 14) {
    return [text];
  }

  const lines = [];
  let line = '';
  for (const word of words) {
    const testLine = line ? line + ' ' + word : word;
    if ((testLine.length * 5.5) > maxWidth && line) {
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
