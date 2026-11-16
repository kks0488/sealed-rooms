# Sealed Rooms - Design

## Spatial Architecture
- **1440x900 SVG viewport**, single building floor
- **Entrance**: Opening balance circulation (not invented transaction)
- **Central corridor**: Bank/cash circulation route
- **Branch corridors**: Public circulation halls (horizontal/vertical), NOT accounting edges
- **Wings**: Separate asset, liability, income and expense branches
- **Rooms**: Non-overlapping leaf rectangles, depth 90 plan units and minimum width 60; 1 plan unit = 50 mm

## Geometry Algorithm
- Deterministic layout from evidence graph
- Compute room widths before placing a dynamic central spine and four touching branch halls. Leaf width = max(60, round(max(5400, 0.005 × gross cents) / 90)); height = 90.
- Bank circulation is an explicitly labelled area exception, not an account-value-sized rectangle.
- Rooms placed only where doors coincide with wall gaps
- Door graph independent from accounting graph
- Each room supported iff evidence reachable via actual doors
- Non-bank graph edges without a direct room-to-room door are listed as routed-via-bank limitations; the fixture has one such edge (EV-C2). This is not a general exact adjacency solver.
- Wall gaps exact same in SVG and DXF

## Account Metadata (from journal.csv memos or fiction)
- 1000 bank, 1010 cash, 1020 clearing, 1090 suspense, 5080 dormant, 5090 unverified
- Infer account names from memo fields
- 24 accounts total, 194 transactions, 388 rows

## Evidence Graph
- Independent reachability analysis
- Supported rooms: via doors from entrance
- Unsupported: 3 rooms, $27,600 total
- Mismatch validation only if counterparty fields support it
- No fabricated mismatch facts

## Input Schema (journal.csv)
- Quoted CSV, 7 columns:
  `transaction,date,account,debit_cents,credit_cents,evidence,memo`
- `transaction`: string ID (e.g. "J0001"), repeated exactly twice per balanced posting
- `date`: YYYY-MM-DD (strict ISO round-trip, rejects phantoms like 2026-02-30)
- `account`: 4-digit string in ranges 1xxx/2xxx/4xxx/5xxx
- `debit_cents` / `credit_cents`: `/^\d+$/`, Number.isSafeInteger, exactly one non-zero per row
- `evidence`: reference string or empty; empty → transaction excluded from evidence graph
- `memo`: non-empty string; must agree across the two rows of a group
- `from` = account of the CREDIT row (money source); `to` = account of the DEBIT row
- `bankMatched`: false by default; never inferred from bank participation

## SVG Rendering
- Midnight navy/chalk white palette
- Thick walls (150-300mm), door swing arcs, external confirmation windows
- Dimensions, scale bar, room labels
- Windows only for explicit bank match marker

## DXF Export (mm units)
- Layers: FLOOR, WALL, DOOR, ROOM_NAME, SEALED
- Group validation for DXF format
- Wall gaps match SVG exactly

## UI Components
- Drag & drop CSV import
- Room click shows all source transactions and missing-reference reasons. Counterparty mismatch detection is not implemented because the seven-column source has no counterparty fields.
- Audit trail dot follows door routes only
- Anti-XSS for DOM text

## Technical Stack
- Native ES modules, Node.js built-in modules only
- Zero runtime dependencies
- Node test runner (`npm test`)
- Build: `npm run build`, dev: `npm run dev`
- No external requests/fonts/images

## Anti-XSS
- All DOM text escaped/encoded
- No innerHTML with untrusted data
- TextContent or createTextNodes for dynamic content
