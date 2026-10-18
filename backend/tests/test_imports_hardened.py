import io
import json
import os
import tempfile
import unittest
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from backend.app import database, main
from backend.app.routers import imports


def zip_bytes(entries: dict[str, bytes | str]) -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in entries.items():
            archive.writestr(name, content)
    return output.getvalue()


def wayfinder_json() -> dict:
    return {
        "format": "WAYFINDER",
        "schema_version": 1,
        "callsign": "EAGLE-2",
        "device_id": "device-007",
        "export_id": "export-abc",
        "map_package": {"name": "Nergalith Wayfinder - Sindh OSM"},
        "track_points": [
            {"latitude": 25.0, "longitude": 67.0, "timestamp": "2026-10-18T01:00:00Z"},
            {"latitude": 25.1, "longitude": 67.1, "timestamp": "2026-10-18T01:10:00Z"},
        ],
        "pins": [
            {"id": "pin-1", "latitude": 25.5, "longitude": 67.5, "label": "Water point", "category": "supply"},
        ],
        "patrol_sessions": [
            {"session_id": "session-1", "started_at": "2026-10-18T01:00:00Z", "ended_at": "2026-10-18T02:00:00Z"},
        ],
    }


class HardenedImporterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.original_database_path = database.DB_PATH
        self.original_import_path = imports.DB_PATH
        test_db = Path(self.temp.name) / "waypoint-test.db"
        database.DB_PATH = test_db
        imports.DB_PATH = test_db
        self.client_context = TestClient(main.app)
        self.client = self.client_context.__enter__()

    def tearDown(self):
        self.client_context.__exit__(None, None, None)
        database.DB_PATH = self.original_database_path
        imports.DB_PATH = self.original_import_path
        self.temp.cleanup()

    def db_rows(self, sql: str):
        with closing(database.get_connection()) as connection:
            return connection.execute(sql).fetchall()

    def test_native_wayfinder_keeps_pins_separate_and_imports_sessions_and_identity(self):
        data = json.dumps(wayfinder_json()).encode()
        response = self.client.post(
            "/api/imports/aar",
            files={"file": ("patrol.json", data, "application/json")},
        )

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["track_count"], 1)
        self.assertEqual(response.json()["pin_count"], 1)
        tracks = self.client.get("/api/tracks").json()
        self.assertEqual(tracks[0]["callsign"], "EAGLE-2")
        self.assertEqual(tracks[0]["device_id"], "device-007")
        self.assertEqual(tracks[0]["export_id"], "export-abc")
        self.assertEqual(tracks[0]["map_package_name"], "Nergalith Wayfinder - Sindh OSM")
        self.assertEqual(len(tracks[0]["geojson"]["coordinates"]), 2)
        self.assertEqual(len(tracks[0]["patrol_sessions"]), 1)
        pins = self.db_rows("SELECT latitude, longitude, label FROM map_pins WHERE source='wayfinder'")
        self.assertEqual([(row[0], row[1], row[2]) for row in pins], [(25.5, 67.5, "Water point")])
        self.assertEqual(len(self.db_rows("SELECT id FROM patrol_sessions")), 1)

    def test_wayfinder_duplicate_uses_export_and_device_not_filename(self):
        data = json.dumps(wayfinder_json()).encode()
        first = self.client.post("/api/imports/aar", files={"file": ("first.json", data, "application/json")})
        second = self.client.post("/api/imports/aar", files={"file": ("renamed.json", data, "application/json")})

        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 200)
        self.assertTrue(second.json()["skipped"])
        self.assertIn("already imported", second.json()["reason"].lower())
        self.assertEqual(len(self.db_rows("SELECT id FROM patrol_tracks")), 1)
        self.assertEqual(len(self.db_rows("SELECT id FROM map_pins WHERE source='wayfinder'")), 1)

    def test_gpx_waypoints_are_pins_not_track_points(self):
        gpx = b"""<?xml version='1.0'?><gpx version='1.1'>
          <wpt lat='25.5' lon='67.5'><name>Well</name></wpt>
          <trk><name>Patrol</name><trkseg>
            <trkpt lat='25.0' lon='67.0'/><trkpt lat='25.1' lon='67.1'/>
          </trkseg></trk></gpx>"""
        response = self.client.post("/api/imports/aar", files={"file": ("ALPHA.gpx", gpx, "application/gpx+xml")})

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["pin_count"], 1)
        track = json.loads(self.db_rows("SELECT geojson FROM patrol_tracks")[0][0])
        self.assertEqual(len(track["coordinates"]), 2)
        self.assertEqual(self.db_rows("SELECT label FROM map_pins WHERE source='gpx'")[0][0], "Well")

    def test_kml_points_are_pins_and_lines_are_tracks(self):
        kml = b"""<?xml version='1.0'?><kml xmlns='http://www.opengis.net/kml/2.2'><Document>
          <Placemark><name>Checkpoint</name><Point><coordinates>67.5,25.5,0</coordinates></Point></Placemark>
          <Placemark><name>Route</name><LineString><coordinates>67.0,25.0,0 67.1,25.1,0</coordinates></LineString></Placemark>
        </Document></kml>"""
        response = self.client.post("/api/imports/aar", files={"file": ("BRAVO.kml", kml, "application/vnd.google-earth.kml+xml")})

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["track_count"], 1)
        self.assertEqual(response.json()["pin_count"], 1)
        self.assertEqual(self.db_rows("SELECT label FROM map_pins WHERE source='kml'")[0][0], "Checkpoint")

    def test_field_node_duplicate_uses_report_and_device(self):
        report = {"report_id": "FN-42", "device_id": "field-device-1", "observer": "Scout", "notes": "Road clear"}
        bundle = zip_bytes({
            "manifest.json": json.dumps({"format": "FIELD_NODE", "device_id": "field-device-1"}),
            "report.json": json.dumps(report),
        })
        first = self.client.post("/api/imports/bundle", files={"file": ("first.zip", bundle, "application/zip")})
        second = self.client.post("/api/imports/bundle", files={"file": ("renamed.zip", bundle, "application/zip")})

        self.assertEqual(first.status_code, 200, first.text)
        self.assertTrue(second.json()["skipped"])
        self.assertIn("already imported", second.json()["reason"].lower())
        self.assertEqual(len(self.db_rows("SELECT id FROM lfi_reports WHERE fn_report_id='FN-42'")), 1)

    def test_field_node_without_device_uses_content_hash(self):
        report = {"report_id": "FN-NODEVICE", "notes": "Same content"}
        bundle = zip_bytes({
            "manifest.json": json.dumps({"format": "FIELD_NODE"}),
            "report.json": json.dumps(report),
        })
        first = self.client.post("/api/imports/bundle", files={"file": ("first.zip", bundle, "application/zip")})
        second = self.client.post("/api/imports/bundle", files={"file": ("second.zip", bundle, "application/zip")})

        self.assertEqual(first.status_code, 200)
        self.assertTrue(second.json()["skipped"])
        self.assertEqual(len(self.db_rows("SELECT id FROM lfi_reports WHERE fn_report_id='FN-NODEVICE'")), 1)

    def test_oversized_import_returns_413(self):
        with patch.dict(os.environ, {"WAYPOINT_MAX_IMPORT_MB": "1"}):
            response = self.client.post(
                "/api/imports/aar",
                files={"file": ("large.json", b"x" * (1024 * 1024 + 1), "application/json")},
            )
        self.assertEqual(response.status_code, 413)

    def test_zip_with_parent_path_is_rejected(self):
        malicious = zip_bytes({
            "manifest.json": json.dumps({"format": "WAYFINDER"}),
            "../escape.json": json.dumps(wayfinder_json()),
        })
        response = self.client.post(
            "/api/imports/bundle",
            files={"file": ("malicious.zip", malicious, "application/zip")},
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("unsafe", response.json()["detail"].lower())


if __name__ == "__main__":
    unittest.main()
