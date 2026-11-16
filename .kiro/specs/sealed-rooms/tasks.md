# Sealed Rooms - Tasks

1. - [x] Data/validation: CSV parsing, integer cents, unique IDs, UTC dates, account lookup, balanced tx groups, error handling, preserve plan on error, fixture.json structure

2. - [x] Architecture geometry+DXF: Corridor branch spines, room placement with aspect ratio, wall gaps matching SVG/DXF, door graph independent from accounting graph, unsupported room tracking, evidence reachability analysis, 1440x900 layout, room areas proportional to amounts

3. - [x] UI+auditor+CSV: Entrance as circulation, SVG rendering (midnight navy/chalk), door swing arcs, dimension lines, scale bar, room labels, click for rows/explanations, auditor dot follow doors only, CSV drag/drop import with validation, anti-XSS DOM text

4. - [x] Acceptance+hook+docs: npm test coverage (negative imports, graph/geometry, wall gaps, DXF readback), PostFileSave hook v1 npm test with in-repo log, actual trigger evidence, README prior work (copied fictional data + externally supplied concept/design, no prior code)