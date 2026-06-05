"""Build the lightweight offline Central African Republic map package.

This script downloads public HDX/OCHA and HOTOSM exports, filters them down to
MVP reference layers, and writes static GeoJSON under frontend/public/maps/car.
Normal Waypoint use does not need internet.
"""

from __future__ import annotations

import json
import math
import shutil
import urllib.request
import zipfile
from pathlib import Path

import shapefile


ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / "scripts" / "_map_cache"
OUT = ROOT / "frontend" / "public" / "maps" / "car"

SOURCES = {
    "admin": "https://data.humdata.org/dataset/78d80f16-b9ff-49cd-8195-d96efcf3b669/resource/7cc03625-ff62-4bf8-9995-27a3a2db1e87/download/caf_admin_boundaries.geojson.zip",
    "places": "https://production-raw-data-api.s3.amazonaws.com/ISO3/CAF/populated_places/hotosm_caf_populated_places_osm_geojson.zip",
    "waterways": "https://production-raw-data-api.s3.amazonaws.com/ISO3/CAF/waterways/hotosm_caf_waterways_osm_geojson.zip",
    "pois": "https://production-raw-data-api.s3.amazonaws.com/ISO3/CAF/points_of_interest/hotosm_caf_points_of_interest_osm_geojson.zip",
    "roads": "https://production-raw-data-api.s3.amazonaws.com/ISO3/CAF/roads/hotosm_caf_roads_osm_shp.zip",
}

MAJOR_ROADS = {
    "motorway",
    "trunk",
    "primary",
    "secondary",
    "tertiary",
}

MAJOR_PLACES = {
    "city",
    "town",
    "village",
}

BORDER_KEYWORDS = (
    "border",
    "frontier",
    "crossing",
    "custom",
    "douane",
)

BORDER_AMENITIES = {
    "border_control",
    "customs",
}

BORDER_BARRIERS = {
    "border_control",
    "border_checkpoint",
}


def main() -> None:
    CACHE.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)

    admin_zip = download("admin", SOURCES["admin"])
    places_zip = download("places", SOURCES["places"])
    waterways_zip = download("waterways", SOURCES["waterways"])
    pois_zip = download("pois", SOURCES["pois"])
    roads_zip = download("roads", SOURCES["roads"])

    admin_collections = read_geojson_zip(admin_zip)
    write_admin_layers(admin_collections)

    places = first_feature_collection(read_geojson_zip(places_zip))
    write_geojson(OUT / "places.geojson", filter_places(places))

    waterways = first_feature_collection(read_geojson_zip(waterways_zip))
    write_geojson(OUT / "waterways.geojson", filter_waterways(waterways))

    pois = first_feature_collection(read_geojson_zip(pois_zip))
    write_geojson(OUT / "border_crossings.geojson", filter_border_crossings(pois))

    roads_dir = unzip(roads_zip, CACHE / "roads")
    write_geojson(OUT / "roads.geojson", read_roads_shapefile(roads_dir))

    write_metadata()
    print(f"Wrote CAR map package to {OUT}")


def download(name: str, url: str) -> Path:
    target = CACHE / Path(url).name
    if target.exists() and target.stat().st_size > 0:
        return target
    print(f"Downloading {name}: {url}")
    with urllib.request.urlopen(url) as response, target.open("wb") as handle:
        shutil.copyfileobj(response, handle)
    return target


def unzip(zip_path: Path, target: Path) -> Path:
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    with zipfile.ZipFile(zip_path) as archive:
        archive.extractall(target)
    return target


def read_geojson_zip(zip_path: Path) -> dict[str, dict]:
    collections: dict[str, dict] = {}
    with zipfile.ZipFile(zip_path) as archive:
        for name in archive.namelist():
            if name.lower().endswith((".geojson", ".json")):
                with archive.open(name) as handle:
                    collections[Path(name).name] = json.load(handle)
    if not collections:
        raise RuntimeError(f"No GeoJSON found in {zip_path}")
    return collections


def first_feature_collection(collections: dict[str, dict]) -> dict:
    for value in collections.values():
        if value.get("type") == "FeatureCollection":
            return value
    raise RuntimeError("No FeatureCollection found")


def write_admin_layers(collections: dict[str, dict]) -> None:
    admin0 = find_collection(collections, ("adm0", "admin0"))
    admin1 = find_collection(collections, ("adm1", "admin1"))
    write_geojson(OUT / "admin0.geojson", slim_collection(admin0, simplify_tolerance=0.01))
    write_geojson(OUT / "admin1_prefectures.geojson", slim_collection(admin1, simplify_tolerance=0.006))


def find_collection(collections: dict[str, dict], needles: tuple[str, ...]) -> dict:
    for name, collection in collections.items():
        lowered = name.lower()
        if any(needle in lowered for needle in needles):
            return collection
    available = ", ".join(collections)
    raise RuntimeError(f"Could not find {needles} in {available}")


def filter_places(collection: dict) -> dict:
    features = []
    for feature in collection.get("features", []):
        props = feature.get("properties") or {}
        place = str(props.get("place") or props.get("fclass") or "").lower()
        name = props.get("name") or props.get("name_en") or props.get("osm_name")
        if place in MAJOR_PLACES and name:
            features.append(slim_feature(feature, keep=("name", "place", "population")))
    features = sorted(features, key=lambda f: place_rank(f), reverse=True)[:260]
    return feature_collection(features)


def filter_waterways(collection: dict) -> dict:
    features = []
    for feature in collection.get("features", []):
        props = feature.get("properties") or {}
        waterway = str(props.get("waterway") or props.get("fclass") or "").lower()
        name = props.get("name") or props.get("name_en")
        if waterway in {"river", "canal"} or name:
            item = slim_feature(feature, keep=("name", "waterway"))
            item["geometry"] = simplify_geometry(item.get("geometry"), 0.006)
            features.append(item)
    return feature_collection(features[:900])


def filter_border_crossings(collection: dict) -> dict:
    features = []
    for feature in collection.get("features", []):
        props = feature.get("properties") or {}
        if is_border_crossing(props):
            features.append(slim_feature(feature, keep=("name", "amenity", "barrier", "border_type", "highway", "office", "operator")))
    return feature_collection(features[:80])


def is_border_crossing(props: dict) -> bool:
    amenity = normalized(props.get("amenity"))
    barrier = normalized(props.get("barrier"))
    office = normalized(props.get("office"))
    border_type = normalized(props.get("border_type"))
    name = normalized(props.get("name"))

    if amenity in BORDER_AMENITIES:
        return True
    if barrier in BORDER_BARRIERS:
        return True
    if office in {"customs", "immigration"}:
        return True
    if border_type:
        return True

    haystack = " ".join(part for part in (name, office, barrier, amenity) if part)
    if "sante" in haystack or "santé" in haystack or "health" in haystack or "hospital" in haystack:
        return False
    return any(keyword in haystack for keyword in BORDER_KEYWORDS) and any(
        marker in haystack for marker in ("border", "frontier", "douane", "custom", "crossing")
    )


def read_roads_shapefile(directory: Path) -> dict:
    shp_files = list(directory.rglob("*.shp"))
    if not shp_files:
        raise RuntimeError(f"No shapefile found in {directory}")

    features = []
    for shp_path in shp_files:
        reader = shapefile.Reader(str(shp_path), encoding="utf-8")
        fields = [field[0] for field in reader.fields[1:]]
        for record, shape in zip(reader.records(), reader.shapes()):
            props = dict(zip(fields, record))
            road_type = str(props.get("highway") or props.get("fclass") or props.get("type") or "").lower()
            if road_type not in MAJOR_ROADS:
                continue
            geometry = shape_to_geometry(shape)
            if not geometry:
                continue
            geometry = simplify_geometry(geometry, 0.004)
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "name": props.get("name") or props.get("ref") or "",
                        "highway": road_type,
                    },
                    "geometry": geometry,
                }
            )
    return feature_collection(features)


def shape_to_geometry(shape) -> dict | None:
    points = [[float(x), float(y)] for x, y in shape.points]
    if not points:
        return None
    parts = list(shape.parts) + [len(points)]
    lines = [points[parts[i] : parts[i + 1]] for i in range(len(parts) - 1)]
    lines = [line for line in lines if len(line) >= 2]
    if not lines:
        return None
    if len(lines) == 1:
        return {"type": "LineString", "coordinates": lines[0]}
    return {"type": "MultiLineString", "coordinates": lines}


def slim_collection(collection: dict, simplify_tolerance: float = 0.0) -> dict:
    features = []
    for feature in collection.get("features", []):
        item = slim_feature(
            feature,
            keep=(
                "name",
                "adm0_name",
                "adm0_name1",
                "adm0_pcode",
                "adm1_name",
                "adm1_name1",
                "adm1_pcode",
                "ADM0_EN",
                "ADM1_EN",
                "ADM1_FR",
                "admin0Name_en",
                "admin1Name_en",
                "admin1Name_fr",
                "shapeName",
            ),
        )
        normalize_admin_properties(item)
        if simplify_tolerance:
            item["geometry"] = simplify_geometry(item.get("geometry"), simplify_tolerance)
        features.append(item)
    return feature_collection(features)


def normalize_admin_properties(feature: dict) -> None:
    props = feature.get("properties") or {}
    admin1 = first_value(props, ("adm1_name", "ADM1_FR", "ADM1_EN", "admin1Name_fr", "admin1Name_en", "shapeName"))
    admin0 = first_value(props, ("adm0_name", "ADM0_EN", "admin0Name_en", "name"))
    if admin1:
        props["name"] = admin1
        props["admin_level"] = "prefecture"
    elif admin0:
        props["name"] = admin0
        props["admin_level"] = "country"
    feature["properties"] = props


def first_value(props: dict, keys: tuple[str, ...]) -> str:
    for key in keys:
        value = props.get(key)
        if value not in (None, ""):
            return str(value)
    return ""


def normalized(value) -> str:
    return str(value or "").strip().lower()


def slim_feature(feature: dict, keep: tuple[str, ...]) -> dict:
    props = feature.get("properties") or {}
    kept = {key: props[key] for key in keep if key in props and props[key] not in (None, "")}
    return {
        "type": "Feature",
        "properties": kept,
        "geometry": feature.get("geometry"),
    }


def feature_collection(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}


def simplify_geometry(geometry: dict | None, tolerance: float) -> dict | None:
    if not geometry or not tolerance:
        return geometry
    gtype = geometry.get("type")
    coords = geometry.get("coordinates")
    if gtype == "LineString":
        return {"type": gtype, "coordinates": simplify_line(coords, tolerance)}
    if gtype == "MultiLineString":
        return {"type": gtype, "coordinates": [simplify_line(line, tolerance) for line in coords]}
    if gtype == "Polygon":
        return {"type": gtype, "coordinates": [simplify_ring(ring, tolerance) for ring in coords]}
    if gtype == "MultiPolygon":
        return {"type": gtype, "coordinates": [[simplify_ring(ring, tolerance) for ring in poly] for poly in coords]}
    return geometry


def simplify_ring(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 4:
        return points
    closed = points[0] == points[-1]
    body = points[:-1] if closed else points
    simplified = simplify_line(body, tolerance)
    if closed and simplified[0] != simplified[-1]:
        simplified.append(simplified[0])
    return simplified


def simplify_line(points: list[list[float]], tolerance: float) -> list[list[float]]:
    if len(points) <= 2:
        return points
    keep = [False] * len(points)
    keep[0] = True
    keep[-1] = True
    simplify_segment(points, 0, len(points) - 1, tolerance, keep)
    return [point for point, include in zip(points, keep) if include]


def simplify_segment(points: list[list[float]], start: int, end: int, tolerance: float, keep: list[bool]) -> None:
    max_distance = 0.0
    index = start
    for i in range(start + 1, end):
        distance = point_line_distance(points[i], points[start], points[end])
        if distance > max_distance:
            max_distance = distance
            index = i
    if max_distance > tolerance:
        keep[index] = True
        simplify_segment(points, start, index, tolerance, keep)
        simplify_segment(points, index, end, tolerance, keep)


def point_line_distance(point: list[float], start: list[float], end: list[float]) -> float:
    if start == end:
        return math.dist(point, start)
    x, y = point
    x1, y1 = start
    x2, y2 = end
    numerator = abs((y2 - y1) * x - (x2 - x1) * y + x2 * y1 - y2 * x1)
    denominator = math.hypot(y2 - y1, x2 - x1)
    return numerator / denominator


def place_rank(feature: dict) -> tuple[int, int]:
    props = feature.get("properties") or {}
    place = str(props.get("place") or "").lower()
    population = props.get("population") or 0
    try:
        population = int(float(population))
    except (TypeError, ValueError):
        population = 0
    rank = {"city": 3, "town": 2, "village": 1}.get(place, 0)
    return (rank, population)


def write_geojson(path: Path, collection: dict) -> None:
    with path.open("w", encoding="utf-8") as handle:
        json.dump(collection, handle, ensure_ascii=False, separators=(",", ":"))
    print(f"{path.name}: {len(collection.get('features', []))} features, {path.stat().st_size // 1024} KB")


def write_metadata() -> None:
    metadata = {
        "name": "Waypoint Core Offline CAR Map Package",
        "generated_utc": "2026-06-03",
        "runtime": "Offline static GeoJSON; no map tiles or paid APIs required.",
        "layers": [
            {"id": "admin0", "file": "admin0.geojson", "description": "CAR national boundary"},
            {"id": "admin1_prefectures", "file": "admin1_prefectures.geojson", "description": "CAR prefectures / admin 1"},
            {"id": "places", "file": "places.geojson", "description": "Major cities, towns, and selected villages"},
            {"id": "roads", "file": "roads.geojson", "description": "Major OSM road classes: trunk, primary, secondary, tertiary"},
            {"id": "waterways", "file": "waterways.geojson", "description": "Named waterways and major river/canal features"},
            {"id": "border_crossings", "file": "border_crossings.geojson", "description": "Likely border/customs crossing points where available"},
        ],
        "sources": [
            {
                "name": "HDX/OCHA Central African Republic Subnational Administrative Boundaries (COD-AB)",
                "url": "https://data.humdata.org/dataset/cod-ab-caf",
                "license_note": "Used for humanitarian planning. Boundaries/names do not imply official endorsement or acceptance by the United Nations or the Central African government.",
            },
            {
                "name": "HOTOSM Central African Republic OpenStreetMap exports via HDX",
                "url": "https://data.humdata.org/organization/hot?q=Central+African+Republic",
                "license_note": "OpenStreetMap contributors; ODbL.",
            },
            {
                "name": "Geofabrik Central African Republic OpenStreetMap extract",
                "url": "https://download.geofabrik.de/africa/central-african-republic.html",
                "license_note": "Referenced as the full upstream OSM extract source for offline rebuilds; runtime package uses lightweight thematic exports.",
            },
        ],
        "notes": [
            "Normal Waypoint use reads only local files under /maps/car.",
            "The package is intentionally simplified for low-spec ToughBook-class machines.",
            "Nearby border context is provided by border-adjacent OSM features included in the HOTOSM country exports; a wider custom HOT Export Tool package can replace these layers later if needed.",
        ],
    }
    with (OUT / "metadata.json").open("w", encoding="utf-8") as handle:
        json.dump(metadata, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
