import en from "./locales/en";

export const DEFAULT_LANG = "en";

const translations = { en };

export function getTranslations(lang = DEFAULT_LANG) {
  return translations[lang] || en;
}

export function t(key, lang = DEFAULT_LANG, vars = {}) {
  const trans = getTranslations(lang);
  let str = trans[key] || key;
  Object.keys(vars).forEach((name) => {
    str = str.replace(new RegExp(`\\{${name}\\}`, "g"), vars[name]);
  });
  return str;
}

export function labelFor(prefix, value, lang = DEFAULT_LANG) {
  return t(`${prefix}.${value}`, lang);
}

export const LANGUAGES = [
  { code: "en", label: "English" },
];

const REPORT_TYPE_KEYS = {
  Observation: "type.Observation",
  Patrol: "type.Patrol",
  "Rumor/Witness": "type.Rumor",
  Rumor: "type.Rumor",
  Witness: "type.Rumor",
  Checkpoint: "type.Checkpoint",
  "Contact Report": "type.Contact",
  Contact: "type.Contact",
  Other: "type.Observation",
};

export function translateReportType(value, tt) {
  return tt(REPORT_TYPE_KEYS[value] || "type.Observation");
}

export default translations;
