import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.app.routers import tiles


PNG_TILE = b"\x89PNG\r\n\x1a\nfixture"


def create_mbtiles(path: Path, *, name="Fixture Map", scheme="tms", tile_format="png") -> Path:
    with closing(sqlite3.connect(path)) as connection:
        connection.executescript(
            """
            CREATE TABLE metadata (name TEXT, value TEXT);
            CREATE TABLE tiles (
                zoom_level INTEGER,
                tile_column INTEGER,
                tile_row INTEGER,
                tile_data BLOB,
                UNIQUE (zoom_level, tile_column, tile_row)
            );
            """
        )
        connection.executemany(
            "INSERT INTO metadata (name, value) VALUES (?, ?)",
            [
                ("name", name), ("bounds", "66.0,24.0,71.0,28.0"),
                ("minzoom", "1"), ("maxzoom", "1"),
                ("format", tile_format), ("scheme", scheme),
            ],
        )
        connection.execute("INSERT INTO tiles VALUES (1, 0, 1, ?)", (PNG_TILE,))
        connection.commit()
    return path


class MapApiTestClientTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.original_maps_dir = tiles.MAPS_DIR
        tiles.MAPS_DIR = Path(self.temp.name)
        tiles.scan_maps()
        app = FastAPI()
        app.include_router(tiles.router)
        self.client = TestClient(app)

    def tearDown(self):
        self.client.close()
        tiles.MAPS_DIR = self.original_maps_dir
        tiles.scan_maps()
        self.temp.cleanup()

    def fixture_bytes(self, **kwargs) -> bytes:
        fixture = tiles.MAPS_DIR / "source-fixture.mbtiles"
        create_mbtiles(fixture, **kwargs)
        data = fixture.read_bytes()
        fixture.unlink()
        return data

    def test_list_and_tile_endpoints(self):
        create_mbtiles(tiles.MAPS_DIR / "sindh.mbtiles", name="Sindh Offline")
        maps = self.client.get("/api/maps")
        tile = self.client.get("/api/tiles/sindh/1/0/0")

        self.assertEqual(maps.status_code, 200)
        self.assertEqual(maps.json()[0]["name"], "Sindh Offline")
        self.assertEqual(tile.status_code, 200)
        self.assertEqual(tile.content, PNG_TILE)
        self.assertEqual(tile.headers["cache-control"], "public, max-age=86400")

    def test_filename_with_hash_is_opened_through_encoded_readonly_uri(self):
        create_mbtiles(tiles.MAPS_DIR / "Map #2.mbtiles", name="Map Number Two")

        maps = self.client.get("/api/maps")
        tile = self.client.get("/api/tiles/map-2/1/0/0")

        self.assertEqual(maps.status_code, 200)
        self.assertEqual(maps.json()[0]["name"], "Map Number Two")
        self.assertEqual(tile.status_code, 200)
        self.assertEqual(tile.content, PNG_TILE)

    def test_upload_valid_map_rescans_registry(self):
        self.assertEqual(self.client.get("/api/maps").json(), [])
        response = self.client.post(
            "/api/maps",
            files={"file": ("Patrol Map.mbtiles", self.fixture_bytes(name="Patrol Map"), "application/octet-stream")},
        )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["name"], "Patrol Map")
        self.assertEqual([item["id"] for item in self.client.get("/api/maps").json()], ["patrol-map"])
        self.assertFalse(any(tiles.MAPS_DIR.glob("*.uploading")))

    def test_upload_invalid_map_is_rejected_and_cleaned_up(self):
        response = self.client.post(
            "/api/maps",
            files={"file": ("broken.mbtiles", b"not sqlite", "application/octet-stream")},
        )

        self.assertEqual(response.status_code, 400)
        self.assertFalse(any(tiles.MAPS_DIR.iterdir()))

    def test_upload_strips_traversal_filename(self):
        response = self.client.post(
            "/api/maps",
            files={"file": ("../../outside.mbtiles", self.fixture_bytes(), "application/octet-stream")},
        )

        self.assertEqual(response.status_code, 201)
        self.assertTrue((tiles.MAPS_DIR / "outside.mbtiles").is_file())
        self.assertFalse((tiles.MAPS_DIR.parent / "outside.mbtiles").exists())

    def test_upload_enforces_size_limit(self):
        with patch.dict(os.environ, {"WAYPOINT_MAX_MAP_MB": "1"}):
            response = self.client.post(
                "/api/maps",
                files={"file": ("large.mbtiles", b"x" * (1024 * 1024 + 1), "application/octet-stream")},
            )

        self.assertEqual(response.status_code, 413)
        self.assertFalse(any(tiles.MAPS_DIR.iterdir()))

    def test_missing_map_and_tile_return_404(self):
        missing_map = self.client.get("/api/tiles/not-installed/1/0/0")
        create_mbtiles(tiles.MAPS_DIR / "sindh.mbtiles")
        tiles.scan_maps()
        missing_tile = self.client.get("/api/tiles/sindh/1/1/1")

        self.assertEqual(missing_map.status_code, 404)
        self.assertEqual(missing_tile.status_code, 404)


if __name__ == "__main__":
    unittest.main()
