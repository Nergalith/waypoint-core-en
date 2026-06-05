# Waypoint Core — English Template

Local-first field intelligence tool. Offline. English only. No cloud, no accounts, no AI.

This is the English master template for Waypoint Core. Fork and configure for your deployment context.

## Stack

- Backend: FastAPI + SQLite (`backend/app/`)
- Frontend: React + Vite (`frontend/src/`)
- Local storage: `data/photos/`, `data/documents/`, `data/waypoint.db`
- PDF export: reportlab (auto-files on finalize; manual bundle export)
- Map: Leaflet — blank world default, centred [20, 0] zoom 2. Add your own GeoJSON under `frontend/public/maps/` and load it in `MapView.jsx`.

## Features

- **Field Reports**: who/what/where/when/notes, source reliability A-F, optional coordinates, finalize/lock with auto-PDF
- **Photos & GPS**: EXIF extraction, thumbnails, GPS pins — photos compressed to max 1024px on ingest
- **Documents**: TXT/CSV text extraction, rule-based clues (dates, coordinates, keywords), document-to-map pins
- **Field Objects**: Person, Vehicle, Group, Location, Event cards with coordinates
- **Map**: blank world map, pins from all sources, manual pin placement with category/status selector
- **Connections**: structured links + visual graph
- **Timeline**: combined view of reports, photos, documents, events
- **PDF export**: auto-filed on finalize (`Waypoint Reports/YYYY/MM/`), manual bundle from selected reports

## Not included

- No OCR
- No cloud sync
- No user accounts
- No AI analysis
- No SIGINT modules

## Start

Double-click `Open Waypoint Core.vbs` or run:

```powershell
.\scripts\run_waypoint.ps1
```

- Backend: `http://127.0.0.1:8000`
- Frontend: `http://127.0.0.1:5173`

## Stop

Double-click `Close Waypoint Core.vbs` or run:

```powershell
.\scripts\close_waypoint.ps1
```

## Manual start

```powershell
# Backend
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Frontend
cd frontend
npm install
npm run dev
```

## Map package

The default map is a blank Leaflet canvas centred on [20, 0] at zoom 2. To add a local map package:

1. Place GeoJSON files under `frontend/public/maps/<your-region>/`
2. Update `MapView.jsx` — set `MAP_DEFAULT_CENTER`, `INITIAL_ZOOM`, and add layer loading in the map initialisation `useEffect`

## Data

All data stays local under `data/`. Nothing is sent to the internet.

PDF reports are saved to `Waypoint Reports/YYYY/MM/` at the repo root.
