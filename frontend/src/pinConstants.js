import * as L from "leaflet";

export const PIN_CATEGORIES = {
  person:       { labelEn: "Person",                  labelFr: "Personne",                    symbol: "◉" },
  vehicle:      { labelEn: "Vehicle",                 labelFr: "Véhicule",                    symbol: "⬡" },
  group:        { labelEn: "Group / Armed Group",     labelFr: "Groupe / Groupe armé",        symbol: "✶" },
  organization: { labelEn: "Organization",            labelFr: "Organisation",                symbol: "■" },
  military:     { labelEn: "Military",                labelFr: "Militaire",                   symbol: "✪" },
  police:       { labelEn: "Police",                  labelFr: "Police",                      symbol: "⭐" },
  checkpoint:   { labelEn: "Checkpoint",              labelFr: "Poste de contrôle",           symbol: "⬛" },
  government:   { labelEn: "Government Building",     labelFr: "Bâtiment gouvernemental",     symbol: "★" },
  hospital:     { labelEn: "Hospital",                labelFr: "Hôpital",                     symbol: "+" },
  church:       { labelEn: "Church / Religious Site", labelFr: "Église / Site religieux",     symbol: "✝" },
  utilities:    { labelEn: "Power / Utilities",       labelFr: "Électricité / Services",      symbol: "⚙" },
  incident:     { labelEn: "Incident / Event",        labelFr: "Incident / Événement",        symbol: "▲" },
  shooting:     { labelEn: "Shooting",                labelFr: "Tir / Fusillade",             symbol: "✕" },
  explosion:    { labelEn: "Explosion",               labelFr: "Explosion",                   symbol: "✱" },
  riot:         { labelEn: "Civil Disturbance",       labelFr: "Troubles civils",             symbol: "⬆" },
  location:     { labelEn: "Named Location",          labelFr: "Lieu nommé",                  symbol: "⌂" },
  document:     { labelEn: "Document Location",       labelFr: "Emplacement document",        symbol: "≡" },
  evidence:     { labelEn: "Evidence Point",          labelFr: "Point de preuve",             symbol: "◆" },
  general:      { labelEn: "General / Other",         labelFr: "Général / Autre",             symbol: "●" },
};

export const STATUS_COLORS = {
  hostile:  { hex: "#dc2626", labelEn: "Hostile / Threat / Danger",           labelFr: "Hostile / Menace / Danger" },
  friendly: { hex: "#16a34a", labelEn: "Friendly / Safe / Confirmed",         labelFr: "Ami / Sûr / Confirmé" },
  unknown:  { hex: "#eab308", labelEn: "Unknown / Unconfirmed / Caution",      labelFr: "Inconnu / Non confirmé / Attention" },
  neutral:  { hex: "#2563eb", labelEn: "Neutral / Civilian / No affiliation",  labelFr: "Neutre / Civil / Sans affiliation" },
  inactive: { hex: "#64748b", labelEn: "Inactive / Historical / No status",    labelFr: "Inactif / Historique / Sans statut" },
};

export const DEFAULT_PIN_COLOR = "#eab308";

const _pinIconCache = {};

export function createPinIcon(category, color) {
  const cat = PIN_CATEGORIES[category] || PIN_CATEGORIES.general;
  const fill = color || DEFAULT_PIN_COLOR;
  const key = `${category || "general"}:${fill}`;
  if (_pinIconCache[key]) return _pinIconCache[key];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="40" viewBox="0 0 30 40"><path d="M15 0C6.716 0 0 6.716 0 15c0 10 15 25 15 25S30 25 30 15C30 6.716 23.284 0 15 0z" fill="${fill}"/><text x="15" y="16" font-size="13" font-family="system-ui,Arial,sans-serif" text-anchor="middle" dy="0.35em" fill="white">${cat.symbol}</text></svg>`;
  const icon = new L.Icon({
    iconUrl: "data:image/svg+xml," + encodeURIComponent(svg),
    iconSize: [30, 40],
    iconAnchor: [15, 40],
    popupAnchor: [0, -42],
  });
  _pinIconCache[key] = icon;
  return icon;
}
