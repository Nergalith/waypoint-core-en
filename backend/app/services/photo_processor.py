"""
Waypoint Core - Photo processor (lightweight, server-side)
Focus: EXIF GPS + datetime + basic metadata + thumbnail generation. Graceful degradation.
No external network. Designed to be fast and low-memory on old hardware.
"""
from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from PIL import Image, ExifTags

logger = logging.getLogger(__name__)

SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}

THUMB_SIZE = (160, 160)


def _rational_to_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    if isinstance(val, (int, float)):
        return float(val)
    if isinstance(val, tuple) and len(val) == 2:
        num, den = val
        if den == 0:
            return None
        return num / den
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _dms_to_decimal(dms: Any, ref: Any) -> Optional[float]:
    if not dms or len(dms) != 3:
        return None
    try:
        d = _rational_to_float(dms[0]) or 0.0
        m = _rational_to_float(dms[1]) or 0.0
        s = _rational_to_float(dms[2]) or 0.0
        decimal = d + (m / 60.0) + (s / 3600.0)
        ref_str = str(ref).upper() if ref else ""
        if ref_str.startswith(("S", "W")):
            decimal = -decimal
        return round(decimal, 6)
    except Exception:
        return None


def _get_exif_value(exif: Dict, tag: int) -> Any:
    return exif.get(tag)


def extract_photo_metadata(path: Path) -> Dict[str, Any]:
    """
    Extract GPS, date, camera, dimensions + generate thumbnail.
    Returns rich dict suitable for DB + UI. Never raises on bad files.
    """
    p = Path(path).resolve()
    result: Dict[str, Any] = {
        "photo_filename": p.name,
        "photo_path": str(p),
        "has_gps": False,
        "latitude": None,
        "longitude": None,
        "datetime_original": None,
        "camera_info": None,
        "width": None,
        "height": None,
        "file_size": p.stat().st_size if p.exists() else 0,
        "thumb_path": None,
        "precision_note": "No image data read",
        "error": None,
    }

    if not p.exists() or p.suffix.lower() not in SUPPORTED_EXTENSIONS:
        result["precision_note"] = "Unsupported or missing file"
        return result

    try:
        with Image.open(p) as img:
            result["width"] = img.width
            result["height"] = img.height

            exif = img.getexif() or {}
            if not exif:
                result["precision_note"] = "No EXIF data"
            else:
                # Camera
                make = exif.get(0x010F)
                model = exif.get(0x0110)
                if make or model:
                    result["camera_info"] = " ".join(filter(None, [str(make), str(model)])).strip()

                # Timestamp prefer original
                for tag in (0x9003, 0x9004, 0x0132):  # DateTimeOriginal, Digitized, Modify
                    val = exif.get(tag)
                    if val:
                        result["datetime_original"] = str(val).replace(":", "-", 2)  # make sortable-ish
                        break

                # GPS IFD (tag 34853)
                gps_ifd = exif.get(34853) or {}
                if isinstance(gps_ifd, dict) and gps_ifd:
                    lat = _dms_to_decimal(gps_ifd.get(2), gps_ifd.get(1))
                    lon = _dms_to_decimal(gps_ifd.get(4), gps_ifd.get(3))
                    if lat is not None and lon is not None:
                        result["latitude"] = lat
                        result["longitude"] = lon
                        result["has_gps"] = True

                    # Altitude (optional)
                    alt = _rational_to_float(gps_ifd.get(6))
                    if alt is not None:
                        alt_ref = gps_ifd.get(5)
                        if alt_ref in (1, b"\x01", "1"):
                            alt = -alt
                        result["altitude"] = round(alt, 1)

                    result["precision_note"] = "GPS detected" + (" + altitude" if "altitude" in result else "")

            # Always generate a thumbnail for UI (small JPEG)
            try:
                thumb = img.copy()
                thumb.thumbnail(THUMB_SIZE, Image.LANCZOS)
                thumb_path = p.parent / "thumbs" / f"{p.stem}_thumb.jpg"
                thumb_path.parent.mkdir(parents=True, exist_ok=True)
                thumb.convert("RGB").save(thumb_path, "JPEG", quality=75, optimize=True)
                result["thumb_path"] = str(thumb_path)
            except Exception as thumb_err:
                logger.debug(f"Thumb generation failed for {p.name}: {thumb_err}")

    except Exception as e:
        result["error"] = str(e)[:180]
        result["precision_note"] = f"Read error ({type(e).__name__})"
        logger.warning(f"Photo metadata extraction issue for {p.name}: {e}")

    return result


def is_supported_photo(path: Path) -> bool:
    return Path(path).suffix.lower() in SUPPORTED_EXTENSIONS


def compress_for_storage(path: Path, max_width: int = 1024, quality: int = 75) -> None:
    """Resize image to max_width and re-encode as JPEG in-place. Called after EXIF extraction."""
    try:
        with Image.open(path) as img:
            w, h = img.size
            if w > max_width:
                new_h = int(h * max_width / w)
                img = img.resize((max_width, new_h), Image.LANCZOS)
            img.convert("RGB").save(path, "JPEG", quality=quality, optimize=True)
    except Exception as e:
        logger.warning(f"Compression failed for {path.name}: {e}")
