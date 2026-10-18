from __future__ import annotations

import io
import hashlib
import json
import logging
import os
import re
import sqlite3
import xml.etree.ElementTree as ET
import zipfile
from contextlib import closing
from datetime import datetime
from pathlib import Path
from pathlib import PurePosixPath
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..database import DB_PATH, PHOTOS_DIR, get_connection, row_to_dict, utc_now_iso
from ..services.photo_processor import compress_for_storage, extract_photo_metadata, is_supported_photo

router = APIRouter()
logger = logging.getLogger(__name__)
DEFAULT_MAX_IMPORT_MB = 200
DEFAULT_MAX_ZIP_FILES = 2000
DEFAULT_MAX_ZIP_UNCOMPRESSED_MB = 1000
DEFAULT_MAX_ZIP_RATIO = 200


def _env_positive_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.getenv(name, str(default))))
    except ValueError:
        return default


async def _read_upload_limited(file: UploadFile) -> bytes:
    max_mb = _env_positive_int("WAYPOINT_MAX_IMPORT_MB", DEFAULT_MAX_IMPORT_MB)
    max_bytes = max_mb * 1024 * 1024
    chunks: list[bytes] = []
    total = 0
    try:
        while chunk := await file.read(1024 * 1024):
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(status_code=413, detail=f"Import is larger than the {max_mb} MB limit")
            chunks.append(chunk)
    finally:
        await file.close()
    return b"".join(chunks)


def _validate_zip(zf: zipfile.ZipFile) -> None:
    infos = zf.infolist()
    max_files = _env_positive_int("WAYPOINT_MAX_ZIP_FILES", DEFAULT_MAX_ZIP_FILES)
    if len(infos) > max_files:
        raise HTTPException(status_code=400, detail=f"ZIP contains too many files (maximum {max_files})")
    max_uncompressed = _env_positive_int("WAYPOINT_MAX_ZIP_UNCOMPRESSED_MB", DEFAULT_MAX_ZIP_UNCOMPRESSED_MB) * 1024 * 1024
    total_uncompressed = sum(info.file_size for info in infos)
    if total_uncompressed > max_uncompressed:
        raise HTTPException(status_code=413, detail="ZIP uncompressed contents are too large")
    max_ratio = _env_positive_int("WAYPOINT_MAX_ZIP_RATIO", DEFAULT_MAX_ZIP_RATIO)
    for info in infos:
        normalized = info.filename.replace("\\", "/")
        path = PurePosixPath(normalized)
        if normalized.startswith("/") or re.match(r"^[A-Za-z]:", normalized) or ".." in path.parts:
            raise HTTPException(status_code=400, detail="ZIP contains an unsafe file path")
        if info.file_size and (info.file_size / max(info.compress_size, 1)) > max_ratio:
            raise HTTPException(status_code=400, detail="ZIP compression ratio is unsafe")


@router.post("/api/imports/bundle")
async def import_bundle(file: UploadFile = File(...)):
    """
    Universal Nergalith import endpoint.
    FIELD_NODE bundles create a draft field report with attached photos and a pin.
    WAYFINDER/AAR bundles create patrol tracks through the existing track pipeline.
    """
    filename = file.filename or "bundle.zip"
    content = await _read_upload_limited(file)

    if not filename.lower().endswith(".zip"):
        raise HTTPException(status_code=400, detail="Only ZIP bundles are supported")

    try:
        with zipfile.ZipFile(io.BytesIO(content)) as zf:
            _validate_zip(zf)
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
    content = await _read_upload_limited(file)
    original_filename = file.filename or "track"
    filename = original_filename.lower()
    try:
        if filename.endswith(".zip"):
            payload = parse_zip(content)
        elif filename.endswith(".gpx"):
            payload = parse_gpx(content, original_filename)
        elif filename.endswith(".kml"):
            payload = parse_kml(content, original_filename)
        elif filename.endswith(".json") or filename.endswith(".geojson"):
            payload = parse_json(content, original_filename)
        else:
            raise HTTPException(status_code=400, detail="Unsupported format. Upload .zip, .json, .geojson, .gpx, or .kml")
        if not payload.get("callsign"):
            apply_wayfinder_callsign(payload["tracks"], original_filename)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("AAR parse failed: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to parse file: {exc}") from exc

    payload["content_hash"] = hashlib.sha256(content).hexdigest()
    result = _save_import(payload, original_filename)
    if not result:
        raise HTTPException(status_code=400, detail="No tracks or pins found in file")
    return result


@router.get("/api/tracks")
def get_tracks():
    with closing(sqlite3.connect(DB_PATH)) as conn:
        rows = conn.execute(
            "SELECT id, callsign, import_filename, import_timestamp, source_format, point_count, geojson, map_package_name, export_id, device_id, patrol_sessions_json FROM patrol_tracks ORDER BY import_timestamp DESC"
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
            "map_package_name": row[7],
            "export_id": row[8],
            "device_id": row[9],
            "patrol_sessions": json.loads(row[10] or "[]"),
        }
        for row in rows
    ]


@router.delete("/api/tracks/{track_id}")
def delete_track(track_id: int):
    with closing(sqlite3.connect(DB_PATH)) as conn, conn:
        conn.execute("DELETE FROM patrol_tracks WHERE id=?", (track_id,))
    return {"deleted": track_id}


async def _ingest_field_node(zf: zipfile.ZipFile, manifest: dict[str, Any], filename: str) -> dict[str, Any]:
    report_name = _find_zip_member(zf, "report.json")
    if not report_name:
        raise HTTPException(status_code=400, detail="No report.json found in Field Node bundle")

    report_data = _read_json_member(zf, report_name)
    fn_report_id = str(report_data.get("report_id") or manifest.get("report_id") or "UNKNOWN")
    fn_device_id = str(report_data.get("device_id") or report_data.get("device") or manifest.get("device_id") or manifest.get("device") or "").strip()
    fn_content_hash = hashlib.sha256(
        json.dumps(report_data, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    ).hexdigest()
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
        if fn_device_id:
            existing = conn.execute(
                "SELECT id FROM lfi_reports WHERE fn_report_id = ? AND fn_device_id = ?",
                (fn_report_id, fn_device_id),
            ).fetchone()
        else:
            existing = conn.execute(
                "SELECT id FROM lfi_reports WHERE fn_report_id = ? AND fn_content_hash = ?",
                (fn_report_id, fn_content_hash),
            ).fetchone()
        if existing:
            return {
                "imported": "FIELD_NODE",
                "skipped": True,
                "reason": f"Report {fn_report_id} from this device is already imported",
                "existing_id": existing["id"],
                "fn_report_id": fn_report_id,
            }

        try:
            cur = conn.execute(
                """
                INSERT INTO lfi_reports
                (report_type, report_number, who_involved, what_happened, where_happened, when_happened,
                 notes, source_reliability, latitude, longitude, related_to, pin_category, pin_color,
                 status, imported_from, fn_report_id, fn_device_id, fn_content_hash, created_at, last_edited_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 'FIELD_NODE', ?, ?, ?, ?, ?)
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
                    fn_device_id or None,
                    fn_content_hash,
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
    payload = _empty_payload()
    for name in zf.namelist():
        lower = name.lower()
        if os.path.basename(lower) == "manifest.json":
            try:
                manifest = _read_json_member(zf, name)
                _merge_metadata(payload, manifest)
            except HTTPException:
                pass
            continue
        if lower.endswith(".gpx"):
            _merge_payload(payload, parse_gpx(zf.read(name), name))
        elif lower.endswith(".kml"):
            _merge_payload(payload, parse_kml(zf.read(name), name))
        elif lower.endswith(".json") or lower.endswith(".geojson"):
            _merge_payload(payload, parse_json(zf.read(name), name))
    for track in payload["tracks"]:
        track.setdefault("map_package_name", payload.get("map_package_name", ""))
        if payload.get("callsign"):
            track["callsign"] = payload["callsign"]
    if not payload.get("callsign"):
        apply_wayfinder_callsign(payload["tracks"], filename)
    result = _save_import(payload, filename, import_label="WAYFINDER")
    if not result:
        raise HTTPException(status_code=400, detail="No tracks or pins found in Wayfinder bundle")
    return result


def _save_import(payload: dict[str, Any], filename: str, import_label: str | None = None) -> dict[str, Any] | None:
    tracks = payload.get("tracks") or []
    pins = payload.get("pins") or []
    sessions = payload.get("sessions") or []
    if not tracks and not pins:
        return None
    export_id = str(payload.get("export_id") or "").strip()
    device_id = str(payload.get("device_id") or "").strip()
    import_type = str(import_label or payload.get("format") or "AAR").upper()
    content_hash = str(payload.get("content_hash") or "")
    with closing(sqlite3.connect(DB_PATH)) as conn, conn:
        if import_type == "WAYFINDER" and export_id and device_id:
            existing = conn.execute(
                "SELECT id FROM import_receipts WHERE import_type='WAYFINDER' AND export_id=? AND device_id=?",
                (export_id, device_id),
            ).fetchone()
        else:
            existing = conn.execute(
                "SELECT id FROM import_receipts WHERE import_type=? AND (content_hash=? OR filename=?)",
                (import_type, content_hash, filename),
            ).fetchone()
        if existing:
            return {
                "imported": import_type,
                "skipped": True,
                "reason": "This export is already imported",
                "existing_id": existing[0],
                "callsigns": [],
                "point_counts": {},
            }
        for track in tracks:
            point_count = len(track["geojson"].get("coordinates", []))
            conn.execute(
                """INSERT INTO patrol_tracks
                   (callsign, import_filename, source_format, point_count, geojson, map_package_name,
                    export_id, device_id, patrol_sessions_json)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (
                    track.get("callsign") or payload.get("callsign") or "UNKNOWN",
                    filename,
                    track["format"],
                    point_count,
                    json.dumps(track["geojson"]),
                    track.get("map_package_name") or payload.get("map_package_name"),
                    export_id or None,
                    device_id or None,
                    json.dumps(sessions),
                ),
            )
        pin_source = import_type.casefold()
        source_id = export_id or content_hash or filename
        for pin in pins:
            conn.execute(
                """INSERT INTO map_pins
                   (latitude, longitude, label, source, source_id, color, category, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    pin["latitude"], pin["longitude"], pin.get("label") or "Imported waypoint",
                    pin_source, source_id, pin.get("color") or "#42c8ff",
                    pin.get("category") or "general", utc_now_iso(),
                ),
            )
        for session in sessions:
            conn.execute(
                """INSERT INTO patrol_sessions
                   (export_id, device_id, callsign, session_id, started_at, ended_at, data_json)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (
                    export_id or None, device_id or None, payload.get("callsign") or "UNKNOWN",
                    str(session.get("session_id") or session.get("id") or ""),
                    session.get("started_at") or session.get("start_time"),
                    session.get("ended_at") or session.get("end_time"),
                    json.dumps(session),
                ),
            )
        receipt = conn.execute(
            """INSERT INTO import_receipts
               (import_type, export_id, device_id, content_hash, filename)
               VALUES (?, ?, ?, ?, ?)""",
            (import_type, export_id or None, device_id or None, content_hash or None, filename),
        )
    return {
        "imported": import_type,
        "import_id": receipt.lastrowid,
        "track_count": len(tracks),
        "pin_count": len(pins),
        "session_count": len(sessions),
        "callsigns": [track.get("callsign") or payload.get("callsign") or "UNKNOWN" for track in tracks],
        "point_counts": {
            track.get("callsign") or payload.get("callsign") or "UNKNOWN": len(track["geojson"].get("coordinates", []))
            for track in tracks
        },
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

def _empty_payload() -> dict[str, Any]:
    return {
        "tracks": [], "pins": [], "sessions": [], "callsign": "",
        "device_id": "", "export_id": "", "map_package_name": "", "format": "AAR",
    }


def _merge_metadata(payload: dict[str, Any], data: dict[str, Any]) -> None:
    payload["callsign"] = str(data.get("callsign") or payload.get("callsign") or "").strip()
    payload["device_id"] = str(data.get("device_id") or data.get("device") or payload.get("device_id") or "").strip()
    payload["export_id"] = str(data.get("export_id") or payload.get("export_id") or "").strip()
    payload["map_package_name"] = _map_package_name(data) or payload.get("map_package_name", "")
    if str(data.get("format") or "").upper() == "WAYFINDER":
        payload["format"] = "WAYFINDER"


def _merge_payload(target: dict[str, Any], source: dict[str, Any]) -> None:
    target["tracks"].extend(source.get("tracks") or [])
    target["pins"].extend(source.get("pins") or [])
    target["sessions"].extend(source.get("sessions") or [])
    for key in ("callsign", "device_id", "export_id", "map_package_name"):
        if source.get(key):
            target[key] = source[key]
    if source.get("format") == "WAYFINDER":
        target["format"] = "WAYFINDER"


def parse_zip(content: bytes) -> dict[str, Any]:
    payload = _empty_payload()
    with zipfile.ZipFile(io.BytesIO(content)) as zf:
        _validate_zip(zf)
        for name in zf.namelist():
            data = zf.read(name)
            lower = name.lower()
            if os.path.basename(lower) == "manifest.json":
                try:
                    _merge_metadata(payload, json.loads(data.decode("utf-8-sig")))
                except Exception:
                    pass
                continue
            if lower.endswith(".gpx"):
                _merge_payload(payload, parse_gpx(data, name))
            elif lower.endswith(".kml"):
                _merge_payload(payload, parse_kml(data, name))
            elif lower.endswith(".json") or lower.endswith(".geojson"):
                _merge_payload(payload, parse_json(data, name))
    for track in payload["tracks"]:
        track.setdefault("map_package_name", payload.get("map_package_name", ""))
        if payload.get("callsign"):
            track["callsign"] = payload["callsign"]
    return payload


def extract_callsign(filename: str) -> str:
    base = os.path.basename(filename).split(".")[0]
    parts = base.split("_")
    return parts[0].upper() if parts and parts[0] else "UNKNOWN"


def extract_wayfinder_callsign(filename: str) -> str:
    # Wayfinder_BRAVO_20260701_101719.zip -> BRAVO
    # Wayfinder_ALPHA_20260629_070709.gpx -> ALPHA
    base = os.path.basename(filename).split(".")[0]
    parts = base.split("_")
    if len(parts) >= 2 and parts[0].lower() == "wayfinder":
        return parts[1].upper()
    return "UNKNOWN"


def apply_wayfinder_callsign(tracks: list[dict[str, Any]], filename: str) -> None:
    callsign = extract_wayfinder_callsign(filename)
    if callsign == "UNKNOWN":
        return
    for track in tracks:
        track["callsign"] = callsign

def _xml_text(element: ET.Element, child_name: str) -> str:
    child = element.find(f"{{*}}{child_name}")
    return str(child.text or "").strip() if child is not None else ""


def parse_gpx(data: bytes, filename: str) -> dict[str, Any]:
    callsign = extract_callsign(filename)
    root = ET.fromstring(data)
    coords = []
    for trkpt in root.findall(".//{*}trkpt"):
        lat = trkpt.get("lat")
        lon = trkpt.get("lon")
        if lat is not None and lon is not None:
            coords.append([float(lon), float(lat)])
    pins = []
    for waypoint in root.findall(".//{*}wpt"):
        lat = _coerce_float(waypoint.get("lat"))
        lon = _coerce_float(waypoint.get("lon"))
        if lat is None or lon is None or not (-90 <= lat <= 90):
            continue
        pins.append({
            "latitude": lat,
            "longitude": lon,
            "label": _xml_text(waypoint, "name") or _xml_text(waypoint, "desc") or "GPX waypoint",
            "category": "waypoint",
        })
    tracks = []
    if coords:
        tracks.append({"callsign": callsign, "format": "gpx", "geojson": {"type": "LineString", "coordinates": coords}})
    return {**_empty_payload(), "tracks": tracks, "pins": pins, "format": "GPX"}


def _kml_coordinates(text: str | None) -> list[list[float]]:
    coords: list[list[float]] = []
    for pair in str(text or "").strip().split():
        parts = pair.split(",")
        if len(parts) >= 2:
            coords.append([float(parts[0]), float(parts[1])])
    return coords


def parse_kml(data: bytes, filename: str) -> dict[str, Any]:
    callsign = extract_callsign(filename)
    root = ET.fromstring(data)
    tracks = []
    pins = []
    for placemark in root.findall(".//{*}Placemark"):
        name = _xml_text(placemark, "name") or "KML point"
        for point in placemark.findall(".//{*}Point"):
            coordinates = _kml_coordinates(_xml_text(point, "coordinates"))
            if coordinates:
                pins.append({"longitude": coordinates[0][0], "latitude": coordinates[0][1], "label": name, "category": "waypoint"})
        for line in placemark.findall(".//{*}LineString"):
            coordinates = _kml_coordinates(_xml_text(line, "coordinates"))
            if coordinates:
                tracks.append({"callsign": callsign, "format": "kml", "geojson": {"type": "LineString", "coordinates": coordinates}})
    return {**_empty_payload(), "tracks": tracks, "pins": pins, "format": "KML"}


def _point_from_mapping(item: dict[str, Any], default_label: str) -> dict[str, Any] | None:
    lat = _coerce_float(item.get("latitude", item.get("lat")))
    lon = _coerce_float(item.get("longitude", item.get("lon", item.get("lng"))))
    coordinates = item.get("coordinates")
    if (lat is None or lon is None) and isinstance(coordinates, list) and len(coordinates) >= 2:
        lon = _coerce_float(coordinates[0])
        lat = _coerce_float(coordinates[1])
    if lat is None or lon is None or not (-90 <= lat <= 90):
        return None
    return {
        "latitude": lat,
        "longitude": lon,
        "label": str(item.get("label") or item.get("name") or item.get("title") or default_label),
        "category": str(item.get("category") or "waypoint"),
        "color": str(item.get("color") or "#42c8ff"),
    }


def _track_point_coordinate(item: Any) -> list[float] | None:
    if isinstance(item, (list, tuple)) and len(item) >= 2:
        lon, lat = _coerce_float(item[0]), _coerce_float(item[1])
    elif isinstance(item, dict):
        pin = _point_from_mapping(item, "")
        if pin is None:
            return None
        lon, lat = pin["longitude"], pin["latitude"]
    else:
        return None
    if lon is None or lat is None or not (-90 <= lat <= 90):
        return None
    return [lon, lat]


def parse_json(data: bytes, filename: str) -> dict[str, Any]:
    callsign = extract_callsign(filename)
    parsed = json.loads(data.decode("utf-8-sig"))
    if not isinstance(parsed, dict):
        raise ValueError("JSON import must contain an object")
    payload = _empty_payload()
    _merge_metadata(payload, parsed)
    native_wayfinder = str(parsed.get("format") or "").upper() == "WAYFINDER"
    if native_wayfinder and int(parsed.get("schema_version", 1)) != 1:
        raise ValueError("Unsupported Wayfinder schema_version")
    payload["format"] = "WAYFINDER" if native_wayfinder else "GEOJSON"
    coords: list[list[float]] = []
    if native_wayfinder:
        for point in parsed.get("track_points") or []:
            coordinate = _track_point_coordinate(point)
            if coordinate:
                coords.append(coordinate)
        for item in parsed.get("pins") or []:
            if isinstance(item, dict):
                pin = _point_from_mapping(item, "Wayfinder pin")
                if pin:
                    payload["pins"].append(pin)
        payload["sessions"] = [item for item in (parsed.get("patrol_sessions") or []) if isinstance(item, dict)]
    if parsed.get("type") == "LineString":
        coords.extend([coord[:2] for coord in parsed.get("coordinates", [])])
    for feature in parsed.get("features", []):
        geom = feature.get("geometry", {})
        gtype = geom.get("type")
        if gtype == "Point":
            properties = feature.get("properties") if isinstance(feature.get("properties"), dict) else {}
            pin = _point_from_mapping({**properties, "coordinates": geom.get("coordinates")}, "GeoJSON point")
            if pin:
                payload["pins"].append(pin)
        elif gtype == "LineString":
            line_coords = [coord[:2] for coord in geom.get("coordinates", [])]
            if line_coords:
                payload["tracks"].append({"callsign": payload.get("callsign") or callsign, "format": "geojson", "geojson": {"type": "LineString", "coordinates": line_coords}})
    if coords:
        payload["tracks"].append({
            "callsign": payload.get("callsign") or callsign,
            "format": "wayfinder" if native_wayfinder else "json",
            "geojson": {"type": "LineString", "coordinates": coords},
            "map_package_name": payload.get("map_package_name", ""),
        })
    return payload


def _map_package_name(data: dict[str, Any]) -> str:
    package = data.get("map_package")
    if isinstance(package, dict):
        return str(package.get("name") or "").strip()
    return ""


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
