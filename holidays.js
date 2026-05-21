import { pad2, parseISODate, todayISO, addCalendarDaysToISO } from "./utils.js";

export const STORAGE_FEIERLAND = "app_feierland";
const STORAGE_THEME = "app_theme";

/** ISO-Code → Anzeigename (Feiertags-Auswahl). */
export const BUNDESLAND_LIST = [
  ["BW", "Baden-Württemberg"],
  ["BY", "Bayern"],
  ["BE", "Berlin"],
  ["BB", "Brandenburg"],
  ["HB", "Bremen"],
  ["HH", "Hamburg"],
  ["HE", "Hessen"],
  ["MV", "Mecklenburg-Vorpommern"],
  ["NI", "Niedersachsen"],
  ["NW", "Nordrhein-Westfalen"],
  ["RP", "Rheinland-Pfalz"],
  ["SL", "Saarland"],
  ["SN", "Sachsen"],
  ["ST", "Sachsen-Anhalt"],
  ["SH", "Schleswig-Holstein"],
  ["TH", "Thüringen"],
];

/**
 * Welche zusätzlichen gesetzlichen Feiertage gelten (über den bundeseinheitlichen Kern hinaus).
 * Vereinfachtes Modell nach gängiger Verwaltungspraxis; Grenzfälle (nur teilweise Land) nicht abgebildet.
 * @type {Record<string, { fronleichnam?: boolean; dreikoenige?: boolean; maria15?: boolean; allerheiligen?: boolean; reformation31?: boolean; frauentag8?: boolean; bussBettag?: boolean; weltkind20?: boolean }>}
 */
const FEIERTAG_LAND_REGELN = {
  BW: { fronleichnam: true, dreikoenige: true, allerheiligen: true },
  BY: { fronleichnam: true, dreikoenige: true, maria15: true, allerheiligen: true },
  BE: { reformation31: true, frauentag8: true },
  BB: { reformation31: true },
  HB: { reformation31: true },
  HH: { reformation31: true },
  HE: { fronleichnam: true },
  MV: { reformation31: true, frauentag8: true },
  NI: { reformation31: true },
  NW: { allerheiligen: true },
  RP: { fronleichnam: true, allerheiligen: true },
  SL: { fronleichnam: true, maria15: true, allerheiligen: true },
  SN: { reformation31: true, bussBettag: true },
  ST: { reformation31: true, dreikoenige: true },
  SH: { reformation31: true },
  TH: { reformation31: true, weltkind20: true },
};

export function getFeierlandCode() {
  try {
    const v = localStorage.getItem(STORAGE_FEIERLAND);
    if (v && FEIERTAG_LAND_REGELN[v]) return v;
  } catch {
    /* ignore */
  }
  return "HE";
}

/** @param {string} code */
export function setFeierlandCode(code) {
  if (!FEIERTAG_LAND_REGELN[code]) return;
  try {
    localStorage.setItem(STORAGE_FEIERLAND, code);
  } catch {
    /* ignore */
  }
  holidayYearLandCache.clear();
}

/** @param {string} code */
export function feierlandDisplayName(code) {
  const row = BUNDESLAND_LIST.find((x) => x[0] === code);
  return row ? row[1] : code;
}

/** Buß- und Bettag: Mittwoch vor dem 23. November (SN). */
export function bussUndBettagISO(/** @type {number} */ year) {
  const d = new Date(year, 10, 23, 12, 0, 0, 0);
  while (d.getDay() !== 3) d.setDate(d.getDate() - 1);
  return toISODateLocal(d);
}

/**
 * Gesetzliche Feiertage für ein Bundesland: ISO-Datum → Kurzname.
 * @param {number} year
 * @param {string} landCode
 */
export function buildHolidayMapForYear(year, landCode) {
  const R = FEIERTAG_LAND_REGELN[landCode] ?? FEIERTAG_LAND_REGELN.HE;
  const Easter = easterSundayLocalMidday(year);
  /** @type {Map<string, string>} */
  const m = new Map();
  const addD = (/** @type {Date} */ dt, /** @type {string} */ name) => {
    m.set(toISODateLocal(dt), name);
  };
  addD(new Date(year, 0, 1, 12, 0, 0, 0), "Neujahr");
  addD(new Date(year, 4, 1, 12, 0, 0, 0), "Tag der Arbeit");
  addD(new Date(year, 9, 3, 12, 0, 0, 0), "Tag der Deutschen Einheit");
  addD(new Date(year, 11, 25, 12, 0, 0, 0), "1. Weihnachtstag");
  addD(new Date(year, 11, 26, 12, 0, 0, 0), "2. Weihnachtstag");
  addD(addCalendarDaysToDate(Easter, -2), "Karfreitag");
  addD(addCalendarDaysToDate(Easter, 1), "Ostermontag");
  addD(addCalendarDaysToDate(Easter, 39), "Christi Himmelfahrt");
  addD(addCalendarDaysToDate(Easter, 50), "Pfingstmontag");
  if (R.fronleichnam) addD(addCalendarDaysToDate(Easter, 60), "Fronleichnam");
  if (R.dreikoenige) addD(new Date(year, 0, 6, 12, 0, 0, 0), "Heilige Drei Könige");
  if (R.maria15) addD(new Date(year, 7, 15, 12, 0, 0, 0), "Mariä Himmelfahrt");
  if (R.allerheiligen) addD(new Date(year, 10, 1, 12, 0, 0, 0), "Allerheiligen");
  if (R.reformation31) addD(new Date(year, 9, 31, 12, 0, 0, 0), "Reformationstag");
  if (R.frauentag8) addD(new Date(year, 2, 8, 12, 0, 0, 0), "Internationaler Frauentag");
  if (R.weltkind20) addD(new Date(year, 8, 20, 12, 0, 0, 0), "Weltkindertag");
  if (R.bussBettag) m.set(bussUndBettagISO(year), "Buß- und Bettag");
  return m;
}

/** @type {Map<string, Map<string, string>>} */
const holidayYearLandCache = new Map();

export function holidayMapCached(/** @type {number} */ year, /** @type {string} */ landCode) {
  const key = `${year}|${landCode}`;
  let m = holidayYearLandCache.get(key);
  if (!m) {
    m = buildHolidayMapForYear(year, landCode);
    holidayYearLandCache.set(key, m);
  }
  return m;
}

/** @param {string} iso yyyy-mm-dd */
export function bundeslandHolidayNameDE(iso) {
  const key = String(iso).slice(0, 10);
  const y = Number(key.slice(0, 4));
  if (!Number.isFinite(y)) return null;
  return holidayMapCached(y, getFeierlandCode()).get(key) ?? null;
}

/**
 * Nächster gesetzlicher Feiertag im gewählten Bundesland (heute eingeschlossen).
 * @returns {{ iso: string; name: string; daysUntil: number } | null}
 */
export function getNextHoliday(maxScanDays = 800) {
  const land = getFeierlandCode();
  let d = todayISO();
  for (let i = 0; i < maxScanDays; i++) {
    const key = String(d).slice(0, 10);
    const y = Number(key.slice(0, 4));
    if (!Number.isFinite(y)) break;
    const name = holidayMapCached(y, land).get(key);
    if (name) {
      const du = daysUntilISODate(key);
      const daysUntil = du == null || !Number.isFinite(du) ? 0 : du;
      return { iso: key, name: String(name), daysUntil };
    }
    const nxt = addCalendarDaysToISO(d, 1);
    if (!nxt || nxt <= d) break;
    d = nxt;
  }
  return null;
}

export function isLandPublicHolidayISO(iso) {
  return bundeslandHolidayNameDE(iso) != null;
}

/** 24. und 30. Dezember: betrieblich frei (kein gesetzlicher Feiertag), zählen nicht als Urlaubs-Arbeitstag. */
export function isBetrieblichFreierDezemberTagISO(iso) {
  const key = String(iso).slice(0, 10);
  if (key.length < 10) return false;
  const mm = key.slice(5, 7);
  const dd = key.slice(8, 10);
  return mm === "12" && (dd === "24" || dd === "30");
}

/** @param {string} iso */
export function betrieblichFreierDezemberTagLabelDE(iso) {
  if (!isBetrieblichFreierDezemberTagISO(iso)) return null;
  return String(iso).slice(8, 10) === "24"
    ? "24. Dezember · betrieblich frei"
    : "30. Dezember · betrieblich frei";
}

/** Mo–Fr ohne gesetzliche Feiertage des gewählten Bundeslandes und ohne betrieblich freie Dez.-Tage (Urlaubsstatistik). */
export function countsAsUrlaubArbeitstag(iso) {
  if (isBetrieblichFreierDezemberTagISO(iso)) return false;
  const d = parseISODate(String(iso));
  const w = d.getDay();
  if (w === 0 || w === 6) return false;
  return !isLandPublicHolidayISO(iso);
}

/** Arbeitstage im ISO-Inklusivbereich [isoStart, isoEnd] (gewähltes Bundesland, ohne 24./30. Dez. betrieblich frei). */
export function countUrlaubWorkdaysInInclusiveRange(isoStart, isoEnd) {
  let c = 0;
  let cur = isoStart;
  let guard = 0;
  while (cur <= isoEnd && guard++ < 5000) {
    if (countsAsUrlaubArbeitstag(cur)) c += 1;
    const nxt = addCalendarDaysToISO(cur, 1);
    if (nxt == null || nxt <= cur) break;
    cur = nxt;
  }
  return c;
}

export function shiftUrlaubMonth(delta) {
  urlaubCalendarYM.m += delta;
  while (urlaubCalendarYM.m < 0) {
    urlaubCalendarYM.m += 12;
    urlaubCalendarYM.y -= 1;
  }
  while (urlaubCalendarYM.m > 11) {
    urlaubCalendarYM.m -= 12;
    urlaubCalendarYM.y += 1;
  }
}

export function shiftUrlaubYear(delta) {
  urlaubCalendarYM.y += delta;
}
