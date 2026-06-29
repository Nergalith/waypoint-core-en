from __future__ import annotations

import os
import sqlite3
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

router = APIRouter()
ROOT_DIR = Path(__file__).resolve().parents[3]
MBTILES_PATH = Path(os.getenv("MBTILES_PATH", str(ROOT_DIR / "backend" / "maps" / "region.mbtiles")))


@router.get("/api/mbtiles/{z}/{x}/{y}")
def get_tile(z: int, x: int, y: int):
    if not MBTILES_PATH.exists():
        raise HTTPException(status_code=404, detail="No MBTiles map loaded")
    try:
        conn = sqlite3.connect(MBTILES_PATH)
        tms_y = (2 ** z - 1) - y
        row = conn.execute(
            "SELECT tile_data FROM tiles WHERE zoom_level=? AND tile_column=? AND tile_row=?",
            (z, x, tms_y),
        ).fetchone()
        conn.close()
        if not row:
            raise HTTPException(status_code=404, detail="Tile not found")
        return Response(content=row[0], media_type="image/png")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
