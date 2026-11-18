// Supervisor-authored browser verification; uses an existing Playwright installation.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { processData } from '../src/data.js';
import { buildLayout } from '../src/geometry.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const shots = path.resolve(root, '../shots2');
const artifacts = path.join(root, 'artifacts');
const modulePath = process.env.SEALED_PLAYWRIGHT || new URL('../../proto/node_modules/playwright-core/index.mjs', import.meta.url).href;
const { chromium } = await import(modulePath);
await mkdir(shots, { recursive: true });
await mkdir(artifacts, { recursive: true });
const csv = await readFile(path.join(root, 'journal.csv'), 'utf8');
const layout = buildLayout(processData(csv).transactions);
const entrance = layout.corridors.find(c => c.id === 'ENTRANCE');
const start = { x: entrance.x + entrance.w / 2, y: entrance.y + entrance.h / 2 };
const checks = [];
function check(name, condition, detail) {
  checks.push({ name, pass: Boolean(condition), ...(detail === undefined ? {} : { detail }) });
  assert.ok(condition, name + (detail === undefined ? '' : ': ' + JSON.stringify(detail)));
}
const srv = spawn(process.execPath, ['scripts/server.js'], { cwd: root,
  env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Local server did not start')), 5000);
    srv.stdout.on('data', chunk => {
      const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
    srv.once('exit', code => reject(Error('Local server exited: ' + code)));
  });
  browser = await chromium.launch({ headless: true,
    executablePath: process.env.SEALED_CHROMIUM || 'chromium',
    args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US', acceptDownloads: true });
  const errors = [], external = [], httpFailures = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith(origin + '/')) external.push(r.url()); });
  page.on('response', r => { if (r.status() >= 400) httpFailures.push({ url: r.url(), status: r.status() }); });
  await page.goto(origin, { waitUntil: 'networkidle' });
  const dot = page.locator('[data-testid="auditor-dot"]');
  const position = () => dot.evaluate(el => ({ x: Number(el.getAttribute('cx')), y: Number(el.getAttribute('cy')) }));
  const state = () => page.locator('#auditor-info').getAttribute('data-state');
  const summary = () => page.locator('#metrics strong').allTextContents();
  const reset = async () => { await page.locator('#auditor-reset').click(); await page.waitForTimeout(100); };
  const drop = text => page.evaluate(text => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([text], 'fictional-journal.csv', { type: 'text/csv' }));
    document.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, text);

  check('23 leaf rooms plus bank = 24 accounts', await page.locator('[data-room-id]').count() === 23);
  check('original ledger totals', JSON.stringify(await summary()) === JSON.stringify(['194', '388', '24', '21', '3', '$27,600']), await summary());
  check('auditor exists at entrance before running', await dot.count() === 1 && JSON.stringify(await position()) === JSON.stringify(start));
  check('night paper', await page.locator('#viewport svg').evaluate(el => getComputedStyle(el).backgroundColor) === 'rgb(11, 21, 38)');
  check('entrance, bank and wings labelled', (await page.locator('#viewport').innerText()).includes('OPENING BALANCES') && (await page.locator('#viewport').innerText()).includes('OPERATING BANK'));
  const roomBoxes = await page.locator('[data-room-id]').evaluateAll(nodes => nodes.map(n => {
    const r = n.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  }));
  const frame = await page.locator('#viewport').boundingBox();
  const textBoxes = await page.locator('#viewport svg text').evaluateAll(nodes => nodes.map(n => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
  check('entire plan and dimension labels fit 1440x900', roomBoxes.every(r => r.left >= 0 && r.right <= 1440 && r.top >= 0 && r.bottom <= 900) && textBoxes.every(r => r.top >= frame.y && r.bottom <= frame.y + frame.height));
  check('no page overflow', await page.evaluate(() => document.documentElement.scrollWidth === 1440 && document.documentElement.scrollHeight === 900));

  // Task-8 browser checks
  // (a) no room label bounding box intersects any door arc/opening bounding box
  const labelArcOverlap = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('[data-label-type]')];
    const arcs   = [...document.querySelectorAll('.door-arc, .door-leaf')];
    const rects  = r => ({ l: r.left, r: r.right, t: r.top, b: r.bottom });
    const overlaps = r => { const a = rects(r); return arcs.some(arc => { const b = rects(arc.getBoundingClientRect()); return a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t; }); };
    return labels.map(el => ({ text: el.textContent, box: rects(el.getBoundingClientRect()), hit: overlaps(el.getBoundingClientRect()) })).filter(x => x.hit);
  });
  check('no room label overlaps a door arc or opening', labelArcOverlap.length === 0, labelArcOverlap);

  // Supervisor check: text lines inside one room never overlap each other,
  // stay inside the room, and are at least 8px tall on screen.
  const labelProblems = await page.evaluate(() => {
    const out = [];
    for (const room of document.querySelectorAll('[data-room-id]')) {
      const rb = room.querySelector('rect')?.getBoundingClientRect();
      const boxes = [...room.querySelectorAll('[data-label-type]')].map(el => ({ text: el.textContent, b: el.getBoundingClientRect() }));
      for (const x of boxes) {
        if (x.b.height < 8) out.push({ room: room.dataset.roomId, text: x.text, small: x.b.height });
        if (rb && (x.b.left < rb.left - 1 || x.b.right > rb.right + 1 || x.b.bottom > rb.bottom + 1)) out.push({ room: room.dataset.roomId, text: x.text, outside: true });
      }
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].b, b = boxes[j].b;
        if (a.left < b.right && a.right > b.left && a.top < b.bottom - 1 && a.bottom - 1 > b.top) out.push({ room: room.dataset.roomId, overlap: [boxes[i].text, boxes[j].text] });
      }
    }
    return out;
  });
  check('room text lines are readable, inside the room and never overlap', labelProblems.length === 0, labelProblems);

  // (b) total door arcs in SVG == number of non-sealed rooms (1 arc per door); sealed rooms have 0
  const totalDoorArcs = await page.locator('.door-arc').count();
  const nonSealedCount = layout.rooms.filter(r => !r.sealed).length;
  check('door arc count equals non-sealed room count (1 arc per door)', totalDoorArcs === nonSealedCount, { totalDoorArcs, nonSealedCount });

  // (c) plan top and bottom margins inside the plan panel differ by at most 15% of panel height
  const marginBalance = await page.evaluate(() => {
    const panel = document.getElementById('viewport').getBoundingClientRect();
    const svg   = document.querySelector('#viewport svg');
    if (!svg) return { ok: false, reason: 'no svg' };
    // Find the actual rendered bounding box of all room-group elements
    const rooms = [...document.querySelectorAll('[data-room-id]')];
    if (!rooms.length) return { ok: false, reason: 'no rooms' };
    const tops    = rooms.map(r => r.getBoundingClientRect().top);
    const bottoms = rooms.map(r => r.getBoundingClientRect().bottom);
    const contentTop    = Math.min(...tops);
    const contentBottom = Math.max(...bottoms);
    const topMargin    = contentTop - panel.top;
    const bottomMargin = panel.bottom - contentBottom;
    const diff = Math.abs(topMargin - bottomMargin);
    const threshold = panel.height * 0.15;
    return { ok: diff <= threshold, topMargin, bottomMargin, diff, threshold };
  });
  check('plan top and bottom margins differ by at most 15% of panel height', marginBalance.ok, marginBalance);

  await page.screenshot({ path: path.join(shots, '01-floorplan.png') });

  await page.locator('#auditor-toggle').click();
  await page.waitForFunction(() => document.querySelector('#auditor-info').dataset.state === 'walking');
  let last = await position(), moved = false;
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(100);
    const next = await position();
    moved ||= Math.hypot(next.x - last.x, next.y - last.y) > .1;
    assert.ok([...layout.rooms.filter(r => !r.sealed), ...layout.corridors].some(r => next.x >= r.x - .01 && next.x <= r.x + r.w + .01 && next.y >= r.y - .01 && next.y <= r.y + r.h + .01), 'Dot leaves accessible floor');
    assert.ok(Math.hypot(next.x - last.x, next.y - last.y) < 230, 'Dot jumps across rooms');
    last = next;
  }
  check('auditor visibly moves on accessible floor without jumping', moved);
  await page.screenshot({ path: path.join(shots, '02-auditor-walking.png') });
  console.log('Waiting for real continuous tour to finish…');
  await page.waitForFunction(() => document.querySelector('#auditor-info').dataset.state === 'complete', {}, { timeout: 90000 });
  check('original completion 3 / $27,600', (await page.locator('#auditor-info').innerText()).includes('Rooms never entered: 3 — $27,600'));

  await page.locator('[data-room-id="5090"]').click();
  const detail = await page.locator('.sidebar').innerText();
  check('sealed room explains exact missing transaction', detail.includes('J0181') && detail.includes('No evidence reference supplied') && detail.includes('8700'));
  check('room selection cancels and resets auditor', await state() === 'idle' && JSON.stringify(await position()) === JSON.stringify(start));
  await page.screenshot({ path: path.join(shots, '03-room-details.png') });
  await page.locator('[data-room-id="5090"]').focus();
  await page.keyboard.press('Enter');
  check('room keyboard activation', (await page.locator('#room-details').innerText()).includes('5090'));
  await page.locator('[data-account-id="1000"]').first().click();
  check('bank corridor opens its source transactions', (await page.locator('#room-details').innerText()).includes('Operating bank') && await page.locator('#transaction-list .transaction-row').count() === 193);

  const downloadPromise = page.waitForEvent('download');
  await page.locator('#export-dxf-btn').click();
  const download = await downloadPromise;
  await download.saveAs(path.join(artifacts, 'browser-export.dxf'));
  const dxf = await readFile(path.join(artifacts, 'browser-export.dxf'), 'utf8');
  const lines = dxf.trim().split(/\r?\n/), pairs = [];
  for (let i = 0; i < lines.length; i += 2) pairs.push({ code: Number(lines[i]), value: lines[i + 1] });
  const unitAt = pairs.findIndex(p => p.code === 9 && p.value === '$INSUNITS');
  check('actual DXF download uses millimetres and required layers', pairs[unitAt + 1]?.value === '4' && ['FLOOR', 'WALL', 'DOOR', 'ROOM_NAME', 'SEALED'].every(name => pairs.some(p => p.code === 2 && p.value === name)) && dxf.length > 10000);

  await reset();
  await page.locator('#auditor-toggle').click(); await page.waitForTimeout(200);
  await page.locator('[data-room-id="1010"]').click();
  const stopped = await position(); await page.waitForTimeout(300);
  check('selection invalidates old animation callbacks', await state() === 'idle' && JSON.stringify(stopped) === JSON.stringify(await position()));
  await page.locator('#auditor-toggle').click(); await page.waitForTimeout(200);
  await page.locator('#sample-select').selectOption('repaired');
  await page.waitForFunction(() => document.querySelectorAll('#metrics strong')[4]?.textContent === '0');
  check('sample import cancels old tour and opens all accounts', await state() === 'idle' && (await summary())[3] === '24' && (await summary())[5] === '$0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#auditor-toggle').click();
  await page.waitForFunction(() => document.querySelector('#auditor-info').dataset.state === 'complete');
  check('reduced motion and repaired completion 0 / $0', (await page.locator('#auditor-info').innerText()).includes('Rooms never entered: 0 — $0'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await drop(csv);
  await page.waitForFunction(() => document.querySelectorAll('#metrics strong')[4]?.textContent === '3');
  check('drag/drop reconstructs original plan', JSON.stringify(await summary()) === JSON.stringify(['194', '388', '24', '21', '3', '$27,600']));
  const widthBefore = await page.locator('[data-room-id="1010"] rect').first().getAttribute('width');
  const changedLines = csv.split('\n');
  changedLines[1] = changedLines[1].replace('18000', '180000'); changedLines[2] = changedLines[2].replace('18000', '180000');
  await drop(changedLines.join('\n'));
  await page.waitForFunction(width => document.querySelector('[data-room-id="1010"] rect').getAttribute('width') !== width, widthBefore);
  check('new CSV amounts change actual room geometry', await page.locator('[data-room-id="1010"] rect').first().getAttribute('width') !== widthBefore);
  const beforeError = await summary();
  await page.locator('#csv-input').setInputFiles({ name: 'invalid-fiction.csv', mimeType: 'text/csv', buffer: Buffer.from('wrong,header\n1,2') });
  await page.locator('.inline-error').waitFor();
  check('invalid import preserves last valid plan', JSON.stringify(await summary()) === JSON.stringify(beforeError) && await page.locator('[data-room-id]').count() === 23);
  await drop(csv.replaceAll('Scheduled posting / Petty cash', '<img src=x onerror=window.__auditXss=1>'));
  await page.waitForTimeout(200); await page.locator('[data-room-id="1010"]').click();
  check('CSV text cannot inject HTML', await page.locator('.sidebar img').count() === 0 && await page.evaluate(() => window.__auditXss !== 1) && (await page.locator('.sidebar').innerText()).includes('<img'));
  check('no outside requests', external.length === 0, external);
  check('no browser or HTTP errors', errors.length === 0 && httpFailures.length === 0, { errors, httpFailures });
  console.log(`Browser checks ${checks.length}/${checks.length} passed`);
} finally {
  await writeFile(path.join(artifacts, 'browser-checks.json'), JSON.stringify(checks, null, 2) + '\n');
  if (browser) await browser.close();
  srv.kill('SIGTERM');
  await new Promise(resolve => { if (srv.exitCode !== null) resolve(); else srv.once('exit', resolve); });
}
