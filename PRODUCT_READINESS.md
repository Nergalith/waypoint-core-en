# Waypoint-Core 0.3 Product Readiness

## Strengths

- French-first MVP flow is now clear: reports, photos, documents, field objects, map, timeline, and connections all work from one local interface.
- Offline CAR map package is present and staged for smoother loading on low-spec laptops.
- Source navigation from map, graph, and object links moves users back to the source tab and highlights the selected item.
- Empty states now tell operators what to do next instead of leaving blank panels.
- Dark mode is the default, with a readable light mode option for bright rooms.

## Weaknesses

- The app is still a single-user local tool; data backup, merge, and handoff remain manual.
- Document extraction is intentionally limited. TXT/CSV are the most dependable demo formats.
- The graph is useful for small link sets but is not meant for dense investigations.
- Map detail depends on the included lightweight CAR package, not full offline tiles.

## Known Limitations

- No AI analysis, OCR workflow, cloud sync, user accounts, SIGINT modules, PDF/DOCX report exports, or enterprise graph features are included.
- PDF/DOCX text reading depends on local Python libraries being available.
- Image text reading is not available yet.
- Timeline summaries are generated from current records and are not a separate persisted event database.

## Demo Readiness Assessment

Waypoint-Core is ready for a controlled 0.3 MVP demonstration if the demo uses prepared sample data:

- Create one field report.
- Use the map click action to fill report position.
- Upload one GPS photo.
- Upload one simple TXT/CSV document with a decimal coordinate.
- Create one field object with a position.
- Link the report, photo, document, and object.
- Confirm map pins, timeline entries, graph relationships, and source highlighting.

The demo should avoid unsupported file types, very large map interactions, and advanced analysis claims.

## Recommended Next Milestone

Run a field-style usability test with a low-training operator on an older laptop. Capture friction in the report/photo/document/map/link workflow, then fix only the highest-impact usability and reliability issues before adding new capability.
