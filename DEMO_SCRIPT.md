# Waypoint-Core 0.3 Demo Script

Use this script to prove the current Waypoint-Core demo workflow without adding OCR, AI, PDF export, accounts, or cloud services.

## Pre-Demo Setup

1. Start from the repository root.
2. If needed, seed the local GPS photo proof row:

```powershell
backend\.venv\Scripts\python.exe scripts\repair_and_seed_photos.py
```

3. Keep one small TXT demo document ready with a clear date and decimal coordinate:

```text
Le 2026-06-03 près du poste de contrôle de Bangui, un véhicule suspect Toyota blanc a été vu à 4.361111, 18.555556 sur la route principale.
```

4. If possible, keep one real phone JPEG with GPS EXIF ready. If not, use the seeded `waypoint_gps_test_bangui.jpg` record to prove stored GPS photo plotting.

## Demo Flow

### 1. Open Waypoint-Core

Double-click:

```text
Open Waypoint Core.vbs
```

Expected proof:

- The browser opens at `http://127.0.0.1:5173`.
- Waypoint opens in dark mode and French by default.
- The header shows the offline badge and local data counts.
- The workflow strip shows the basic path: rapport, photos/documents, carte, chronologie, objets et connexions.

### 2. Create A Field Report

1. Open `Rapports`.
2. Fill a short report:
   - Qui : `patrouille démo`
   - Quoi : `véhicule suspect près du poste de contrôle`
   - Où : `route principale vers Bangui`
   - Quand : `aujourd'hui 09:15`
   - Fiabilité : `B`
   - Lié à : `véhicule suspect démo`
3. Leave latitude and longitude empty for the first save.
4. Save the report.

Expected proof:

- The success message appears.
- The report appears in `Derniers rapports`.
- No report pin appears yet because no position was entered.

### 3. Add Report Position From The Map

1. Open `Carte`.
2. Click `Choisir position du rapport`.
3. Click near Bangui or the planned demo location.
4. Confirm Waypoint returns to `Rapports` with latitude and longitude filled.
5. Save the report again with the position.

Expected proof:

- The position fields contain decimal latitude and longitude.
- Invalid coordinate pairs are rejected if tested.
- The map shows a report pin colored by source reliability.

### 4. Upload A GPS Photo

1. Open `Photos`.
2. Enter a short link note such as `même véhicule suspect`.
3. Upload a GPS-tagged JPEG.

Expected proof:

- The photo appears in the photo grid.
- GPS appears under the photo when EXIF GPS is present.
- A blue photo pin appears on the map.

Fallback proof:

- Use the seeded `waypoint_gps_test_bangui.jpg` record.
- State clearly that the seed proves photo-to-map plotting from stored GPS fields.

### 5. Upload A Document And Create A Document Pin

1. Open `Documents`.
2. Upload the TXT demo document.
3. Confirm extracted text and clues appear.
4. Click the document coordinate button to create a point.
5. Open `Carte`.

Expected proof:

- The document is stored locally.
- Dates, positions, place hints, and field keyword labels appear in French.
- An orange document pin appears on the map.
- The document pin has an open-source button.

### 6. Create A Vehicle Object

1. Open `Objets terrain`.
2. Create a vehicle object:
   - Type : `Véhicule`
   - Nom : `Toyota blanc démo`
   - Description : `pick-up blanc vu près du poste de contrôle`
   - Notes : `lié au rapport et au document de démonstration`
   - État : `actif`
   - Position : use the same demo coordinate or another nearby point.

Expected proof:

- The vehicle appears in the object list.
- Selecting the vehicle shows its detail panel.
- If coordinates were added, the vehicle can be shown on the map.

### 7. Verify The Offline CAR Map

Open `Carte` and zoom/pan.

Expected proof:

- CAR national boundary is visible.
- Prefecture boundaries are visible and labeled.
- Major towns/cities, major roads, and waterways are visible.
- User-created report/photo/document/object pins appear above the local map.
- The vehicle object marker has an open-source button.
- The map works without internet tiles or paid map APIs.

Note:

- The current HOT POI package did not provide reliable confirmed border crossings after false positives were removed, so the demo should not promise a populated crossing layer.

### 8. Open Source From Map Pins

1. Click the report pin and open its source.
2. Confirm Waypoint switches to `Rapports` and highlights the source item when visible.
3. Return to `Carte`.
4. Click the photo pin and open its source.
5. Click the document pin and open its source.
6. Click the vehicle object pin and open its source.

Expected proof:

- Source buttons move to the right tab.
- Available source items scroll into view and briefly highlight.

### 9. Create Structured Links

1. Open `Connexions`.
2. Create a link:
   - Source : the field report
   - Relation : `associé à`
   - Cible : the vehicle object
   - Notes : `le rapport parle du même Toyota blanc`
3. Create a second link:
   - Source : the document
   - Relation : `mentionné dans`
   - Cible : the vehicle object
   - Notes : `le document reprend le même véhicule et la même route`

Expected proof:

- Each link appears in the text list.
- Each link appears in the visual graph.
- The vehicle appears as a real graph node, not a manual label.
- Clicking a node shows details and source/map actions when available.
- Clicking a line shows relationship type and notes.

### 10. View Timeline

Open `Chronologie`.

Expected proof:

- Reports, photos, documents, and Event objects appear where available.
- Related notes are visible where provided.
- Items with positions show the location marker.

### 11. Generate Simple Text Summary

1. In `Chronologie`, choose a simple summary type.
2. Review the preview.
3. Use `Copier` or `Télécharger .txt`.

Expected proof:

- A simple text summary is generated from local reports, photos, and documents.
- The summary includes positions and source notes when available.

### 12. Stop Waypoint-Core

Double-click:

```text
Close Waypoint Core.vbs
```

Expected proof:

- Backend and frontend processes stop.
- Ports `8000` and `5173` are released.

## Known Demo Boundaries

- OCR is not connected.
- PDF/DOCX final report generation is not connected.
- TXT/CSV are the dependable document extraction path.
- The visual graph is intentionally simple field link analysis, not enterprise graph analytics.
- Timeline order still depends mostly on stored record times, not perfect natural-language event parsing.
- A live GPS photo upload still needs a real GPS-tagged JPEG if you want to prove EXIF extraction live.
