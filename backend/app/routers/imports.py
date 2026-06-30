from __future__ import annotations

import io
import json
import logging
import os
import sqlite3
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..database import DB_PATH, PHOTOS_DIR, get_connection, row_to_dict, utc_now_iso
from ..services.photo_processor import compress_for_storage, extract_photo_metadata, is_supported_photo

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/api/imports/bundle")
async def import_bundle(file: UploadFile = File(...)):
    """
    Universal Nergalith import endpoint.
    FIELD_NODE bundles create a draft field report with attached photos and a pin.
    WAYFINDER/AAR bundles create patrol tracks through the existing track pipeline.
    """
    filename = file.filename or "bundle.zip"
    content = await file.read()

    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP bundles are supported")

    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            manifest_name = _find_zip_member(zf, "manifest.json")
            if not manifest_name:
                raise HTTPException(status_code=400, detail="No manifest.json found - not a valid Nergalith bundle")

            manifest = _read_json_member(zf, manifest_name)
            bundle_format = str(manifest.get("format") or manifest.get("report_format") or "UNKNOWN").upper()

            if bundle_format == "FIELD_NODE":
                return await _ingest_field_node(zf, manifest, filename)
            if bundle_format in {"WAYFINDER", "AAR"}:
                return _ingest_wayfinder(zf, filename)
            raise HTTPException(status_code=400, detail=f"Unknown bundle format: {bundle_format}")
    except HTTPException:
        raise
    except zipfile.BadZipFile as exc:
        raise HTTPException(status_code=400, detail="File is not a valid ZIP") from exc
    except Exception as exc:
        logger.exception("Bundle import failed")
        raise HTTPException(status_code=500, detail=f"Import failed: {exc}") from exc


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

    result = _save_tracks(tracks, file.filename or "track")
    if not result:
        raise HTTPException(status_code=400, detail="No tracks found in file")
    return result


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


async def _ingest_field_node(zf: zipfile.ZipFile, manifest: dict[str, Any], filename: str) -> dict[str, Any]:
    report_name = _find_zip_member(zf, "report.json")
    if not report_name:
        raise HTTPException(status_code=400, detail="No report.json found in Field Node bundle")

    report_data = _read_json_member(zf, report_name)
    fn_report_id = str(report_data.get("report_id") or manifest.get("report_id") or "UNKNOWN")
    observer = str(report_data.get("observer") or "").strip()
    timestamp_str = str(report_data.get("timestamp") or manifest.get("timestamp") or utc_now_iso())
    latitude = _coerce_float(report_data.get("latitude"))
    longitude = _coerce_float(report_data.get("longitude"))
    location_desc = str(report_data.get("location_description") or "").strip()
    report_type = _normalize_report_type(str(report_data.get("type") or "Observation"))
    reliability = str(report_data.get("source_reliability") or "F").strip().upper()[:1] or "F"
    if reliability not in {"A", "B", "C", "D", "E", "F"}:
        reliability = "F"
    notes = str(report_data.get("notes") or "").strip()
    salute = report_data.get("salute") if isinstance(report_data.get("salute"), dict) else {}
    photo_entries = _normalize_photo_entries(report_data)

    full_notes = _build_notes(notes, salute, fn_report_id, filename)
    who_involved = f"Observer: {observer}" if observer else ""
    when_text = _format_field_node_time(timestamp_str)
    now = utc_now_iso()
    report_number = _next_report_number()
    pin_id = None
    saved_photos: list[dict[str, Any]] = []

    with get_connection() as conn:
        try:
            cur = conn.execute(
                """
                INSERT INTO lfi_reports
                (report_type, report_number, who_involved, what_happened, where_happened, when_happened,
                 notes, source_reliability, latitude, longitude, related_to, pin_category, pin_color,
                 status, imported_from, fn_report_id, created_at, last_edited_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'FIELD_NODE', ?, ?, ?)
                """,
                (
                    report_type,
                    report_number,
                    who_involved,
                    notes or location_desc or f"Field Node report {fn_report_id}",
                    location_desc,
                    when_text,
                    full_notes,
                    reliability,
                    latitude,
                    longitude,
                    fn_report_id,
                    "general",
                    "#ff6b35",
                    fn_report_id,
                    timestamp_str or now,
                    now,
                ),
            )
            lfi_id = cur.lastrowid

            if latitude is not None and longitude is not None:
                pin_cur = conn.execute(
                    """
                    INSERT INTO map_pins (latitude, longitude, label, source, source_id, color, category, created_at)
                    VALUES (?, ?, ?, 'field_report', ?, '#ff6b35', 'field_report', ?)
                    """,
                    (latitude, longitude, f"{report_number}: {location_desc or fn_report_id}"[:80], str(lfi_id), now),
                )
                pin_id = pin_cur.lastrowid

            for photo_entry in photo_entries:
                photo_result = _save_field_node_photo(conn, zf, photo_entry["filename"], lfi_id, report_number, timestamp_str or now, photo_entry.get("caption", ""))
                if photo_result:
                    saved_photos.append(photo_result)

            report = row_to_dict(conn.execute("SELECT * FROM lfi_reports WHERE id = ?", (lfi_id,)).fetchone())
        except Exception as exc:
            logger.exception("Field Node DB insert failed")
            raise HTTPException(status_code=500, detail=f"Database error: {exc}") from exc

    return {
        "imported": "FIELD_NODE",
        "fn_report_id": fn_report_id,
        "waypoint_report_number": report_number,
        "lfi_id": report["id"] if report else lfi_id,
        "pin_created": pin_id is not None,
        "photos_saved": len(saved_photos),
        "photos": saved_photos,
        "status": "DRAFT",
    }


def _ingest_wayfinder(zf: zipfile.ZipFile, filename: str) -> dict[str, Any]:
    tracks: list[dict[str, Any]] = []
    for name in zf.namelist():
        lower = name.lower()
        if lower.endswith(".gpx"):
            tracks.extend(parse_gpx(zf.read(name), name))
        elif lower.endswith(".kml"):
            tracks.extend(parse_kml(zf.read(name), name))
        elif lower.endswith(".json") or lower.endswith(".geojson"):
            if os.path.basename(lower) == "manifest.json":
                continue
            tracks.extend(parse_json(zf.read(name), name))
    result = _save_tracks(tracks, filename)
    if not result:
        raise HTTPException(status_code=400, detail="No tracks found in Wayfinder bundle")
    result["imported"] = "WAYFINDER"
    return result


def _save_tracks(tracks: list[dict[str, Any]], filename: str) -> dict[str, Any] | None:
    if not tracks:
        return None
    with sqlite3.connect(DB_PATH) as conn:
        for track in tracks:
            point_count = len(track["geojson"].get("coordinates", []))
            conn.execute(
                "INSERT INTO patrol_tracks (callsign, import_filename, source_format, point_count, geojson) VALUES (?,?,?,?,?)",
                (track["callsign"], filename, track["format"], point_count, json.dumps(track["geojson"])),
            )
    return {
        "imported": len(tracks),
        "callsigns": [track["callsign"] for track in tracks],
        "point_counts": {track["callsign"]: len(track["geojson"].get("coordinates", [])) for track in tracks},
    }


def _save_field_node_photo(conn, zf: zipfile.ZipFile, photo_filename: str, lfi_id: int, report_number: str, timestamp: str, caption: str = "") -> dict[str, Any] | None:
    member = _find_zip_member(zf, photo_filename)
    if not member:
        logger.warning("Photo %s listed in Field Node report but not found in ZIP", photo_filename)
        return None

    safe_name = Path(photo_filename).name.replace(" ", "_")
    if not safe_name:
        return None
    dest = _unique_photo_path(f"fieldnode_{lfi_id}_{safe_name}")

    try:
        with dest.open("wb") as fh:
            fh.write(zf.read(member))
        meta = extract_photo_metadata(dest)
        if is_supported_photo(dest):
            compress_for_storage(dest, max_width=1024, quality=75)
        file_size = dest.stat().st_size if dest.exists() else meta.get("file_size", 0) or 0
        cur = conn.execute(
            """
            INSERT INTO photos
            (original_filename, stored_path, thumb_path, latitude, longitude, datetime_original,
             file_size, width, height, related_to, source_type, source_id, imported_from, caption, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'field_report', ?, 'FIELD_NODE', ?, ?)
            """,
            (
                safe_name,
                str(dest),
                meta.get("thumb_path"),
                meta.get("latitude"),
                meta.get("longitude"),
                meta.get("datetime_original") or timestamp,
                file_size,
                meta.get("width"),
                meta.get("height"),
                report_number,
                str(lfi_id),
                str(caption or "").strip(),
                timestamp,
            ),
        )
        photo_id = cur.lastrowid
        conn.execute(
            """
            INSERT INTO links
            (source_type, source_id, source_label, relationship_type, target_type, target_id, target_label, notes, created_at)
            VALUES ('photo', ?, ?, 'related_to', 'field_report', ?, ?, 'Imported from Field Node bundle', ?)
            """,
            (str(photo_id), safe_name, str(lfi_id), report_number, utc_now_iso()),
        )
        return {"filename": safe_name, "photo_id": photo_id, "thumb_path": meta.get("thumb_path"), "caption": str(caption or "").strip()}
    except Exception as exc:
        logger.exception("Photo save failed for %s", photo_filename)
        try:
            if dest.exists():
                dest.unlink()
        except Exception:
            pass
        return None



def _normalize_photo_entries(report_data: dict[str, Any]) -> list[dict[str, str]]:
    raw_photos = report_data.get("photos") if isinstance(report_data.get("photos"), list) else []
    caption_maps = []
    for key in ("photo_captions", "captions", "photo_notes"):
        value = report_data.get(key)
        if isinstance(value, dict):
            caption_maps.append({str(k): str(v) for k, v in value.items()})

    entries: list[dict[str, str]] = []
    for item in raw_photos:
        filename = ""
        caption = ""
        if isinstance(item, str):
            filename = item
        elif isinstance(item, dict):
            filename = str(item.get("filename") or item.get("name") or item.get("file") or item.get("path") or "")
            caption = str(item.get("caption") or item.get("notes") or item.get("description") or item.get("title") or "")
        filename = Path(filename).name.strip()
        if not filename:
            continue
        if not caption:
            for caption_map in caption_maps:
                caption = caption_map.get(filename) or caption_map.get(Path(filename).name) or ""
                if caption:
                    break
        entries.append({"filename": filename, "caption": caption.strip()})
    return entries

def parse_zip(content: bytes) -> list[dict]:
    tracks = []
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        for name in zf.namelist():
            data = zf.read(name)
            lower = name.lower()
            if os.path.basename(lower) == "manifest.json":
                continue
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
    if parsed.get("type") == "LineString":
        coords.extend([coord[:2] for coord in parsed.get("coordinates", [])])
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


def _find_zip_member(zf: zipfile.ZipFile, wanted: str) -> str | None:
    wanted_norm = wanted.replace("\\", "/").lower()
    wanted_base = os.path.basename(wanted_norm)
    for name in zf.namelist():
        lower = name.replace("\\", "/").lower()
        if lower == wanted_norm or os.path.basename(lower) == wanted_base:
            return name
    return None


def _read_json_member(zf: zipfile.ZipFile, name: str) -> dict[str, Any]:
    try:
        data = zf.read(name).decode("utf-8-sig")
        parsed = json.loads(data)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON in {Path(name).name}") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail=f"{Path(name).name} must contain a JSON object")
    return parsed


def _coerce_float(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if -180 <= number <= 180 else None


def _normalize_report_type(value: str) -> str:
    cleaned = value.strip()
    known = {"Observation", "Patrol", "Rumor/Witness", "Checkpoint", "Contact Report"}
    if cleaned in known:
        return cleaned
    lowered = cleaned.lower()
    if "patrol" in lowered:
        return "Patrol"
    if "checkpoint" in lowered:
        return "Checkpoint"
    if "contact" in lowered:
        return "Contact Report"
    if "rumor" in lowered or "witness" in lowered:
        return "Rumor/Witness"
    return "Observation"


def _build_notes(notes: str, salute: dict[str, Any], fn_report_id: str, filename: str) -> str:
    parts = [notes.strip()] if notes.strip() else []
    salute_fields = [(str(k), str(v).strip()) for k, v in salute.items() if str(v or "").strip()]
    if salute_fields:
        parts.append("TACTICAL DETAIL (SALUTE):\n" + "\n".join(f"  {key}: {value}" for key, value in salute_fields))
    parts.append(f"Imported from Field Node: {fn_report_id} ({filename})")
    return "\n\n".join(parts)


def _format_field_node_time(timestamp: str) -> str:
    try:
        dt = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d %H:%M UTC")
    except Exception:
        return timestamp


def _next_report_number() -> str:
    today = datetime.utcnow().strftime("%Y%m%d")
    prefix = f"RPT-{today}-"
    with get_connection() as conn:
        row = conn.execute(
            "SELECT report_number FROM lfi_reports WHERE report_number LIKE ? ORDER BY report_number DESC LIMIT 1",
            (prefix + "%",),
        ).fetchone()
    if row and row[0]:
        try:
            return f"{prefix}{int(str(row[0]).split('-')[-1]) + 1:03d}"
        except Exception:
            pass
    return f"{prefix}001"


def _unique_photo_path(filename: str) -> Path:
    PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
    base = Path(filename).name.replace(" ", "_")
    target = PHOTOS_DIR / base
    if not target.exists():
        return target
    stem = target.stem
    suffix = target.suffix or ".jpg"
    for idx in range(1, 1000):
        candidate = PHOTOS_DIR / f"{stem}_{idx}{suffix}"
        if not candidate.exists():
            return candidate
    return PHOTOS_DIR / f"{stem}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{suffix}"
