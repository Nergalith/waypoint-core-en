from __future__ import annotations

import hashlib
import os
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from threading import RLock

from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.responses import Response

router = APIRouter()
ROOT_DIR = Path(__file__).resolve().parents[3]
MAPS_DIR = Path(os.getenv("WAYPOINT_MAPS_DIR", str(ROOT_DIR / "backend" / "maps")))
SUPPORTED_FORMATS = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}
DEFAULT_MAX_MAP_MB = 2048

_maps: dict[str, dict] = {}
_lock = RLock()


def _readonly_uri(path: Path) -> str:
    return Path(path).resolve().as_uri() + "?mode=ro"


def _slug(value: str) -> str:
    cleaned = re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")
    return cleaned or "map"


def _read_metadata(path: Path) -> dict:
    try:
        with closing(sqlite3.connect(_readonly_uri(path), uri=True, check_same_thread=False)) as conn:
            tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {"metadata", "tiles"}.issubset(tables):
                raise ValueError("Not a valid MBTiles file")
            values = dict(conn.execute("SELECT name, value FROM metadata").fetchall())
    except (sqlite3.Error, ValueError) as exc:
        raise ValueError(f"Could not read MBTiles metadata: {exc}") from exc

    tile_format = str(values.get("format", "png")).lower()
    if tile_format not in SUPPORTED_FORMATS:
        raise ValueError("Only PNG and JPEG raster MBTiles maps are supported")

    bounds = None
    if values.get("bounds"):
        try:
            parsed = [float(value.strip()) for value in str(values["bounds"]).split(",")]
            if len(parsed) == 4:
                bounds = parsed
        except ValueError:
            bounds = None

    def integer(name: str, default: int) -> int:
        try:
            return int(values.get(name, default))
        except (TypeError, ValueError):
            return default

    return {
        "name": str(values.get("name") or path.stem),
        "bounds": bounds,
        "minzoom": integer("minzoom", 0),
        "maxzoom": integer("maxzoom", 18),
        "format": "jpeg" if tile_format in {"jpg", "jpeg"} else "png",
        "scheme": "xyz" if str(values.get("scheme", "tms")).lower() == "xyz" else "tms",
    }


def scan_maps() -> list[dict]:
    """Rebuild the in-memory map registry from backend/maps/*.mbtiles."""
    MAPS_DIR.mkdir(parents=True, exist_ok=True)
    discovered: dict[str, dict] = {}
    for path in sorted(MAPS_DIR.glob("*.mbtiles"), key=lambda item: item.name.casefold()):
        try:
            metadata = _read_metadata(path)
        except ValueError:
            continue
        map_id = _slug(path.stem)
        if map_id in discovered:
            suffix = hashlib.sha1(path.name.encode("utf-8")).hexdigest()[:8]
            map_id = f"{map_id}-{suffix}"
        discovered[map_id] = {"id": map_id, **metadata, "path": path}
    with _lock:
        _maps.clear()
        _maps.update(discovered)
    return [_public_map(item) for item in discovered.values()]


def _public_map(item: dict) -> dict:
    return {key: value for key, value in item.items() if key != "path"}


def _get_map(map_id: str) -> dict:
    with _lock:
        item = _maps.get(map_id)
    if item is None:
        scan_maps()
        with _lock:
            item = _maps.get(map_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Map not found")
    return item


@router.get("/api/maps")
def list_maps():
    return scan_maps()


@router.post("/api/maps", status_code=status.HTTP_201_CREATED)
async def add_map(file: UploadFile = File(...)):
    original_name = Path(file.filename or "map.mbtiles").name
    if Path(original_name).suffix.lower() != ".mbtiles":
        raise HTTPException(status_code=400, detail="Choose an .mbtiles map file")

    MAPS_DIR.mkdir(parents=True, exist_ok=True)
    safe_stem = re.sub(r"[^A-Za-z0-9._ -]+", "_", Path(original_name).stem).strip(" .") or "map"
    destination = MAPS_DIR / f"{safe_stem}.mbtiles"
    counter = 2
    while destination.exists():
        destination = MAPS_DIR / f"{safe_stem}-{counter}.mbtiles"
        counter += 1
    temporary = destination.with_suffix(".uploading")
    try:
        max_map_mb = max(1, int(os.getenv("WAYPOINT_MAX_MAP_MB", str(DEFAULT_MAX_MAP_MB))))
    except ValueError:
        max_map_mb = DEFAULT_MAX_MAP_MB
    max_bytes = max_map_mb * 1024 * 1024

    try:
        bytes_written = 0
        with temporary.open("wb") as output:
            while chunk := await file.read(1024 * 1024):
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    raise HTTPException(
                        status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                        detail=f"Map is larger than the {max_map_mb} MB limit",
                    )
                output.write(chunk)
        _read_metadata(temporary)
        os.replace(temporary, destination)
    except HTTPException:
        raise
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail="Could not copy the map file") from exc
    finally:
        temporary.unlink(missing_ok=True)
        await file.close()

    maps = scan_maps()
    created = next((item for item in maps if _get_map(item["id"])["path"] == destination), None)
    if created is None:
        raise HTTPException(status_code=500, detail="Map was copied but could not be opened")
    return created


def _tile_response(item: dict, z: int, x: int, y: int) -> Response:
    if z < 0 or x < 0 or y < 0 or x >= 2**z or y >= 2**z:
        raise HTTPException(status_code=404, detail="Tile not found")
    stored_y = y if item["scheme"] == "xyz" else (2**z - 1) - y
    try:
        with closing(sqlite3.connect(_readonly_uri(item["path"]), uri=True, check_same_thread=False)) as conn:
            row = conn.execute(
                "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
                (z, x, stored_y),
            ).fetchone()
    except sqlite3.Error as exc:
        raise HTTPException(status_code=500, detail="Could not read map tiles") from exc
    if row is None:
        raise HTTPException(status_code=404, detail="Tile not found")
    return Response(
        content=row[0],
        media_type=SUPPORTED_FORMATS[item["format"]],
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.get("/api/tiles/{map_id}/{z}/{x}/{y}")
def get_tile(map_id: str, z: int, x: int, y: int):
    return _tile_response(_get_map(map_id), z, x, y)


@router.get("/api/mbtiles/{z}/{x}/{y}")
def get_legacy_tile(z: int, x: int, y: int):
    with _lock:
        item = next(iter(_maps.values()), None)
    if item is None:
        raise HTTPException(status_code=404, detail="No MBTiles map loaded")
    return _tile_response(item, z, x, y)
