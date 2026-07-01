from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    HRFlowable, Image, Paragraph, SimpleDocTemplate, Spacer,
)

# Offline map rendering (Pillow already a backend dep via photo processor; stdlib json)
import json
import logging
from io import BytesIO
try:
    from PIL import Image as PILImage, ImageDraw, ImageFont, ImageOps
    _HAS_RENDER_DEPS = True
except Exception:
    _HAS_RENDER_DEPS = False

ROOT_DIR = Path(__file__).resolve().parents[3]
REPORTS_DIR = ROOT_DIR / "Waypoint Reports"
logger = logging.getLogger(__name__)

MONTH_ABBREV = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

# ---------------------------------------------------------------------------
# Font registration - Arial TTF for full Latin-extended / UTF-8 support.
# Falls back to built-in Helvetica if the system font is missing.
# ---------------------------------------------------------------------------

def _init_fonts() -> tuple[str, str]:
    windir = os.environ.get("WINDIR", "C:\\Windows")
    regular = os.path.join(windir, "Fonts", "arial.ttf")
    bold    = os.path.join(windir, "Fonts", "arialbd.ttf")
    try:
        pdfmetrics.registerFont(TTFont("WPT-Regular", regular))
        pdfmetrics.registerFont(TTFont("WPT-Bold",    bold))
        pdfmetrics.registerFontFamily("WPT", normal="WPT-Regular", bold="WPT-Bold")
        return "WPT-Regular", "WPT-Bold"
    except Exception:
        return "Helvetica", "Helvetica-Bold"


_FONT_REGULAR, _FONT_BOLD = _init_fonts()

# ---------------------------------------------------------------------------
# Localised strings
# ---------------------------------------------------------------------------

_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "header_single": "WAYPOINT CORE - Field Report",
        "header_bundle": "WAYPOINT CORE - Bundled Report",
        "generated_on": "report(s) - generated",
        "finalized": "FINALIZED",
        "who": "Who involved",
        "what": "What happened",
        "where": "Where",
        "when": "When (field)",
        "notes": "Notes",
        "related": "Related to",
        "reliability": "Source reliability",
        "coords": "GPS coordinates",
        "linked_objects": "Linked objects",
        "linked_photos": "Linked photos",
        "report_number":  "Report number",
        "created":        "Created",
        "last_edited":    "Last edited",
        "reopened":       "Reopened",
    },
}

_RELIABILITY_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "A": "A - Reliable source",
        "B": "B - Usually reliable",
        "C": "C - Fairly reliable",
        "D": "D - Not usually reliable",
        "E": "E - Unreliable",
        "F": "F - Reliability unknown",
    },
}


def _lbl(lang: str) -> dict[str, str]:
    return _LABELS.get(lang, _LABELS["en"])


def _rel_labels(lang: str) -> dict[str, str]:
    return _RELIABILITY_LABELS.get(lang, _RELIABILITY_LABELS["en"])


_REPORT_TYPE_LABELS: dict[str, dict[str, str]] = {
    "en": {
        "Observation": "Observation",
        "Patrol": "Patrol",
        "Rumor/Witness": "Rumor/Witness",
        "Rumor": "Rumor",
        "Witness": "Witness",
        "Contact Report": "Contact Report",
        "Contact": "Contact Report",
        "Checkpoint": "Checkpoint",
    },
}


def _report_type_label(report_type: str, lang: str) -> str:
    labels = _REPORT_TYPE_LABELS.get(lang, _REPORT_TYPE_LABELS["en"])
    return labels.get(report_type, report_type or "Observation")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ensure_reports_dir(year: int, month: int) -> Path:
    folder = REPORTS_DIR / str(year) / f"{month:02d}"
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def get_reports_dir_size() -> int:
    total = 0
    if not REPORTS_DIR.exists():
        return 0
    for p in REPORTS_DIR.rglob("*"):
        if p.is_file():
            try:
                total += p.stat().st_size
            except OSError:
                pass
    return total


def _parse_dt(date_str: str) -> datetime:
    try:
        return datetime.fromisoformat(date_str.rstrip("Z"))
    except Exception:
        return datetime.utcnow()


def _filename_date(date_str: str) -> str:
    dt = _parse_dt(date_str)
    return f"{dt.day:02d}{MONTH_ABBREV[dt.month - 1]}{str(dt.year)[2:]}"


def _single_filename(report_id: int, report_number: str | None, report_type: str, date_str: str) -> str:
    safe_type = report_type.replace(" ", "")[:20]
    base = report_number or f"RPT-{report_id:03d}"
    return f"{base}_{safe_type}_{_filename_date(date_str)}.pdf"


def _bundle_filename(count: int) -> str:
    return f"RPT-BUNDLE_{count}rpts_{_filename_date(datetime.utcnow().isoformat())}.pdf"


def _make_styles() -> dict:
    base = getSampleStyleSheet()
    f = _FONT_REGULAR
    fb = _FONT_BOLD
    return {
        "title":  ParagraphStyle("wpt_title",  parent=base["Normal"], fontName=fb,  fontSize=14, spaceAfter=2,  textColor=colors.HexColor("#111827")),
        "h1":     ParagraphStyle("wpt_h1",     parent=base["Normal"], fontName=fb,  fontSize=13, spaceAfter=2,  textColor=colors.HexColor("#111827")),
        "h2":     ParagraphStyle("wpt_h2",     parent=base["Normal"], fontName=fb,  fontSize=12, spaceAfter=2,  textColor=colors.HexColor("#111827")),
        "normal": ParagraphStyle("wpt_normal", parent=base["Normal"], fontName=f,   fontSize=10, spaceAfter=1),
        "label":  ParagraphStyle("wpt_label",  parent=base["Normal"], fontName=f,   fontSize=9,  spaceBefore=3, textColor=colors.HexColor("#6b7280")),
        "small":  ParagraphStyle("wpt_small",  parent=base["Normal"], fontName=f,   fontSize=9,  textColor=colors.HexColor("#374151")),
        "muted":  ParagraphStyle("wpt_muted",  parent=base["Normal"], fontName=f,   fontSize=10, textColor=colors.HexColor("#6b7280")),
        "locked": ParagraphStyle("wpt_locked", parent=base["Normal"], fontName=fb,  fontSize=9,  textColor=colors.HexColor("#16a34a")),
    }


def _build_doc(path: Path) -> SimpleDocTemplate:
    return SimpleDocTemplate(
        str(path), pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=20 * mm, bottomMargin=20 * mm,
    )


# ---------------------------------------------------------------------------
# Offline static GPS map renderer (Pillow).
# Bounds come only from report pins and patrol tracks, never from background map data.
# ---------------------------------------------------------------------------

def _render_static_map(points: list[tuple[float, float, str]], tracks: list | None = None, width: int = 640, height: int = 360) -> bytes | None:
    """Return PNG bytes for an offline overview map with report pins and patrol tracks."""
    if not _HAS_RENDER_DEPS:
        return None

    points = points or []
    tracks = tracks or []
    track_lines: list[tuple[str, list[tuple[float, float]]]] = []
    for track in tracks:
        callsign = str(track.get("callsign") or "UNKNOWN")
        geojson_raw = track.get("geojson")
        try:
            geojson = json.loads(geojson_raw) if isinstance(geojson_raw, str) else (geojson_raw or {})
            coords = geojson.get("coordinates", [])
            line = []
            for coord in coords:
                if len(coord) >= 2:
                    line.append((float(coord[0]), float(coord[1])))
            if len(line) >= 2:
                track_lines.append((callsign, line))
        except Exception as exc:
            logger.warning("Track render failed for %s: %s", callsign, exc)

    all_lons: list[float] = []
    all_lats: list[float] = []
    for lat, lon, _ in points:
        try:
            all_lons.append(float(lon))
            all_lats.append(float(lat))
        except Exception:
            pass
    for _, line in track_lines:
        for lon, lat in line:
            all_lons.append(lon)
            all_lats.append(lat)

    W, H = int(width), int(height)
    img = PILImage.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)
    font = ImageFont.load_default()

    if not all_lons or not all_lats:
        draw.text((W // 2 - 48, H // 2), "No map data available", fill=(110, 110, 110), font=font)
        bio = BytesIO()
        img.save(bio, format="PNG")
        return bio.getvalue()

    pad_lon = max((max(all_lons) - min(all_lons)) * 0.08, 0.05)
    pad_lat = max((max(all_lats) - min(all_lats)) * 0.08, 0.05)
    min_lon = min(all_lons) - pad_lon
    max_lon = max(all_lons) + pad_lon
    min_lat = min(all_lats) - pad_lat
    max_lat = max(all_lats) + pad_lat
    if max_lon == min_lon:
        max_lon += 0.05
        min_lon -= 0.05
    if max_lat == min_lat:
        max_lat += 0.05
        min_lat -= 0.05

    margin = 18

    def proj(lon: float, lat: float):
        x = margin + (float(lon) - min_lon) / (max_lon - min_lon) * (W - 2 * margin)
        y = margin + (max_lat - float(lat)) / (max_lat - min_lat) * (H - 2 * margin)
        return int(max(margin, min(W - margin, x))), int(max(margin, min(H - margin, y)))

    track_colors = [(255, 107, 53), (0, 191, 255), (124, 252, 0), (255, 215, 0), (255, 105, 180), (129, 140, 248)]
    for idx, (callsign, line) in enumerate(track_lines):
        color = track_colors[idx % len(track_colors)]
        pixels = [proj(lon, lat) for lon, lat in line]
        if len(pixels) >= 2:
            draw.line(pixels, fill=color, width=5)
            lx, ly = pixels[-1]
            draw.text((lx + 4, ly - 6), callsign[:12], fill=color, font=font)

    for lat, lon, label in points:
        try:
            px, py = proj(float(lon), float(lat))
            draw.polygon([(px, py + 14), (px - 9, py - 6), (px + 9, py - 6)], fill=(200, 30, 30), outline=(90, 20, 20))
            lab = str(label or "")[:12]
            if lab:
                draw.text((px + 7, py - 8), lab, fill=(20, 20, 20), font=font)
        except Exception:
            continue

    try:
        draw.text((6, 4), "Area of Operations", fill=(70, 70, 70), font=font)
    except Exception:
        pass

    bio = BytesIO()
    img.save(bio, format="PNG")
    return bio.getvalue()

def _photo_flowable(path: str | Path, width: float):
    if not _HAS_RENDER_DEPS:
        return None
    image_path = Path(path)
    if not image_path.exists():
        return None
    try:
        with PILImage.open(image_path) as img:
            img = ImageOps.exif_transpose(img)
            out = BytesIO()
            img.convert("RGB").save(out, format="JPEG", quality=85, optimize=True)
            out.seek(0)
            return Image(out, width=width)
    except Exception as exc:
        logger.warning("PDF photo orientation/render failed for %s: %s", image_path, exc)
        return None

# ---------------------------------------------------------------------------
# Story builder
# ---------------------------------------------------------------------------

def _report_story(
    report: dict[str, Any],
    photos: list,
    links: list,
    styles: dict,
    lbl: dict[str, str],
    rel_lbl: dict[str, str],
    as_section: bool = False,
    include_individual_map: bool = True,
    lang: str = "en",
) -> list:
    story: list = []
    heading = styles["h2"] if as_section else styles["h1"]

    rid     = report.get("id", "?")
    rnum    = report.get("report_number") or f"RPT-{int(rid):03d}" if str(rid).isdigit() else f"RPT-{rid}"
    rtype   = report.get("report_type", "")
    rtype_display = _report_type_label(rtype, lang)
    created = report.get("created_at", "")
    date_display = created.replace("T", " ").replace("Z", "") if created else ""

    story.append(Paragraph(f"{rnum} - {rtype_display}", heading))
    if date_display:
        story.append(Paragraph(date_display, styles["muted"]))

    # Four timestamps (audit trail)
    c_ts = (report.get("created_at") or "").replace("T", " ").replace("Z", "")
    if c_ts:
        story.append(Paragraph(f"{lbl.get('created', 'Created')}: {c_ts}", styles["small"]))
    le = (report.get("last_edited_at") or "").replace("T", " ").replace("Z", "")
    if le:
        story.append(Paragraph(f"{lbl.get('last_edited', 'Last edited')}: {le}", styles["small"]))
    if report.get("status") == "finalized":
        fin = (report.get("finalized_at") or "").replace("T", " ").replace("Z", "")
        story.append(Paragraph(f"{lbl['finalized']} - {fin}", styles["locked"]))
    ro = (report.get("reopened_at") or "").replace("T", " ").replace("Z", "")
    if ro:
        story.append(Paragraph(f"{lbl.get('reopened', 'Reopened')}: {ro}", styles["small"]))

    story.append(Spacer(1, 4 * mm))

    text_fields = [
        (lbl["who"],     "who_involved"),
        (lbl["what"],    "what_happened"),
        (lbl["where"],   "where_happened"),
        (lbl["when"],    "when_happened"),
        (lbl["notes"],   "notes"),
        (lbl["related"], "related_to"),
    ]
    for field_label, key in text_fields:
        val = (report.get(key) or "").strip()
        if val:
            story.append(Paragraph(field_label, styles["label"]))
            story.append(Paragraph(val, styles["normal"]))

    story.append(Spacer(1, 3 * mm))
    rel = (report.get("source_reliability") or "F").upper()
    story.append(Paragraph(lbl["reliability"], styles["label"]))
    story.append(Paragraph(rel_lbl.get(rel, f"{rel}"), styles["normal"]))

    lat = report.get("latitude")
    lon = report.get("longitude")
    if lat is not None and lon is not None:
        story.append(Paragraph(lbl["coords"], styles["label"]))
        story.append(Paragraph(f"{lat:.5f}, {lon:.5f}", styles["normal"]))

    # Embed a small offline coordinate plot at this report's location.
    if include_individual_map and lat is not None and lon is not None:
        try:
            png = _render_static_map([(lat, lon, str(rnum))])
            if not png:
                raise RuntimeError("static map returned no image")
            story.append(Spacer(1, 2 * mm))
            story.append(Image(BytesIO(png), width=58 * mm, height=33 * mm))
            story.append(Spacer(1, 1 * mm))
        except Exception as e:
            logger.error(f"PDF map render failed: {e}")
            raise

    if links:
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(lbl["linked_objects"], styles["label"]))
        for lk in links:
            src      = lk.get("source_label", "")
            tgt      = lk.get("target_label", "")
            rel_type = lk.get("relationship_type", "")
            story.append(Paragraph(f"| {src}  ->  {rel_type}  ->  {tgt}", styles["small"]))

    if photos:
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(lbl["linked_photos"], styles["label"]))
        story.append(Spacer(1, 2 * mm))
        for ph in photos:
            image_path = ph.get("thumb_path") or ph.get("stored_path")
            flowable = _photo_flowable(image_path, width=40 * mm) if image_path else None
            if flowable:
                fname = ph.get("original_filename", "")
                gps = ""
                if ph.get("latitude") and ph.get("longitude"):
                    gps = f"  {ph['latitude']:.4f}, {ph['longitude']:.4f}"
                story.append(flowable)
                story.append(Paragraph(f"{fname}{gps}", styles["small"]))
                story.append(Spacer(1, 2 * mm))

    return story


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_single_pdf(report: dict[str, Any], photos: list, links: list, lang: str = "en") -> Path:
    created = report.get("created_at", datetime.utcnow().isoformat())
    dt      = _parse_dt(created)
    folder  = ensure_reports_dir(dt.year, dt.month)
    rnum    = report.get("report_number")
    path    = folder / _single_filename(report.get("id", 0), rnum, report.get("report_type", "Report"), created)

    lbl     = _lbl(lang)
    rel_lbl = _rel_labels(lang)
    styles  = _make_styles()
    doc     = _build_doc(path)
    story   = [
        Paragraph(lbl["header_single"], styles["title"]),
        Spacer(1, 6 * mm),
    ]
    story  += _report_story(report, photos, links, styles, lbl, rel_lbl, lang=lang)
    doc.build(story)
    return path


def _normalize_sections(sections: dict | None) -> dict[str, bool]:
    defaults = {"cover": True, "map": True, "reports": True, "photos": False}
    if not isinstance(sections, dict):
        return defaults
    return {key: bool(sections.get(key, default)) for key, default in defaults.items()}


def _photos_gallery_story(photos_by_id: dict, styles: dict) -> list:
    story: list = [Paragraph("Photos Gallery", styles["label"]), Spacer(1, 2 * mm)]
    seen: set[str] = set()
    count = 0
    for photos in photos_by_id.values():
        for ph in photos or []:
            marker = str(ph.get("id") or ph.get("stored_path") or ph.get("original_filename") or count)
            if marker in seen:
                continue
            seen.add(marker)
            image_path = ph.get("thumb_path") or ph.get("stored_path")
            flowable = _photo_flowable(image_path, width=42 * mm) if image_path else None
            if not flowable:
                continue
            fname = ph.get("caption") or ph.get("original_filename") or "Photo"
            gps = ""
            if ph.get("latitude") and ph.get("longitude"):
                gps = f"  {ph['latitude']:.4f}, {ph['longitude']:.4f}"
            story.append(flowable)
            story.append(Paragraph(f"{fname}{gps}", styles["small"]))
            story.append(Spacer(1, 2 * mm))
            count += 1
    if count == 0:
        story.append(Paragraph("No linked photos available.", styles["muted"]))
    return story


def generate_bundle_pdf(reports: list, photos_by_id: dict, links_by_id: dict, lang: str = "en", sections: dict | None = None, tracks: list | None = None) -> Path:
    now    = datetime.utcnow()
    folder = ensure_reports_dir(now.year, now.month)
    path   = folder / _bundle_filename(len(reports))

    sections = _normalize_sections(sections)
    tracks = tracks or []
    lbl     = _lbl(lang)
    rel_lbl = _rel_labels(lang)
    styles  = _make_styles()
    doc     = _build_doc(path)
    date_str = now.strftime("%d %b %Y %H:%M")
    story: list = []

    if sections.get("cover", True):
        story.extend([
            Paragraph(lbl["header_bundle"], styles["title"]),
            Paragraph(f"{len(reports)} {lbl['generated_on']} {date_str}", styles["muted"]),
            Spacer(1, 8 * mm),
        ])

    if sections.get("map", True):
        locs = []
        for rep in reports:
            la = rep.get("latitude")
            lo = rep.get("longitude")
            if la is not None and lo is not None:
                rid = rep.get("id", "?")
                lab = rep.get("report_number") or (f"RPT-{int(rid):03d}" if str(rid).isdigit() else f"RPT-{rid}")
                locs.append((la, lo, lab))
        try:
            png = _render_static_map(locs, tracks=tracks)
            if not png:
                raise RuntimeError("static map returned no image")
            story.append(Paragraph("Map - Patrol Tracks and Report Pins", styles["label"]))
            story.append(Image(BytesIO(png), width=170 * mm, height=96 * mm))
            story.append(Spacer(1, 4 * mm))
        except Exception as e:
            logger.error(f"PDF map render failed: {e}")
            raise

    if sections.get("reports", True):
        for report in reports:
            if story:
                story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#d1d5db"), spaceAfter=6 * mm))
            rid = report.get("id")
            story += _report_story(
                report,
                [],
                links_by_id.get(rid, []),
                styles, lbl, rel_lbl,
                as_section=True,
                include_individual_map=False,
                lang=lang,
            )
            story.append(Spacer(1, 6 * mm))

    if sections.get("photos", False):
        if story:
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#d1d5db"), spaceAfter=6 * mm))
        story += _photos_gallery_story(photos_by_id, styles)

    if not story:
        story.append(Paragraph("No sections selected.", styles["muted"]))

    doc.build(story)
    return path
