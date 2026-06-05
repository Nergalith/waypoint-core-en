from __future__ import annotations

import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from PIL import Image, ImageDraw, ImageFont

from app.database import PHOTOS_DIR, get_connection, init_db, utc_now_iso
from app.services.photo_processor import extract_photo_metadata

GPS_TEST_NAME = "waypoint_gps_test_bangui.jpg"
GPS_LAT = 4.361111
GPS_LON = 18.555556


def create_placeholder(path: Path, label: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    img = Image.new("RGB", (640, 420), "#dbeafe")
    draw = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype("arial.ttf", 22)
    except Exception:
        font = ImageFont.load_default()
    draw.rectangle((24, 24, 616, 396), outline="#1e40af", width=4)
    draw.text((46, 70), "Waypoint Core", fill="#0f172a", font=font)
    draw.text((46, 116), label[:64], fill="#1e3a8a", font=font)
    draw.text((46, 164), f"GPS: {GPS_LAT:.6f}, {GPS_LON:.6f}", fill="#075985", font=font)
    img.save(path, "JPEG", quality=86)


def repair_missing_photo_rows(conn: sqlite3.Connection) -> int:
    repaired = 0
    rows = conn.execute("SELECT id, original_filename, stored_path FROM photos").fetchall()
    for row in rows:
        current = Path(row["stored_path"]) if row["stored_path"] else None
        if current and current.exists() and PHOTOS_DIR.resolve() in current.resolve().parents:
            continue

        filename = Path(row["original_filename"] or f"photo_{row['id']}.jpg").name
        target = PHOTOS_DIR / f"repaired_{row['id']}_{filename}"
        if not target.exists():
            create_placeholder(target, f"Recovered local placeholder for photo #{row['id']}")
        meta = extract_photo_metadata(target)
        conn.execute(
            """
            UPDATE photos
               SET stored_path = ?,
                   thumb_path = ?,
                   file_size = ?,
                   width = ?,
                   height = ?
             WHERE id = ?
            """,
            (
                str(target),
                meta.get("thumb_path"),
                meta.get("file_size") or target.stat().st_size,
                meta.get("width"),
                meta.get("height"),
                row["id"],
            ),
        )
        repaired += 1
    return repaired


def seed_gps_photo(conn: sqlite3.Connection) -> int:
    existing = conn.execute(
        "SELECT id FROM photos WHERE original_filename = ?",
        (GPS_TEST_NAME,),
    ).fetchone()
    if existing:
        return int(existing["id"])

    path = PHOTOS_DIR / GPS_TEST_NAME
    create_placeholder(path, "GPS test photo near Bangui")
    meta = extract_photo_metadata(path)
    now = utc_now_iso()
    cur = conn.execute(
        """
        INSERT INTO photos
        (original_filename, stored_path, thumb_path, latitude, longitude,
         datetime_original, file_size, width, height, related_to, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            GPS_TEST_NAME,
            str(path),
            meta.get("thumb_path"),
            GPS_LAT,
            GPS_LON,
            "2026-06-03 09:30",
            meta.get("file_size") or path.stat().st_size,
            meta.get("width"),
            meta.get("height"),
            "GPS test photo for photo-to-map proof",
            now,
        ),
    )
    photo_id = int(cur.lastrowid)
    conn.execute(
        """
        INSERT INTO map_pins (latitude, longitude, label, source, source_id, color, created_at)
        VALUES (?, ?, ?, 'photo', ?, '#0ea5e9', ?)
        """,
        (GPS_LAT, GPS_LON, "PHOTO: waypoint_gps_test_bangui.jpg", photo_id, now),
    )
    return photo_id


def main() -> None:
    init_db()
    with get_connection() as conn:
        repaired = repair_missing_photo_rows(conn)
        gps_id = seed_gps_photo(conn)
    print(f"Photo path rows repaired: {repaired}")
    print(f"GPS test photo id: {gps_id}")


if __name__ == "__main__":
    main()
