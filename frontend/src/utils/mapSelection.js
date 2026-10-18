export const LAST_MAP_STORAGE_KEY = "waypoint_last_map_id";

export function normalizeMapName(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function findMatchingMap(maps, requestedName) {
  const wanted = normalizeMapName(requestedName);
  if (!wanted) return null;
  return (Array.isArray(maps) ? maps : []).find((map) => normalizeMapName(map?.name) === wanted) || null;
}

export function chooseMapForTrack(maps, requestedName, lastMapId) {
  const available = Array.isArray(maps) ? maps : [];
  const matching = findMatchingMap(available, requestedName);
  if (matching) return { map: matching, missingRequestedMap: false };
  const fallback = available.find((map) => map.id === lastMapId) || available[0] || null;
  return { map: fallback, missingRequestedMap: Boolean(requestedName) };
}
