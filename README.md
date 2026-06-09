# Waypoint Core EN

Clean English test build for local/offline field workflow testing on Windows laptops, including older ToughBook-class hardware.

This folder is meant to be copied as a self-contained project sandbox. It is not the CAR demo build and does not include CAR demo records, photos, documents, objects, links, or map data.

## What Is Included

- FastAPI + SQLite backend.
- React/Vite frontend.
- English-only UI by default.
- Dark mode by default with a Light Mode toggle.
- Field reports with coordinate validation, edit/update/delete, finalize/unlock, and source highlighting.
- Photo upload with thumbnail creation and EXIF GPS extraction where available.
- Document upload and local text extraction for simple files.
- Field objects for people, vehicles, groups, locations, and events.
- Structured connections plus a lightweight visual graph.
- Timeline and simple text summary tools.
- Offline test map package under `frontend/public/maps/test/`.
- Local map pins, source buttons, symbol/category colors, report-position picker, and manual pins.
- Start/close scripts that use paths relative to the copied folder.

## What Is Not Included

- No CAR demo database.
- No CAR demo photos or documents.
- No CAR map package as the default map.
- No cloud services, accounts, AI, SIGINT modules, or online map APIs.
- The included test map is a tiny offline map for function testing, not an operational basemap.

## Start

Double-click:

```text
Open Waypoint Core.vbs
```

Default local addresses:

- Backend: `http://127.0.0.1:8000`
- Frontend: `http://127.0.0.1:5173`

To stop Waypoint, double-click:

```text
Close Waypoint Core.vbs
```

## Manual Development Start

Backend:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Frontend:

```powershell
cd frontend
npm install
npm run dev -- --host 127.0.0.1
```

## Data

Runtime data lives under `data/`:

- `data/waypoint.db`
- `data/photos/`
- `data/photos/thumbs/`
- `data/documents/`

This English test build should start with an empty database and empty media/document folders.

## Offline Test Map

Runtime map files are local GeoJSON under:

```text
frontend/public/maps/test/
```

The package is intentionally tiny. It contains a simple test boundary, two regions, a few sample roads, a river, places, and a test crossing point. Normal use does not require internet.

## Transfer To ToughBook

See `START_HERE_ToughBook.txt` for the short transfer checklist.
