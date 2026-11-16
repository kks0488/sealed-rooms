# Sealed Rooms - Technology Stack

## Core Technology

- **Language**: JavaScript ES modules (native, no transpilation)
- **Runtime**: Node.js built-in modules only
- **Rendering**: SVG + CSS (no canvas, no WebGL)
- **Testing**: Node.js built-in test runner

## Dependency Policy

- **Zero Runtime Dependencies**: No npm packages required at runtime
- **No Build Tool Dependencies**: Custom simple build script
- **External Tools**: Only Node.js built-in modules for development

## File Structure

```
src/              # Source code (ES modules)
test/             # Test files (Node test runner format)
scripts/          # Build and development scripts
.kiro/specs/      # Specification documents
.kiro/hooks/      # Kiro event hooks
```

## Modules

### Core Modules (src/)

- **geometry.js**: Deterministic room layout algorithms
- **data.js**: CSV parsing, validation and evidence graph
- **renderer.js**: SVG generation and styling
- **auditor.js**: Pathfinding and audit trail visualization
- **dxf.js**: Shared wall segments and DXF output generation
- **main.js**: Application entry point

### Data Files

- **fixture.json**: Fictional transactions, journal entries and seeded cases; not geometry
- **journal.csv**: Accounting transactions (fictional)
- **samples/**: Additional sample CSV files

## Build System

### Development Server

- Custom Node.js HTTP server
- Serves static files from `dist/`
- Simple localhost configuration

### Build Script

- `npm run build`: Create production bundle
- Output to `dist/` directory
- No minification (readability preferred)

## Testing

- **Command**: `npm test`
- **Framework**: Node.js built-in test runner
- **Coverage**: All modules tested
- **Data Validation**: CSV parsing edge cases

## Output Formats

### SVG (Primary)

- Vector rendering for floorplan
- Scale bars and dimensions
- Interactive elements via CSS

### DXF (Export)

- Layer structure:
  - FLOOR: Base floor geometry
  - WALL: Wall outlines
  - DOOR: Door elements
  - ROOM_NAME: Text labels
  - SEALED: Evidence containers

## Data Handling

### Money Format

- **Unit**: Integer cents (no floating point)
- **Parsing**: Strict numeric validation
- **Calculation**: Integer arithmetic

### CSV Validation

- **Headers**: Required field validation
- **Amounts**: Numeric format verification
- **Dates**: ISO format checking
- **Missing Data**: Graceful handling with reporting

### JSON Fixture

- **Structure**: Defined schema
- **Geometry**: Deterministic room placement
- **Dimensions**: Physical measurements (mm for DXF)

## Performance

- **In-Memory**: All processing in memory
- **Local I/O**: Browser sample loading and file imports are asynchronous; pure geometry and graph calculations are synchronous
- **Deterministic**: Same input always produces same output

## Browser Compatibility

- **Modern Browsers**: ES module support
- **No Polyfills**: Native features only
- **No External CSS**: Inline styles via SVG attributes
