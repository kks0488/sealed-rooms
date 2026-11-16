# Sealed Rooms - Project Structure

## Root Directory Layout

```

├── src/                     # Source code
│   ├── geometry.js         # Room layout algorithms
│   ├── data.js             # CSV validation and evidence graph
│   ├── renderer.js         # SVG rendering
│   ├── auditor.js          # Audit path visualization
│   ├── dxf.js              # Shared walls and DXF export
│   └── main.js             # Application entry
├── test/                    # Test files
│   ├── geometry.test.js
│   ├── data.test.js
│   ├── auditor.test.js
│   └── dxf.test.js
├── scripts/                 # Build and dev tools
│   ├── server.js           # Local dev server
│   └── build.js            # Production build script
├── .kiro/                   # Kiro configuration
│   ├── steering/           # Steering documents (this folder)
│   │   ├── product.md
│   │   ├── tech.md
│   │   └── structure.md
│   ├── specs/              # Detailed specifications
│   │   └── sealed-rooms/   # Sealed Rooms specific specs
│   └── hooks/              # Kiro event hooks
├── fixture.json             # Fictional transactions, entries and cases
├── journal.csv              # Accounting transactions
├── samples/                 # Sample CSV files
│   └── sample-repaired.csv  # Original sample is root journal.csv
├── dist/                    # Build output (created by build script)
├── README.md                # Project overview
└── package.json             # Project metadata (scripts, name)
```

## .kiro/specs/sealed-rooms/

```
.kiro/specs/sealed-rooms/
├── requirements.md         # Functional requirements
├── design.md              # Spatial design specifications
├── validation.md          # Data validation rules
├── auditor-rules.md       # Audit path logic
└── dxf-spec.md            # DXF output format
```

## .kiro/hooks/

```
.kiro/hooks/
├── message.js             # Runs on message send
├── tool-call.js           # Runs on tool usage
└── file-save.js           # Runs on file save
```

## Key Directories Explained

### src/
- Pure JavaScript modules (ESM)
- No external dependencies
- Each module has clear single responsibility
- Export functions only, no top-level side effects

### test/
- Node.js built-in test runner format
- Test files match source structure
- Data-driven tests for validators
- Integration tests for end-to-end flow

### scripts/
- Development server: `node scripts/server.js`
- Build script: `node scripts/build.js`
- Simple implementations, no dependencies

### samples/
- Two fictional CSV files for demonstration
- Sample data follows journal.csv format
- Different scenarios for testing

## Output Structure

### Development
- Serve from `src/` directory
- Live reload on changes
- No compilation step

### Production (build)
```
dist/
├── index.html             # Main HTML file
├── src/                   # Native ES modules and style.css
├── journal.csv
├── bank-statement.json
└── samples/
```

## Naming Conventions

- **Files**: camelCase (geometry.js, data.js)
- **Modules**: ES module exports
- **Tests**: source.test.js naming
- **Functions**: camelCase, descriptive names
- **Constants**: UPPER_SNAKE_CASE

## Import Policy

- Relative imports only within project
- No `node_modules` imports in source
- No absolute imports (use relative paths)
- Clear module boundaries
