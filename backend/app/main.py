from __future__ import annotations

import os
import shutil
import json
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .database import (
    DB_PATH,
    DOCUMENTS_DIR,
    PHOTOS_DIR,
    THUMBS_DIR,
    get_connection,
    init_db,
    row_to_dict,
    rows_to_dicts,
    utc_now_iso,
)
from .services.document_processor import extract_document, is_supported_document
from .services.photo_processor import compress_for_storage, extract_photo_metadata, is_supported_photo
from .services.pdf_generator import (
    generate_bundle_pdf,
    generate_single_pdf,
    get_reports_dir_size,
    REPORTS_DIR,
)

# ---------------- Models (Pydantic for API) ----------------

class LfiExportRequest(BaseModel):
    ids: List[int]
    lang: str = "en"


class LfiCreate(BaseModel):
    report_type: str = "Observation"
    who_involved: str = ""
    what_happened: str = ""
    where_happened: str = ""
    when_happened: str = ""
    notes: str = ""
    source_reliability: str = "F"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    related_to: str = ""
    pin_category: str = "general"
    pin_color: str = "#eab308"


class LfiUpdate(BaseModel):
    report_type: str = "Observation"
    who_involved: str = ""
    what_happened: str = ""
    where_happened: str = ""
    when_happened: str = ""
    notes: str = ""
    source_reliability: str = "F"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    related_to: str = ""
    pin_category: str = "general"
    pin_color: str = "#eab308"


class MapPinCreate(BaseModel):
    latitude: float
    longitude: float
    label: str = ""
    source: str = "manual"
    source_id: Optional[int] = None
    color: Optional[str] = None
    category: str = "general"


class DocumentPinCreate(BaseModel):
    latitude: float
    longitude: float
    label: str = ""
    category: str = "document"
    color: str = "#eab308"


class LinkCreate(BaseModel):
    source_type: str
    source_id: str = ""
    source_label: str = ""
    relationship_type: str
    target_type: str
    target_id: str = ""
    target_label: str = ""
    notes: str = ""


class FieldObjectCreate(BaseModel):
    object_type: str
    name: str
    description: str = ""
    notes: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    status: str = "unknown"
    pin_color: str = "#eab308"
    pin_category: str = "general"
    location_description: str = ""


DEV_MODE = os.environ.get("WAYPOINT_DEV", "").lower() in ("1", "true", "yes")

OBJECT_TYPES = {"person", "vehicle", "group", "location", "event"}
OBJECT_STATUSES = {"active", "unknown", "no longer relevant"}

REPORT_TYPE_LABELS_EN = {
    "Observation": "Observation",
    "Patrol": "Patrol",
    "Rumor/Witness": "Rumor/Witness",
    "Rumor": "Rumor",
    "Witness": "Witness",
    "Contact Report": "Contact Report",
    "Contact": "Contact Report",
    "Checkpoint": "Checkpoint",
}


def report_type_label_en(report_type: str) -> str:
    return REPORT_TYPE_LABELS_EN.get(report_type, report_type or "Observation")


def validate_coordinate_pair(latitude: Optional[float], longitude: Optional[float]) -> tuple[Optional[float], Optional[float]]:
    if latitude is None and longitude is None:
        return None, None
    if latitude is None or longitude is None:
        raise HTTPException(status_code=422, detail="Latitude and longitude must be provided together.")
    if not (-90 <= latitude <= 90):
        raise HTTPException(status_code=422, detail="Latitude must be between -90 and 90.")
    if not (-180 <= longitude <= 180):
        raise HTTPException(status_code=422, detail="Longitude must be between -180 and 180.")
    return round(float(latitude), 6), round(float(longitude), 6)


def _get_next_report_number() -> str:
    """Compute RPT-YYYYMMDD-NNN. NNN resets daily, increments from existing."""
    today = datetime.utcnow().strftime("%Y%m%d")
    prefix = f"RPT-{today}-"
    try:
        with get_connection() as conn:
            row = conn.execute(
                "SELECT report_number FROM lfi_reports WHERE report_number LIKE ? ORDER BY report_number DESC LIMIT 1",
                (prefix + "%",)
            ).fetchone()
            if row and row[0]:
                try:
                    n = int(str(row[0]).split('-')[-1])
                    return f"{prefix}{n + 1:03d}"
                except Exception:
                    pass
    except Exception:
        pass
    return f"{prefix}001"


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Waypoint Core API", version="0.3.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5174",
        "http://localhost:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static serving for photos and thumbs (offline friendly)
app.mount("/photos", StaticFiles(directory=str(PHOTOS_DIR)), name="photos")


# ---------------- Health ----------------

@app.get("/api/health")
def health():
    with get_connection() as conn:
        lfi_count = conn.execute("SELECT COUNT(*) FROM lfi_reports").fetchone()[0]
        photo_count = conn.execute("SELECT COUNT(*) FROM photos").fetchone()[0]
        pin_count = conn.execute("SELECT COUNT(*) FROM map_pins").fetchone()[0]
        document_count = conn.execute("SELECT COUNT(*) FROM documents").fetchone()[0]
        link_count = conn.execute("SELECT COUNT(*) FROM links").fetchone()[0]
        object_count = conn.execute("SELECT COUNT(*) FROM field_objects").fetchone()[0]
    return {
        "status": "ok",
        "db": str(DB_PATH),
        "counts": {"lfi": lfi_count, "photos": photo_count, "pins": pin_count, "documents": document_count, "links": link_count, "objects": object_count},
        "version": "0.1.0-mvp",
    }


# ---------------- Storage ----------------

@app.get("/api/storage/size")
def storage_size():
    size_bytes = get_reports_dir_size()
    if size_bytes < 1024:
        display = f"{size_bytes} o"
    elif size_bytes < 1024 * 1024:
        display = f"{size_bytes / 1024:.1f} Ko"
    else:
        display = f"{size_bytes / (1024 * 1024):.1f} Mo"
    return {"bytes": size_bytes, "display": display, "path": str(REPORTS_DIR)}


# ---------------- LFI Reports ----------------

@app.get("/api/lfi")
def list_lfi(limit: int = 100):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM lfi_reports ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return rows_to_dicts(rows)


@app.post("/api/lfi", status_code=201)
def create_lfi(payload: LfiCreate):
    now = utc_now_iso()
    latitude, longitude = validate_coordinate_pair(payload.latitude, payload.longitude)
    pin_cat = (payload.pin_category or "general").strip() or "general"
    pin_col = payload.pin_color or "#eab308"
    report_num = _get_next_report_number()
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO lfi_reports
            (report_type, report_number, who_involved, what_happened, where_happened, when_happened,
             notes, source_reliability, latitude, longitude, related_to, pin_category, pin_color,
             created_at, last_edited_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload.report_type,
                report_num,
                payload.who_involved.strip(),
                payload.what_happened.strip(),
                payload.where_happened.strip(),
                payload.when_happened.strip(),
                payload.notes.strip(),
                payload.source_reliability,
                latitude,
                longitude,
                payload.related_to.strip(),
                pin_cat,
                pin_col,
                now,
                now,
            ),
        )
        lfi_id = cur.lastrowid

    # Auto-create map pin for this report if it has coordinates (pipeline: report -> pin)
    if latitude is not None and longitude is not None:
        try:
            with get_connection() as conn:
                conn.execute(
                    "DELETE FROM map_pins WHERE source = 'field_report' AND source_id = ?",
                    (str(lfi_id),),
                )
                label = f"{report_num} {report_type_label_en(payload.report_type)}"[:80]
                conn.execute(
                    """
                    INSERT INTO map_pins (latitude, longitude, label, source, source_id, color, category, created_at)
                    VALUES (?, ?, ?, 'field_report', ?, ?, ?, ?)
                    """,
                    (latitude, longitude, label, str(lfi_id), pin_col, pin_cat, now),
                )
        except Exception:
            pass  # pin creation must never break report save

    # Return the created record
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM lfi_reports WHERE id = ?", (lfi_id,)).fetchone()
    return row_to_dict(row)


@app.patch("/api/lfi/{lfi_id}/finalize")
def finalize_lfi(lfi_id: int, lang: str = "en"):
    with get_connection() as conn:
        row = conn.execute("SELECT id, status FROM lfi_reports WHERE id = ?", (lfi_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Report not found.")
        if row["status"] == "finalized":
            raise HTTPException(status_code=409, detail="Report is already finalized.")
        now = utc_now_iso()
        conn.execute(
            "UPDATE lfi_reports SET status = 'finalized', finalized_at = ? WHERE id = ?",
            (now, lfi_id),
        )
        report = row_to_dict(conn.execute("SELECT * FROM lfi_reports WHERE id = ?", (lfi_id,)).fetchone())

        # Gather linked photos and links for the PDF
        link_rows = conn.execute(
            """SELECT * FROM links WHERE
               (source_type = 'field_report' AND source_id = ?)
               OR (target_type = 'field_report' AND target_id = ?)""",
            (str(lfi_id), str(lfi_id)),
        ).fetchall()
        links = rows_to_dicts(link_rows)

        photo_ids = set()
        for lk in links:
            if lk["source_type"] == "photo":
                try: photo_ids.add(int(lk["source_id"]))
                except ValueError: pass
            if lk["target_type"] == "photo":
                try: photo_ids.add(int(lk["target_id"]))
                except ValueError: pass
        photos = []
        if photo_ids:
            placeholders = ",".join("?" * len(photo_ids))
            photos = rows_to_dicts(conn.execute(
                f"SELECT * FROM photos WHERE id IN ({placeholders})", list(photo_ids)
            ).fetchall())

    try:
        pdf_path = generate_single_pdf(report, photos, links, lang=lang)
        with get_connection() as conn:
            conn.execute(
                "UPDATE lfi_reports SET pdf_path = ? WHERE id = ?",
                (str(pdf_path), lfi_id),
            )
            report = row_to_dict(conn.execute("SELECT * FROM lfi_reports WHERE id = ?", (lfi_id,)).fetchone())
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"PDF generation failed: {exc}") from exc

    return report


@app.patch("/api/lfi/{lfi_id}/reopen")
def reopen_lfi(lfi_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT id, status FROM lfi_reports WHERE id = ?", (lfi_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Report not found.")
        if row["status"] == "draft":
            raise HTTPException(status_code=409, detail="Report is already a draft.")
        now = utc_now_iso()
        conn.execute(
            "UPDATE lfi_reports SET status = 'draft', reopened_at = ? WHERE id = ?",
            (now, lfi_id),
        )
        updated = conn.execute("SELECT * FROM lfi_reports WHERE id = ?", (lfi_id,)).fetchone()
    return row_to_dict(updated)


@app.patch("/api/lfi/{lfi_id}")
def update_lfi(lfi_id: int, payload: LfiUpdate):
    now = utc_now_iso()
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM lfi_reports WHERE id = ?", (lfi_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Report not found.")
        latitude, longitude = validate_coordinate_pair(payload.latitude, payload.longitude)
        pin_cat = (payload.pin_category or "general").strip() or "general"
        pin_col = payload.pin_color or "#eab308"
        conn.execute(
            """
            UPDATE lfi_reports SET
                report_type = ?, who_involved = ?, what_happened = ?,
                where_happened = ?, when_happened = ?, notes = ?,
                source_reliability = ?, latitude = ?, longitude = ?, related_to = ?,
                pin_category = ?, pin_color = ?, last_edited_at = ?
            WHERE id = ?
            """,
            (
                payload.report_type,
                payload.who_involved.strip(),
                payload.what_happened.strip(),
                payload.where_happened.strip(),
                payload.when_happened.strip(),
                payload.notes.strip(),
                payload.source_reliability,
                latitude,
                longitude,
                payload.related_to.strip(),
                pin_cat,
                pin_col,
                now,
                lfi_id,
            ),
        )
        updated = conn.execute("SELECT * FROM lfi_reports WHERE id = ?", (lfi_id,)).fetchone()

    # Upsert auto pin on edit; remove stale report pin when coordinates are cleared.
    try:
        with get_connection() as conn:
            conn.execute(
                "DELETE FROM map_pins WHERE source = 'field_report' AND source_id = ?",
                (str(lfi_id),),
            )
            if latitude is not None and longitude is not None:
                rnum = (updated or {}).get("report_number") or f"RPT-{lfi_id}"
                label = f"{rnum} {report_type_label_en(payload.report_type)}"[:80]
                conn.execute(
                    """
                    INSERT INTO map_pins (latitude, longitude, label, source, source_id, color, category, created_at)
                    VALUES (?, ?, ?, 'field_report', ?, ?, ?, ?)
                    """,
                    (latitude, longitude, label, str(lfi_id), pin_col, pin_cat, now),
                )
    except Exception:
        pass

    return row_to_dict(updated)


@app.delete("/api/lfi/{lfi_id}")
def delete_lfi(lfi_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT id FROM lfi_reports WHERE id = ?", (lfi_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Report not found.")
        conn.execute("DELETE FROM lfi_reports WHERE id = ?", (lfi_id,))
        conn.execute(
            "DELETE FROM map_pins WHERE source = 'field_report' AND source_id = ?",
            (str(lfi_id),),
        )
    return {"deleted": lfi_id}


@app.get("/api/reports/download/{filename}")
def download_report(filename: str):
    safe_name = Path(filename).name  # strip any path components
    if not safe_name.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files can be downloaded.")
    for p in REPORTS_DIR.rglob(safe_name):
        if p.is_file():
            return FileResponse(str(p), media_type="application/pdf", filename=safe_name)
    raise HTTPException(status_code=404, detail="Report file not found.")


@app.post("/api/lfi/export", status_code=201)
def export_lfi(payload: LfiExportRequest):
    if not payload.ids:
        raise HTTPException(status_code=422, detail="No report IDs provided.")
    if len(payload.ids) > 100:
        raise HTTPException(status_code=422, detail="Too many reports in one export (max 100).")

    with get_connection() as conn:
        placeholders = ",".join("?" * len(payload.ids))
        reports = rows_to_dicts(conn.execute(
            f"SELECT * FROM lfi_reports WHERE id IN ({placeholders}) ORDER BY created_at ASC",
            payload.ids,
        ).fetchall())
        if not reports:
            raise HTTPException(status_code=404, detail="No reports found for provided IDs.")

        photos_by_id: Dict[int, list] = {}
        links_by_id: Dict[int, list] = {}
        for report in reports:
            rid = report["id"]
            link_rows = conn.execute(
                """SELECT * FROM links WHERE
                   (source_type = 'field_report' AND source_id = ?)
                   OR (target_type = 'field_report' AND target_id = ?)""",
                (str(rid), str(rid)),
            ).fetchall()
            links = rows_to_dicts(link_rows)
            links_by_id[rid] = links

            photo_ids = set()
            for lk in links:
                if lk["source_type"] == "photo":
                    try: photo_ids.add(int(lk["source_id"]))
                    except ValueError: pass
                if lk["target_type"] == "photo":
                    try: photo_ids.add(int(lk["target_id"]))
                    except ValueError: pass
            if photo_ids:
                ph_placeholders = ",".join("?" * len(photo_ids))
                photos_by_id[rid] = rows_to_dicts(conn.execute(
                    f"SELECT * FROM photos WHERE id IN ({ph_placeholders})", list(photo_ids)
                ).fetchall())
            else:
                photos_by_id[rid] = []

    pdf_path = generate_bundle_pdf(reports, photos_by_id, links_by_id, lang=payload.lang)
    return {"path": str(pdf_path), "filename": pdf_path.name}


# ---------------- Photos ----------------

@app.get("/api/photos")
def list_photos(limit: int = 100):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM photos ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return rows_to_dicts(rows)


@app.post("/api/photos/upload", status_code=201)
async def upload_photos(
    files: List[UploadFile] = File(...),
    related_to: str = Form("", description="Optional free-text 'related to' note for these photos (simple linking)")
):
    """
    Accept one or more photos. Process EXIF/GPS + create thumb. Return list of records.
    related_to (form field): optional free-text note for basic linking (e.g. "same pickup as RPT-001").
    """
    results = []
    related_note = (related_to or "").strip()
    with get_connection() as conn:
        for upload in files:
            if not upload.filename:
                continue
            if not is_supported_photo(Path(upload.filename)):
                # Still save but mark as limited
                pass

            # Unique stored name to avoid collisions
            ts = datetime.utcnow().strftime("%Y%m%d-%H%M%S")
            safe_original = Path(upload.filename).name.replace(" ", "_")
            safe_name = f"{ts}_{safe_original}"
            dest = PHOTOS_DIR / safe_name

            # Save original
            with dest.open("wb") as f:
                shutil.copyfileobj(upload.file, f)

            # Extract EXIF/GPS + generate thumb from full-res original
            meta = extract_photo_metadata(dest)

            # Compress stored file to max 1024px after EXIF has been extracted
            compress_for_storage(dest, max_width=1024, quality=75)
            meta["file_size"] = dest.stat().st_size if dest.exists() else meta.get("file_size", 0)

            # Insert DB record
            cur = conn.execute(
                """
                INSERT INTO photos
                (original_filename, stored_path, thumb_path, latitude, longitude,
                 datetime_original, file_size, width, height, related_to, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    upload.filename,
                    str(dest),
                    meta.get("thumb_path"),
                    meta.get("latitude"),
                    meta.get("longitude"),
                    meta.get("datetime_original"),
                    meta.get("file_size") or 0,
                    meta.get("width"),
                    meta.get("height"),
                    related_note,
                    utc_now_iso(),
                ),
            )
            photo_id = cur.lastrowid

            # Return enriched record
            row = conn.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
            rec = dict(row) if row else {}
            rec["has_gps"] = bool(rec.get("latitude"))
            rec["precision_note"] = meta.get("precision_note", "")
            rec["camera_info"] = meta.get("camera_info")
            rec["related_to"] = related_note
            results.append(rec)

    return {"uploaded": len(results), "photos": results}


@app.delete("/api/photos/{photo_id}")
def delete_photo(photo_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT stored_path, thumb_path FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Photo not found.")
        for path_col in (row["stored_path"], row["thumb_path"]):
            if path_col:
                p = Path(path_col)
                if p.exists():
                    try:
                        p.unlink()
                    except Exception:
                        pass
        conn.execute(
            """DELETE FROM links WHERE
               (source_type = 'photo' AND source_id = ?)
               OR (target_type = 'photo' AND target_id = ?)""",
            (str(photo_id), str(photo_id)),
        )
        conn.execute(
            "DELETE FROM map_pins WHERE source = 'photo' AND source_id = ?",
            (str(photo_id),),
        )
        remaining_links = conn.execute(
            """SELECT COUNT(*) FROM links WHERE
               (source_type = 'photo' AND source_id = ?)
               OR (target_type = 'photo' AND target_id = ?)""",
            (str(photo_id), str(photo_id)),
        ).fetchone()[0]
        remaining_pins = conn.execute(
            "SELECT COUNT(*) FROM map_pins WHERE source = 'photo' AND source_id = ?",
            (str(photo_id),),
        ).fetchone()[0]
        print(f"Photo delete cleanup: photo_id={photo_id} remaining_links={remaining_links} remaining_pins={remaining_pins}")
        conn.execute("DELETE FROM photos WHERE id = ?", (photo_id,))
    return {"deleted": photo_id}


# ---------------- Documents / Extraction ----------------

@app.get("/api/documents")
def list_documents(limit: int = 100):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM documents ORDER BY uploaded_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    docs = rows_to_dicts(rows)
    for doc in docs:
        doc["text_preview"] = (doc.get("extracted_text") or "")[:600]
        doc["clues"] = _decode_clues(doc.get("extracted_clues"))
    return docs


@app.get("/api/documents/{document_id}")
def get_document(document_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM documents WHERE id = ?", (document_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    doc = row_to_dict(row)
    doc["clues"] = _decode_clues(doc.get("extracted_clues"))
    return doc


@app.post("/api/documents/upload", status_code=201)
async def upload_documents(
    files: List[UploadFile] = File(...),
    notes: str = Form(""),
    related_to: str = Form(""),
    source_label: str = Form(""),
):
    results = []
    now = utc_now_iso()
    with get_connection() as conn:
        for upload in files:
            if not upload.filename:
                continue

            original_name = Path(upload.filename).name
            suffix = Path(original_name).suffix.lower()
            if not is_supported_document(Path(original_name)):
                status = "unsupported"
                detail = "Unsupported file type for current MVP."
            else:
                status = "pending"
                detail = ""

            safe_name = f"{datetime.utcnow().strftime('%Y%m%d-%H%M%S')}_{original_name.replace(' ', '_')}"
            dest = DOCUMENTS_DIR / safe_name
            with dest.open("wb") as f:
                shutil.copyfileobj(upload.file, f)

            extracted_text = ""
            clues = {}
            if status != "unsupported":
                extracted = extract_document(dest)
                status = extracted["status"]
                detail = extracted.get("detail", "")
                extracted_text = extracted.get("text", "")
                clues = extracted.get("clues", {})

            cur = conn.execute(
                """
                INSERT INTO documents
                (original_filename, stored_path, file_type, extraction_status, extraction_detail,
                 extracted_text, extracted_clues, notes, related_to, source_label, uploaded_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    original_name,
                    str(dest),
                    suffix.lstrip(".") or "unknown",
                    status,
                    detail,
                    extracted_text,
                    json.dumps(clues, ensure_ascii=False),
                    notes.strip(),
                    related_to.strip(),
                    source_label.strip(),
                    now,
                ),
            )
            row = conn.execute("SELECT * FROM documents WHERE id = ?", (cur.lastrowid,)).fetchone()
            rec = row_to_dict(row)
            rec["text_preview"] = (rec.get("extracted_text") or "")[:600]
            rec["clues"] = _decode_clues(rec.get("extracted_clues"))
            results.append(rec)

    return {"uploaded": len(results), "documents": results}


@app.post("/api/documents/{document_id}/pins", status_code=201)
def create_document_pin(document_id: int, payload: DocumentPinCreate):
    latitude, longitude = validate_coordinate_pair(payload.latitude, payload.longitude)
    with get_connection() as conn:
        doc = conn.execute("SELECT id, original_filename FROM documents WHERE id = ?", (document_id,)).fetchone()
        if doc is None:
            raise HTTPException(status_code=404, detail="Document not found.")
        label = (payload.label or f"DOC: {doc['original_filename']}")[:80]
        now = utc_now_iso()
        cur = conn.execute(
            """
            INSERT INTO map_pins (latitude, longitude, label, source, source_id, color, category, created_at)
            VALUES (?, ?, ?, 'document', ?, ?, ?, ?)
            """,
            (latitude, longitude, label, document_id, payload.color, payload.category, now),
        )
        row = conn.execute("SELECT * FROM map_pins WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_dict(row)


@app.delete("/api/documents/{document_id}")
def delete_document(document_id: int):
    with get_connection() as conn:
        row = conn.execute("SELECT stored_path FROM documents WHERE id = ?", (document_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Document not found.")
        if row["stored_path"]:
            p = Path(row["stored_path"])
            if p.exists():
                try:
                    p.unlink()
                except Exception:
                    pass
        conn.execute(
            """DELETE FROM links WHERE
               (source_type = 'document' AND source_id = ?)
               OR (target_type = 'document' AND target_id = ?)""",
            (str(document_id), str(document_id)),
        )
        conn.execute(
            "DELETE FROM map_pins WHERE source = 'document' AND source_id = ?",
            (str(document_id),),
        )
        remaining_links = conn.execute(
            """SELECT COUNT(*) FROM links WHERE
               (source_type = 'document' AND source_id = ?)
               OR (target_type = 'document' AND target_id = ?)""",
            (str(document_id), str(document_id)),
        ).fetchone()[0]
        remaining_pins = conn.execute(
            "SELECT COUNT(*) FROM map_pins WHERE source = 'document' AND source_id = ?",
            (str(document_id),),
        ).fetchone()[0]
        print(f"Document delete cleanup: document_id={document_id} remaining_links={remaining_links} remaining_pins={remaining_pins}")
        conn.execute("DELETE FROM documents WHERE id = ?", (document_id,))
    return {"deleted": document_id}


def _decode_clues(raw: str | None) -> dict:
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {}


# ---------------- Field Objects ----------------

@app.get("/api/objects")
def list_field_objects(limit: int = 200):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM field_objects ORDER BY updated_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return rows_to_dicts(rows)


@app.post("/api/objects", status_code=201)
def create_field_object(payload: FieldObjectCreate):
    object_type = payload.object_type.strip().lower()
    status = payload.status.strip().lower() or "unknown"
    name = payload.name.strip()
    if object_type not in OBJECT_TYPES:
        raise HTTPException(status_code=422, detail="Unsupported object type.")
    if status not in OBJECT_STATUSES:
        raise HTTPException(status_code=422, detail="Unsupported object status.")
    if not name:
        raise HTTPException(status_code=422, detail="Object name is required.")

    latitude, longitude = validate_coordinate_pair(payload.latitude, payload.longitude)
    pin_cat = (payload.pin_category or "general").strip() or "general"
    pin_col = payload.pin_color or "#eab308"
    now = utc_now_iso()
    obj_id = None
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO field_objects
            (object_type, name, description, notes, latitude, longitude, status, pin_color, pin_category, location_description, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                object_type,
                name[:120],
                payload.description.strip(),
                payload.notes.strip(),
                latitude,
                longitude,
                status,
                pin_col,
                pin_cat,
                (payload.location_description or "").strip(),
                now,
                now,
            ),
        )
        obj_id = cur.lastrowid
        row = conn.execute("SELECT * FROM field_objects WHERE id = ?", (obj_id,)).fetchone()

    # Auto-create map pin for this field object if coords (pipeline: object -> pin)
    if obj_id is not None and latitude is not None and longitude is not None:
        try:
            with get_connection() as conn:
                conn.execute(
                    "DELETE FROM map_pins WHERE source = ? AND source_id = ?",
                    (object_type, str(obj_id)),
                )
                label = f"{object_type.upper()}-{obj_id} {name}"[:80]
                conn.execute(
                    """
                    INSERT INTO map_pins (latitude, longitude, label, source, source_id, color, category, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (latitude, longitude, label, object_type, str(obj_id), pin_col, pin_cat, now),
                )
        except Exception:
            pass

    return row_to_dict(row)


# ---------------- Structured Links ----------------

@app.get("/api/links")
def list_links(limit: int = 200):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM links ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return rows_to_dicts(rows)


@app.post("/api/links", status_code=201)
def create_link(payload: LinkCreate):
    allowed_objects = {"field_report", "photo", "document", "person", "vehicle", "group", "location", "event"}
    relationship_aliases = {
        "related_to": "related_to",
        "related to": "related_to",
        "observed_at": "observed_at",
        "observed at": "observed_at",
        "mentioned_in": "mentioned_in",
        "mentioned in": "mentioned_in",
        "photographed_at": "photographed_at",
        "photographed at": "photographed_at",
        "reported_by": "reported_by",
        "reported by": "reported_by",
        "associated_with": "associated_with",
        "associated with": "associated_with",
        "same_as": "same_as",
        "same as / possible match": "same_as",
    }
    source_type = payload.source_type.strip()
    target_type = payload.target_type.strip()
    relationship = relationship_aliases.get(payload.relationship_type.strip().lower())
    if source_type not in allowed_objects or target_type not in allowed_objects:
        raise HTTPException(status_code=422, detail="Unsupported object type.")
    if relationship is None:
        raise HTTPException(status_code=422, detail="Unsupported relationship type.")
    if not payload.source_label.strip() or not payload.target_label.strip():
        raise HTTPException(status_code=422, detail="Source and target labels are required.")

    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO links
            (source_type, source_id, source_label, relationship_type,
             target_type, target_id, target_label, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                source_type,
                payload.source_id.strip(),
                payload.source_label.strip(),
                relationship,
                target_type,
                payload.target_id.strip(),
                payload.target_label.strip(),
                payload.notes.strip(),
                utc_now_iso(),
            ),
        )
        row = conn.execute("SELECT * FROM links WHERE id = ?", (cur.lastrowid,)).fetchone()
    return row_to_dict(row)


# ---------------- Map Pins (manual + auto) ----------------

@app.get("/api/pins")
def list_pins(limit: int = 200):
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT * FROM map_pins ORDER BY created_at DESC LIMIT ?",
            (limit,),
        ).fetchall()
    return rows_to_dicts(rows)


@app.post("/api/pins", status_code=201)
def create_pin(payload: MapPinCreate):
    now = utc_now_iso()
    latitude, longitude = validate_coordinate_pair(payload.latitude, payload.longitude)
    color = payload.color or "#eab308"
    with get_connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO map_pins (latitude, longitude, label, source, source_id, color, category, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                latitude,
                longitude,
                payload.label.strip()[:80] or "Manual observation",
                payload.source,
                payload.source_id,
                color,
                payload.category.strip() or "general",
                now,
            ),
        )
        pin_id = cur.lastrowid
        row = conn.execute("SELECT * FROM map_pins WHERE id = ?", (pin_id,)).fetchone()
    return row_to_dict(row)


@app.delete("/api/pins/{pin_id}")
def delete_pin(pin_id: int):
    with get_connection() as conn:
        conn.execute("DELETE FROM map_pins WHERE id = ?", (pin_id,))
    return {"deleted": pin_id}


# ---------------- Utility: clear all (for testing only) ----------------
@app.post("/api/dev/clear")
def dev_clear_all():
    """Danger: wipes all data. Only available when WAYPOINT_DEV=1."""
    if not DEV_MODE:
        raise HTTPException(status_code=403, detail="Only available in development mode (set WAYPOINT_DEV=1).")
    with get_connection() as conn:
        conn.execute("DELETE FROM map_pins")
        conn.execute("DELETE FROM photos")
        conn.execute("DELETE FROM lfi_reports")
        conn.execute("DELETE FROM documents")
        conn.execute("DELETE FROM links")
        conn.execute("DELETE FROM field_objects")
    return {"status": "cleared (db rows only)"}




