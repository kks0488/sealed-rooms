# Sealed Rooms - Product Specification

## Overview

Sealed Rooms is an English offline accounting evidence floorplan visualizer for fictional data. It presents accounting records as a spatial layout where monetary amounts correspond to physical room dimensions and relationships.

## Core Concept

- **Offline First**: No network requests, no external assets, no fonts
- **Fictional Data**: All data is fictional; prior external proof exists
- **Physical Metaphor**: Accounting evidence mapped to building floorplan layout
- **Auditor Experience**: Simulates walking through rooms to verify evidence

## Data Model

- **Fixture**: `fixture.json` - transaction/entry/case data (NOT geometry)
- **Journal**: `journal.csv` - accounting transactions and balances
- **Evidence Graph**: Mathematical relationships preserved in spatial layout

## Spatial Requirements

- **Single Building Floor**: Not stacked strips; realistic floorplan layout
- **Entrance Area**: For opening balances
- **Central Corridor**: Bank/cash circulation route
- **Wings**: Income, expense, asset-liability sections
- **Room Sizing**: Proportional to monetary amounts with stated minimums
- **Physical Details**: 
  - Thick walls (150-300mm)
  - Actual gaps and door swing arcs
  - External confirmation windows
  - Dimensions labeled
  - Room labels visible
- **Audit Trail**: Auditor walks only via doors; blocked rooms appear dark
- **DXF Output**: Layered format (FLOOR/WALL/DOOR/ROOM_NAME/SEALED)

## Visual Design

- **Palette**: Midnight navy / chalk white
- **Resolution**: 1440x900 viewport
- **SVG + CSS**: Pure native rendering
- **Calm Aesthetic**: Professional accounting visualization

## Validation & Robustness

- **CSV Validation**: Robust parsing with error reporting
- **Deterministic Geometry**: Consistent layout generation
- **Money Format**: Integer cents for precision
- **Missing Evidence Handling**: Room details explain gaps/mismatches

## User Experience

- **Local Files**: Two fictional sample CSVs for demonstration
- **Drag & Drop**: Local CSV file import
- **No Dependencies**: Zero runtime dependencies
- **Native JS**: ES modules only

## Technical Constraints

- **ES Modules**: Native JavaScript modules
- **No Build Tools**: Simple Node.js localhost server
- **Built-in Tests**: Node test runner (`npm test`)
- **Build Script**: `npm run build` required
- **No External Requests**: Completely self-contained

## Open Issues

- Prior external proof exists (disclosed in README)
- Prior work acknowledged in README
- No publication, push, or external actions