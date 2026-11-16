# Sealed Rooms

An offline accounting evidence floorplan visualizer for fictional data. Maps accounting transactions to a spatial building layout where room dimensions reflect monetary amounts.

## Overview

- **Fictional ledger**: 194 transactions across 388 data rows + header (each ID repeats exactly 2 balanced rows), 24 accounts, $27,600 in sealed evidence
- **Spatial layout**: Entrance (opening balances), central bank circulation spine, four wings (assets, liabilities, income, expenses)
- **Auditor walkthrough**: Interactive path following portal doors; 3 rooms never entered (sealed evidence)
- **DXF export**: ASCII AC1015 format with layer structure (FLOOR, WALL, DOOR, ROOM_NAME, SEALED)
- **Bank exception**: One connection (1010→1020) routed via bank circulation due to layout constraints
- **Minimum area**: 5,400 plan-square-units (60×90 depth); scale 50mm/unit
- **No dependencies**: Native ES modules, Node.js built-ins only, offline

## Data

### CSV Schema

`journal.csv` (7 columns):
```
transaction, date, account, debit_cents, credit_cents, evidence, memo
```

- **transaction**: J0001–J0194 (unique, repeated exactly 2 times per ID for balanced debit/credit)
- **date**: ISO 8601 (2026-09-01 to 2026-11-27)
- **account**: 1xxx (assets), 2xxx (liabilities), 4xxx (income), 5xxx (expense), or 1000 (bank)
- **debit_cents/credit_cents**: Integer cents (no decimals)
- **evidence**: Document reference (e.g., INV-001) or empty for unmapped transactions
- **memo**: Description

**Totals**: 194 unique transactions, 388 data rows + 1 header row (some with embedded newlines), balanced

### Accounts (24)

**Bank**: 1000 Operating bank  
**Assets**: 1010 Cash, 1020 Clearing, 1030 Inventory, 1040 Receivables, 1050 Equipment, 1060 Prepaid rent, 1090 Suspense  
**Liabilities**: 2000 Trade payables, 2010 Sales tax, 2020 Bridge loan, 2030 Gift cards, 2040 Customer deposits  
**Income**: 4000 Shop sales, 4010 Online sales, 4020 Workshop income, 4030 Other income  
**Expense**: 5000 Rent, 5010 Payroll, 5020 Utilities, 5030 Supplies, 5040 Marketing, 5080 Dormant, 5090 Unverified

### Sealed Evidence

3 accounts have unmapped transactions totaling $27,600:
- **1090 Suspense reserve**: $12,800
- **5080 Dormant maintenance**: $6,100
- **5090 Unverified services**: $8,700

**Note**: References (evidence column) are not proof of authenticity. This is a fictional demonstration.

## Build & Run

### Development

```bash
npm run dev
```

Starts local HTTP server (localhost, random port). Open browser to shown URL. Import CSV or load samples.

### Build

```bash
npm run build
```

Copies assets to `dist/` directory (index.html, src/*, journal.csv, samples/, bank-statement.json).

### Test

```bash
npm test
```

Runs Node.js built-in test runner (143 tests):
- **Data validation** (62): CSV parsing, encoding, balance checks, evidence reachability
- **Geometry** (36): Room layout, corridor placement, door gaps, wall segments
- **DXF** (37): Wall canonicalization, layer consistency, DXF entity correctness
- **Auditor** (8): Waypoint validity, segment containment, room visit order

### Verify

```bash
bash scripts/verify.sh
```

Browser verification (23 checks) via Playwright/Chromium. Requires Chrome/Chromium environment.

## Features

### Floorplan

- **Navy+chalk rendering**: Midnight background (#0b1526), chalk walls (stroke 3)
- **Room fills**: Navy (reachable), burgundy (sealed)
- **Door swings**: Teal dashed arcs showing swing area
- **Bank windows**: Synthetic dashed rectangles for bank statement validation
- **Grid**: Subtle drafting grid (50-unit spacing)
- **Dimensions**: Bottom scale bar (100 units = 5m at 50mm/unit); room labels with amounts (sealed only)

### CSV Import

- **Drag/drop**: Drop any .csv file to import
- **Samples**: Original journal.csv or Evidence-repaired sample
- **Validation**: Inline error message on parse failure; preserves last valid layout
- **Safe DOM**: All user input rendered via `textContent` (no HTML injection)

### Auditor Walkthrough

- **BFS path**: Shortest routes from entrance through non-sealed rooms
- **Interpolated dot**: Follows polyline at ~900 plan-units/sec
- **Reduced motion**: Completes in one frame if `prefers-reduced-motion` detected
- **Statistics**: Shows count of unsealed rooms visited; final message lists rooms never entered and total sealed amount

### DXF Export

- **Format**: AutoCAD AC1015 (ASCII DXF format)
- **Layers**: FLOOR (exterior), WALL (canonical segments), DOOR (openings), ROOM_NAME (labels), SEALED (unmapped)
- **Scale**: 50mm per plan unit
- **Units**: Millimeters
- **Metadata**: Drawing size, layer colors, lineweight
- **Validation**: Parser checks entity structure and layer consistency (no CAD application opened)

## Architecture

### Modules

- **data.js**: CSV parsing, account lookup, evidence graph BFS, transaction derivation
- **geometry.js**: Room placement (area ∝ gross amount), corridor layout, door/window generation
- **dxf.js**: Wall canonicalization (union/dedup), DXF entity generation, layer management
- **renderer.js**: SVG floorplan (navy fills, teal accents, drafting grid), auditor dot interpolation
- **auditor.js**: BFS path construction (room↔corridor via door portals, corridor shared edges), waypoint generation
- **main.js**: Event handling, CSV import, auditor animation (RAF + position interpolation), sidebar updates

### Data Flow

```
journal.csv → parseCSV → balance check → evidence BFS
                               ↓
                  buildLayout(transactions)
                               ↓
                  applyBankStatements(layout)
                               ↓
        renderFloorplan + buildAuditWalk + buildDXF
```

## Known Limitations

1. **Topology**: One account pair (1010↔1020) must route via bank circulation—no direct room-to-room door due to layout constraints.
2. **Minimum area**: All rooms ≥60×90 units; very small accounts are floor-sized.
3. **Evidence validation**: Bank statement window validation is synthetic; no real banking data.
4. **Offline only**: No external requests; bank windows and window data are generated fixtures.

## Design & Concept

Prior external work exists for design concepts and overall architecture. This implementation:
- **Copied data**: fixture.json and journal.csv sourced externally
- **Kiro implementation**: All application logic—geometry engine, DXF export, SVG renderer, auditor, test suite
- **Externally supplied**: Overall concept and non-Kiro prototype
- **Supervisor corrections**: Codex supervisor reviewed and corrected index.html, src/main.js, src/renderer.js, src/style.css, src/dxf.js; authored .gitignore, scripts/capture.mjs, scripts/verify.sh (see artifacts/provenance.json for exact line counts)

This is a reconstructed implementation, not pure Kiro authorship.

## License

ISC (see LICENSE)

Copyright (c) 2026 Sealed Rooms contributors
