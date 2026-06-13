from __future__ import annotations

import sqlite3
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)

DB_PATH = DATA_DIR / "waypoint.db"
PHOTOS_DIR = DATA_DIR / "photos"
PHOTOS_DIR.mkdir(parents=True, exist_ok=True)
THUMBS_DIR = PHOTOS_DIR / "thumbs"
THUMBS_DIR.mkdir(parents=True, exist_ok=True)
DOCUMENTS_DIR = DATA_DIR / "documents"
DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def row_to_dict(row: sqlite3.Row | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return dict(row)


def rows_to_dicts(rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS lfi_reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                report_type TEXT NOT NULL DEFAULT 'Observation',
                report_number TEXT,
                who_involved TEXT NOT NULL DEFAULT '',
                what_happened TEXT NOT NULL DEFAULT '',
                where_happened TEXT NOT NULL DEFAULT '',
                when_happened TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                source_reliability TEXT NOT NULL DEFAULT 'F',
                latitude REAL,
                longitude REAL,
                related_to TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'draft',
                finalized_at TEXT,
                reopened_at TEXT,
                last_edited_at TEXT,
                pdf_path TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS photos (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_filename TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                thumb_path TEXT,
                latitude REAL,
                longitude REAL,
                datetime_original TEXT,
                file_size INTEGER NOT NULL DEFAULT 0,
                width INTEGER,
                height INTEGER,
                related_to TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS map_pins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                label TEXT NOT NULL DEFAULT '',
                source TEXT NOT NULL DEFAULT 'manual',
                source_id INTEGER,
                color TEXT NOT NULL DEFAULT '#eab308',
                category TEXT NOT NULL DEFAULT 'general',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS documents (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                original_filename TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                file_type TEXT NOT NULL DEFAULT '',
                extraction_status TEXT NOT NULL DEFAULT 'pending',
                extraction_detail TEXT NOT NULL DEFAULT '',
                extracted_text TEXT NOT NULL DEFAULT '',
                extracted_clues TEXT NOT NULL DEFAULT '{}',
                notes TEXT NOT NULL DEFAULT '',
                related_to TEXT NOT NULL DEFAULT '',
                source_label TEXT NOT NULL DEFAULT '',
                uploaded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                source_type TEXT NOT NULL,
                source_id TEXT NOT NULL DEFAULT '',
                source_label TEXT NOT NULL DEFAULT '',
                relationship_type TEXT NOT NULL,
                target_type TEXT NOT NULL,
                target_id TEXT NOT NULL DEFAULT '',
                target_label TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS field_objects (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                object_type TEXT NOT NULL,
                name TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                latitude REAL,
                longitude REAL,
                status TEXT NOT NULL DEFAULT 'unknown',
                pin_color TEXT NOT NULL DEFAULT '#eab308',
                pin_category TEXT NOT NULL DEFAULT 'general',
                location_description TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            CREATE INDEX IF NOT EXISTS idx_lfi_created ON lfi_reports(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_photo_created ON photos(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_pins_created ON map_pins(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_documents_uploaded ON documents(uploaded_at DESC);
            CREATE INDEX IF NOT EXISTS idx_links_created ON links(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_field_objects_updated ON field_objects(updated_at DESC);
            """
        )

        # Ensure columns added after initial schema without dropping existing DBs
        _ensure_columns(conn, "lfi_reports", {
            "related_to": "TEXT NOT NULL DEFAULT ''",
            "status": "TEXT NOT NULL DEFAULT 'draft'",
            "finalized_at": "TEXT",
            "reopened_at": "TEXT",
            "pdf_path": "TEXT",
            "pin_category": "TEXT NOT NULL DEFAULT 'general'",
            "pin_color": "TEXT NOT NULL DEFAULT '#eab308'",
            "report_number": "TEXT",
            "last_edited_at": "TEXT",
        })
        _ensure_columns(conn, "photos", {"related_to": "TEXT NOT NULL DEFAULT ''"})
        _ensure_columns(conn, "map_pins", {"category": "TEXT NOT NULL DEFAULT 'general'"})
        _ensure_columns(conn, "field_objects", {
            "pin_color": "TEXT NOT NULL DEFAULT '#eab308'",
            "pin_category": "TEXT NOT NULL DEFAULT 'general'",
            "location_description": "TEXT NOT NULL DEFAULT ''",
        })
        _repair_photo_storage_paths(conn)


def utc_now_iso() -> str:
    return datetime.utcnow().isoformat(timespec="seconds") + "Z"


# Ensure columns added after initial schema without breaking existing DBs
def _ensure_columns(conn: sqlite3.Connection, table: str, columns: dict[str, str]) -> None:
    existing = {row["name"] for row in conn.execute(f"PRAGMA table_info({table})").fetchall()}
    for name, definition in columns.items():
        if name not in existing:
            try:
                conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
            except Exception:
                pass  # ignore if race or already handled


def _repair_photo_storage_paths(conn: sqlite3.Connection) -> None:
    rows = conn.execute("SELECT id, original_filename, stored_path, thumb_path FROM photos").fetchall()
    photo_root = PHOTOS_DIR.resolve()

    for row in rows:
        stored = Path(row["stored_path"]) if row["stored_path"] else None
        thumb = Path(row["thumb_path"]) if row["thumb_path"] else None
        if stored and stored.exists():
            try:
                stored_resolved = stored.resolve()
                if photo_root in stored_resolved.parents:
                    continue
                target = _unique_photo_target(stored.name)
                shutil.copy2(stored, target)
                new_thumb = _copy_thumb_if_present(thumb, target)
                conn.execute(
                    "UPDATE photos SET stored_path = ?, thumb_path = ? WHERE id = ?",
                    (str(target), str(new_thumb) if new_thumb else row["thumb_path"], row["id"]),
                )
            except Exception:
                continue
            continue

        candidates = []
        if stored:
            candidates.append(PHOTOS_DIR / stored.name)
        if row["original_filename"]:
            candidates.append(PHOTOS_DIR / Path(row["original_filename"]).name)

        replacement = next((candidate for candidate in candidates if candidate.exists()), None)
        if replacement:
            conn.execute("UPDATE photos SET stored_path = ? WHERE id = ?", (str(replacement), row["id"]))


def _unique_photo_target(filename: str) -> Path:
    base = Path(filename).name.replace(" ", "_")
    target = PHOTOS_DIR / base
    if not target.exists():
        return target
    stem = target.stem
    suffix = target.suffix
    for i in range(1, 1000):
        candidate = PHOTOS_DIR / f"{stem}_{i}{suffix}"
        if not candidate.exists():
            return candidate
    return PHOTOS_DIR / f"{stem}_{datetime.utcnow().strftime('%Y%m%d%H%M%S')}{suffix}"


def _copy_thumb_if_present(thumb: Path | None, target: Path) -> Path | None:
    if not thumb or not thumb.exists():
        return None
    thumb_target = THUMBS_DIR / f"{target.stem}_thumb{thumb.suffix or '.jpg'}"
    try:
        shutil.copy2(thumb, thumb_target)
        return thumb_target
    except Exception:
        return None
