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
from io import BytesIO
try:
    from PIL import Image as PILImage, ImageDraw, ImageFont
    from reportlab.lib.utils import ImageReader
    _HAS_RENDER_DEPS = True
except Exception:
    _HAS_RENDER_DEPS = False

ROOT_DIR = Path(__file__).resolve().parents[3]
REPORTS_DIR = ROOT_DIR / "Waypoint Reports"

MONTH_ABBREV = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN",
                "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]

# ---------------------------------------------------------------------------
# Font registration â€” Arial TTF for full Latin-extended / UTF-8 support.
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
    "fr": {
        "header_single":  "WAYPOINT CORE â€” Rapport de terrain",
        "header_bundle":  "WAYPOINT CORE â€” Rapport groupÃ©",
        "generated_on":   "rapport(s) â€” gÃ©nÃ©rÃ© le",
        "finalized":      "FINALISÃ‰",
        "who":            "Qui impliquÃ©",
        "what":           "Quoi",
        "where":          "OÃ¹",
        "when":           "Quand (terrain)",
        "notes":          "Notes",
        "related":        "LiÃ© Ã ",
        "reliability":    "FiabilitÃ© source",
        "coords":         "CoordonnÃ©es GPS",
        "linked_objects": "Objets liÃ©s",
        "linked_photos":  "Photos liÃ©es",
    },
    "en": {
        "header_single":  "WAYPOINT CORE â€” Field Report",
        "header_bundle":  "WAYPOINT CORE â€” Bundled Report",
        "generated_on":   "report(s) â€” generated",
        "finalized":      "FINALIZED",
        "who":            "Who involved",
        "what":           "What happened",
        "where":          "Where",
        "when":           "When (field)",
        "notes":          "Notes",
        "related":        "Related to",
        "reliability":    "Source reliability",
        "coords":         "GPS coordinates",
        "linked_objects": "Linked objects",
        "linked_photos":  "Linked photos",
    },
}

_RELIABILITY_LABELS: dict[str, dict[str, str]] = {
    "fr": {
        "A": "A â€” Source sÃ»re",
        "B": "B â€” Source gÃ©nÃ©ralement fiable",
        "C": "C â€” Source assez fiable",
        "D": "D â€” Source peu fiable",
        "E": "E â€” Source non fiable",
        "F": "F â€” FiabilitÃ© inconnue",
    },
    "en": {
        "A": "A â€” Reliable source",
        "B": "B â€” Usually reliable",
        "C": "C â€” Fairly reliable",
        "D": "D â€” Not usually reliable",
        "E": "E â€” Unreliable",
        "F": "F â€” Reliability unknown",
    },
}


def _lbl(lang: str) -> dict[str, str]:
    return _LABELS.get(lang, _LABELS["fr"])


def _rel_labels(lang: str) -> dict[str, str]:
    return _RELIABILITY_LABELS.get(lang, _RELIABILITY_LABELS["fr"])


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


def _single_filename(report_id: int, report_type: str, date_str: str) -> str:
    safe_type = report_type.replace(" ", "")[:20]
    return f"RPT-{report_id:03d}_{safe_type}_{_filename_date(date_str)}.pdf"


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
# Offline static test map renderer (uses only local admin0.geojson + Pillow)
# Renders the generic test boundary + pin(s) at report location(s). Small PNG for embedding.
# For bundles, pass multiple points to show all on one map.
# ---------------------------------------------------------------------------

def _render_static_map(points: list[tuple[float, float, str]], width: int = 320, height: int = 180) -> bytes | None:
    """Return PNG bytes for a simple test-map outline + labeled pin(s). points = [(lat, lon, label), ...].
    Completely offline. Linear scale is sufficient for the small offline test package.
    """
    if not _HAS_RENDER_DEPS or not points:
        return None

    map_path = ROOT_DIR / "frontend" / "public" / "maps" / "test" / "admin0.geojson"
    if not map_path.exists():
        return None

    try:
        with open(map_path, "r", encoding="utf-8") as f:
            gj = json.load(f)
        feat = gj["features"][0]
        ring = feat["geometry"]["coordinates"][0]
        boundary = [(float(c[0]), float(c[1])) for c in ring]  # (lon, lat)
    except Exception:
        return None

    if not boundary:
        return None

    # bounds from boundary + all points (lat,lon order in points)
    all_lons = [b[0] for b in boundary]
    all_lats = [b[1] for b in boundary]
    for lat, lon, _ in points:
        try:
            all_lons.append(float(lon))
            all_lats.append(float(lat))
        except Exception:
            pass

    if not all_lons or not all_lats:
        return None

    pad = 0.8
    min_lon = min(all_lons) - pad
    max_lon = max(all_lons) + pad
    min_lat = min(all_lats) - pad
    max_lat = max(all_lats) + pad

    W, H = int(width), int(height)
    margin = 12
    img = PILImage.new("RGB", (W, H), "white")
    draw = ImageDraw.Draw(img)

    def proj(lon: float, lat: float):
        x = margin + (float(lon) - min_lon) / (max_lon - min_lon) * (W - 2 * margin)
        y = margin + (max_lat - float(lat)) / (max_lat - min_lat) * (H - 2 * margin)
        return int(max(margin, min(W - margin, x))), int(max(margin, min(H - margin, y)))

    # Test boundary (light fill + outline)
    poly = [proj(lon, lat) for lon, lat in boundary]
    draw.polygon(poly, fill=(232, 244, 255), outline=(25, 70, 130), width=2)

    # pins + labels (red dot + small text)
    font = ImageFont.load_default()
    for lat, lon, label in points:
        try:
            px, py = proj(float(lon), float(lat))
            r = 5
            # pin dot
            draw.ellipse([px - r, py - r, px + r, py + r], fill=(200, 30, 30), outline=(255, 220, 220))
            # tiny stem
            draw.line([px, py + r, px, py + r + 4], fill=(80, 80, 80), width=1)
            # label
            lab = str(label or "")[:9]
            if lab:
                draw.text((px + 5, py - 3), lab, fill=(20, 20, 20), font=font)
        except Exception:
            continue

    # very small context label
    try:
        draw.text((4, 2), "TEST", fill=(90, 90, 90), font=font)
    except Exception:
        pass

    bio = BytesIO()
    img.save(bio, format="PNG")
    return bio.getvalue()


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
) -> list:
    story: list = []
    heading = styles["h2"] if as_section else styles["h1"]

    rid     = report.get("id", "?")
    rtype   = report.get("report_type", "")
    created = report.get("created_at", "")
    date_display = created.replace("T", " ").replace("Z", "") if created else ""

    story.append(Paragraph(f"RPT-{rid:03d} â€” {rtype}", heading))
    if date_display:
        story.append(Paragraph(date_display, styles["muted"]))

    if report.get("status") == "finalized":
        fin = (report.get("finalized_at") or "").replace("T", " ").replace("Z", "")
        story.append(Paragraph(f"{lbl['finalized']} â€” {fin}", styles["locked"]))

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

    # Embed small offline static map (test-map boundary + pin at this report's location).
    # Uses local GeoJSON only. For bundles the caller can suppress per-report maps
    # and provide a combined overview instead.
    if include_individual_map and _HAS_RENDER_DEPS and lat is not None and lon is not None:
        try:
            rid = report.get("id", "?")
            lab = f"RPT-{int(rid):03d}" if str(rid).isdigit() else f"RPT-{rid}"
            png = _render_static_map([(lat, lon, lab)])
            if png:
                ir = ImageReader(BytesIO(png))
                story.append(Spacer(1, 2 * mm))
                story.append(Image(ir, width=58 * mm, height=33 * mm))
                story.append(Spacer(1, 1 * mm))
        except Exception:
            pass  # never break PDF generation on map render issues

    if links:
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(lbl["linked_objects"], styles["label"]))
        for lk in links:
            src      = lk.get("source_label", "")
            tgt      = lk.get("target_label", "")
            rel_type = lk.get("relationship_type", "")
            story.append(Paragraph(f"â€¢ {src}  â†’  {rel_type}  â†’  {tgt}", styles["small"]))

    if photos:
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph(lbl["linked_photos"], styles["label"]))
        story.append(Spacer(1, 2 * mm))
        for ph in photos:
            thumb = ph.get("thumb_path")
            if thumb and Path(thumb).exists():
                try:
                    story.append(Image(str(thumb), width=40 * mm))
                    fname = ph.get("original_filename", "")
                    gps   = ""
                    if ph.get("latitude") and ph.get("longitude"):
                        gps = f"  {ph['latitude']:.4f}, {ph['longitude']:.4f}"
                    story.append(Paragraph(f"{fname}{gps}", styles["small"]))
                    story.append(Spacer(1, 2 * mm))
                except Exception:
                    pass

    return story


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_single_pdf(report: dict[str, Any], photos: list, links: list, lang: str = "fr") -> Path:
    created = report.get("created_at", datetime.utcnow().isoformat())
    dt      = _parse_dt(created)
    folder  = ensure_reports_dir(dt.year, dt.month)
    path    = folder / _single_filename(report.get("id", 0), report.get("report_type", "Rapport"), created)

    lbl     = _lbl(lang)
    rel_lbl = _rel_labels(lang)
    styles  = _make_styles()
    doc     = _build_doc(path)
    story   = [
        Paragraph(lbl["header_single"], styles["title"]),
        Spacer(1, 6 * mm),
    ]
    story  += _report_story(report, photos, links, styles, lbl, rel_lbl)
    doc.build(story)
    return path


def generate_bundle_pdf(reports: list, photos_by_id: dict, links_by_id: dict, lang: str = "fr") -> Path:
    now    = datetime.utcnow()
    folder = ensure_reports_dir(now.year, now.month)
    path   = folder / _bundle_filename(len(reports))

    lbl     = _lbl(lang)
    rel_lbl = _rel_labels(lang)
    styles  = _make_styles()
    doc     = _build_doc(path)
    date_str = now.strftime("%d %b %Y %H:%M")
    story = [
        Paragraph(lbl["header_bundle"], styles["title"]),
        Paragraph(f"{len(reports)} {lbl['generated_on']} {date_str}", styles["muted"]),
        Spacer(1, 8 * mm),
    ]

    # For bundles: render ONE combined map with ALL report locations/pins (as requested).
    # Insert overview early; suppress per-section individual maps below.
    if _HAS_RENDER_DEPS:
        locs = []
        for rep in reports:
            la = rep.get("latitude")
            lo = rep.get("longitude")
            if la is not None and lo is not None:
                rid = rep.get("id", "?")
                lab = f"RPT-{int(rid):03d}" if str(rid).isdigit() else f"RPT-{rid}"
                locs.append((la, lo, lab))
        if locs:
            try:
                png = _render_static_map(locs)
                if png:
                    story.append(Paragraph("CAR â€” Emplacements / Locations overview", styles["label"]))
                    ir = ImageReader(BytesIO(png))
                    story.append(Image(ir, width=72 * mm, height=40 * mm))
                    story.append(Spacer(1, 4 * mm))
            except Exception:
                pass

    for i, report in enumerate(reports):
        if i > 0:
            story.append(HRFlowable(width="100%", thickness=0.5, color=colors.HexColor("#d1d5db"), spaceAfter=6 * mm))
        rid    = report.get("id")
        story += _report_story(
            report,
            photos_by_id.get(rid, []),
            links_by_id.get(rid, []),
            styles, lbl, rel_lbl,
            as_section=True,
            include_individual_map=False,
        )
        story.append(Spacer(1, 6 * mm))

    doc.build(story)
    return path


