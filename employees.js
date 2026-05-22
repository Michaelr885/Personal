/**
 * Mitarbeiter-, Urlaubs- und Teamleiter-Logik (ohne komplette Bildschirme).
 *
 * Enthält u. a.: Normalisierung der Daten, Urlaubszeiträume, automatischer Status
 * (Krank/Urlaub/Verfügbar), Teamleiter-Zuordnung, Zuweisungs-Konfliktprüfung,
 * HTML-Snippets für Abwesenheits-Badges.
 *
 * UI für Tabs → siehe dashboardView.js, personnelView.js, urlaubView.js, ganttView.js.
 */
import { getState, persist } from "./state.js";
import {
  $,
  pad2,
  parseISODate,
  todayISO,
  addCalendarDaysToISO,
  rangesOverlap,
  formatDateDE,
  daysUntilISODate,
  escapeHtml,
  isSingleCalendarDayUrlaub,
  validateUrlaubPeriodOrder,
  readOptionalISODateFromInput,
  addDaysFromTodayISO,
  ensureSelectHasValue,
} from "./utils.js";
import {
  getFeierlandCode,
  countsAsUrlaubArbeitstag,
  countUrlaubWorkdaysInInclusiveRange,
  bundeslandHolidayNameDE,
} from "./holidays.js";

/** @typedef {{ von: string, bis: string|null, Halber_Tag?: boolean }} Urlaubsperiode */
/** @typedef {{ ID:number, Personalnummer:string, Vorname:string, Nachname:string, Qualifikation:string, Zusatz_Tags:string[], Teamleiter_ID:number|null, Beschäftigung:"AÜG"|"Eigene", Stufe:string, Abteilung:string, Status:string, Rückkehr_erwartet_am:string|null, Abwesenheit_geplant_ab:string|null, Abwesenheit_geplant_bis:string|null, Krank_ab:string|null, Krank_bis:string|null, Urlaub_ab:string|null, Urlaub_bis:string|null, Urlaub_halber_Tag?: boolean, Urlaub_perioden: Urlaubsperiode[] }} Employee */
/** @typedef {{ ID:number, Name:string, Team_Farbe:string, Abteilung:string, Reihenfolge:number }} TeamLeader */
/** @typedef {{ ID:number, Name:string, Startdatum:string, Enddatum:string, Benötigte_Qualifikationen:Record<string, number>, leiterId:string }} Project */
/** `leiterId` verweist auf `team_leaders[].ID` (Verantwortliche Teamleitung), leer = keine Zuweisung. */
/** @typedef {{ ID:number, Project_ID:number, Employee_ID:number, Startdatum:string, Enddatum:string }} Assignment */

/** Vorgabe-Liste, wenn in der Datei noch keine `qualifications` gepflegt sind. */
export const DEFAULT_QUALIFICATIONS = [
  "Monteur",
  "Schweißer",
  "Bauleiter",
  "Elektriker",
  "Lagerist",
];

/** Bekannte Qualifikationen → Farbton (HSL Hue 0–360); unbekannte Werte stabil aus dem Namen. */
export function empQualHue(qual) {
  const q = String(qual ?? "").trim();
  if (!q) return 210;
  const map = /** @type {Record<string, number>} */ ({
    Monteur: 204,
    Schweißer: 24,
    Bauleiter: 152,
    Elektriker: 268,
    Lagerist: 43,
    Ausmesser: 172,
  });
  if (Object.prototype.hasOwnProperty.call(map, q)) return map[q];
  let h = 0;
  for (let i = 0; i < q.length; i++) h = (h * 31 + q.charCodeAt(i)) >>> 0;
  return h % 360;
}

export function ensureStateQualifications() {
  if (!getState()) return;
  const used = new Set(DEFAULT_QUALIFICATIONS);
  for (const e of getState().employees) {
    const q = String(e.Qualifikation ?? "").trim();
    if (q) used.add(q);
  }
  for (const p of getState().projects) {
    for (const k of Object.keys(p.Benötigte_Qualifikationen || {})) {
      const q = String(k).trim();
      if (q) used.add(q);
    }
  }
  const raw = Array.isArray(getState().qualifications) ? getState().qualifications : [];
  const defined = raw.map((x) => String(x ?? "").trim()).filter(Boolean);
  if (defined.length === 0) {
    getState().qualifications = [...used].sort((a, b) => a.localeCompare(b, "de"));
    return;
  }
  for (const q of used) {
    if (!defined.includes(q)) defined.push(q);
  }
  defined.sort((a, b) => a.localeCompare(b, "de"));
  getState().qualifications = defined;
}

export const BESCHÄFTIGUNG_AÜG = "AÜG";
export const BESCHÄFTIGUNG_EIGENE = "Eigene";

/** Feste Abteilungsliste (Personal-Tabelle & Dropdown). */
export const ABTEILUNGEN = /** @type {const} */ ([
  "Mechanik",
  "Steriltechnik",
  "Kunststofftechnik und Gewerbe",
  "Rohrfertigung",
]);

/** @param {unknown} raw */
export function normalizeAbteilung(raw) {
  let s = String(raw ?? "").trim();
  if (s === "KunststoffIch und Gewerbe") s = "Kunststofftechnik und Gewerbe";
  if (/** @type {readonly string[]} */ (ABTEILUNGEN).includes(s)) return s;
  return ABTEILUNGEN[0];
}

/** @param {unknown} raw @returns {Urlaubsperiode[]} */
export function normalizeUrlaubPerioden(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {Urlaubsperiode[]} */
  const out = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = /** @type {Record<string, unknown>} */ (row);
    const von = String(o.von ?? o.ab ?? o.Urlaub_ab ?? "").trim();
    if (!von) continue;
    const bisRaw = o.bis ?? o.Urlaub_bis ?? "";
    const bisStr = bisRaw == null || bisRaw === "" ? null : String(bisRaw).trim();
    let Halber_Tag = Boolean(o.Halber_Tag ?? o.halber_Tag);
    if (Halber_Tag && !isSingleCalendarDayUrlaub(von, bisStr)) Halber_Tag = false;
    /** @type {Urlaubsperiode} */
    const entry = { von, bis: bisStr || null };
    if (Halber_Tag) entry.Halber_Tag = true;
    out.push(entry);
  }
  return out;
}

/** @param {unknown} raw @returns {"AÜG"|"Eigene"} */
export function normalizeBeschäftigung(raw) {
  const s = String(raw ?? "").trim();
  if (s === BESCHÄFTIGUNG_AÜG) return BESCHÄFTIGUNG_AÜG;
  return BESCHÄFTIGUNG_EIGENE;
}

export function normalizeAllEmployeesShape() {
  if (!getState()) return;
  for (const emp of getState().employees) {
    emp.Beschäftigung = normalizeBeschäftigung(emp.Beschäftigung);
    emp.Stufe = emp.Stufe != null && emp.Stufe !== "" ? String(emp.Stufe).trim() : "";
    emp.Abteilung = normalizeAbteilung(emp.Abteilung);
    emp.Urlaub_perioden = normalizeUrlaubPerioden(emp.Urlaub_perioden);
    if (emp.Urlaub_halber_Tag === true && !isSingleCalendarDayUrlaub(String(emp.Urlaub_ab ?? "").trim(), emp.Urlaub_bis)) {
      emp.Urlaub_halber_Tag = false;
    }
    dedupeUrlaubStorage(emp);
  }
  ensureStateQualifications();
  ensureDashboardAbteilungReihenfolge();
  normalizeAllProjectsShape();
}

/** Stellt `leiterId` auf Projekten bereit und entfernt ungültige Verweise auf Teamleiter-IDs. */
export function normalizeAllProjectsShape() {
  if (!getState()) return;
  for (const p of getState().projects) {
    const raw = p.leiterId;
    if (raw == null || String(raw).trim() === "") {
      p.leiterId = "";
      continue;
    }
    const id = Number(String(raw).trim());
    if (!Number.isFinite(id) || !getState().team_leaders.some((t) => Number(t.ID) === id)) {
      p.leiterId = "";
    } else {
      p.leiterId = String(id);
    }
  }
}

export function firstWorkdayAfterAbsenceEnd(/** @type {Employee} */ emp) {
  if (emp.Status === "Krank") {
    const bis = emp.Krank_bis;
    if (bis != null && bis !== "") return addCalendarDaysToISO(String(bis), 1);
    return emp.Rückkehr_erwartet_am != null && emp.Rückkehr_erwartet_am !== ""
      ? String(emp.Rückkehr_erwartet_am)
      : null;
  }
  if (emp.Status === "Urlaub") {
    const t = todayISO();
    const r = currentUrlaubRangeForDay(emp, t);
    const bis = r ? r.bis : emp.Urlaub_bis != null && emp.Urlaub_bis !== "" ? String(emp.Urlaub_bis) : null;
    if (bis != null && bis !== "") return addCalendarDaysToISO(String(bis), 1);
    return emp.Rückkehr_erwartet_am != null && emp.Rückkehr_erwartet_am !== ""
      ? String(emp.Rückkehr_erwartet_am)
      : null;
  }
  return null;
}

/** Hält ältere Felder konsistent (Rückkehr / einheitlicher Urlaubsplan in Abwesenheit_geplant_*). */
export function syncLegacyAbsenceFields(/** @type {Employee} */ emp) {
  if (emp.Status === "Krank") {
    emp.Rückkehr_erwartet_am =
      emp.Krank_bis != null && emp.Krank_bis !== "" ? addCalendarDaysToISO(String(emp.Krank_bis), 1) : null;
  } else if (emp.Status === "Urlaub") {
    const t = todayISO();
    const r = currentUrlaubRangeForDay(emp, t);
    if (r && r.bis != null && r.bis !== "") {
      emp.Rückkehr_erwartet_am = addCalendarDaysToISO(String(r.bis), 1);
    } else {
      emp.Rückkehr_erwartet_am =
        emp.Urlaub_bis != null && emp.Urlaub_bis !== "" ? addCalendarDaysToISO(String(emp.Urlaub_bis), 1) : null;
    }
  } else {
    emp.Rückkehr_erwartet_am = null;
  }
  const env = urlaubPlannedEnvelope(emp);
  if (env) {
    emp.Abwesenheit_geplant_ab = env.ab;
    emp.Abwesenheit_geplant_bis = env.bis;
  } else {
    emp.Abwesenheit_geplant_ab = null;
    emp.Abwesenheit_geplant_bis = null;
  }
}

/**
 * Alle Urlaubs-Zeiträume: Hauptfelder Urlaub_ab/bis plus zusätzliche Einträge in Urlaub_perioden.
 * @param {Employee} emp
 * @returns {{ ab: string; bis: string | null }[]}
 */
export function getUrlaubRanges(emp) {
  /** @type {{ ab: string; bis: string | null }[]} */
  const ranges = [];
  let hauptAb = null;
  let hauptBis = null;
  if (emp.Urlaub_ab != null && emp.Urlaub_ab !== "") {
    hauptAb = String(emp.Urlaub_ab);
    hauptBis = emp.Urlaub_bis != null && emp.Urlaub_bis !== "" ? String(emp.Urlaub_bis) : null;
    ranges.push({ ab: hauptAb, bis: hauptBis });
  }
  /** @type {Set<string>} */
  const seen = new Set();
  if (hauptAb) seen.add(`${hauptAb}|${bisNormUrlaub(hauptBis) ?? ""}`);
  for (const p of normalizeUrlaubPerioden(emp.Urlaub_perioden)) {
    const bis = p.bis != null && p.bis !== "" ? String(p.bis) : null;
    if (hauptAb && sameUrlaubSpan(hauptAb, hauptBis, p.von, bis)) continue;
    const key = `${p.von}|${bisNormUrlaub(bis) ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    ranges.push({ ab: String(p.von), bis });
  }
  return ranges;
}

/**
 * Urlaubs-Zeiträge inkl. Halber-Tag-Metadaten (Statistik / Urlaubsplan).
 * @param {Employee} emp
 * @returns {{ ab: string; bis: string | null; halberTag: boolean; slot: "haupt" | "zusatz" }[]}
 */
export function getUrlaubRangeEntries(emp) {
  /** @type {{ ab: string; bis: string | null; halferTag: boolean; slot: "haupt" | "zusatz" }[]} */
  const out = [];
  let hauptAb = null;
  let hauptBis = null;
  if (emp.Urlaub_ab != null && emp.Urlaub_ab !== "") {
    hauptAb = String(emp.Urlaub_ab);
    hauptBis = emp.Urlaub_bis != null && emp.Urlaub_bis !== "" ? String(emp.Urlaub_bis) : null;
    const halberTag = emp.Urlaub_halber_Tag === true && isSingleCalendarDayUrlaub(hauptAb, hauptBis);
    out.push({ ab: hauptAb, bis: hauptBis, halberTag, slot: "haupt" });
  }
  /** @type {Set<string>} */
  const seen = new Set();
  if (hauptAb) seen.add(`${hauptAb}|${bisNormUrlaub(hauptBis) ?? ""}`);
  for (const p of normalizeUrlaubPerioden(emp.Urlaub_perioden)) {
    const bis = p.bis != null && p.bis !== "" ? String(p.bis) : null;
    if (hauptAb && sameUrlaubSpan(hauptAb, hauptBis, p.von, bis)) continue;
    const key = `${p.von}|${bisNormUrlaub(bis) ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const halberTag = !!p.Halber_Tag && isSingleCalendarDayUrlaub(p.von, bis);
    out.push({ ab: String(p.von), bis, halferTag, slot: "zusatz" });
  }
  return out;
}

export function bisNormUrlaub(/** @type {string|null|undefined} */ b) {
  return b == null || b === "" ? null : String(b);
}

export function sameUrlaubSpan(
  /** @type {string} */ aVon,
  /** @type {string|null|undefined} */ aBis,
  /** @type {string} */ bVon,
  /** @type {string|null|undefined} */ bBis
) {
  return aVon === bVon && bisNormUrlaub(aBis) === bisNormUrlaub(bBis);
}

/**
 * @param {Employee} emp
 * @param {string} von
 * @param {string|null} bis
 * @param {{ slot: "haupt" | "zusatz"; von: string; bis: string | null } | null} exclude bestehender Eintrag, der beim Speichern ersetzt wird
 * @returns {string|null} Fehlertext oder null
 */

/**
 * Entfernt doppelte Urlaub_perioden (gleicher Zeitraum wie Haupt-Urlaub oder mehrfach in der Liste).
 * @param {Employee} emp
 */
export function dedupeUrlaubStorage(emp) {
  const hAb = emp.Urlaub_ab != null && emp.Urlaub_ab !== "" ? String(emp.Urlaub_ab) : null;
  const hBis = bisNormUrlaub(emp.Urlaub_bis);
  let periods = normalizeUrlaubPerioden(emp.Urlaub_perioden);
  if (hAb) {
    periods = periods.filter((p) => !sameUrlaubSpan(hAb, hBis, p.von, p.bis));
  }
  /** @type {Urlaubsperiode[]} */
  const unique = [];
  for (const p of periods) {
    if (unique.some((u) => sameUrlaubSpan(u.von, u.bis, p.von, p.bis))) continue;
    unique.push(p);
  }
  emp.Urlaub_perioden = unique;
}

/**
 * Entfernt einen Urlaubszeitraum überall (Hauptfelder und passende Zusatzeinträge).
 * @param {Employee} emp
 * @param {string} von
 * @param {string|null} bis
 */
export function removeUrlaubSpan(emp, von, bis) {
  if (
    emp.Urlaub_ab != null &&
    emp.Urlaub_ab !== "" &&
    sameUrlaubSpan(String(emp.Urlaub_ab), emp.Urlaub_bis, von, bis)
  ) {
    emp.Urlaub_ab = null;
    emp.Urlaub_bis = null;
    emp.Urlaub_halber_Tag = false;
  }
  emp.Urlaub_perioden = normalizeUrlaubPerioden(emp.Urlaub_perioden).filter(
    (p) => !sameUrlaubSpan(p.von, p.bis, von, bis)
  );
}

export function urlaubDuplicateAgainst(emp, von, bis, exclude) {
  const bN = bisNormUrlaub(bis);
  if (emp.Urlaub_ab) {
    const ma = String(emp.Urlaub_ab);
    const mb = bisNormUrlaub(emp.Urlaub_bis);
    const skip =
      exclude && exclude.slot === "haupt" && sameUrlaubSpan(ma, mb, exclude.von, exclude.bis);
    if (!skip && sameUrlaubSpan(ma, mb, von, bN)) {
      return "Dieser Zeitraum ist bereits als Haupt-Urlaub eingetragen.";
    }
  }
  for (const p of normalizeUrlaubPerioden(emp.Urlaub_perioden)) {
    const skip =
      exclude && exclude.slot === "zusatz" && sameUrlaubSpan(p.von, p.bis, exclude.von, exclude.bis);
    if (!skip && sameUrlaubSpan(p.von, p.bis, von, bN)) {
      return "Dieser Zeitraum ist bereits als weiterer Urlaub eingetragen.";
    }
  }
  return null;
}

/** @param {string} dayISO @param {Employee} emp */
export function isDayInAnyUrlaubRange(dayISO, emp) {
  return getUrlaubRanges(emp).some((r) => isDayInAbsenceRange(dayISO, r.ab, r.bis));
}

/** @param {Employee} emp */
export function hasAnyUrlaubStart(emp) {
  return getUrlaubRanges(emp).length > 0;
}

/**
 * Zeitraum, der den Kalendertag abdeckt (für Rückkehr / Anzeige).
 * @param {Employee} emp
 * @param {string} dayISO
 */
export function currentUrlaubRangeForDay(emp, dayISO) {
  for (const r of getUrlaubRanges(emp)) {
    if (isDayInAbsenceRange(dayISO, r.ab, r.bis)) return r;
  }
  return null;
}

/**
 * Einhüllende für Abwesenheit_geplant_* (frühester Start, spätestes Ende).
 * @param {Employee} emp
 * @returns {{ ab: string; bis: string } | null}
 */
export function urlaubPlannedEnvelope(emp) {
  const ranges = getUrlaubRanges(emp);
  if (!ranges.length) return null;
  let minAb = ranges[0].ab;
  let maxEnd = ranges[0].bis ?? ranges[0].ab;
  for (const r of ranges) {
    if (r.ab < minAb) minAb = r.ab;
    const end = r.bis ?? r.ab;
    if (end > maxEnd) maxEnd = end;
  }
  return { ab: minAb, bis: maxEnd };
}

export function getEmployee(id) {
  if (!getState()) return undefined;
  return getState().employees.find((e) => Number(e.ID) === Number(id));
}

export function getProject(id) {
  if (!getState()) return undefined;
  return getState().projects.find((p) => Number(p.ID) === Number(id));
}

/** @param {Project} p */
export function getProjectLeiterTeamLeader(p) {
  if (!getState()) return undefined;
  const raw = String(p.leiterId ?? "").trim();
  if (!raw) return undefined;
  const id = Number(raw);
  if (!Number.isFinite(id)) return undefined;
  return getTeamLeader(id);
}

/** @param {TeamLeader} tl */
export function teamLeaderAbbreviatedName(tl) {
  const raw = String(tl.Name ?? "").trim();
  if (!raw) return `TL ${tl.ID}`;
  const parts = raw.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0];
  const ini = `${parts[0].charAt(0).toUpperCase()}.`;
  const last = parts[parts.length - 1];
  return `${ini} ${last}`;
}

/** Kompaktes PL-Badge (HTML, escaped); leer wenn kein gültiger Teamleiter. @param {Project} p */
export function projectLeiterBadgeHtml(p) {
  const tl = getProjectLeiterTeamLeader(p);
  if (!tl) return "";
  const label = String(tl.Name ?? "").trim() || `TL ${tl.ID}`;
  return `<span class="badge badge--leiter" title="Verantwortliche Teamleitung / PL"><i class="fa-solid fa-user-tie" aria-hidden="true"></i> ${escapeHtml(
    label
  )}</span>`;
}

/** Anzeigetext für Gantt-Balken inkl. optionaler PL-Kürzel. @param {Project} p */
export function ganttTaskTitleForDisplay(p) {
  const tl = getProjectLeiterTeamLeader(p);
  if (!tl) return p.Name;
  return `${p.Name} (PL: ${teamLeaderAbbreviatedName(tl)})`;
}

export function fillProjectLeiterSelect(/** @type {string | null | undefined} */ selectedId) {
  if (!getState()) return;
  const sel = /** @type {HTMLSelectElement | null} */ ($("#project-leiter-select"));
  if (!sel) return;
  const want = String(selectedId ?? "").trim();
  const sorted = teamLeadersSortedForDashboard();
  const parts = ['<option value="">-- Kein Teamleiter zugewiesen --</option>'];
  for (const tl of sorted) {
    const idStr = String(tl.ID);
    const selAttr = idStr === want ? " selected" : "";
    const name = String(tl.Name ?? "").trim() || `TL ${tl.ID}`;
    const abt = normalizeAbteilung(tl.Abteilung);
    parts.push(
      `<option value="${escapeHtml(idStr)}"${selAttr}>${escapeHtml(name)} · ${escapeHtml(abt)}</option>`
    );
  }
  sel.innerHTML = parts.join("");
}

/** Alle Qualifikationsnamen aus State, Mitarbeitenden und Projektbedarf. */
export function uniqueQualifications() {
  if (!getState()) return [];
  const set = new Set(
    (Array.isArray(getState().qualifications) ? getState().qualifications : [])
      .map((x) => String(x ?? "").trim())
      .filter(Boolean)
  );
  for (const e of getState().employees) {
    const q = String(e.Qualifikation ?? "").trim();
    if (q) set.add(q);
  }
  for (const p of getState().projects) {
    for (const k of Object.keys(p.Benötigte_Qualifikationen || {})) {
      const q = String(k).trim();
      if (q) set.add(q);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "de"));
}

export function employeeActiveOnProjectToday(empId) {
  if (!getState()) return false;
  const t = todayISO();
  return getState().assignments.some(
    (a) =>
      Number(a.Employee_ID) === Number(empId) &&
      rangesOverlap(a.Startdatum, a.Enddatum, t, t)
  );
}

export function getTeamLeader(id) {
  if (!getState()) return undefined;
  return getState().team_leaders.find((t) => Number(t.ID) === Number(id));
}

export function teamLeadersSortedForDashboard() {
  if (!getState()) return [];
  return [...getState().team_leaders].sort((a, b) => {
    const ra = Number(a.Reihenfolge);
    const rb = Number(b.Reihenfolge);
    const oa = Number.isFinite(ra) ? ra : 1e9;
    const ob = Number.isFinite(rb) ? rb : 1e9;
    if (oa !== ob) return oa - ob;
    return Number(a.ID) - Number(b.ID);
  });
}

export function reorderTeamLeadersOnDashboard(fromIdStr, toIdStr) {
  if (!getState()) return;
  const fromId = Number(fromIdStr);
  const toId = Number(toIdStr);
  if (!Number.isFinite(fromId) || !Number.isFinite(toId) || fromId === toId) return;
  const sorted = teamLeadersSortedForDashboard();
  const fromIdx = sorted.findIndex((t) => Number(t.ID) === fromId);
  const toIdx = sorted.findIndex((t) => Number(t.ID) === toId);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = sorted.splice(fromIdx, 1);
  sorted.splice(toIdx, 0, moved);
  sorted.forEach((t, i) => {
    const live = getState().team_leaders.find((x) => Number(x.ID) === Number(t.ID));
    if (live) live.Reihenfolge = i;
  });
}

/** Reihenfolge der Abteilungs-Blöcke im Dashboard; wird mit tatsächlich genutzten Abteilungen synchronisiert. */
export function ensureDashboardAbteilungReihenfolge() {
  if (!getState()) return;
  if (!Array.isArray(getState().dashboard_abteilung_reihenfolge)) {
    getState().dashboard_abteilung_reihenfolge = [];
  }
  const sortedTls = teamLeadersSortedForDashboard();
  /** @type {string[]} */
  const inUse = [];
  const seen = new Set();
  for (const tl of sortedTls) {
    const a = normalizeAbteilung(tl.Abteilung);
    if (!seen.has(a)) {
      seen.add(a);
      inUse.push(a);
    }
  }
  let order = getState().dashboard_abteilung_reihenfolge
    .map((x) => String(x ?? "").trim())
    .filter(Boolean)
    .filter((a) => inUse.includes(a));
  for (const a of inUse) {
    if (!order.includes(a)) order.push(a);
  }
  getState().dashboard_abteilung_reihenfolge = order;
}

/** @param {string} fromAbt @param {string} toAbt */
export function reorderDashboardAbteilungen(fromAbt, toAbt) {
  if (!getState()) return;
  const from = String(fromAbt).trim();
  const to = String(toAbt).trim();
  if (!from || !to || from === to) return;
  const arr = getState().dashboard_abteilung_reihenfolge;
  const fromIdx = arr.indexOf(from);
  const toIdx = arr.indexOf(to);
  if (fromIdx < 0 || toIdx < 0) return;
  const [moved] = arr.splice(fromIdx, 1);
  arr.splice(toIdx, 0, moved);
}

export function absenceReturnBadgeHtml(emp) {
  if (emp.Status !== "Krank" && emp.Status !== "Urlaub") return "";
  const raw = firstWorkdayAfterAbsenceEnd(emp);
  const de = raw ? formatDateDE(raw) : "";
  if (raw == null || raw === "") {
    return `<span class="abs-hint abs-hint--rueckkehr abs-hint--muted" title="„Krankheit bis“ bzw. „Urlaub bis“ setzen (letzter freier Tag vor der Rückkehr)">kein Zeitraum-Ende</span>`;
  }
  const d = daysUntilISODate(raw);
  if (d === null || !Number.isFinite(d)) {
    return `<span class="abs-hint abs-hint--rueckkehr" title="Erster Arbeitstag nach Abwesenheit"><i class="fa-solid fa-calendar-check"></i> Rückkehr ab ${escapeHtml(de)}</span>`;
  }
  if (d < 0) {
    return `<span class="abs-hint abs-hint--rueckkehr abs-hint--danger" title="Geplanter erster Arbeitstag ${escapeHtml(String(raw))}"><i class="fa-solid fa-circle-xmark"></i> Rückkehr <strong>${escapeHtml(de)}</strong> überfällig</span>`;
  }
  if (d === 0) {
    return `<span class="abs-hint abs-hint--rueckkehr abs-hint--warn" title="Rückkehr an Arbeit geplant"><i class="fa-solid fa-triangle-exclamation"></i> Rückkehr heute · <strong>${escapeHtml(de)}</strong></span>`;
  }
  const urgent = d < 30;
  const cls = urgent ? "abs-hint abs-hint--rueckkehr abs-hint--warn" : "abs-hint abs-hint--rueckkehr";
  const icon = urgent ? "fa-triangle-exclamation" : "fa-calendar-check";
  return `<span class="${cls}" title="Erster Arbeitstag nach Abwesenheit: ${escapeHtml(String(raw))}"><i class="fa-solid ${icon}"></i> Rückkehr ab <strong>${escapeHtml(de)}</strong> · noch ${d} Tag${d === 1 ? "" : "e"}</span>`;
}

/** Verfügbar: ab 5 Tage vor geplantem Beginn Hinweis (HTML), getrennt für Krank- und Urlaubsplan. */
export function plannedAbsenceBadgeHtml(emp) {
  if (emp.Status !== "Verfügbar") return "";
  const chunks = [];
  for (const r of getUrlaubRanges(emp)) {
    const von = r.ab;
    const bis = r.bis;
    const label = "Urlaub";
    const icon = "fa-umbrella-beach";
    if (von == null || von === "") continue;
    const d = daysUntilISODate(String(von));
    if (d === null || !Number.isFinite(d) || d < 0 || d > 5) continue;
    const vonDe = formatDateDE(String(von));
    const bisPart =
      bis && String(bis) !== String(von)
        ? ` bis <strong>${escapeHtml(formatDateDE(String(bis)))}</strong>`
        : "";
    chunks.push(
      `<span class="abs-hint abs-hint--urlaub-start" title="Geplanter ${label} ab ${escapeHtml(String(von))}${bis ? ` bis ${escapeHtml(String(bis))}` : ""}"><i class="fa-solid ${icon}"></i> ${label} ab <strong>${escapeHtml(vonDe)}</strong>${bisPart} · noch ${d} Tag${d === 1 ? "" : "e"}</span>`
    );
  }
  for (const spec of /** @type {const} */ ([{ label: "Krank", von: emp.Krank_ab, bis: emp.Krank_bis, icon: "fa-file-medical" }])) {
    const { label, von, bis, icon } = spec;
    if (von == null || von === "") continue;
    const d = daysUntilISODate(String(von));
    if (d === null || !Number.isFinite(d) || d < 0 || d > 5) continue;
    const vonDe = formatDateDE(String(von));
    const bisPart =
      bis && String(bis) !== String(von)
        ? ` bis <strong>${escapeHtml(formatDateDE(String(bis)))}</strong>`
        : "";
    chunks.push(
      `<span class="abs-hint abs-hint--krank-start" title="Geplanter ${label} ab ${escapeHtml(String(von))}${bis ? ` bis ${escapeHtml(String(bis))}` : ""}"><i class="fa-solid ${icon}"></i> ${label} ab <strong>${escapeHtml(vonDe)}</strong>${bisPart} · noch ${d} Tag${d === 1 ? "" : "e"}</span>`
    );
  }
  if (chunks.length) return chunks.join(" ");
  const von = emp.Abwesenheit_geplant_ab;
  if (von == null || von === "") return "";
  const d = daysUntilISODate(String(von));
  if (d === null || !Number.isFinite(d) || d < 0 || d > 5) return "";
  const bis = emp.Abwesenheit_geplant_bis;
  const vonDe = formatDateDE(String(von));
  const bisPart =
    bis && String(bis) !== String(von)
      ? ` bis <strong>${escapeHtml(formatDateDE(String(bis)))}</strong>`
      : "";
  return `<span class="abs-hint abs-hint--urlaub-start" title="Geplante Abwesenheit ab ${escapeHtml(String(von))}${bis ? ` bis ${escapeHtml(String(bis))}` : ""}"><i class="fa-solid fa-plane-departure"></i> Abwesenheit ab <strong>${escapeHtml(vonDe)}</strong>${bisPart} · noch ${d} Tag${d === 1 ? "" : "e"}</span>`;
}

/** Fließtext für Personal-Tabelle (ohne HTML). */
export function absenceSummaryPlain(emp) {
  const parts = [];
  if (emp.Status === "Krank" || emp.Status === "Urlaub") {
    if (emp.Status === "Krank") {
      const ab = emp.Krank_ab;
      const bis = emp.Krank_bis;
      if ((ab != null && ab !== "") || (bis != null && bis !== "")) {
        parts.push(`${emp.Status} ${ab ?? "…"}–${bis ?? "…"}`);
      }
    } else {
      const t = todayISO();
      const r = currentUrlaubRangeForDay(emp, t);
      if (r) {
        parts.push(`Urlaub ${r.ab}–${r.bis ?? "…"}`);
      } else {
        const ranges = getUrlaubRanges(emp);
        if (ranges.length) {
          const segs = ranges.map((x) => `${x.ab}–${x.bis ?? "…"}`);
          parts.push(`Urlaub: ${segs.join(", ")}`);
        }
      }
    }
    const ret = firstWorkdayAfterAbsenceEnd(emp);
    if (ret == null || ret === "") parts.push("Rückkehr: —");
    else {
      const d = daysUntilISODate(ret);
      if (d === null || !Number.isFinite(d)) parts.push(`Rückkehr: ${ret}`);
      else if (d < 0) parts.push(`Rückkehr überfällig (${ret})`);
      else if (d === 0) parts.push("Rückkehr heute");
      else parts.push(`Rückkehr in ${d} T. (${ret})`);
    }
  }
  if (emp.Status === "Verfügbar") {
    const pushPlan = (label, von) => {
      if (von == null || von === "") return;
      const d = daysUntilISODate(String(von));
      if (d !== null && Number.isFinite(d) && d >= 0 && d <= 5) parts.push(`${label} ab ${von} in ${d} T.`);
      else if (d !== null && Number.isFinite(d) && d > 5) parts.push(`${label} geplant ab ${von}`);
    };
    pushPlan("Krank", emp.Krank_ab);
    for (const r of getUrlaubRanges(emp)) {
      pushPlan("Urlaub", r.ab);
    }
    if (!parts.some((p) => p.startsWith("Krank") || p.startsWith("Urlaub"))) {
      const von = emp.Abwesenheit_geplant_ab;
      if (von) {
        const d = daysUntilISODate(String(von));
        if (d !== null && Number.isFinite(d) && d >= 0 && d <= 5) parts.push(`Abwesenheit ab ${von} in ${d} T.`);
        else if (d !== null && Number.isFinite(d) && d > 5) parts.push(`Geplant ab ${von}`);
      }
    }
  }
  return parts.length ? parts.join(" · ") : "—";
}

/** Eine Zeile für den Ressourcen-Pool unter der Person. */
export function plannedAbsencePoolLine(emp) {
  if (emp.Status !== "Verfügbar") return "";
  const lines = [];
  for (const r of getUrlaubRanges(emp)) {
    const von = r.ab;
    if (von == null || von === "") continue;
    const d = daysUntilISODate(String(von));
    if (d === null || !Number.isFinite(d) || d < 0 || d > 5) continue;
    lines.push(`Urlaub ab ${formatDateDE(String(von))} · in ${d} Tag${d === 1 ? "" : "en"}`);
  }
  const kVon = emp.Krank_ab;
  if (kVon != null && kVon !== "") {
    const d = daysUntilISODate(String(kVon));
    if (d !== null && Number.isFinite(d) && d >= 0 && d <= 5) {
      lines.push(`Krank ab ${formatDateDE(String(kVon))} · in ${d} Tag${d === 1 ? "" : "en"}`);
    }
  }
  if (lines.length) return lines.join(" · ");
  const von = emp.Abwesenheit_geplant_ab;
  if (von == null || von === "") return "";
  const d = daysUntilISODate(String(von));
  if (d === null || !Number.isFinite(d) || d < 0 || d > 5) return "";
  return `Abwesenheit ab ${formatDateDE(String(von))} · in ${d} Tag${d === 1 ? "" : "en"}`;
}

export function absenceHintText(status) {
  if (status === "Verfügbar") {
    return "Krankheit und Urlaub: Hauptzeitraum (von/bis) plus beliebig viele weitere Urlaubsblöcke. Kalendertage inklusive. Ab 5 Tage vor „von“ zeigt das Dashboard Hinweise. Liegt heute in einem Urlaubs- oder Krankheitszeitraum, wird der Status automatisch angepasst; nach abgeschlossenen Zeiträumen (mit „bis“) wieder „Verfügbar“.";
  }
  if (status === "Krank" || status === "Urlaub") {
    return "„Von“ und „bis“ = erster bzw. letzter freier Tag; der erste Arbeitstag ist automatisch der Tag nach „bis“. Zusätzliche Urlaubszeiten unten eintragen. Schnellbuttons setzen „bis“ auf eine bzw. zwei Wochen ab heute.";
  }
  return "";
}

export function syncEditAbsenceHint() {
  const el = /** @type {HTMLSelectElement | null} */ ($("#emp-status"));
  const hint = /** @type {HTMLElement | null} */ ($("#emp-absence-hint"));
  if (!el || !hint) return;
  hint.textContent = absenceHintText(el.value);
}

export function syncNewAbsenceHint() {
  const el = /** @type {HTMLSelectElement | null} */ ($("#new-emp-status"));
  const hint = /** @type {HTMLElement | null} */ ($("#new-emp-absence-hint"));
  if (!el || !hint) return;
  hint.textContent = absenceHintText(el.value);
}

const URLAUB_GANTT_MODAL_HINT_NEW =
  "Wird als <strong>weiterer Urlaubszeitraum</strong> gespeichert (wie in der Personalverwaltung). Leeres „Bis“ = offenes Ende ab „Von“.";

const URLAUB_GANTT_MODAL_HINT_EDIT =
  "Sie bearbeiten einen <strong>bestehenden</strong> Zeitraum (Haupt-Urlaub oder Zusatzeintrag). Leeres „Bis“ = offenes Ende.";

export function refreshUrlaubPeriodRowHalbUI(row) {
  const vonEl = row.querySelector(".js-u-von");
  const bisEl = row.querySelector(".js-u-bis");
  const wrap = row.querySelector(".js-urlaub-per-halb-wrap");
  const halbCb = row.querySelector(".js-u-halb");
  if (!(vonEl instanceof HTMLInputElement) || !(wrap instanceof HTMLElement) || !(halbCb instanceof HTMLInputElement)) return;
  const von = vonEl.value.trim();
  const bisRaw = bisEl instanceof HTMLInputElement ? bisEl.value.trim() : "";
  const ok = !!von && isSingleCalendarDayUrlaub(von, bisRaw === "" ? null : bisRaw);
  wrap.hidden = !ok;
  if (!ok) halbCb.checked = false;
}

export function urlaubPeriodRowTemplate(von = "", bis = "", halber = false) {
  const v = von ? escapeHtml(von) : "";
  const b = bis ? escapeHtml(bis) : "";
  const halbChecked = halber ? " checked" : "";
  return `<div class="urlaub-per-row form-grid form-grid--wide form-section__grid">
    <label>Weiterer Urlaub von (optional)<input type="date" class="js-u-von" value="${v}" /></label>
    <label>Bis (optional)<input type="date" class="js-u-bis" value="${b}" /></label>
    <label class="span-2 urlaub-per-halb-wrap js-urlaub-per-halb-wrap" hidden>
      <span class="pool-filter-opt" style="margin:0;display:flex;align-items:flex-start;gap:0.5rem">
        <input type="checkbox" class="js-u-halb"${halbChecked} />
        <span>Halber Urlaubstag (0,5 Arbeitstage)</span>
      </span>
    </label>
    <div class="form-actions--inline"><button type="button" class="btn btn--ghost btn--tiny js-u-remove" title="Zeile entfernen"><i class="fa-solid fa-xmark"></i> Entfernen</button></div>
  </div>`;
}

export function renderUrlaubPeriodenContainer(hostId, /** @type {Urlaubsperiode[]} */ periods) {
  const host = document.getElementById(hostId);
  if (!(host instanceof HTMLElement)) return;
  const list = periods && periods.length ? periods : [];
  host.innerHTML = list.length
    ? list.map((p) => urlaubPeriodRowTemplate(p.von, p.bis ?? "", !!p.Halber_Tag)).join("")
    : "";
  for (const row of host.querySelectorAll(".urlaub-per-row")) {
    if (row instanceof HTMLElement) refreshUrlaubPeriodRowHalbUI(row);
  }
}

export function collectUrlaubPeriodenFromContainer(hostId) {
  const host = document.getElementById(hostId);
  if (!(host instanceof HTMLElement)) return /** @type {Urlaubsperiode[]} */ ([]);
  /** @type {Urlaubsperiode[]} */
  const out = [];
  for (const row of host.querySelectorAll(".urlaub-per-row")) {
    const vonEl = row.querySelector(".js-u-von");
    const bisEl = row.querySelector(".js-u-bis");
    const von = vonEl instanceof HTMLInputElement ? vonEl.value.trim() : "";
    const bisRaw = bisEl instanceof HTMLInputElement ? bisEl.value.trim() : "";
    if (!von && !bisRaw) continue;
    if (!von) continue;
    const halbCb = row.querySelector(".js-u-halb");
    const Halber_Tag =
      halbCb instanceof HTMLInputElement &&
      halbCb.checked &&
      isSingleCalendarDayUrlaub(von, bisRaw === "" ? null : bisRaw);
    /** @type {Urlaubsperiode} */
    const entry = { von, bis: bisRaw === "" ? null : bisRaw };
    if (Halber_Tag) entry.Halber_Tag = true;
    out.push(entry);
  }
  return out;
}


export function validateAssignmentForSave(employeeId, start, end) {
  const emp = getEmployee(employeeId);
  if (!emp) return { conflict: true, fullName: "Unbekannt" };
  const fullName = `${emp.Vorname} ${emp.Nachname}`.trim();
  if (emp.Status === "Krank" || emp.Status === "Urlaub") {
    return { conflict: true, fullName };
  }
  if (!getState()) return { conflict: false, fullName };
  for (const a of getState().assignments) {
    if (Number(a.Employee_ID) !== Number(employeeId)) continue;
    if (!rangesOverlap(a.Startdatum, a.Enddatum, start, end)) continue;
    return { conflict: true, fullName };
  }
  return { conflict: false, fullName };
}

export function hasValidTeamLeader(emp) {
  const raw = emp.Teamleiter_ID;
  if (raw === null || raw === undefined || raw === "") return false;
  const id = Number(raw);
  if (!Number.isFinite(id)) return false;
  return !!getTeamLeader(id);
}

export function employeesWithoutTeamLeader() {
  if (!getState()) return [];
  return getState().employees.filter((e) => !hasValidTeamLeader(e));
}

/** Abwesenheits-Hinweise für eine Person (Dashboard: Teamkarte & Chip). */
export function dashboardMemberAbsenceBlock(emp) {
  const ret = absenceReturnBadgeHtml(emp).trim();
  const plan = plannedAbsenceBadgeHtml(emp).trim();
  if (!ret && !plan) return "";
  return `<div class="dashboard-emp-abs">${[ret, plan].filter(Boolean).join(" ")}</div>`;
}

/** True, wenn heute im inklusiven Zeitraum [ab, bis] liegt. */
export function todayWithinInclusiveISO(ab, bis) {
  const t = todayISO();
  const b = bis && bis !== "" ? String(bis) : String(ab);
  if (ab == null || ab === "") return false;
  return t >= String(ab) && t <= b;
}

/**
 * Liegt dayISO im inklusiven Abwesenheitszeitraum [ab, bis]?
 * Ohne „bis“: abwesend ab `ab` einschließlich (offenes Ende).
 * @param {string} dayISO
 * @param {string|null|undefined} ab
 * @param {string|null|undefined} bis
 */
export function isDayInAbsenceRange(dayISO, ab, bis) {
  if (ab == null || ab === "") return false;
  const a = String(ab);
  if (bis != null && bis !== "") {
    return dayISO >= a && dayISO <= String(bis);
  }
  return dayISO >= a;
}

/**
 * Liegt dayISO nach dem letzten Tag eines geschlossenen Zeitraums (nur wenn „bis“ gesetzt)?
 * @param {string} dayISO
 */
export function isDayAfterClosedAbsenceRange(dayISO, ab, bis) {
  if (ab == null || ab === "") return false;
  if (bis == null || bis === "") return false;
  return dayISO > String(bis);
}

/**
 * Soll-Status aus Kalenderdaten (Krank/Urlaub von–bis). Sonst bisherigen Status beibehalten,
 * außer: Krank/Urlaub mit abgeschlossenem Zeitraum → Verfügbar.
 * @param {Employee} emp
 * @param {string} dayISO
 */
export function computeAutoStatusForEmployee(emp, dayISO) {
  const inK = isDayInAbsenceRange(dayISO, emp.Krank_ab, emp.Krank_bis);
  const inU = isDayInAnyUrlaubRange(dayISO, emp);
  if (inK) return "Krank";
  if (inU) return "Urlaub";
  /* Krank eingetragen, aber Krankheit beginnt erst später: wie Urlaub nicht als abwesend zählen */
  const kAb = emp.Krank_ab != null && emp.Krank_ab !== "" ? String(emp.Krank_ab).trim() : "";
  if (emp.Status === "Krank" && kAb && dayISO < kAb) {
    return "Verfügbar";
  }
  if (emp.Status === "Krank" && emp.Krank_ab && isDayAfterClosedAbsenceRange(dayISO, emp.Krank_ab, emp.Krank_bis)) {
    return "Verfügbar";
  }
  if (emp.Status === "Urlaub" && hasAnyUrlaubStart(emp) && !inU) {
    return "Verfügbar";
  }
  return emp.Status;
}

/** Passt alle Mitarbeitenden-Status an den Kalendertag an. @returns {boolean} true bei Änderung */
export function syncEmployeeStatusesFromAbsenceDates(dayISO = todayISO()) {
  if (!getState()) return false;
  let changed = false;
  for (const emp of getState().employees) {
    const next = computeAutoStatusForEmployee(emp, dayISO);
    if (next !== emp.Status) {
      emp.Status = next;
      syncLegacyAbsenceFields(emp);
      changed = true;
    }
  }
  return changed;
}

export async function runAutoStatusSyncAndPersist() {
  if (!getState()) return;
  if (!syncEmployeeStatusesFromAbsenceDates()) return;
  await persist();
}

/**
 * Status aller Mitarbeitenden an den Kalendertag anpassen, dann einmal speichern.
 * Nach Stammdaten-/Abwesenheitsänderungen (nicht bei Undo/Redo oder reinen Zuweisungen).
 */
export async function syncEmployeesThenPersist() {
  if (!getState()) return;
  syncEmployeeStatusesFromAbsenceDates();
  await persist();
}

/** Geplanter Start sichtbar: heute im Zeitraum oder Start in 0…5 Tagen. */
export function plannedWindowVisibleOnDashboard(ab, bis) {
  if (ab == null || ab === "") return false;
  if (todayWithinInclusiveISO(ab, bis)) return true;
  const d = daysUntilISODate(String(ab));
  return d !== null && Number.isFinite(d) && d >= 0 && d <= 5;
}

/** Dashboard-Abwesenheitsliste: laufend Krank/Urlaub + relevante Pläne bei „Verfügbar“. */
export function employeeMatchesDashboardAbsencePanel(emp) {
  if (emp.Status === "Krank" || emp.Status === "Urlaub") return true;
  if (emp.Status !== "Verfügbar") return false;
  for (const r of getUrlaubRanges(emp)) {
    if (plannedWindowVisibleOnDashboard(r.ab, r.bis)) return true;
  }
  if (plannedWindowVisibleOnDashboard(emp.Krank_ab, emp.Krank_bis)) return true;
  return plannedWindowVisibleOnDashboard(emp.Abwesenheit_geplant_ab, emp.Abwesenheit_geplant_bis);
}

/**
 * Für Status Verfügbar: ein Anzeige-Zeitraum (Deduplizierung per ab|bis).
 * Priorität: heute im Zeitraum, sonst frühester sichtbarer Start.
 * @returns {{ kind: string; ab: string; bis: string } | null}
 */
export function verfügbarDashboardAbsenceDisplayWindow(emp) {
  const windows = /** @type {{ kind: string; ab: string; bis: string }[]} */ ([]);
  const seen = new Set();
  const push = (kind, ab, bis) => {
    if (ab == null || ab === "") return;
    const b = bis && bis !== "" ? String(bis) : String(ab);
    if (!plannedWindowVisibleOnDashboard(ab, bis)) return;
    const key = `${String(ab)}|${b}|${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    windows.push({ kind, ab: String(ab), bis: b });
  };
  for (const r of getUrlaubRanges(emp)) {
    push("Urlaub", r.ab, r.bis);
  }
  push("Krank", emp.Krank_ab, emp.Krank_bis);
  push("Urlaub", emp.Abwesenheit_geplant_ab, emp.Abwesenheit_geplant_bis);
  if (!windows.length) return null;
  const t = todayISO();
  windows.sort((a, z) => {
    const aIn = t >= a.ab && t <= a.bis ? 0 : 1;
    const zIn = t >= z.ab && t <= z.bis ? 0 : 1;
    if (aIn !== zIn) return aIn - zIn;
    return a.ab.localeCompare(z.ab);
  });
  return windows[0];
}

/** Rückkehr-Hinweis für geplanten Zeitraum (Status noch Verfügbar). */
export function plannedVerfügbarReturnLineHtml(ab, bis, kind = "Urlaub") {
  const ret = addCalendarDaysToISO(bis, 1);
  const icon = kind === "Krank" ? "fa-file-medical" : "fa-umbrella-beach";
  if (ret == null || ret === "") return '<span class="hint">Ende des Zeitraums nicht lesbar</span>';
  const d = daysUntilISODate(ret);
  const de = formatDateDE(ret);
  if (d === null || !Number.isFinite(d)) {
    return `<span class="abs-hint abs-hint--rueckkehr"><i class="fa-solid fa-calendar-check"></i> Geplant: erster Arbeitstag <strong>${escapeHtml(de)}</strong></span>`;
  }
  if (d < 0) {
    return `<span class="abs-hint abs-hint--rueckkehr abs-hint--danger"><i class="fa-solid fa-circle-xmark"></i> Geplanter Arbeitstag <strong>${escapeHtml(de)}</strong> liegt in der Vergangenheit</span>`;
  }
  if (d === 0) {
    return `<span class="abs-hint abs-hint--rueckkehr abs-hint--warn"><i class="fa-solid fa-triangle-exclamation"></i> Geplant: erster Arbeitstag heute · <strong>${escapeHtml(de)}</strong></span>`;
  }
  const urgent = d < 30;
  const cls = urgent ? "abs-hint abs-hint--rueckkehr abs-hint--warn" : "abs-hint abs-hint--rueckkehr";
  return `<span class="${cls}"><i class="fa-solid ${icon}"></i> Geplant: erster Arbeitstag <strong>${escapeHtml(de)}</strong> · noch ${d} Tag${d === 1 ? "" : "e"}</span>`;
}

/** Krank/Urlaub: Abwesenheitszeitraum für die Dashboard-Abwesenheitsliste. */
export function activeAbsencePeriodHtml(emp) {
  if (emp.Status !== "Krank" && emp.Status !== "Urlaub") return "";
  if (emp.Status === "Krank") {
    const ab = emp.Krank_ab;
    const bis = emp.Krank_bis;
    if ((!ab || ab === "") && (!bis || bis === "")) return "";
    const a = ab ? formatDateDE(String(ab)) : "…";
    const b = bis ? formatDateDE(String(bis)) : "…";
    return `<span class="absence-list__period">Abwesend <strong>${escapeHtml(a)}</strong> – <strong>${escapeHtml(b)}</strong></span>`;
  }
  const t = todayISO();
  const r = currentUrlaubRangeForDay(emp, t);
  if (r) {
    const a = formatDateDE(String(r.ab));
    const b = r.bis ? formatDateDE(String(r.bis)) : "…";
    return `<span class="absence-list__period">Abwesend <strong>${escapeHtml(a)}</strong> – <strong>${escapeHtml(b)}</strong></span>`;
  }
  const ranges = getUrlaubRanges(emp);
  if (!ranges.length) return "";
  const a = formatDateDE(String(ranges[0].ab));
  const b = ranges[0].bis ? formatDateDE(String(ranges[0].bis)) : "…";
  const more = ranges.length > 1 ? ` <span class="hint">(und ${ranges.length - 1} weitere)</span>` : "";
  return `<span class="absence-list__period">Abwesend <strong>${escapeHtml(a)}</strong> – <strong>${escapeHtml(b)}</strong>${more}</span>`;
}

