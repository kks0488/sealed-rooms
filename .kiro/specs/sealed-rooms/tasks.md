# Sealed Rooms - Tasks

1. - [x] Data/validation: CSV parsing, integer cents, unique IDs, UTC dates, account lookup, balanced tx groups, error handling, preserve plan on error, fixture.json structure

2. - [x] Architecture geometry+DXF: Corridor branch spines, room placement with aspect ratio, wall gaps matching SVG/DXF, door graph independent from accounting graph, unsupported room tracking, evidence reachability analysis, 1440x900 layout, room areas proportional to amounts

3. - [x] UI+auditor+CSV: Entrance as circulation, SVG rendering (midnight navy/chalk), door swing arcs, dimension lines, scale bar, room labels, click for rows/explanations, auditor dot follow doors only, CSV drag/drop import with validation, anti-XSS DOM text

4. - [x] Acceptance+hook+docs: npm test coverage (negative imports, graph/geometry, wall gaps, DXF readback), PostFileSave hook v1 npm test with in-repo log, actual trigger evidence, README prior work (copied fictional data + externally supplied concept/design, no prior code)
5. - [x] DXF alignment point fix: added groups 11/21/31 to every TEXT entity when group 72 is non-zero (same point as 10/20), preventing AutoCAD-family programs from placing all labels at 0,0 and ezdxf crashes; added alignment-point assertion test; npm test passes 144/144.
6. - [x] DXF room-name two-line split: each room now emits two centred TEXT entities (account number upper, name lower) sized so the longer line fits within 85% of inner room width (cap 300 mm, floor 120 mm, truncate with "..." if needed); 0 names shortened in fixture data; added 2 new tests (width-fit per TEXT, account+name presence); npm test passes 146/146.
