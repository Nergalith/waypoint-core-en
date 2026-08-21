import asyncio
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from starlette.datastructures import UploadFile

from backend.app import database, main
from backend.app.services.linkboard_import import LinkBoardImportError, parse_linkboard_handoff


def make_handoff(extra_entries=None):
    manifest = {"format": "WAYPOINT_ATTACHMENT", "version": "1.0.0", "attachment_type": "link_analysis_report", "title": "Route Network", "reference": "LB-TEST-01", "analyst": "Test Analyst", "files": {"report": "route-network.pdf", "editable_case": "route-network.linkboard.json"}}
    case = {"format": "LINKBOARD_CASE", "version": "1.0.0", "case": {"title": "Route Network", "summary": "Test summary", "findings": "Test finding"}, "nodes": [{"id": "n1"}, {"id": "n2"}], "edges": [{"id": "e1", "source": "n1", "target": "n2"}]}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("waypoint-attachment.json", json.dumps(manifest))
        archive.writestr("route-network.pdf", b"%PDF-1.4\n%%EOF")
        archive.writestr("route-network.linkboard.json", json.dumps(case))
        for name, content in extra_entries or []:
            archive.writestr(name, content)
    return output.getvalue()


class LinkBoardImportTests(unittest.TestCase):
    def test_parser_rejects_nested_archive_entry(self):
        with self.assertRaises(LinkBoardImportError):
            parse_linkboard_handoff(make_handoff([("nested/extra.txt", "unsafe")]))

    def test_import_preserves_report_and_case_and_links_report(self):
        temp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        original_db_path, original_documents_dir = database.DB_PATH, main.DOCUMENTS_DIR
        try:
            database.DB_PATH = Path(temp.name) / "waypoint-test.db"
            main.DOCUMENTS_DIR = Path(temp.name) / "documents"
            database.init_db()
            with database.get_connection() as connection:
                cursor = connection.execute("INSERT INTO lfi_reports (report_number) VALUES (?)", ("RPT-TEST",))
                report_id = cursor.lastrowid
            upload = UploadFile(file=io.BytesIO(make_handoff()), filename="handoff.zip")
            result = asyncio.run(main.import_linkboard_package(upload, str(report_id)))
            document = result["document"]
            self.assertEqual(result["linked_report_id"], report_id)
            self.assertEqual(result["title"], "Route Network")
            self.assertEqual(document["extraction_status"], "linkboard_report")
            self.assertTrue(Path(document["stored_path"]).is_file())
            self.assertTrue(Path(document["clues"]["linkboard"]["case_path"]).is_file())
            self.assertEqual(document["clues"]["linkboard"]["node_count"], 2)
            with database.get_connection() as connection:
                link = connection.execute("SELECT * FROM links WHERE target_id = ?", (str(document["id"]),)).fetchone()
            self.assertIsNotNone(link)
            self.assertEqual(link["source_id"], str(report_id))
        finally:
            database.DB_PATH, main.DOCUMENTS_DIR = original_db_path, original_documents_dir
            temp.cleanup()


if __name__ == "__main__":
    unittest.main()
