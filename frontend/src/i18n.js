import en from "./locales/en";

export const DEFAULT_LANG = "en";

const translations = { en };

export function getTranslations() {
  return en;
}

export function t(key, _lang, vars = {}) {
  let str = en[key] || key;
  Object.keys(vars).forEach((name) => {
    str = str.replace(new RegExp(`\\{${name}\\}`, "g"), vars[name]);
  });
  return str;
}

export function labelFor(prefix, value) {
  return t(`${prefix}.${value}`);
}

const REPORT_TYPE_KEYS = {
  Observation: "type.Observation",
  Patrol:      "type.Patrol",
  Witness:     "type.Witness",
  Rumor:       "type.Rumor",
  Other:       "type.Other",
};

export function translateReportType(value, tt) {
  return tt(REPORT_TYPE_KEYS[value] || "type.Observation");
}

export default translations;
