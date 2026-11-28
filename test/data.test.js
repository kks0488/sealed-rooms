/**
 * test/data.test.js — data layer tests
 *
 * Coverage:
 *  - parseCSV: quoted fields, embedded newlines, escaped quotes, unterminated quote, empty input
 *  - parseCents: strict integer validation (rejects floats, junk suffixes, unsafe)
 *  - parseDate: rejects phantom dates (2026-02-30), bad format
 *  - validateHeader: exact column names
 *  - validateDataRow: zero/both-sided amounts, bad account, bad date
 *  - validateGroups: unbalanced, inconsistent date/evidence/memo, same-account
 *  - processData on fixture journal.csv: 194 tx, 388 rows, 24 accounts, 3 unreachable, 2760000 cents
 *  - processData on sample-repaired.csv: 24 accounts, 0 unreachable, 2760000 more cents reachable
 *  - negative imports: various reject scenarios
 *  - repaired: removing an evidence ref makes account unreachable again
 */

import { readFileSync } from 'fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCSV,
  parseCents,
  parseDate,
  validateHeader,
  validateDataRow,
  validateGroups,
  deriveTransactions,
  buildGraph,
  findReachableAccounts,
  processData,
} from '../src/data.js';

// ---- helpers ----------------------------------------------------------------

function minimalCSV(overrides = {}) {
  const r = {
    id: 'J0001', date: '2026-09-01',
    acc_deb: '1010', acc_cre: '1000',
    amount: '18000', evidence: 'EV-0001', memo: 'Test memo',
    ...overrides,
  };
  const header = 'transaction,date,account,debit_cents,credit_cents,evidence,memo';
  const row1 = `${r.id},${r.date},${r.acc_deb},${r.amount},0,${r.evidence},"${r.memo}"`;
  const row2 = `${r.id},${r.date},${r.acc_cre},0,${r.amount},${r.evidence},"${r.memo}"`;
  return `${header}\n${row1}\n${row2}\n`;
}

// ---- parseCSV ---------------------------------------------------------------

test('parseCSV: quoted field with comma inside', () => {
  const rows = parseCSV('a,b,c\n1,"two,two",3\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1][1], 'two,two');
});

test('parseCSV: escaped double-quote inside quoted field', () => {
  const rows = parseCSV('a,b\n1,"say ""hello"""\n');
  assert.equal(rows[1][1], 'say "hello"');
});

test('parseCSV: embedded newline in quoted field', () => {
  const rows = parseCSV('a,b\n1,"line1\nline2"\n');
  assert.equal(rows[1][1], 'line1\nline2');
  assert.equal(rows.length, 2); // still 2 logical rows
});

test('parseCSV: unterminated quote throws', () => {
  assert.throws(() => parseCSV('a,b\n1,"unterminated'), /unterminated/i);
});

test('parseCSV: empty string throws', () => {
  assert.throws(() => parseCSV(''), /empty/i);
});

test('parseCSV: whitespace-only throws', () => {
  assert.throws(() => parseCSV('   \n  '), /empty/i);
});

// ---- parseCents -------------------------------------------------------------

test('parseCents: accepts zero', () => {
  assert.deepEqual(parseCents('0'), { ok: true, value: 0 });
});

test('parseCents: accepts normal integer', () => {
  assert.deepEqual(parseCents('18000'), { ok: true, value: 18000 });
});

test('parseCents: rejects float string "12.5"', () => {
  assert.equal(parseCents('12.5').ok, false);
});

test('parseCents: rejects junk suffix "12junk"', () => {
  assert.equal(parseCents('12junk').ok, false);
});

test('parseCents: rejects negative "-1"', () => {
  assert.equal(parseCents('-1').ok, false);
});

test('parseCents: rejects unsafe integer', () => {
  assert.equal(parseCents(String(Number.MAX_SAFE_INTEGER + 1)).ok, false);
});

test('parseCents: rejects empty string', () => {
  assert.equal(parseCents('').ok, false);
});

// ---- parseDate --------------------------------------------------------------

test('parseDate: accepts valid date', () => {
  assert.equal(parseDate('2026-09-01').ok, true);
});

test('parseDate: rejects phantom date 2026-02-30', () => {
  assert.equal(parseDate('2026-02-30').ok, false);
});

test('parseDate: rejects bad format "09-01-2026"', () => {
  assert.equal(parseDate('09-01-2026').ok, false);
});

test('parseDate: rejects month 13', () => {
  assert.equal(parseDate('2026-13-01').ok, false);
});

test('parseDate: rejects day 00', () => {
  assert.equal(parseDate('2026-09-00').ok, false);
});

// ---- validateHeader ---------------------------------------------------------

test('validateHeader: accepts correct header', () => {
  const row = ['transaction','date','account','debit_cents','credit_cents','evidence','memo'];
  assert.equal(validateHeader(row), null);
});

test('validateHeader: rejects wrong column name', () => {
  const row = ['transaction','date','account','debit_cents','credit_cents','ev','memo'];
  assert.match(validateHeader(row), /evidence/);
});

test('validateHeader: rejects wrong column count', () => {
  const row = ['transaction','date','account'];
  assert.match(validateHeader(row), /columns/);
});

// ---- validateDataRow --------------------------------------------------------

test('validateDataRow: rejects row where both sides zero', () => {
  const row = ['J0001','2026-09-01','1010','0','0','EV-001','memo'];
  assert.match(validateDataRow(row, 2), /both.*zero/i);
});

test('validateDataRow: rejects row where both sides non-zero', () => {
  const row = ['J0001','2026-09-01','1010','100','100','EV-001','memo'];
  assert.match(validateDataRow(row, 2), /both.*non-zero/i);
});

test('validateDataRow: rejects invalid account', () => {
  const row = ['J0001','2026-09-01','3000','100','0','EV-001','memo'];
  assert.match(validateDataRow(row, 2), /account/i);
});

test('validateDataRow: rejects phantom date', () => {
  const row = ['J0001','2026-02-30','1010','100','0','EV-001','memo'];
  assert.match(validateDataRow(row, 2), /date/i);
});

test('validateDataRow: rejects empty memo', () => {
  const row = ['J0001','2026-09-01','1010','100','0','EV-001',''];
  assert.match(validateDataRow(row, 2), /memo/i);
});

// ---- validateGroups ---------------------------------------------------------

test('validateGroups: rejects inconsistent date within group', () => {
  const rows = [
    ['J0001','2026-09-01','1010','100','0','EV-001','memo'],
    ['J0001','2026-09-02','1000','0','100','EV-001','memo'],
  ];
  const errs = validateGroups(rows);
  assert.ok(errs.some(e => /date/i.test(e)));
});

test('validateGroups: rejects inconsistent evidence within group', () => {
  const rows = [
    ['J0001','2026-09-01','1010','100','0','EV-001','memo'],
    ['J0001','2026-09-01','1000','0','100','EV-002','memo'],
  ];
  const errs = validateGroups(rows);
  assert.ok(errs.some(e => /evidence/i.test(e)));
});

test('validateGroups: rejects inconsistent memo within group', () => {
  const rows = [
    ['J0001','2026-09-01','1010','100','0','EV-001','memo A'],
    ['J0001','2026-09-01','1000','0','100','EV-001','memo B'],
  ];
  const errs = validateGroups(rows);
  assert.ok(errs.some(e => /memo/i.test(e)));
});

test('validateGroups: rejects same account on both sides', () => {
  const rows = [
    ['J0001','2026-09-01','1010','100','0','EV-001','memo'],
    ['J0001','2026-09-01','1010','0','100','EV-001','memo'],
  ];
  const errs = validateGroups(rows);
  assert.ok(errs.some(e => /same account/i.test(e)));
});

test('validateGroups: rejects unbalanced amounts', () => {
  const rows = [
    ['J0001','2026-09-01','1010','100','0','EV-001','memo'],
    ['J0001','2026-09-01','1000','0','200','EV-001','memo'],
  ];
  const errs = validateGroups(rows);
  assert.ok(errs.some(e => /unbalanced/i.test(e)));
});

test('validateGroups: rejects group with 3 rows', () => {
  const rows = [
    ['J0001','2026-09-01','1010','100','0','EV-001','memo'],
    ['J0001','2026-09-01','1000','0','100','EV-001','memo'],
    ['J0001','2026-09-01','1020','50','0','EV-001','memo'],
  ];
  const errs = validateGroups(rows);
  assert.ok(errs.some(e => /rows/i.test(e)));
});

// ---- from/to direction ------------------------------------------------------

test('deriveTransactions: from=credit account, to=debit account', () => {
  // J0001: 1010 DR 18000 / 1000 CR 18000 → money flows 1000→1010
  const rows = [
    ['J0001','2026-09-01','1010','18000','0','EV-001','memo'],
    ['J0001','2026-09-01','1000','0','18000','EV-001','memo'],
  ];
  const txs = deriveTransactions(rows);
  assert.equal(txs[0].from, '1000'); // credit row = source
  assert.equal(txs[0].to,   '1010'); // debit  row = destination
  assert.equal(txs[0].cents, 18000);
});

// ---- bankMatched default ----------------------------------------------------

test('deriveTransactions: bankMatched defaults to false', () => {
  const rows = [
    ['J0001','2026-09-01','1010','18000','0','EV-001','memo'],
    ['J0001','2026-09-01','1000','0','18000','EV-001','memo'],
  ];
  const txs = deriveTransactions(rows);
  assert.equal(txs[0].bankMatched, false);
});

// ---- buildGraph evidence filter ---------------------------------------------

test('buildGraph: excludes edges with null evidence', () => {
  const txs = [
    { from: '1000', to: '1090', cents: 100, evidence: null },
    { from: '1000', to: '1010', cents: 50,  evidence: 'EV-001' },
  ];
  const graph = buildGraph(txs);
  // 1090 must NOT be in the graph
  assert.ok(!graph.has('1090'));
  assert.ok(graph.has('1010'));
});

// ---- fixture journal.csv: exact totals --------------------------------------

const journalPath = new URL('../journal.csv', import.meta.url);
const journalCSV = readFileSync(journalPath, 'utf8');

test('fixture: processData is valid', () => {
  const result = processData(journalCSV);
  if (!result.valid) {
    console.error('Errors:', result.errors);
  }
  assert.equal(result.valid, true);
});

test('fixture: 194 transactions', () => {
  const result = processData(journalCSV);
  assert.equal(result.txCount, 194);
});

test('fixture: 388 data rows', () => {
  const result = processData(journalCSV);
  assert.equal(result.rowCount, 388);
});

test('fixture: 24 accounts total', () => {
  const result = processData(journalCSV);
  assert.equal(result.allAccounts.size, 24);
});

test('fixture: 21 reachable accounts (evidence graph from 1000)', () => {
  const result = processData(journalCSV);
  assert.equal(result.reachable.size, 21);
});

test('fixture: 3 unreachable accounts', () => {
  const result = processData(journalCSV);
  assert.equal(result.unreachableAccounts.size, 3);
});

test('fixture: unreachable accounts are 1090, 5080, 5090', () => {
  const result = processData(journalCSV);
  assert.ok(result.unreachableAccounts.has('1090'));
  assert.ok(result.unreachableAccounts.has('5080'));
  assert.ok(result.unreachableAccounts.has('5090'));
});

test('fixture: 2760000 cents in unreachable transactions', () => {
  const result = processData(journalCSV);
  // 1090→1280000, 5090→870000, 5080→610000 = 2760000
  assert.equal(result.unreachableCents, 2760000);
});

test('counts a transaction between two unreachable accounts only once', () => {
  const [, debit, credit] = minimalCSV({
    id: 'J0195', acc_deb: '5090', acc_cre: '5080', amount: '10000', evidence: '',
  }).split('\n');
  const result = processData(`${journalCSV.trimEnd()}\n${debit}\n${credit}\n`);
  assert.equal(result.valid, true);
  assert.equal(result.txCount, 195);
  assert.equal(result.unreachableAccounts.size, 3);
  assert.equal(result.unreachableCents, 2770000);
});

// ---- sample-repaired.csv: 0 unreachable ------------------------------------

const repairedPath = new URL('../samples/sample-repaired.csv', import.meta.url);
const repairedCSV = readFileSync(repairedPath, 'utf8');

test('repaired: processData is valid', () => {
  const result = processData(repairedCSV);
  if (!result.valid) console.error('Errors:', result.errors);
  assert.equal(result.valid, true);
});

test('repaired: 24 accounts total', () => {
  const result = processData(repairedCSV);
  assert.equal(result.allAccounts.size, 24);
});

test('repaired: 0 unreachable accounts', () => {
  const result = processData(repairedCSV);
  assert.equal(result.unreachableAccounts.size, 0);
});

test('repaired: 0 unreachable cents', () => {
  const result = processData(repairedCSV);
  assert.equal(result.unreachableCents, 0);
});

// ---- negative import tests --------------------------------------------------

test('negative: empty CSV', () => {
  const r = processData('');
  assert.equal(r.valid, false);
});

test('negative: header-only CSV', () => {
  const r = processData('transaction,date,account,debit_cents,credit_cents,evidence,memo\n');
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /no data rows/i.test(e)));
});

test('negative: unterminated quoted field', () => {
  const csv = 'transaction,date,account,debit_cents,credit_cents,evidence,memo\nJ0001,2026-09-01,1010,100,0,EV-001,"unterminated\n';
  const r = processData(csv);
  assert.equal(r.valid, false);
});

test('negative: float debit_cents rejected', () => {
  const csv = minimalCSV({ amount: '12.5' }).replace('12.5,0', '12.5,0');
  // build manually with float
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-09-01,1010,12.5,0,EV-001,"memo"
J0001,2026-09-01,1000,0,12.5,EV-001,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /debit_cents/i.test(e)));
});

test('negative: junk suffix in credit_cents rejected', () => {
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-09-01,1010,100,0,EV-001,"memo"
J0001,2026-09-01,1000,0,100junk,EV-001,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /credit_cents/i.test(e)));
});

test('negative: phantom date 2026-02-30 rejected', () => {
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-02-30,1010,100,0,EV-001,"memo"
J0001,2026-02-30,1000,0,100,EV-001,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /date/i.test(e)));
});

test('negative: both debit and credit non-zero rejected', () => {
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-09-01,1010,100,100,EV-001,"memo"
J0001,2026-09-01,1000,100,100,EV-001,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
});

test('negative: both debit and credit zero rejected', () => {
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-09-01,1010,0,0,EV-001,"memo"
J0001,2026-09-01,1000,0,0,EV-001,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
});

test('negative: 3-row transaction rejected', () => {
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-09-01,1010,100,0,EV-001,"memo"
J0001,2026-09-01,1000,0,100,EV-001,"memo"
J0001,2026-09-01,1020,50,0,EV-001,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
});

test('negative: same account on both sides rejected', () => {
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-09-01,1010,100,0,EV-001,"memo"
J0001,2026-09-01,1010,0,100,EV-001,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /same account/i.test(e)));
});

test('negative: inconsistent date within group rejected', () => {
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-09-01,1010,100,0,EV-001,"memo"
J0001,2026-09-02,1000,0,100,EV-001,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /date/i.test(e)));
});

test('negative: inconsistent evidence within group rejected', () => {
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-09-01,1010,100,0,EV-001,"memo"
J0001,2026-09-01,1000,0,100,EV-002,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /evidence/i.test(e)));
});

test('negative: unbalanced transaction rejected', () => {
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-09-01,1010,100,0,EV-001,"memo"
J0001,2026-09-01,1000,0,200,EV-001,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /unbalanced/i.test(e)));
});

test('negative: invalid account prefix rejected', () => {
  const bad = `transaction,date,account,debit_cents,credit_cents,evidence,memo
J0001,2026-09-01,3000,100,0,EV-001,"memo"
J0001,2026-09-01,1000,0,100,EV-001,"memo"
`;
  const r = processData(bad);
  assert.equal(r.valid, false);
  assert.ok(r.errors.some(e => /account/i.test(e)));
});

// ---- repair/remove reference test -------------------------------------------

test('remove evidence from J0181 makes 5090 unreachable', () => {
  // Take repaired CSV and blank out EV-R001 for J0181 to simulate removal
  const modified = repairedCSV
    .replace('J0181,2026-11-06,5090,870000,0,EV-R001,', 'J0181,2026-11-06,5090,870000,0,,')
    .replace('J0181,2026-11-06,1000,0,870000,EV-R001,', 'J0181,2026-11-06,1000,0,870000,,');
  const result = processData(modified);
  assert.equal(result.valid, true);
  assert.ok(result.unreachableAccounts.has('5090'));
});
