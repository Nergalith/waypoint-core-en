import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from backend.app.routers import tiles


PNG_TILE = b"\x89PNG\r\n\x1a\nfixture"


def create_mbtiles(path: Path, *, name="Fixture Map", scheme="tms", tile_format="png") -> Path:
    """Create the tiny MBTiles fixture used by the map API tests."""
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
                ("name", name),
                ("bounds", "66.0,24.0,71.0,28.0"),
                ("minzoom", "1"),
                ("maxzoom", "1"),
                ("format", tile_format),
                ("scheme", scheme),
            ],
        )
        # XYZ y=0 is stored at TMS row 1 when z=1.
        connection.execute("INSERT INTO tiles VALUES (1, 0, 1, ?)", (PNG_TILE,))
        connection.commit()
    return path


class MapApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.original_maps_dir = tiles.MAPS_DIR
        tiles.MAPS_DIR = Path(self.temp.name)

    def tearDown(self):
        tiles.MAPS_DIR = self.original_maps_dir
        tiles.scan_maps()
        self.temp.cleanup()

    def test_list_endpoint_returns_mbtiles_metadata(self):
        create_mbtiles(tiles.MAPS_DIR / "sindh.mbtiles", name="Nergalith Wayfinder - Sindh OSM")

        maps = tiles.list_maps()

        self.assertEqual(len(maps), 1)
        self.assertEqual(maps[0]["id"], "sindh")
        self.assertEqual(maps[0]["name"], "Nergalith Wayfinder - Sindh OSM")
        self.assertEqual(maps[0]["bounds"], [66.0, 24.0, 71.0, 28.0])
        self.assertEqual(maps[0]["minzoom"], 1)
        self.assertEqual(maps[0]["maxzoom"], 1)
        self.assertEqual(maps[0]["format"], "png")

    def test_tile_endpoint_converts_xyz_request_to_tms_row(self):
        create_mbtiles(tiles.MAPS_DIR / "sindh.mbtiles")
        tiles.scan_maps()

        response = tiles.get_tile("sindh", 1, 0, 0)

        self.assertEqual(response.body, PNG_TILE)
        self.assertEqual(response.media_type, "image/png")

    def test_xyz_jpeg_tiles_keep_the_requested_row_and_content_type(self):
        path = create_mbtiles(tiles.MAPS_DIR / "photo-map.mbtiles", scheme="xyz", tile_format="jpg")
        with closing(sqlite3.connect(path)) as connection:
            connection.execute("UPDATE tiles SET tile_data = ?", (b"\xff\xd8fixture\xff\xd9",))
            connection.commit()
        tiles.scan_maps()

        response = tiles.get_tile("photo-map", 1, 0, 1)

        self.assertEqual(response.body, b"\xff\xd8fixture\xff\xd9")
        self.assertEqual(response.media_type, "image/jpeg")


if __name__ == "__main__":
    unittest.main()
