from __future__ import annotations

import io
import json
import logging
import os
import sqlite3
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..database import DB_PATH

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/api/imports/aar")
async def import_aar(file: UploadFile = File(...)):
    content = await file.read()
    filename = (file.filename or "").lower()
    try:
        if filename.endswith(".zip"):
            tracks = parse_zip(content)
        elif filename.endswith(".gpx"):
            tracks = parse_gpx(content, file.filename or "track.gpx")
        elif filename.endswith(".kml"):
            tracks = parse_kml(content, file.filename or "track.kml")
        else:
            raise HTTPException(status_code=400, detail="Unsupported format. Upload .zip, .gpx, or .kml")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("AAR parse failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to parse file: {exc}") from exc

    if not tracks:
        raise HTTPException(status_code=400, detail="No tracks found in file")

    with sqlite3.connect(DB_PATH) as conn:
        for track in tracks:
            point_count = len(track["geojson"].get("coordinates", []))
            conn.execute(
                "INSERT INTO patrol_tracks (callsign, import_filename, source_format, point_count, geojson) VALUES (?,?,?,?,?)",
                (track["callsign"], file.filename, track["format"], point_count, json.dumps(track["geojson"])),
            )

    return {
        "imported": len(tracks),
        "callsigns": [track["callsign"] for track in tracks],
        "point_counts": {track["callsign"]: len(track["geojson"].get("coordinates", [])) for track in tracks},
    }


@router.get("/api/tracks")
def get_tracks():
    with sqlite3.connect(DB_PATH) as conn:
        rows = conn.execute(
            "SELECT id, callsign, import_filename, import_timestamp, source_format, point_count, geojson FROM patrol_tracks ORDER BY import_timestamp DESC"
        ).fetchall()
    return [
        {
            "id": row[0],
            "callsign": row[1],
            "filename": row[2],
            "timestamp": row[3],
            "format": row[4],
            "point_count": row[5],
            "geojson": json.loads(row[6]),
        }
        for row in rows
    ]


@router.delete("/api/tracks/{track_id}")
def delete_track(track_id: int):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("DELETE FROM patrol_tracks WHERE id=?", (track_id,))
    return {"deleted": track_id}


def parse_zip(content: bytes) -> list[dict]:
    tracks = []
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        for name in zf.namelist():
            data = zf.read(name)
            lower = name.lower()
            if lower.endswith(".gpx"):
                tracks.extend(parse_gpx(data, name))
            elif lower.endswith(".kml"):
                tracks.extend(parse_kml(data, name))
            elif lower.endswith(".json") or lower.endswith(".geojson"):
                tracks.extend(parse_json(data, name))
    return tracks


def extract_callsign(filename: str) -> str:
    base = os.path.basename(filename).split(".")[0]
    parts = base.split("_")
    return parts[0].upper() if parts and parts[0] else "UNKNOWN"


def parse_gpx(data: bytes, filename: str) -> list[dict]:
    callsign = extract_callsign(filename)
    root = ET.fromstring(data)
    coords = []
    for trkpt in root.findall(".//{*}trkpt"):
        lat = trkpt.get("lat")
        lon = trkpt.get("lon")
        if lat is not None and lon is not None:
            coords.append([float(lon), float(lat)])
    if not coords:
        return []
    return [{"callsign": callsign, "format": "gpx", "geojson": {"type": "LineString", "coordinates": coords}}]


def parse_kml(data: bytes, filename: str) -> list[dict]:
    callsign = extract_callsign(filename)
    root = ET.fromstring(data)
    coords = []
    for coords_el in root.findall(".//{*}coordinates"):
        if not coords_el.text:
            continue
        for pair in coords_el.text.strip().split():
            parts = pair.split(",")
            if len(parts) >= 2:
                coords.append([float(parts[0]), float(parts[1])])
    if not coords:
        return []
    return [{"callsign": callsign, "format": "kml", "geojson": {"type": "LineString", "coordinates": coords}}]


def parse_json(data: bytes, filename: str) -> list[dict]:
    callsign = extract_callsign(filename)
    parsed = json.loads(data.decode("utf-8-sig"))
    coords = []
    for feature in parsed.get("features", []):
        geom = feature.get("geometry", {})
        gtype = geom.get("type")
        if gtype == "Point":
            coords.append(geom["coordinates"][:2])
        elif gtype == "LineString":
            coords.extend([coord[:2] for coord in geom.get("coordinates", [])])
    if not coords:
        return []
    return [{"callsign": callsign, "format": "json", "geojson": {"type": "LineString", "coordinates": coords}}]
