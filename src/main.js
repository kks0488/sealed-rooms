/**
 * main.js — Sealed Rooms UI application
 *
 * Main entry point:
 * - Load journal.csv and bank-statement.json
 * - Accept CSV upload or choose samples via select
 * - Render floorplan with room selection
 * - Display transactions (including missing evidence)
 * - Auditor walkthrough visualization
 * - Export DXF
 */

import { processData } from './data.js';
import { buildLayout, applyBankStatements } from './geometry.js';
import { buildDXF } from './dxf.js';
import { renderFloorplan, getRoomNames } from './renderer.js';
import { buildAuditWalk } from './auditor.js';

// Global state
let currentLayout = null;
let currentTransactions = null;
let unreachableCents = 0;
let currentBankStatement = null;
let selectedRoomId = null;
let currentSample = '';
let ledgerLoadId = 0;

const sealedAmountFormat = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', maximumFractionDigits: 0,
});

// Auditor state: position is interpolated along waypoint polyline
const auditState = {
  state: 'idle',  // idle | walking | complete
  walk: null,     // { waypoints, visitedRooms }
  position: null, // {x, y} interpolated dot position
  dist: 0,        // total distance covered along polyline
  token: 0,       // incremented on cancel to invalidate old callbacks
  rafId: null,
  prevTs: null,
};

const elements = {
  viewport: document.getElementById('viewport'),
  csvInput: document.getElementById('csv-input'),
  sampleSelect: document.getElementById('sample-select'),
  roomSelect: document.getElementById('room-select'),
  auditorToggle: document.getElementById('auditor-toggle'),
  auditorReset: document.getElementById('auditor-reset'),
  exportDxfBtn: document.getElementById('export-dxf-btn'),
  roomDetails: document.getElementById('room-details'),
  transactionList: document.getElementById('transaction-list'),
  auditorInfo: document.getElementById('auditor-info'),
};

/**
 * Initialize application
 */
async function init() {
  // Add favicon (data-URI)
  const favicon = document.createElement('link');
  favicon.rel = 'icon';
  favicon.href = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect fill="%230b1526" width="100" height="100"/><rect fill="%232a9d8f" x="10" y="10" width="30" height="30"/><rect fill="%238b3a3a" x="60" y="60" width="30" height="30"/></svg>';
  document.head.appendChild(favicon);

  try {
    // Load journal.csv
    const journalRes = await fetch('./journal.csv');
    if (!journalRes.ok) throw new Error('Failed to load journal.csv');
    const journalText = await journalRes.text();

    // Load bank-statement.json
    const bankRes = await fetch('./bank-statement.json');
    if (!bankRes.ok) throw new Error('Failed to load bank-statement.json');
    const bankData = await bankRes.json();
    currentBankStatement = bankData.records || [];

    // Process fixture data
    const result = processData(journalText);
    if (!result.valid) {
      showInlineError(`CSV validation failed: ${result.errors.join(', ')}`);
      return;
    }

    currentTransactions = result.transactions;
    unreachableCents = result.unreachableCents;
    elements.sampleSelect.value = currentSample = 'original';

    // Build layout and apply bank statements
    currentLayout = buildLayout(currentTransactions);
    currentLayout = applyBankStatements(currentLayout, currentBankStatement, currentTransactions);
    cancelAudit();

    // Enable export buttons
    elements.exportDxfBtn.disabled = false;
    elements.auditorToggle.disabled = false;

    // Populate room dropdown
    const roomNames = getRoomNames(currentLayout);
    for (const room of roomNames) {
      const option = document.createElement('option');
      option.value = room.id;
      option.textContent = room.label;
      elements.roomSelect.appendChild(option);
    }

    // Initial render
    renderLayout();
    // Set dot to entrance after first render
    cancelAudit();
    updateDotOnly();
  } catch (err) {
    showInlineError(`Failed to load data: ${err.message}`);
  }

  // Attach event listeners
  elements.csvInput.addEventListener('change', handleCSVUpload);
  elements.sampleSelect.addEventListener('change', handleSampleSelect);
  elements.roomSelect.addEventListener('change', handleRoomSelect);
  elements.auditorToggle.addEventListener('click', handleAuditorToggle);
  elements.auditorReset.addEventListener('click', handleAuditorReset);
  elements.exportDxfBtn.addEventListener('click', handleExportDXF);

  // Drag and drop
  document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('drop', handleDragDrop);
}

/**
 * Render current layout to viewport
 */
function renderLayout() {
  if (!currentLayout) return;
  document.querySelector('.main-content').classList.toggle('has-selection', Boolean(selectedRoomId));
  updateMetrics();

  // Render floorplan (SVG fully redrawn; dot position set afterwards)
  const svg = renderFloorplan(currentLayout, selectedRoomId, onRoomSelect, auditState);
  elements.viewport.innerHTML = '';
  elements.viewport.appendChild(svg);

  // Position the static dot at current position
  updateDotOnly();

  // Update sidebar
  updateRoomDetails();
  updateTransactionList();
  updateAuditorInfo();
}

/**
 * Update room details sidebar
 */
function updateRoomDetails() {
  const details = elements.roomDetails;
  details.innerHTML = '';

  if (!selectedRoomId) {
    const p = document.createElement('p');
    p.textContent = 'Select a room to view details';
    details.appendChild(p);
    return;
  }

  const room = selectedAccount();
  if (!room) {
    const p = document.createElement('p');
    p.textContent = 'Room not found';
    details.appendChild(p);
    return;
  }

  const div = document.createElement('div');

  const labelEl = document.createElement('p');
  labelEl.innerHTML = '<strong>Room:</strong> ';
  labelEl.appendChild(createTextNode(room.label));
  div.appendChild(labelEl);

  const amountEl = document.createElement('p');
  amountEl.innerHTML = '<strong>Amount:</strong> ';
  amountEl.appendChild(createTextNode(`$${(room.cents / 100).toFixed(2)}`));
  div.appendChild(amountEl);

  const statusEl = document.createElement('p');
  statusEl.innerHTML = '<strong>Status:</strong> ';
  statusEl.appendChild(createTextNode(room.sealed ? 'SEALED — no evidence route' : 'Connected by evidence'));
  div.appendChild(statusEl);

  const accountEl = document.createElement('p');
  accountEl.innerHTML = '<strong>Account:</strong> ';
  accountEl.appendChild(createTextNode(room.account));
  div.appendChild(accountEl);

  details.appendChild(div);
}

/**
 * Update transaction list sidebar
 */
function updateTransactionList() {
  const list = elements.transactionList;
  list.innerHTML = '';

  if (!selectedRoomId) {
    const p = document.createElement('p');
    p.textContent = 'Select a room to see transactions';
    list.appendChild(p);
    return;
  }

  const room = selectedAccount();
  if (!room) {
    const p = document.createElement('p');
    p.textContent = 'Room not found';
    list.appendChild(p);
    return;
  }

  // Find ALL transactions for this account (including null evidence)
  const txs = currentTransactions.filter(tx => tx.from === room.account || tx.to === room.account);

  if (txs.length === 0) {
    const p = document.createElement('p');
    p.textContent = 'No transactions for this account';
    list.appendChild(p);
    return;
  }

  const container = document.createElement('div');
  for (const tx of txs) {
    const txDiv = document.createElement('div');
    txDiv.className = 'transaction-row' + (tx.evidence ? '' : ' no-evidence');

    const idEl = document.createElement('div');
    idEl.className = 'transaction-row-label';
    idEl.textContent = tx.id;
    txDiv.appendChild(idEl);

    const detailEl = document.createElement('div');
    detailEl.textContent = `${tx.from} → ${tx.to} | $${(tx.cents / 100).toFixed(2)}`;
    txDiv.appendChild(detailEl);

    const dateEl = document.createElement('div');
    dateEl.className = 'transaction-date';
    dateEl.textContent = tx.date;
    txDiv.appendChild(dateEl);
    const evidenceEl = document.createElement('div');
    evidenceEl.textContent = tx.evidence ? `Reference: ${tx.evidence}` : 'Reference: missing';
    txDiv.appendChild(evidenceEl);
    const memoEl = document.createElement('div');
    memoEl.textContent = tx.memo;
    txDiv.appendChild(memoEl);

    if (!tx.evidence) {
      const noEvidenceEl = document.createElement('div');
      noEvidenceEl.className = 'no-evidence-note';
      noEvidenceEl.textContent = `⚠ No evidence reference supplied for ${tx.id}`;
      txDiv.appendChild(noEvidenceEl);
    }

    container.appendChild(txDiv);
  }

  list.appendChild(container);
}

/**
 * Update auditor info sidebar
 */
function updateAuditorInfo() {
  const info = elements.auditorInfo;
  info.dataset.state = auditState.state;
  info.innerHTML = '';

  if (auditState.state === 'idle') {
    const p = document.createElement('p');
    p.textContent = 'Follow the evidence from the entrance. Closed rooms remain unvisited.';
    info.appendChild(p);
  } else if (auditState.state === 'walking') {
    const p = document.createElement('p');
    p.textContent = 'Auditor walking through documented doors…';
    info.appendChild(p);
  } else if (auditState.state === 'complete') {
    const div = document.createElement('div');
    const p1 = document.createElement('p');
    p1.textContent = `✓ Walkthrough complete`;
    div.appendChild(p1);

    const p2 = document.createElement('p');
    const dollars = sealedAmountFormat.format(unreachableCents / 100);
    p2.textContent = `Rooms never entered: ${currentLayout.sealedAccounts.length} — ${dollars}`;
    div.appendChild(p2);

    info.appendChild(div);
  }
}

/**
 * Handle room selection from viewport
 */
function onRoomSelect(roomId) {
  if (auditState.state === 'walking') cancelAudit();
  selectedRoomId = roomId;
  elements.roomSelect.value = roomId ?? '';
  renderLayout();
}

/**
 * Handle CSV file upload
 */
function handleCSVUpload(e) {
  const file = e.target.files[0];
  if (!file) return;

  loadLedger(() => file.text());
}

/**
 * Handle sample select dropdown
 */
function handleSampleSelect(e) {
  const choice = e.target.value;
  if (!choice) return;

  const url = choice === 'original' ? './journal.csv' : './samples/sample-repaired.csv';
  loadLedger(async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }, choice);
}

/**
 * Load the latest requested ledger and keep the picker aligned with the active sample.
 */
async function loadLedger(readCSV, sample = '') {
  const loadId = ++ledgerLoadId;
  try {
    const text = await readCSV();
    if (loadId === ledgerLoadId) processCSVText(text, sample);
  } catch (err) {
    if (loadId === ledgerLoadId) showInlineError(`Failed to load ledger: ${err.message}`);
  } finally {
    if (loadId === ledgerLoadId) elements.sampleSelect.value = currentSample;
  }
}

/**
 * Handle drag and drop
 */
function handleDragDrop(e) {
  e.preventDefault();
  e.stopPropagation();

  const files = e.dataTransfer.files;
  if (files.length === 0) return;

  const file = files[0];
  if (!file.name.endsWith('.csv')) {
    showInlineError('Please drop a .csv file');
    return;
  }

  loadLedger(() => file.text());
}

/**
 * Process CSV text and rebuild layout
 */
function processCSVText(csvText, sample) {
  const result = processData(csvText);
  if (!result.valid) {
    showInlineError(`CSV validation failed: ${result.errors.join(', ')}`);
    return; // Preserve last valid layout
  }

  const layout = buildLayout(result.transactions);
  currentLayout = applyBankStatements(layout, currentBankStatement, result.transactions);
  currentTransactions = result.transactions;
  unreachableCents = result.unreachableCents;
  currentSample = sample;

  // Cancel any running auditor
  cancelAudit();

  // Reset selection
  selectedRoomId = null;
  elements.roomSelect.value = '';
  elements.auditorToggle.disabled = false;
  elements.auditorToggle.textContent = 'Run auditor';

  // Update room dropdown
  elements.roomSelect.innerHTML = '<option value="">-- All Rooms --</option>';
  const roomNames = getRoomNames(currentLayout);
  for (const room of roomNames) {
    const option = document.createElement('option');
    option.value = room.id;
    option.textContent = room.label;
    elements.roomSelect.appendChild(option);
  }

  renderLayout();
}

/**
 * Cancel any running animation and reset position to entrance center
 */
function cancelAudit() {
  auditState.token++;
  if (auditState.rafId !== null) {
    cancelAnimationFrame(auditState.rafId);
    auditState.rafId = null;
  }
  auditState.state = 'idle';
  auditState.walk = null;
  auditState.dist = 0;
  auditState.prevTs = null;
  elements.auditorToggle.textContent = 'Run auditor';
  elements.auditorToggle.disabled = !currentLayout;
  elements.auditorReset.disabled = !currentLayout;
  // Set dot to entrance center
  if (currentLayout) {
    const entrance = currentLayout.corridors.find(c => c.id === 'ENTRANCE');
    auditState.position = entrance
      ? { x: entrance.x + entrance.w / 2, y: entrance.y + entrance.h / 2 }
      : null;
  } else {
    auditState.position = null;
  }
}

/**
 * Handle auditor start
 */
function handleAuditorToggle() {
  if (!currentLayout) { showInlineError('No layout loaded'); return; }

  cancelAudit();
  auditState.walk  = buildAuditWalk(currentLayout);
  auditState.state = 'walking';
  auditState.dist  = 0;
  elements.auditorToggle.textContent = 'Walking…';
  elements.auditorToggle.disabled = true;

  renderLayout();
  startAuditorRAF();
}

/**
 * Handle auditor reset
 */
function handleAuditorReset() {
  cancelAudit();
  elements.auditorToggle.textContent = 'Run auditor';
  elements.auditorToggle.disabled = !currentLayout;
  updateDotOnly();
  updateAuditorInfo();
}

/**
 * Compute total polyline length
 */
function polylineLength(wps) {
  let len = 0;
  for (let i = 1; i < wps.length; i++) {
    const dx = wps[i].x - wps[i-1].x, dy = wps[i].y - wps[i-1].y;
    len += Math.sqrt(dx*dx + dy*dy);
  }
  return len;
}

/**
 * Interpolate position at distance d along polyline
 */
function interpolatePolyline(wps, d) {
  if (wps.length === 0) return null;
  if (wps.length === 1) return { ...wps[0] };
  let remaining = d;
  for (let i = 1; i < wps.length; i++) {
    const dx = wps[i].x - wps[i-1].x, dy = wps[i].y - wps[i-1].y;
    const seg = Math.sqrt(dx*dx + dy*dy);
    if (remaining <= seg || i === wps.length - 1) {
      const t = seg > 0 ? Math.min(remaining / seg, 1) : 0;
      return { x: wps[i-1].x + dx*t, y: wps[i-1].y + dy*t };
    }
    remaining -= seg;
  }
  return { ...wps[wps.length - 1] };
}

const SPEED = 900; // plan-units per second

function startAuditorRAF() {
  const myToken = auditState.token;
  const wps = auditState.walk?.waypoints ?? [];
  const totalLen = polylineLength(wps);
  const prefersReduced = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (prefersReduced || totalLen === 0) {
    // Complete immediately
    auditState.dist = totalLen;
    auditState.position = wps.length ? { ...wps[wps.length - 1] } : auditState.position;
    finishAudit();
    return;
  }

  auditState.prevTs = null;

  function frame(ts) {
    if (auditState.token !== myToken) return; // cancelled

    if (auditState.prevTs === null) auditState.prevTs = ts;
    const elapsed = (ts - auditState.prevTs) / 1000; // seconds
    auditState.prevTs = ts;

    auditState.dist += elapsed * SPEED;

    if (auditState.dist >= totalLen) {
      auditState.dist = totalLen;
      auditState.position = { ...wps[wps.length - 1] };
      finishAudit();
      return;
    }

    auditState.position = interpolatePolyline(wps, auditState.dist);
    updateDotOnly();
    auditState.rafId = requestAnimationFrame(frame);
  }

  auditState.rafId = requestAnimationFrame(frame);
}

function finishAudit() {
  auditState.state = 'complete';
  elements.auditorToggle.textContent = 'Run auditor';
  elements.auditorToggle.disabled = false;
  updateDotOnly();
  updateAuditorInfo();
}

/**
 * Update only the auditor dot without redrawing the entire SVG
 */
function updateDotOnly() {
  const dot = document.querySelector('[data-testid="auditor-dot"]');
  if (!dot) return;
  if (auditState.position) {
    dot.setAttribute('cx', String(auditState.position.x));
    dot.setAttribute('cy', String(auditState.position.y));
  }
  if (dot.closest('svg')) {
    dot.closest('svg').setAttribute('data-state', auditState.state);
  }
}

/**
 * Handle room selection from dropdown
 */
function handleRoomSelect(e) {
  onRoomSelect(e.target.value || null);
}

function selectedAccount() {
  if (selectedRoomId === '1000') {
    return { id: '1000', account: '1000', label: '1000 Operating bank', sealed: false,
      cents: currentTransactions.filter(t => t.from === '1000' || t.to === '1000')
        .reduce((sum, t) => sum + t.cents, 0) };
  }
  return currentLayout.rooms.find(r => r.id === selectedRoomId);
}

function updateMetrics() {
  const accounts = new Set(currentTransactions.flatMap(t => [t.from, t.to]));
  const values = [
    [currentTransactions.length, 'TRANSACTIONS'], [currentTransactions.length * 2, 'JOURNAL LINES'],
    [accounts.size, 'ACCOUNTS'], [currentLayout.reachableRooms.size + 1, 'CONNECTED'],
    [currentLayout.sealedAccounts.length, 'SEALED ROOMS'],
    [sealedAmountFormat.format(unreachableCents / 100), 'IN SEALED ROOMS'],
  ];
  const metrics = document.getElementById('metrics');
  metrics.replaceChildren(...values.map(([value, label]) => {
    const card = document.createElement('div');
    const strong = document.createElement('strong'); strong.textContent = String(value);
    const small = document.createElement('span'); small.textContent = label;
    card.append(strong, small); return card;
  }));
  document.getElementById('layout-note').textContent =
    `Bank space shows circulation, not value. ${currentLayout.unplacedConnections.length} documented connection(s) routed via bank. Drop a fictional journal CSV to redraw.`;
}

/**
 * Handle DXF export
 */
function handleExportDXF() {
  if (!currentLayout) {
    showInlineError('No layout to export');
    return;
  }

  try {
    const dxf = buildDXF(currentLayout);
    downloadFile(dxf, 'floorplan.dxf', 'application/octet-stream');
  } catch (err) {
    showInlineError(`DXF export failed: ${err.message}`);
  }
}

/**
 * Download file
 */
function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Create safe text node (no HTML injection)
 */
function createTextNode(text) {
  const span = document.createElement('span');
  span.textContent = String(text);
  return span;
}

/**
 * Show inline error (no alert, appears briefly)
 */
function showInlineError(message) {
  console.log('Validation:', message); // For debugging, not console.error for user messages
  const div = document.createElement('div');
  div.className = 'inline-error';
  div.setAttribute('role', 'alert');
  div.textContent = message;
  document.body.insertBefore(div, document.body.firstChild);
  setTimeout(() => div.remove(), 5000);
}

/**
 * Start application
 */
init().catch(err => showInlineError(err.message));
