/**
 * data.js — CSV parsing, validation, fixture loading, evidence graph BFS
 *
 * Key invariants:
 *   - from = account of the CREDIT row (money source)
 *   - to   = account of the DEBIT  row (money destination)
 *   - bankMatched = false by default; never inferred from bank participation
 *   - graph built only over evidence-bearing transactions
 *   - reachable = BFS from '1000' over evidence-only graph
 *   - unreachable accounts: those never touched by an evidenced tx reachable from bank
 */

// ---------------------------------------------------------------------------
// Account metadata
// ---------------------------------------------------------------------------
const ACCOUNT_METADATA = {
  '1000': { name: '1000 Operating bank',      type: 'bank'      },
  '1010': { name: '1010 Cash',                 type: 'asset'     },
  '1020': { name: '1020 Clearing',             type: 'asset'     },
  '1030': { name: '1030 Inventory',            type: 'asset'     },
  '1040': { name: '1040 Receivables',          type: 'asset'     },
  '1050': { name: '1050 Equipment',            type: 'asset'     },
  '1060': { name: '1060 Prepaid rent',         type: 'asset'     },
  '1090': { name: '1090 Suspense reserve',     type: 'reserve'   },
  '2000': { name: '2000 Trade payables',       type: 'liability' },
  '2010': { name: '2010 Sales tax',            type: 'liability' },
  '2020': { name: '2020 Bridge loan',          type: 'liability' },
  '2030': { name: '2030 Gift cards',           type: 'liability' },
  '2040': { name: '2040 Customer deposits',    type: 'liability' },
  '4000': { name: '4000 Shop sales',           type: 'income'    },
  '4010': { name: '4010 Online sales',         type: 'income'    },
  '4020': { name: '4020 Workshop income',      type: 'income'    },
  '4030': { name: '4030 Other income',         type: 'income'    },
  '5000': { name: '5000 Rent',                 type: 'expense'   },
  '5010': { name: '5010 Payroll',              type: 'expense'   },
  '5020': { name: '5020 Utilities',            type: 'expense'   },
  '5030': { name: '5030 Shop supplies',        type: 'expense'   },
  '5040': { name: '5040 Marketing',            type: 'expense'   },
  '5080': { name: '5080 Dormant maintenance',  type: 'expense'   },
  '5090': { name: '5090 Unverified services',  type: 'expense'   },
};

// Valid account: 1xxx, 2xxx, 4xxx, 5xxx
const VALID_ACCOUNT_RE = /^[1245]\d{3}$/;

// ---------------------------------------------------------------------------
// CSV parser — handles quoted fields, escaped double-quotes, embedded newlines
// Throws on unterminated quoted field
// ---------------------------------------------------------------------------
function parseCSV(text) {
  if (!text || text.trim() === '') {
    throw new Error('Empty CSV input');
  }

  const rows = [];
  let currentRow = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          // escaped double-quote
          field += '"';
          i += 2;
        } else {
          // closing quote
          inQuotes = false;
          i++;
        }
      } else {
        // embedded character (including newline)
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        currentRow.push(field);
        field = '';
        i++;
      } else if (ch === '\r') {
        i++; // skip CR
      } else if (ch === '\n') {
        currentRow.push(field);
        // skip entirely-blank trailing line
        if (currentRow.some(f => f !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        field = '';
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // flush last row
  if (inQuotes) {
    throw new Error('Unterminated quoted field in CSV');
  }
  if (field !== '' || currentRow.length > 0) {
    currentRow.push(field);
    if (currentRow.some(f => f !== '')) {
      rows.push(currentRow);
    }
  }

  return rows;
}

// ---------------------------------------------------------------------------
// Strict integer-cents parser
// Accepts only /^\d+$/ strings whose numeric value is a safe integer > 0 or 0
// ---------------------------------------------------------------------------
function parseCents(raw) {
  if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
    return { ok: false };
  }
  const n = Number(raw);
  if (!Number.isSafeInteger(n)) {
    return { ok: false };
  }
  return { ok: true, value: n };
}

// ---------------------------------------------------------------------------
// Strict date parser — rejects phantom dates like 2026-02-30
// ---------------------------------------------------------------------------
function parseDate(raw) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return { ok: false };
  }
  const d = new Date(raw + 'T00:00:00Z');
  if (isNaN(d.getTime())) return { ok: false };
  // ISO round-trip check
  const roundtrip = d.toISOString().slice(0, 10);
  if (roundtrip !== raw) return { ok: false };
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Validate header
// ---------------------------------------------------------------------------
const EXPECTED_HEADER = [
  'transaction', 'date', 'account',
  'debit_cents', 'credit_cents', 'evidence', 'memo',
];

function validateHeader(row) {
  if (row.length !== EXPECTED_HEADER.length) {
    return `Header has ${row.length} columns, expected ${EXPECTED_HEADER.length}`;
  }
  for (let i = 0; i < EXPECTED_HEADER.length; i++) {
    if (row[i] !== EXPECTED_HEADER[i]) {
      return `Header column ${i}: expected '${EXPECTED_HEADER[i]}', got '${row[i]}'`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Validate a single data row
// ---------------------------------------------------------------------------
function validateDataRow(row, lineNum) {
  if (row.length !== EXPECTED_HEADER.length) {
    return `Row ${lineNum}: wrong column count (${row.length})`;
  }
  const [transaction, date, account, debitRaw, creditRaw, , memo] = row;

  if (!transaction || transaction.trim() === '') {
    return `Row ${lineNum}: empty transaction ID`;
  }
  if (!parseDate(date).ok) {
    return `Row ${lineNum}: invalid date '${date}'`;
  }
  if (!VALID_ACCOUNT_RE.test(account)) {
    return `Row ${lineNum}: invalid account '${account}'`;
  }

  const deb = parseCents(debitRaw);
  const cre = parseCents(creditRaw);
  if (!deb.ok) return `Row ${lineNum}: invalid debit_cents '${debitRaw}'`;
  if (!cre.ok) return `Row ${lineNum}: invalid credit_cents '${creditRaw}'`;

  // Exactly one side must be non-zero
  if (deb.value === 0 && cre.value === 0) {
    return `Row ${lineNum}: both debit_cents and credit_cents are zero`;
  }
  if (deb.value > 0 && cre.value > 0) {
    return `Row ${lineNum}: both debit_cents and credit_cents are non-zero`;
  }

  if (!memo || memo.trim() === '') {
    return `Row ${lineNum}: empty memo`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cross-group validation — date, evidence, memo must agree within a group
// ---------------------------------------------------------------------------
function validateGroups(dataRows) {
  const groups = new Map();
  for (const row of dataRows) {
    const id = row[0];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }

  const errors = [];

  for (const [txId, rows] of groups) {
    if (rows.length !== 2) {
      errors.push(`Transaction ${txId}: expected 2 rows, got ${rows.length}`);
      continue;
    }

    const [r0, r1] = rows;
    const [, date0, acc0, deb0raw, cre0raw, ev0, memo0] = r0;
    const [, date1, acc1, deb1raw, cre1raw, ev1, memo1] = r1;

    if (date0 !== date1) {
      errors.push(`Transaction ${txId}: inconsistent date ('${date0}' vs '${date1}')`);
    }
    if (ev0 !== ev1) {
      errors.push(`Transaction ${txId}: inconsistent evidence ('${ev0}' vs '${ev1}')`);
    }
    if (memo0 !== memo1) {
      errors.push(`Transaction ${txId}: inconsistent memo`);
    }

    if (acc0 === acc1) {
      errors.push(`Transaction ${txId}: same account on both sides ('${acc0}')`);
    }

    // balanced amounts
    const deb0 = parseCents(deb0raw).value;
    const cre0 = parseCents(cre0raw).value;
    const deb1 = parseCents(deb1raw).value;
    const cre1 = parseCents(cre1raw).value;
    const totalDebit  = deb0 + deb1;
    const totalCredit = cre0 + cre1;
    if (totalDebit !== totalCredit) {
      errors.push(`Transaction ${txId}: unbalanced (debit ${totalDebit} ≠ credit ${totalCredit})`);
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Derive transaction objects
//   from = account of the CREDIT row  (source of money)
//   to   = account of the DEBIT  row  (destination)
// ---------------------------------------------------------------------------
function deriveTransactions(dataRows) {
  const groups = new Map();
  for (const row of dataRows) {
    const id = row[0];
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }

  const result = [];
  for (const [txId, rows] of groups) {
    if (rows.length !== 2) continue;

    const [r0, r1] = rows;
    // find which row is debit (debit_cents > 0) and which is credit
    let debitRow, creditRow;
    if (parseCents(r0[3]).value > 0) {
      debitRow = r0; creditRow = r1;
    } else {
      debitRow = r1; creditRow = r0;
    }

    const evidence = debitRow[5].trim() !== '' ? debitRow[5].trim() : null;

    result.push({
      id:          txId,
      date:        debitRow[1],
      from:        creditRow[2],   // credit account = source
      to:          debitRow[2],    // debit  account = destination
      cents:       parseCents(debitRow[3]).value,
      evidence,
      memo:        debitRow[6],
      bankMatched: false,          // never inferred; set externally if present
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Evidence graph — only edges where evidence is non-null
// ---------------------------------------------------------------------------
function buildGraph(transactions) {
  const graph = new Map();

  const addEdge = (a, b) => {
    if (!graph.has(a)) graph.set(a, new Set());
    graph.get(a).add(b);
  };

  for (const tx of transactions) {
    if (tx.evidence === null) continue; // evidence-only edges
    addEdge(tx.from, tx.to);
    addEdge(tx.to, tx.from);
  }

  return graph;
}

// BFS from '1000' over the evidence graph
function findReachableAccounts(graph) {
  const visited = new Set(['1000']);
  const queue   = ['1000'];

  while (queue.length > 0) {
    const cur = queue.shift();
    for (const nb of (graph.get(cur) ?? [])) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }

  return visited;
}

// Sum cents of transactions that touch at least one unreachable account
function countUnreachableCents(transactions, reachable) {
  let total = 0;
  for (const tx of transactions) {
    if (!reachable.has(tx.from) || !reachable.has(tx.to)) {
      total += tx.cents;
    }
  }
  return total;
}

// ---------------------------------------------------------------------------
// processData — main entry point
// Returns { valid, errors } on failure, or full result object on success
// ---------------------------------------------------------------------------
export function processData(csvText) {
  // 1. Parse
  let rows;
  try {
    rows = parseCSV(csvText);
  } catch (e) {
    return { valid: false, errors: [e.message] };
  }

  if (rows.length < 2) {
    return { valid: false, errors: ['CSV has no data rows (header only or empty)'] };
  }

  // 2. Header
  const headerErr = validateHeader(rows[0]);
  if (headerErr) return { valid: false, errors: [headerErr] };

  const dataRows = rows.slice(1);

  // 3. Per-row validation
  const rowErrors = [];
  for (let i = 0; i < dataRows.length; i++) {
    const e = validateDataRow(dataRows[i], i + 2); // +2 = 1-based + header
    if (e) rowErrors.push(e);
  }
  if (rowErrors.length > 0) return { valid: false, errors: rowErrors };

  // 4. Group-level validation
  const groupErrors = validateGroups(dataRows);
  if (groupErrors.length > 0) return { valid: false, errors: groupErrors };

  // 5. Derive & graph
  const transactions  = deriveTransactions(dataRows);
  const graph         = buildGraph(transactions);
  const reachable     = findReachableAccounts(graph);
  const unreachableCents = countUnreachableCents(transactions, reachable);

  // All accounts that appear in at least one transaction
  const allAccounts = new Set();
  for (const tx of transactions) {
    allAccounts.add(tx.from);
    allAccounts.add(tx.to);
  }

  const unreachableAccounts = new Set(
    [...allAccounts].filter(a => !reachable.has(a))
  );

  return {
    valid: true,
    transactions,
    txCount:              transactions.length,
    rowCount:             dataRows.length,
    allAccounts,
    reachable,
    unreachableAccounts,
    unreachableCents,
    metadata: ACCOUNT_METADATA,
  };
}

// Low-level exports for testing
export {
  parseCSV,
  parseCents,
  parseDate,
  validateHeader,
  validateDataRow,
  validateGroups,
  deriveTransactions,
  buildGraph,
  findReachableAccounts,
  countUnreachableCents,
  ACCOUNT_METADATA,
  VALID_ACCOUNT_RE,
};
