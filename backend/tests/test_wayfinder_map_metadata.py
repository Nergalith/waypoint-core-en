import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import database, main
from backend.app.routers import imports


def make_wayfinder_bundle() -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", json.dumps({
            "format": "WAYFINDER",
            "map_package": {"name": "Nergalith Wayfinder - Sindh OSM"},
        }))
        archive.writestr("route.geojson", json.dumps({
            "type": "LineString",
            "coordinates": [[67.0, 25.0], [67.1, 25.1]],
        }))
    return output.getvalue()


class WayfinderMapMetadataTests(unittest.TestCase):
    def test_wayfinder_import_stores_map_package_name(self):
        temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        original_database_path = database.DB_PATH
        original_import_path = imports.DB_PATH
        try:
            test_db = Path(temp.name) / "waypoint-test.db"
            database.DB_PATH = test_db
            imports.DB_PATH = test_db
            with TestClient(main.app) as client:
                response = client.post(
                    "/api/imports/bundle",
                    files={"file": ("Wayfinder_ALPHA_test.zip", make_wayfinder_bundle(), "application/zip")},
                )
                tracks = client.get("/api/tracks")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(tracks.status_code, 200)
            self.assertEqual(tracks.json()[0]["map_package_name"], "Nergalith Wayfinder - Sindh OSM")
        finally:
            database.DB_PATH = original_database_path
            imports.DB_PATH = original_import_path
            temp.cleanup()


if __name__ == "__main__":
    unittest.main()
