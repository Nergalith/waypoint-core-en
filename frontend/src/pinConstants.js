import * as L from "leaflet";

export const PIN_CATEGORIES = {
  person:       { labelEn: "Person",                  symbol: "P" },
  vehicle:      { labelEn: "Vehicle",                 symbol: "V" },
  group:        { labelEn: "Group / Armed Group",     symbol: "G" },
  organization: { labelEn: "Organization",            symbol: "O" },
  military:     { labelEn: "Military",                symbol: "M" },
  police:       { labelEn: "Police",                  symbol: "P" },
  checkpoint:   { labelEn: "Checkpoint",              symbol: "C" },
  government:   { labelEn: "Government Building",     symbol: "G" },
  hospital:     { labelEn: "Hospital",                symbol: "+" },
  church:       { labelEn: "Church / Religious Site", symbol: "R" },
  utilities:    { labelEn: "Power / Utilities",       symbol: "U" },
  incident:     { labelEn: "Incident / Event",        symbol: "!" },
  shooting:     { labelEn: "Shooting",                symbol: "S" },
  explosion:    { labelEn: "Explosion",               symbol: "X" },
  riot:         { labelEn: "Civil Disturbance",       symbol: "R" },
  location:     { labelEn: "Named Location",          symbol: "L" },
  document:     { labelEn: "Document Location",       symbol: "D" },
  evidence:     { labelEn: "Evidence Point",          symbol: "E" },
  general:      { labelEn: "General / Other",         symbol: "*" },
};

export const STATUS_COLORS = {
  hostile:  { hex: "#dc2626", labelEn: "Hostile / Threat / Danger" },
  friendly: { hex: "#16a34a", labelEn: "Friendly / Safe / Confirmed" },
  unknown:  { hex: "#eab308", labelEn: "Unknown / Unconfirmed / Caution" },
  neutral:  { hex: "#2563eb", labelEn: "Neutral / Civilian / No affiliation" },
  inactive: { hex: "#64748b", labelEn: "Inactive / Historical / No status" },
};

export const DEFAULT_PIN_COLOR = "#eab308";

const _pinIconCache = {};

export function createPinIcon(category, color) {
  const cat = PIN_CATEGORIES[category] || PIN_CATEGORIES.general;
  const fill = color || DEFAULT_PIN_COLOR;
  const key = `${category || "general"}:${fill}`;
  if (_pinIconCache[key]) return _pinIconCache[key];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40"><path d="M15 0C6.716 0 0 6.716 0 15c0 10 15 25 15 25S30 25 30 15C30 6.716 23.284 0 15 0z" fill="${fill}"/><text x="15" y="16" font-size="13" font-family="Arial,sans-serif" font-weight="700" text-anchor="middle" dy="0.35em" fill="white">${cat.symbol}</text></svg>`;
  const icon = new L.Icon({
    iconUrl: "data:image/svg+xml," + encodeURIComponent(svg),
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -42],
  });
  _pinIconCache[key] = icon;
  return icon;
}
