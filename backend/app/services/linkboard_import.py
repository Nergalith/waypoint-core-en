from __future__ import annotations

import json
import zipfile
from io import BytesIO
from pathlib import PurePosixPath
from typing import Any


MAX_ARCHIVE_BYTES = 50 * 1024 * 1024
MAX_EXPANDED_BYTES = 100 * 1024 * 1024
MAX_ENTRIES = 10


class LinkBoardImportError(ValueError):
    pass


def parse_linkboard_handoff(content: bytes) -> dict[str, Any]:
    if not content or len(content) > MAX_ARCHIVE_BYTES:
        raise LinkBoardImportError("LinkBoard package is empty or exceeds 50 MB.")
    try:
        archive = zipfile.ZipFile(BytesIO(content))
    except zipfile.BadZipFile as exc:
        raise LinkBoardImportError("LinkBoard package is not a valid ZIP file.") from exc
    with archive:
        infos = archive.infolist()
        if not infos or len(infos) > MAX_ENTRIES or sum(info.file_size for info in infos) > MAX_EXPANDED_BYTES:
            raise LinkBoardImportError("LinkBoard package has too many files or is too large when expanded.")
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            raise LinkBoardImportError("LinkBoard package contains duplicate filenames.")
        for info in infos:
            path = PurePosixPath(info.filename)
            if info.flag_bits & 0x1 or path.is_absolute() or ".." in path.parts or len(path.parts) != 1:
                raise LinkBoardImportError("LinkBoard package contains an unsafe or encrypted file entry.")
        if "waypoint-attachment.json" not in names:
            raise LinkBoardImportError("Waypoint attachment manifest is missing.")
        manifest = _read_json(archive, "waypoint-attachment.json", "manifest")
        if manifest.get("format") != "WAYPOINT_ATTACHMENT" or manifest.get("attachment_type") != "link_analysis_report":
            raise LinkBoardImportError("Package is not a LinkBoard analysis handoff.")
        files = manifest.get("files") if isinstance(manifest.get("files"), dict) else {}
        report_name, case_name = files.get("report"), files.get("editable_case")
        if not isinstance(report_name, str) or not isinstance(case_name, str) or report_name not in names or case_name not in names:
            raise LinkBoardImportError("Manifest references missing report or case files.")
        if PurePosixPath(report_name).suffix.lower() != ".pdf" or not case_name.lower().endswith(".linkboard.json"):
            raise LinkBoardImportError("Manifest file types are invalid.")
        pdf = archive.read(report_name)
        if not pdf.startswith(b"%PDF"):
            raise LinkBoardImportError("Report file is not a valid PDF.")
        case = _read_json(archive, case_name, "editable case")
        if case.get("format") != "LINKBOARD_CASE" or not isinstance(case.get("nodes"), list) or not isinstance(case.get("edges"), list):
            raise LinkBoardImportError("Editable case is not a valid LINKBOARD_CASE package.")
        return {"manifest": manifest, "case": case, "pdf": pdf, "report_name": PurePosixPath(report_name).name, "case_name": PurePosixPath(case_name).name}


def _read_json(archive: zipfile.ZipFile, name: str, label: str) -> dict[str, Any]:
    try:
        value = json.loads(archive.read(name).decode("utf-8-sig"))
    except (KeyError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LinkBoardImportError(f"LinkBoard {label} is invalid JSON.") from exc
    if not isinstance(value, dict):
        raise LinkBoardImportError(f"LinkBoard {label} must be a JSON object.")
    return value
