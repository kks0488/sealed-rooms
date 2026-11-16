# Sealed Rooms - Requirements

## Overview
Build Sealed Rooms: an offline accounting evidence floorplan visualizer. Fictional journal data becomes a real-looking single architectural floor at 1440x900 resolution.

## Spatial Layout
- Single building floor (not stacked strips)
- Entrance area for opening balances
- Central bank/cash circulation corridor
- Wings: income, expense, asset-liability sections
- Near-square rooms in clusters (not 24 skinny stacked bands)
- Room areas proportional to posted amounts with stated minimums
- Thick walls (150-300mm) with actual gaps and door swing arcs
- External confirmation windows
- Dimension lines and scale bar
- Room labels visible
- Auditor dot starts entrance, follows only door/corridor routes

## Data Model
- **Fixture**: `fixture.json` - transaction/entry/case data (NOT geometry)
- **Journal**: `journal.csv` - accounting transactions and balances
- **Evidence Graph**: Mathematical relationships preserved in spatial layout
- Account IDs: 1000 bank, 1010 cash, 1020 clearing, 1090 suspense, 5080 dormant, 5090 unverified
- 194 transactions, 388 rows, 24 accounts
- 3 unsupported rooms: $27,600 total

## Validation
- CSV drop/import must validate:
  - Balanced tx groups
  - Safe integer cents (no floating point)
  - Unique IDs
  - Valid UTC dates
  - Amounts and accounts
- Preserve existing plan on error
- Include original CSV plus fictional alternative

## Auditor Experience
- Click rooms for exact rows and concrete missing/mismatched evidence explanation
- Rooms never entered: 3 — $27,600
- Maintain independent evidence connectivity and geometry
- Never equate layout limitations with evidence defects

## Output Formats
- **SVG**: Vector rendering, scale bars, dimensions, interactive elements
- **DXF**: Layers FLOOR/WALL/DOOR/ROOM_NAME/SEALED, mm units
- Wall gaps identical between SVG and DXF

## Technical Constraints
- Native ES modules, Node.js built-in modules only
- Zero runtime dependencies, no npm packages at runtime
- Offline: no external requests/fonts/images
- Visual: midnight navy/chalk white palette
- Build: `npm run build` and `npm run dev` localhost server
- Tests: `npm test` using Node.js built-in test runner
- English all text