import {
  linkLocalDataFile,
  saveDataToFile,
  isFileSystemAccessSupported,
  getLinkedFileName,
} from "./fileHandler.js";

/** @typedef {{ von: string, bis: string|null }} Urlaubsperiode */
/** @typedef {{ ID:number, Personalnummer:string, Vorname:string, Nachname:string, Qualifikation:string, Zusatz_Tags:string[], Teamleiter_ID:number|null, Beschäftigung:"AÜG"|"Eigene", Stufe:string, Abteilung:string, Status:string, Rückkehr_erwartet_am:string|null, Abwesenheit_geplant_ab:string|null, Abwesenheit_geplant_bis:string|null, Krank_ab:string|null, Krank_bis:string|null, Urlaub_ab:string|null, Urlaub_bis:string|null, Urlaub_perioden: Urlaubsperiode[] }} Employee */
/** @typedef {{ ID:number, Name:string, Team_Farbe:string, Abteilung:string, Reihenfolge:number }} TeamLeader */
/** @typedef {{ ID:number, Name:string, Startdatum:string, Enddatum:string, Benötigte_Qualifikationen:Record<string, number> }} Project */
/** @typedef {{ ID:number, Project_ID:number, Employee_ID:number, Startdatum:string, Enddatum:string }} Assignment */

const QUALIFICATIONS = [
  "Monteur",
  "Schweißer",
  "Bauleiter",
  "Elektriker",
  "Lagerist",
];

const BESCHÄFTIGUNG_AÜG = "AÜG";
const BESCHÄFTIGUNG_EIGENE = "Eigene";

/** Feste Abteilungsliste (Personal-Tabelle & Dropdown). */
const ABTEILUNGEN = /** @type {const} */ ([
  "Mechanik",
  "Steriltechnik",
  "Kunststofftechnik und Gewerbe",
  "Rohrfertigung",
]);

/** @param {unknown} raw */
function normalizeAbteilung(raw) {
  let s = String(raw ?? "").trim();
  if (s === "KunststoffIch und Gewerbe") s = "Kunststofftechnik und Gewerbe";
  if (/** @type {readonly string[]} */ (ABTEILUNGEN).includes(s)) return s;
  return ABTEILUNGEN[0];
}

/** @param {unknown} raw @returns {Urlaubsperiode[]} */
function normalizeUrlaubPerioden(raw) {
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
    out.push({ von, bis: bisStr || null });
  }
  return out;
}

/** @param {unknown} raw @returns {"AÜG"|"Eigene"} */
function normalizeBeschäftigung(raw) {
  const s = String(raw ?? "").trim();
  if (s === BESCHÄFTIGUNG_AÜG) return BESCHÄFTIGUNG_AÜG;
  return BESCHÄFTIGUNG_EIGENE;
}

function normalizeAllEmployeesShape() {
  if (!state) return;
  for (const emp of state.employees) {
    emp.Beschäftigung = normalizeBeschäftigung(emp.Beschäftigung);
    emp.Stufe = emp.Stufe != null && emp.Stufe !== "" ? String(emp.Stufe).trim() : "";
    emp.Abteilung = normalizeAbteilung(emp.Abteilung);
    emp.Urlaub_perioden = normalizeUrlaubPerioden(emp.Urlaub_perioden);
  }
}

/** @type {{ employees: Employee[], team_leaders: TeamLeader[], projects: Project[], assignments: Assignment[] } | null} */
let state = null;

const UNDO_HISTORY_LIMIT = 80;
/** @type {string[]} */
let undoStack = [];
/** @type {string[]} */
let redoStack = [];
let historySuspended = false;

function clearUndoHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

function cloneStateJson() {
  if (!state) return "";
  return JSON.stringify(state);
}

function recordUndoSnapshot() {
  if (!state || historySuspended) return;
  undoStack.push(cloneStateJson());
  if (undoStack.length > UNDO_HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

function refreshAllDataViews() {
  if (!state) return;
  renderDashboard();
  renderPersonnelView();
  if ($("#view-projects").classList.contains("view--active")) {
    renderProjectsView();
  }
  if ($("#view-urlaub")?.classList?.contains("view--active")) {
    renderUrlaubPlan();
  }
}

async function undoLastChange() {
  if (!state || historySuspended || undoStack.length === 0) return;
  const prevJson = undoStack.pop();
  if (!prevJson) return;
  redoStack.push(cloneStateJson());
  historySuspended = true;
  try {
    state = /** @type {typeof state} */ (JSON.parse(prevJson));
    normalizeAllEmployeesShape();
    await persist();
    refreshAllDataViews();
  } finally {
    historySuspended = false;
  }
}

async function redoLastChange() {
  if (!state || historySuspended || redoStack.length === 0) return;
  const nextJson = redoStack.pop();
  if (!nextJson) return;
  undoStack.push(cloneStateJson());
  historySuspended = true;
  try {
    state = /** @type {typeof state} */ (JSON.parse(nextJson));
    normalizeAllEmployeesShape();
    await persist();
    refreshAllDataViews();
  } finally {
    historySuspended = false;
  }
}

/** @param {Event} ev */
function isTypingFieldUndoTarget(ev) {
  const el = ev.target;
  if (!(el instanceof Element)) return false;
  const tag = el.tagName;
  if (tag === "TEXTAREA") return true;
  if (el.getAttribute("contenteditable") === "true") return true;
  if (tag === "INPUT") {
    const t = (/** @type {HTMLInputElement} */ (el).type || "text").toLowerCase();
    if (["text", "search", "email", "url", "tel", "password"].includes(t)) return true;
  }
  return false;
}

function setupHistoryKeyboard() {
  document.addEventListener("keydown", (ev) => {
    if (!(ev.ctrlKey || ev.metaKey) || !state) return;
    if (isTypingFieldUndoTarget(ev)) return;
    const k = ev.key;
    if (k === "z" || k === "Z") {
      if (ev.shiftKey) {
        if (redoStack.length === 0) return;
        ev.preventDefault();
        void redoLastChange();
      } else {
        if (undoStack.length === 0) return;
        ev.preventDefault();
        void undoLastChange();
      }
    } else if (k === "y" || k === "Y") {
      if (redoStack.length === 0) return;
      ev.preventDefault();
      void redoLastChange();
    }
  });
}

function nextId(list, key = "ID") {
  if (!list.length) return 1;
  return Math.max(...list.map((item) => Number(item[key]) || 0)) + 1;
}

async function persist() {
  if (!state) return;
  const err = /** @type {HTMLParagraphElement} */ (document.querySelector("#file-error"));
  const meta = /** @type {HTMLParagraphElement} */ (document.querySelector("#file-meta"));
  err.hidden = true;
  err.textContent = "";
  try {
    await saveDataToFile(state);
    meta.textContent = `Aktiv: ${getLinkedFileName()} · zuletzt gespeichert ${new Date().toLocaleTimeString("de-DE")}`;
  } catch (e) {
    err.hidden = false;
    err.textContent =
      e && typeof e === "object" && "message" in e
        ? /** @type {{message:string}} */ (e).message
        : String(e);
  }
}

function $(sel, root = document) {
  return root.querySelector(sel);
}

function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

const views = {
  dashboard: /** @type {HTMLElement} */ ($("#view-dashboard")),
  projects: /** @type {HTMLElement} */ ($("#view-projects")),
  personnel: /** @type {HTMLElement} */ ($("#view-personnel")),
  urlaub: /** @type {HTMLElement} */ ($("#view-urlaub")),
};

const titles = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Teams, Verfügbarkeit und Kennzahlen auf einen Blick.",
  },
  projects: {
    title: "Zeitleiste",
    subtitle: "Gantt-Übersicht, Ressourcenpool und Zuweisungen mit Konfliktprüfung.",
  },
  personnel: {
    title: "Personalverwaltung",
    subtitle: "Stammdaten pflegen, filtern und Teamzuordnungen ändern.",
  },
  urlaub: {
    title: "Urlaub",
    subtitle: "Urlaubszeiten aller Mitarbeitenden im Monatsraster – filterbar.",
  },
};

/** Angezeigter Monat in der Urlaubsplan-Ansicht (Jahr, Monat 0–11). */
let urlaubCalendarYM = (() => {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() };
})();

let ganttInstance = null;
/** @type {"Day"|"Week"|"Month"} */
let ganttViewMode = "Month";

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** @param {string|null|undefined} isoStr @param {number} deltaDays */
function addCalendarDaysToISO(isoStr, deltaDays) {
  if (isoStr == null || isoStr === "") return null;
  const [y, m, d] = String(isoStr).split("-").map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const dt = new Date(y, m - 1, d);
  dt.setHours(12, 0, 0, 0);
  dt.setDate(dt.getDate() + deltaDays);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Gantt liefert `Date` (lokal); für Projekt-Stammdaten yyyy-mm-dd. */
function dateFromGanttToProjectISO(/** @type {unknown} */ d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * frappe-gantt speichert task._end als exklusives Ende; letzter belegter Kalendertag = Tag davor.
 * @param {Date} exclusiveEnd
 */
function inclusiveEndISOFromGanttExclusiveEnd(exclusiveEnd) {
  if (!(exclusiveEnd instanceof Date) || Number.isNaN(exclusiveEnd.getTime())) return "";
  const t = new Date(exclusiveEnd.getTime());
  t.setMilliseconds(t.getMilliseconds() - 1);
  return dateFromGanttToProjectISO(t);
}

/** Erster Arbeitstag nach dem letzten Abwesenheitstag (inkl. „bis“). */
function firstWorkdayAfterAbsenceEnd(/** @type {Employee} */ emp) {
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
function syncLegacyAbsenceFields(/** @type {Employee} */ emp) {
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

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Alle Urlaubs-Zeiträume: Hauptfelder Urlaub_ab/bis plus zusätzliche Einträge in Urlaub_perioden.
 * @param {Employee} emp
 * @returns {{ ab: string; bis: string | null }[]}
 */
function getUrlaubRanges(emp) {
  /** @type {{ ab: string; bis: string | null }[]} */
  const ranges = [];
  if (emp.Urlaub_ab != null && emp.Urlaub_ab !== "") {
    const bis = emp.Urlaub_bis != null && emp.Urlaub_bis !== "" ? String(emp.Urlaub_bis) : null;
    ranges.push({ ab: String(emp.Urlaub_ab), bis });
  }
  for (const p of emp.Urlaub_perioden || []) {
    if (!p || !p.von) continue;
    const bis = p.bis != null && p.bis !== "" ? String(p.bis) : null;
    ranges.push({ ab: String(p.von), bis });
  }
  return ranges;
}

function bisNormUrlaub(/** @type {string|null|undefined} */ b) {
  return b == null || b === "" ? null : String(b);
}

function sameUrlaubSpan(
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
function urlaubDuplicateAgainst(emp, von, bis, exclude) {
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
function isDayInAnyUrlaubRange(dayISO, emp) {
  return getUrlaubRanges(emp).some((r) => isDayInAbsenceRange(dayISO, r.ab, r.bis));
}

/** @param {Employee} emp */
function hasAnyUrlaubStart(emp) {
  return getUrlaubRanges(emp).length > 0;
}

/**
 * Zeitraum, der den Kalendertag abdeckt (für Rückkehr / Anzeige).
 * @param {Employee} emp
 * @param {string} dayISO
 */
function currentUrlaubRangeForDay(emp, dayISO) {
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
function urlaubPlannedEnvelope(emp) {
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

function getEmployee(id) {
  if (!state) return undefined;
  return state.employees.find((e) => Number(e.ID) === Number(id));
}

function getProject(id) {
  if (!state) return undefined;
  return state.projects.find((p) => Number(p.ID) === Number(id));
}

function getTeamLeader(id) {
  if (!state) return undefined;
  return state.team_leaders.find((t) => Number(t.ID) === Number(id));
}

function teamLeadersSortedForDashboard() {
  if (!state) return [];
  return [...state.team_leaders].sort((a, b) => {
    const ra = Number(a.Reihenfolge);
    const rb = Number(b.Reihenfolge);
    const oa = Number.isFinite(ra) ? ra : 1e9;
    const ob = Number.isFinite(rb) ? rb : 1e9;
    if (oa !== ob) return oa - ob;
    return Number(a.ID) - Number(b.ID);
  });
}

function reorderTeamLeadersOnDashboard(fromIdStr, toIdStr) {
  if (!state) return;
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
    const live = state.team_leaders.find((x) => Number(x.ID) === Number(t.ID));
    if (live) live.Reihenfolge = i;
  });
}

function employeeActiveOnProjectToday(empId) {
  if (!state) return false;
  const t = todayISO();
  return state.assignments.some(
    (a) =>
      Number(a.Employee_ID) === Number(empId) &&
      rangesOverlap(a.Startdatum, a.Enddatum, t, t)
  );
}

/** Kalendertage bis zum Zieldatum (heute → Ziel); negativ = Datum liegt in der Vergangenheit. */
function daysUntilISODate(isoStr) {
  if (isoStr == null || isoStr === "") return null;
  const end = parseISODate(String(isoStr));
  if (Number.isNaN(end.getTime())) return null;
  const start = parseISODate(todayISO());
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
}

/** ISO-Datum (yyyy-mm-dd) → Anzeige dd.mm.yyyy */
function formatDateDE(iso) {
  if (iso == null || iso === "") return "";
  const parts = String(iso).trim().split("-");
  if (parts.length < 3) return String(iso);
  const [y, m, d] = parts;
  if (!y || !m || !d) return String(iso);
  return `${d}.${m}.${y}`;
}

/** Krank/Urlaub: Hinweis bis zum ersten Arbeitstag nach dem letzten Abwesenheitstag (HTML). */
function absenceReturnBadgeHtml(emp) {
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
function plannedAbsenceBadgeHtml(emp) {
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
function absenceSummaryPlain(emp) {
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
function plannedAbsencePoolLine(emp) {
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

function readOptionalISODateFromInput(id) {
  const el = /** @type {HTMLInputElement | null} */ ($(id));
  if (!el) return null;
  const v = el.value.trim();
  return v === "" ? null : v;
}

function addDaysFromTodayISO(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return todayISO();
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** @param {HTMLSelectElement | null} sel */
function ensureSelectHasValue(sel, value, labelText) {
  if (!sel || value == null || value === "") return;
  const v = String(value);
  if ([...sel.options].some((o) => o.value === v)) {
    sel.value = v;
    return;
  }
  const opt = document.createElement("option");
  opt.value = v;
  opt.textContent = labelText != null ? String(labelText) : v;
  sel.appendChild(opt);
  sel.value = v;
}

function absenceHintText(status) {
  if (status === "Verfügbar") {
    return "Krankheit und Urlaub: Hauptzeitraum (von/bis) plus beliebig viele weitere Urlaubsblöcke. Kalendertage inklusive. Ab 5 Tage vor „von“ zeigt das Dashboard Hinweise. Liegt heute in einem Urlaubs- oder Krankheitszeitraum, wird der Status automatisch angepasst; nach abgeschlossenen Zeiträumen (mit „bis“) wieder „Verfügbar“.";
  }
  if (status === "Krank" || status === "Urlaub") {
    return "„Von“ und „bis“ = erster bzw. letzter freier Tag; der erste Arbeitstag ist automatisch der Tag nach „bis“. Zusätzliche Urlaubszeiten unten eintragen. Schnellbuttons setzen „bis“ auf eine bzw. zwei Wochen ab heute.";
  }
  return "";
}

function syncEditAbsenceHint() {
  const el = /** @type {HTMLSelectElement | null} */ ($("#emp-status"));
  const hint = /** @type {HTMLElement | null} */ ($("#emp-absence-hint"));
  if (!el || !hint) return;
  hint.textContent = absenceHintText(el.value);
}

function syncNewAbsenceHint() {
  const el = /** @type {HTMLSelectElement | null} */ ($("#new-emp-status"));
  const hint = /** @type {HTMLElement | null} */ ($("#new-emp-absence-hint"));
  if (!el || !hint) return;
  hint.textContent = absenceHintText(el.value);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const URLAUB_GANTT_MODAL_HINT_NEW =
  "Wird als <strong>weiterer Urlaubszeitraum</strong> gespeichert (wie in der Personalverwaltung). Leeres „Bis“ = offenes Ende ab „Von“.";

const URLAUB_GANTT_MODAL_HINT_EDIT =
  "Sie bearbeiten einen <strong>bestehenden</strong> Zeitraum (Haupt-Urlaub oder Zusatzeintrag). Leeres „Bis“ = offenes Ende.";

function urlaubPeriodRowTemplate(von = "", bis = "") {
  const v = von ? escapeHtml(von) : "";
  const b = bis ? escapeHtml(bis) : "";
  return `<div class="urlaub-per-row form-grid form-grid--wide form-section__grid">
    <label>Weiterer Urlaub von (optional)<input type="date" class="js-u-von" value="${v}" /></label>
    <label>Bis (optional)<input type="date" class="js-u-bis" value="${b}" /></label>
    <div class="form-actions--inline"><button type="button" class="btn btn--ghost btn--tiny js-u-remove" title="Zeile entfernen"><i class="fa-solid fa-xmark"></i> Entfernen</button></div>
  </div>`;
}

function renderUrlaubPeriodenContainer(hostId, /** @type {Urlaubsperiode[]} */ periods) {
  const host = document.getElementById(hostId);
  if (!(host instanceof HTMLElement)) return;
  const list = periods && periods.length ? periods : [];
  host.innerHTML = list.length ? list.map((p) => urlaubPeriodRowTemplate(p.von, p.bis ?? "")).join("") : "";
}

function collectUrlaubPeriodenFromContainer(hostId) {
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
    out.push({ von, bis: bisRaw === "" ? null : bisRaw });
  }
  return out;
}

/** @param {unknown} raw @returns {boolean} */
function validateUrlaubPeriodOrder(rawVon, rawBis) {
  const von = rawVon == null || rawVon === "" ? null : String(rawVon);
  const bis = rawBis == null || rawBis === "" ? null : String(rawBis);
  if (von && bis && bis < von) return false;
  return true;
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** @param {number} y @param {number} m0 Monat 0–11 */
function monthRangeISO(y, m0) {
  const days = new Date(y, m0 + 1, 0).getDate();
  const start = `${y}-${pad2(m0 + 1)}-01`;
  const end = `${y}-${pad2(m0 + 1)}-${pad2(days)}`;
  return { start, end, days };
}

/** Ostersonntag, lokales Mittag (gregorianisch, anonym-gregorianischer Algorithmus). */
function easterSundayLocalMidday(/** @type {number} */ year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

/** @param {Date} d @param {number} n */
function addCalendarDaysToDate(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  x.setHours(12, 0, 0, 0);
  return x;
}

/** @param {Date} d */
function toISODateLocal(d) {
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Gesetzliche Feiertage Hessen: ISO-Datum → deutscher Kurzname (pro Jahr). */
function hessenHolidayMapForYear(/** @type {number} */ year) {
  const Easter = easterSundayLocalMidday(year);
  /** @type {Map<string, string>} */
  const m = new Map();
  m.set(toISODateLocal(new Date(year, 0, 1, 12, 0, 0, 0)), "Neujahr");
  m.set(toISODateLocal(new Date(year, 4, 1, 12, 0, 0, 0)), "Tag der Arbeit");
  m.set(toISODateLocal(new Date(year, 9, 3, 12, 0, 0, 0)), "Tag der Deutschen Einheit");
  m.set(toISODateLocal(new Date(year, 11, 25, 12, 0, 0, 0)), "1. Weihnachtstag");
  m.set(toISODateLocal(new Date(year, 11, 26, 12, 0, 0, 0)), "2. Weihnachtstag");
  m.set(toISODateLocal(addCalendarDaysToDate(Easter, -2)), "Karfreitag");
  m.set(toISODateLocal(addCalendarDaysToDate(Easter, 1)), "Ostermontag");
  m.set(toISODateLocal(addCalendarDaysToDate(Easter, 39)), "Christi Himmelfahrt");
  m.set(toISODateLocal(addCalendarDaysToDate(Easter, 50)), "Pfingstmontag");
  m.set(toISODateLocal(addCalendarDaysToDate(Easter, 60)), "Fronleichnam");
  return m;
}

/** @type {Map<number, Map<string, string>>} */
const hessenHolidayYearCache = new Map();

function hessenHolidayMapCached(/** @type {number} */ year) {
  let m = hessenHolidayYearCache.get(year);
  if (!m) {
    m = hessenHolidayMapForYear(year);
    hessenHolidayYearCache.set(year, m);
  }
  return m;
}

/** @param {string} iso yyyy-mm-dd */
function hessenHolidayNameDE(iso) {
  const key = String(iso).slice(0, 10);
  const y = Number(key.slice(0, 4));
  if (!Number.isFinite(y)) return null;
  return hessenHolidayMapCached(y).get(key) ?? null;
}

function isHessenPublicHolidayISO(iso) {
  return hessenHolidayNameDE(iso) != null;
}

/** Mo–Fr ohne hessische gesetzliche Feiertage (Urlaubsstatistik). */
function countsAsUrlaubArbeitstag(iso) {
  const d = parseISODate(String(iso));
  const w = d.getDay();
  if (w === 0 || w === 6) return false;
  return !isHessenPublicHolidayISO(iso);
}

/** Arbeitstage im ISO-Inklusivbereich [isoStart, isoEnd] (Hessen). */
function countUrlaubWorkdaysInInclusiveRange(isoStart, isoEnd) {
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

function shiftUrlaubMonth(delta) {
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

function shiftUrlaubYear(delta) {
  urlaubCalendarYM.y += delta;
}

/** @param {string|null|undefined} ab @param {string|null|undefined} bis @param {string} windowStart @param {string} windowEnd */
function clipUrlaubRangeToWindow(ab, bis, windowStart, windowEnd) {
  if (ab == null || ab === "") return null;
  const a = String(ab);
  const effEnd = bis != null && bis !== "" ? String(bis) : windowEnd;
  const start = a > windowStart ? a : windowStart;
  const end = effEnd < windowEnd ? effEnd : windowEnd;
  if (start > end) return null;
  return { start, end };
}

/** @param {string|null|undefined} ab @param {string|null|undefined} bis @param {string} monthStart @param {string} monthEnd */
function clipUrlaubRangeToMonth(ab, bis, monthStart, monthEnd) {
  return clipUrlaubRangeToWindow(ab, bis, monthStart, monthEnd);
}

/** Inklusive Kalendertage zwischen zwei ISO-Daten (yyyy-mm-dd). */
function calendarDaysInclusive(isoStart, isoEnd) {
  const [ya, ma, da] = String(isoStart).split("-").map(Number);
  const [yb, mb, db] = String(isoEnd).split("-").map(Number);
  const t0 = new Date(ya, ma - 1, da).setHours(12, 0, 0, 0);
  const t1 = new Date(yb, mb - 1, db).setHours(12, 0, 0, 0);
  return Math.round((t1 - t0) / 86400000) + 1;
}

/** Überlappende oder aneinander grenzende Urlaubsclips zusammenführen (keine Doppelzählung). */
function mergeInclusiveUrlaubClips(/** @type {{ start: string; end: string }[]} */ clips) {
  if (!clips.length) return [];
  const sorted = clips.slice().sort((a, b) => a.start.localeCompare(b.start));
  /** @type {{ start: string; end: string }[]} */
  const out = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const c = sorted[i];
    const last = out[out.length - 1];
    const lastPlus = addCalendarDaysToISO(last.end, 1);
    if (lastPlus != null && c.start <= lastPlus) {
      if (c.end > last.end) last.end = c.end;
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

/** Urlaubs-Arbeitstage (Hessen: Mo–Fr ohne gesetzliche Feiertage) im Fenster [winStart, winEnd]. */
function countVacationDaysInWindow(/** @type {Employee} */ emp, winStart, winEnd) {
  /** @type {{ start: string; end: string }[]} */
  const clips = [];
  for (const r of getUrlaubRanges(emp)) {
    const clip = clipUrlaubRangeToWindow(r.ab, r.bis, winStart, winEnd);
    if (clip) clips.push(clip);
  }
  const merged = mergeInclusiveUrlaubClips(clips);
  return merged.reduce((sum, iv) => sum + countUrlaubWorkdaysInInclusiveRange(iv.start, iv.end), 0);
}

/** @param {string} iso */
function dayOfMonthFromISO(iso) {
  return Number(String(iso).slice(8, 10)) || 1;
}

/**
 * Überlappende Urlaubsbalken auf Zeilen verteilen (grid-row).
 * @param {{ gs: number; ge: number; rangeVon: string; rangeBis: string; slot: "haupt" | "zusatz" }[]} segs gs erster Tag (1…31), ge exklusiv
 * @returns {{ gs: number; ge: number; row: number; rangeVon: string; rangeBis: string; slot: "haupt" | "zusatz" }[]}
 */
function stackVacationBars(segs) {
  const sorted = segs.map((s) => ({
    gs: s.gs,
    ge: s.ge,
    rangeVon: s.rangeVon,
    rangeBis: s.rangeBis,
    slot: s.slot,
    row: 1,
  }));
  /** @type {{ gs: number; ge: number }[][]} */
  const byRow = [];
  for (const s of sorted) {
    let r = 0;
    for (; r < byRow.length; r++) {
      const overlap = byRow[r].some((o) => !(s.ge <= o.gs || s.gs >= o.ge));
      if (!overlap) break;
    }
    if (!byRow[r]) byRow[r] = [];
    byRow[r].push({ gs: s.gs, ge: s.ge });
    s.row = r + 1;
  }
  return sorted;
}

function fillUrlaubFilterSelects() {
  if (!state) return;
  const quals = uniqueQualifications();
  const qualSel = /** @type {HTMLSelectElement | null} */ ($("#urlaub-filter-qual"));
  if (qualSel) {
    const prev = qualSel.value;
    qualSel.innerHTML =
      '<option value="">Alle</option>' +
      quals.map((q) => `<option value="${escapeHtml(q)}">${escapeHtml(q)}</option>`).join("");
    if (prev && [...qualSel.options].some((o) => o.value === prev)) qualSel.value = prev;
  }
  const stufeSel = /** @type {HTMLSelectElement | null} */ ($("#urlaub-filter-stufe"));
  if (stufeSel) {
    const prevS = stufeSel.value;
    const stufen = [
      ...new Set(state.employees.map((e) => String(e.Stufe ?? "").trim()).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "de"));
    stufeSel.innerHTML =
      '<option value="">Alle</option>' +
      stufen.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    if (prevS && [...stufeSel.options].some((o) => o.value === prevS)) stufeSel.value = prevS;
  }
}

function filterEmployeesForUrlaubView() {
  if (!state) return [];
  const qEl = /** @type {HTMLInputElement | null} */ ($("#urlaub-search"));
  const fqEl = /** @type {HTMLSelectElement | null} */ ($("#urlaub-filter-qual"));
  const fBeschEl = /** @type {HTMLSelectElement | null} */ ($("#urlaub-filter-beschäftigung"));
  const fStufeEl = /** @type {HTMLSelectElement | null} */ ($("#urlaub-filter-stufe"));
  const fAbtEl = /** @type {HTMLSelectElement | null} */ ($("#urlaub-filter-abteilung"));
  const fstEl = /** @type {HTMLSelectElement | null} */ ($("#urlaub-filter-status"));
  const q = (qEl?.value ?? "").trim().toLowerCase();
  const fq = fqEl?.value ?? "";
  const fBesch = fBeschEl?.value ?? "";
  const fStufe = fStufeEl?.value ?? "";
  const fAbt = fAbtEl?.value ?? "";
  const fst = fstEl?.value ?? "";
  return state.employees.filter((e) => {
    const hay = `${e.Vorname} ${e.Nachname} ${e.Personalnummer}`.toLowerCase();
    if (q && !hay.includes(q)) return false;
    if (fst && e.Status !== fst) return false;
    if (fq && e.Qualifikation !== fq) return false;
    if (fBesch && normalizeBeschäftigung(e.Beschäftigung) !== fBesch) return false;
    if (fStufe && String(e.Stufe ?? "").trim() !== fStufe) return false;
    if (fAbt && normalizeAbteilung(e.Abteilung) !== fAbt) return false;
    return true;
  });
}

function isoFromYearMonthDay(y, m0, day) {
  return `${y}-${pad2(m0 + 1)}-${pad2(day)}`;
}

function renderUrlaubPlan() {
  if (!state) return;
  const root = /** @type {HTMLElement | null} */ ($("#urlaub-plan-root"));
  const labelEl = /** @type {HTMLElement | null} */ ($("#urlaub-month-label"));
  if (!root || !labelEl) return;
  fillUrlaubFilterSelects();
  const { y, m } = urlaubCalendarYM;
  labelEl.textContent = new Date(y, m, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  const { start: monthStart, end: monthEnd, days } = monthRangeISO(y, m);
  const employees = filterEmployeesForUrlaubView().sort((a, b) =>
    `${a.Nachname} ${a.Vorname}`.localeCompare(`${b.Nachname} ${b.Vorname}`, "de")
  );

  const headCells = [];
  /** @type {string[]} */
  const trackColBgs = [];
  for (let d = 1; d <= days; d++) {
    const dt = new Date(y, m, d);
    const iso = isoFromYearMonthDay(y, m, d);
    const w = dt.getDay();
    const isWe = w === 0 || w === 6;
    const hName = hessenHolidayNameDE(iso);
    const shortD = dt.toLocaleDateString("de-DE", { weekday: "short" });
    const titleBase = dt.toLocaleDateString("de-DE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const title = hName ? `${titleBase} · ${hName}` : titleBase;
    const cls = [
      "urlaub-plan__head-col",
      isWe ? "urlaub-plan__head-col--we" : "",
      hName ? "urlaub-plan__head-col--holiday" : "",
    ]
      .filter(Boolean)
      .join(" ");
    headCells.push(
      `<div class="${cls}" title="${escapeHtml(title)}"><span class="urlaub-plan__head-day">${d}</span><span class="urlaub-plan__head-dow">${escapeHtml(
        shortD
      )}</span></div>`
    );
    const bgCls = [
      "urlaub-plan__colbg",
      isWe ? "urlaub-plan__colbg--we" : "",
      hName ? "urlaub-plan__colbg--holiday" : "",
    ]
      .filter(Boolean)
      .join(" ");
    trackColBgs.push(
      `<div class="${bgCls}" style="grid-column:${d}; grid-row:1 / -1" aria-hidden="true"></div>`
    );
  }
  const trackColBgsHtml = trackColBgs.join("");

  const rows = employees.map((emp) => {
    const ranges = getUrlaubRanges(emp);
    const hasMain = emp.Urlaub_ab != null && emp.Urlaub_ab !== "";
    /** @type {{ gs: number; ge: number; rangeVon: string; rangeBis: string; slot: "haupt" | "zusatz" }[]} */
    const rawSegs = [];
    for (let ri = 0; ri < ranges.length; ri++) {
      const r = ranges[ri];
      const clip = clipUrlaubRangeToMonth(r.ab, r.bis, monthStart, monthEnd);
      if (!clip) continue;
      const gs = dayOfMonthFromISO(clip.start);
      const ge = dayOfMonthFromISO(clip.end) + 1;
      const isMain = hasMain && ri === 0;
      const rangeBis = r.bis == null ? "" : String(r.bis);
      rawSegs.push({
        gs,
        ge,
        rangeVon: r.ab,
        rangeBis,
        slot: isMain ? "haupt" : "zusatz",
      });
    }
    const segs = stackVacationBars(rawSegs);
    const maxRow = segs.length ? Math.max(...segs.map((s) => s.row)) : 1;
    const bars = segs.length
      ? segs
          .map((s) => {
            const fullTitle =
              s.rangeBis === ""
                ? `${formatDateDE(s.rangeVon)}–… (Bearbeiten)`
                : `${formatDateDE(s.rangeVon)}–${formatDateDE(s.rangeBis)}`;
            const dbAttr = escapeHtml(s.rangeBis);
            return `<div class="urlaub-bar" style="grid-column:${s.gs} / ${s.ge}; grid-row:${s.row}" title="${escapeHtml(
              fullTitle
            )}" data-urlaub-slot="${s.slot}" data-urlaub-von="${escapeHtml(s.rangeVon)}" data-urlaub-bis="${dbAttr}"></div>`;
          })
          .join("")
      : '<span class="hint urlaub-plan__empty">kein Urlaub</span>';
    const name = `${escapeHtml(emp.Nachname)}, ${escapeHtml(emp.Vorname)}`;
    return `<div class="urlaub-plan__row">
      <div class="urlaub-plan__namecell">${name}</div>
      <div class="urlaub-plan__track urlaub-plan--daylines urlaub-plan__track--pick" style="--urlaub-d:${days}; --urlaub-rows:${maxRow}" data-urlaub-emp="${emp.ID}" data-urlaub-days="${days}" data-urlaub-y="${y}" data-urlaub-m0="${m}" title="Freie Fläche: neuen Urlaub eintragen · Balken: bestehenden Zeitraum bearbeiten">${trackColBgsHtml}${bars}</div>
    </div>`;
  });

  const monthHeadCells = [];
  for (let m0 = 0; m0 < 12; m0++) {
    const mh = new Date(y, m0, 1).toLocaleDateString("de-DE", { month: "short" });
    monthHeadCells.push(`<th scope="col" class="urlaub-year-th">${escapeHtml(mh)}</th>`);
  }

  const yearSummaryRows = employees
    .map((emp) => {
      const cells = [];
      for (let m0 = 0; m0 < 12; m0++) {
        const { start: ms, end: me } = monthRangeISO(y, m0);
        const n = countVacationDaysInWindow(emp, ms, me);
        cells.push(`<td class="urlaub-summary__num">${n}</td>`);
      }
      const yTotal = countVacationDaysInWindow(emp, `${y}-01-01`, `${y}-12-31`);
      return `<tr>
        <td>${escapeHtml(`${emp.Nachname}, ${emp.Vorname}`)}</td>
        ${cells.join("")}
        <td class="urlaub-summary__num urlaub-summary__num--sum">${yTotal}</td>
      </tr>`;
    })
    .join("");

  root.innerHTML = `<div class="urlaub-plan" style="--urlaub-days:${days}">
    <div class="urlaub-plan__head-row">
      <div class="urlaub-plan__corner">Mitarbeitende/r</div>
      <div class="urlaub-plan__head-days" style="--urlaub-d:${days}">${headCells.join("")}</div>
    </div>
    ${
      rows.length
        ? rows.join("")
        : '<p class="hint urlaub-plan__empty urlaub-plan__empty--block">Keine Einträge für die Filter.</p>'
    }
    <div class="urlaub-plan__after">
      <div class="panel urlaub-summary-panel">
        <h3 class="urlaub-summary__title urlaub-summary__title--year">
          <span class="urlaub-year-nav" role="group" aria-label="Jahr wechseln">
            <button type="button" class="btn btn--small urlaub-year-shift" data-delta="-1" title="Vorheriges Jahr" aria-label="Vorheriges Jahr">
              <i class="fa-solid fa-chevron-left"></i>
            </button>
            <span class="urlaub-year-nav__label"><i class="fa-solid fa-calendar"></i> Jahresübersicht ${escapeHtml(String(y))}</span>
            <button type="button" class="btn btn--small urlaub-year-shift" data-delta="1" title="Nächstes Jahr" aria-label="Nächstes Jahr">
              <i class="fa-solid fa-chevron-right"></i>
            </button>
          </span>
        </h3>
        <p class="hint">Arbeitstage Hessen (ohne Sa/So, ohne gesetzliche Feiertage in Hessen) pro Kalendermonat wie im Raster oben; letzte Spalte = Summe Jahr. Pfeile: Jahr wechseln.</p>
        <div class="table-wrap urlaub-year-table-wrap">
          <table class="data-table urlaub-summary-table urlaub-year-table">
            <thead><tr><th>Mitarbeitende/r</th>${monthHeadCells.join("")}<th class="urlaub-year-th-sum">Σ</th></tr></thead>
            <tbody>${yearSummaryRows || '<tr><td colspan="14" class="hint">—</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;
}

function setupUrlaubView() {
  const viewUrlaub = /** @type {HTMLElement | null} */ ($("#view-urlaub"));
  if (viewUrlaub && viewUrlaub.dataset.urlaubYearNav !== "1") {
    viewUrlaub.dataset.urlaubYearNav = "1";
    viewUrlaub.addEventListener("click", (ev) => {
      const t = ev.target instanceof Element ? ev.target.closest("button.urlaub-year-shift[data-delta]") : null;
      if (!(t instanceof HTMLButtonElement)) return;
      const d = Number(t.dataset.delta);
      if (!Number.isFinite(d) || d === 0) return;
      shiftUrlaubYear(d);
      renderUrlaubPlan();
    });
  }

  const prev = /** @type {HTMLButtonElement | null} */ ($("#urlaub-month-prev"));
  const next = /** @type {HTMLButtonElement | null} */ ($("#urlaub-month-next"));
  if (!prev || prev.dataset.bound === "1") return;
  prev.dataset.bound = "1";
  next.dataset.bound = "1";
  prev.addEventListener("click", () => {
    shiftUrlaubMonth(-1);
    renderUrlaubPlan();
  });
  next.addEventListener("click", () => {
    shiftUrlaubMonth(1);
    renderUrlaubPlan();
  });
  for (const id of [
    "urlaub-search",
    "urlaub-filter-qual",
    "urlaub-filter-stufe",
    "urlaub-filter-abteilung",
    "urlaub-filter-beschäftigung",
    "urlaub-filter-status",
  ]) {
    const el = $(`#${id}`);
    if (!el) continue;
    el.addEventListener("input", () => renderUrlaubPlan());
    el.addEventListener("change", () => renderUrlaubPlan());
  }
}

function closeUrlaubGanttBlockModal() {
  const slotInp = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-slot"));
  const vonInp = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-von"));
  const bisInp = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-bis"));
  if (slotInp) slotInp.value = "";
  if (vonInp) vonInp.value = "";
  if (bisInp) bisInp.value = "";
  const titleEl = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-title"));
  if (titleEl) titleEl.textContent = "Urlaub eintragen";
  const hintEl = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-save-hint"));
  if (hintEl) hintEl.innerHTML = URLAUB_GANTT_MODAL_HINT_NEW;
  const bd = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-backdrop"));
  const md = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-modal"));
  if (bd) bd.hidden = true;
  if (md) md.hidden = true;
}

/**
 * @param {number} empId
 * @param {string} vonISO
 * @param {string} bisISO Wert fürs Bis-Feld (leer = offenes Ende)
 * @param {{ slot: "haupt" | "zusatz"; von: string; bis: string | null } | null} [editMeta]
 */
function openUrlaubGanttBlockModal(empId, vonISO, bisISO, editMeta = null) {
  const emp = getEmployee(empId);
  if (!emp) return;
  /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-emp-id")).value = String(emp.ID);
  const nameEl = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-name"));
  if (nameEl) nameEl.textContent = `${emp.Vorname} ${emp.Nachname}`.trim();
  const vEl = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-von"));
  const bEl = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-bis"));
  if (vEl) vEl.value = vonISO;
  if (bEl) bEl.value = bisISO;
  const origSlot = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-slot"));
  const origVon = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-von"));
  const origBis = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-bis"));
  const titleEl = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-title"));
  const hintEl = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-save-hint"));
  if (editMeta) {
    if (origSlot) origSlot.value = editMeta.slot;
    if (origVon) origVon.value = editMeta.von;
    if (origBis) origBis.value = editMeta.bis == null ? "" : String(editMeta.bis);
    if (titleEl) titleEl.textContent = "Urlaub bearbeiten";
    if (hintEl) hintEl.innerHTML = URLAUB_GANTT_MODAL_HINT_EDIT;
  } else {
    if (origSlot) origSlot.value = "";
    if (origVon) origVon.value = "";
    if (origBis) origBis.value = "";
    if (titleEl) titleEl.textContent = "Urlaub eintragen";
    if (hintEl) hintEl.innerHTML = URLAUB_GANTT_MODAL_HINT_NEW;
  }
  const bd = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-backdrop"));
  const md = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-modal"));
  if (bd) bd.hidden = false;
  if (md) md.hidden = false;
  vEl?.focus();
}

function setupUrlaubGanttBlockModal() {
  const wrap = /** @type {HTMLElement | null} */ (document.querySelector(".urlaub-plan-wrap"));
  if (!wrap || wrap.dataset.urlaubGanttClick === "1") return;
  wrap.dataset.urlaubGanttClick = "1";
  wrap.addEventListener("click", (ev) => {
    if (!state) return;
    const view = /** @type {HTMLElement | null} */ ($("#view-urlaub"));
    if (!view?.classList.contains("view--active")) return;
    const t = ev.target instanceof Element ? ev.target : null;
    const track = t?.closest(".urlaub-plan__track[data-urlaub-emp]");
    if (!(track instanceof HTMLElement)) return;
    const bar = t?.closest(".urlaub-bar");
    if (bar instanceof HTMLElement) {
      const empId = Number(track.dataset.urlaubEmp);
      const von = bar.getAttribute("data-urlaub-von");
      const bisRaw = bar.getAttribute("data-urlaub-bis") ?? "";
      const slot = bar.getAttribute("data-urlaub-slot");
      if (!Number.isFinite(empId) || !von || (slot !== "haupt" && slot !== "zusatz")) return;
      const bisNull = bisRaw === "" ? null : bisRaw;
      openUrlaubGanttBlockModal(empId, von, bisRaw, {
        slot: /** @type {"haupt" | "zusatz"} */ (slot),
        von,
        bis: bisNull,
      });
      return;
    }
    const empId = Number(track.dataset.urlaubEmp);
    const days = Number(track.dataset.urlaubDays);
    const y = Number(track.dataset.urlaubY);
    const m0 = Number(track.dataset.urlaubM0);
    if (!Number.isFinite(empId) || !Number.isFinite(days) || !Number.isFinite(y) || !Number.isFinite(m0)) return;
    const rect = track.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const rw = Math.max(rect.width, 1);
    const col = Math.min(days, Math.max(1, Math.floor((x / rw) * days) + 1));
    const iso = isoFromYearMonthDay(y, m0, col);
    openUrlaubGanttBlockModal(empId, iso, iso);
  });

  const form = /** @type {HTMLFormElement | null} */ ($("#urlaub-gantt-block-form"));
  const cancel = /** @type {HTMLButtonElement | null} */ ($("#urlaub-gantt-block-cancel"));
  const bd = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-backdrop"));
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";
  cancel?.addEventListener("click", closeUrlaubGanttBlockModal);
  bd?.addEventListener("click", (e) => {
    if (e.target === bd) closeUrlaubGanttBlockModal();
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state) return;
    const idRaw = /** @type {HTMLInputElement} */ ($("#urlaub-gantt-block-emp-id")).value;
    const empId = Number(idRaw);
    const vAb = readOptionalISODateFromInput("#urlaub-gantt-block-von");
    const vBisRaw = readOptionalISODateFromInput("#urlaub-gantt-block-bis");
    if (!vAb) {
      await openModal("Datum", "<div>Bitte „Von“ setzen.</div>", { variant: "info", confirmText: "Verstanden" });
      return;
    }
    const vBis = vBisRaw && vBisRaw !== "" ? vBisRaw : null;
    if (vBis && vBis < vAb) {
      await openModal(
        "Datum prüfen",
        "<div>„Bis“ darf nicht vor „Von“ liegen.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    const idx = state.employees.findIndex((e) => Number(e.ID) === empId);
    if (idx < 0) return;
    const emp = state.employees[idx];
    const origSlot = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-slot"))?.value ?? "";
    const origVon = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-von"))?.value?.trim() ?? "";
    const origBisRaw = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-bis"))?.value?.trim() ?? "";
    const isEdit = origSlot === "haupt" || origSlot === "zusatz";
    const origBisNull = origBisRaw === "" ? null : origBisRaw;
    const dupExclude =
      isEdit && origVon
        ? /** @type {{ slot: "haupt" | "zusatz"; von: string; bis: string | null }} */ ({
            slot: /** @type {"haupt" | "zusatz"} */ (origSlot),
            von: origVon,
            bis: origBisNull,
          })
        : null;
    const dupMsg = urlaubDuplicateAgainst(emp, vAb, vBis, dupExclude);
    if (dupMsg) {
      await openModal("Hinweis", `<div>${escapeHtml(dupMsg)}</div>`, { variant: "info", confirmText: "Verstanden" });
      return;
    }
    if (isEdit) {
      if (!origVon) {
        await openModal("Hinweis", "<div>Ungültiger Bearbeitungsmodus.</div>", { variant: "info", confirmText: "Verstanden" });
        return;
      }
      if (origSlot === "haupt") {
        if (String(emp.Urlaub_ab || "") !== origVon || bisNormUrlaub(emp.Urlaub_bis) !== bisNormUrlaub(origBisNull)) {
          await openModal(
            "Hinweis",
            "<div>Der Haupt-Urlaub wurde zwischenzeitlich geändert. Bitte die Ansicht aktualisieren (z. B. Monat wechseln).</div>",
            { variant: "info", confirmText: "Verstanden" }
          );
          return;
        }
        recordUndoSnapshot();
        emp.Urlaub_ab = vAb;
        emp.Urlaub_bis = vBis;
      } else {
        const normalized = normalizeUrlaubPerioden(emp.Urlaub_perioden);
        const oi = normalized.findIndex(
          (p) => p.von === origVon && bisNormUrlaub(p.bis) === bisNormUrlaub(origBisNull)
        );
        if (oi < 0) {
          await openModal(
            "Hinweis",
            "<div>Dieser Zusatz-Zeitraum wurde zwischenzeitlich entfernt oder geändert.</div>",
            { variant: "info", confirmText: "Verstanden" }
          );
          return;
        }
        recordUndoSnapshot();
        normalized[oi] = { von: vAb, bis: vBis };
        emp.Urlaub_perioden = normalized;
      }
    } else {
      recordUndoSnapshot();
      const period = /** @type {Urlaubsperiode} */ ({ von: vAb, bis: vBis });
      const normalized = normalizeUrlaubPerioden(emp.Urlaub_perioden);
      normalized.push(period);
      emp.Urlaub_perioden = normalized;
    }
    syncLegacyAbsenceFields(emp);
    state.employees[idx] = emp;
    await syncEmployeesThenPersist();
    closeUrlaubGanttBlockModal();
    renderUrlaubPlan();
    renderPersonnelView();
    renderDashboard();
    if ($("#view-projects").classList.contains("view--active")) {
      renderProjectsView();
    }
  });
}

/** @param {unknown} c */
function sanitizeTeamColor(c) {
  const s = typeof c === "string" ? c.trim() : "";
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  return "#64748b";
}

/** Farben pro Abteilung im Dashboard (Index in ABTEILUNGEN, danach Palette zyklisch; unbekannte Namen stabil per Hash). */
const DASHBOARD_ABTEILUNG_PALETTE = [
  "#2563eb",
  "#0d9488",
  "#7c3aed",
  "#ea580c",
  "#db2777",
  "#0891b2",
  "#4d7c0f",
  "#b45309",
];

/** @param {string} normalizedAbt */
function dashboardAbteilungAkzentfarbe(normalizedAbt) {
  const name = String(normalizedAbt ?? "").trim();
  const list = /** @type {readonly string[]} */ (ABTEILUNGEN);
  const idx = list.indexOf(name);
  if (idx >= 0) return DASHBOARD_ABTEILUNG_PALETTE[idx % DASHBOARD_ABTEILUNG_PALETTE.length];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 52% 36%)`;
}

/**
 * PRÜFUNG 1: Status Krank/Urlaub
 * PRÜFUNG 2: Überschneidung mit beliebigem bestehenden assignment desselben Mitarbeiters
 */
function validateAssignmentForSave(employeeId, start, end) {
  const emp = getEmployee(employeeId);
  if (!emp) return { conflict: true, fullName: "Unbekannt" };
  const fullName = `${emp.Vorname} ${emp.Nachname}`.trim();
  if (emp.Status === "Krank" || emp.Status === "Urlaub") {
    return { conflict: true, fullName };
  }
  if (!state) return { conflict: false, fullName };
  for (const a of state.assignments) {
    if (Number(a.Employee_ID) !== Number(employeeId)) continue;
    if (!rangesOverlap(a.Startdatum, a.Enddatum, start, end)) continue;
    return { conflict: true, fullName };
  }
  return { conflict: false, fullName };
}

function openAssignmentConflictModal(employeeFullName) {
  return new Promise((resolve) => {
    const backdrop = /** @type {HTMLElement | null} */ ($("#assign-conflict-backdrop"));
    const modal = /** @type {HTMLElement | null} */ ($("#assign-conflict-modal"));
    const cancelBtn = /** @type {HTMLButtonElement | null} */ ($("#assign-conflict-cancel"));
    const confirmBtn = /** @type {HTMLButtonElement | null} */ ($("#assign-conflict-confirm"));
    const body = /** @type {HTMLElement | null} */ ($("#assign-conflict-body"));
    if (!backdrop || !modal || !cancelBtn || !confirmBtn || !body) {
      console.error("Konflikt-Modal: erwartete DOM-Elemente fehlen.");
      resolve(false);
      return;
    }
    const nameSafe = String(employeeFullName ?? "").trim() || "Mitarbeiter";
    body.textContent = `Achtung: ${nameSafe} ist im gewählten Zeitraum bereits in einem anderen Projekt eingeteilt oder abwesend. Möchtest du ihn trotzdem zuweisen?`;

    backdrop.hidden = false;
    modal.hidden = false;

    const onBackdropMouseDown = (ev) => {
      if (ev.target === backdrop) {
        cleanup();
        resolve(false);
      }
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    function cleanup() {
      backdrop.removeEventListener("mousedown", onBackdropMouseDown);
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      backdrop.hidden = true;
      modal.hidden = true;
    }

    backdrop.addEventListener("mousedown", onBackdropMouseDown);
    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

function openModal(title, bodyHtml, opts = {}) {
  const confirmText = opts.confirmText ?? "Trotzdem zuweisen";
  const cancelText = opts.cancelText ?? "Abbrechen";
  const variant = opts.variant ?? "confirm";

  return new Promise((resolve) => {
    const backdrop = /** @type {HTMLElement} */ ($("#modal-backdrop"));
    const modal = /** @type {HTMLElement} */ ($("#modal"));
    const cancelBtn = /** @type {HTMLButtonElement} */ ($("#modal-cancel"));
    const confirmBtn = /** @type {HTMLButtonElement} */ ($("#modal-confirm"));

    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = bodyHtml;

    cancelBtn.textContent = cancelText;
    confirmBtn.textContent = confirmText;

    if (variant === "info") {
      cancelBtn.hidden = true;
      confirmBtn.className = "btn btn--primary";
    } else {
      cancelBtn.hidden = false;
      confirmBtn.className = opts.confirmDanger === false ? "btn btn--primary" : "btn btn--danger";
    }

    backdrop.hidden = false;
    modal.hidden = false;

    const onCancel = () => {
      cleanup();
      resolve(false);
    };
    const onConfirm = () => {
      cleanup();
      resolve(true);
    };

    function cleanup() {
      cancelBtn.removeEventListener("click", onCancel);
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.hidden = false;
      backdrop.hidden = true;
      modal.hidden = true;
    }

    cancelBtn.addEventListener("click", onCancel);
    confirmBtn.addEventListener("click", onConfirm);
  });
}

function switchView(name) {
  if (!state) return;
  $all(".nav-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === name);
  });
  Object.entries(views).forEach(([key, el]) => {
    const active = key === name;
    el.hidden = !active;
    el.classList.toggle("view--active", active);
  });
  const meta = titles[/** @type {keyof typeof titles} */ (name)];
  $("#page-title").textContent = meta.title;
  $("#page-subtitle").textContent = meta.subtitle;
  if (name === "dashboard") renderDashboard();
  if (name === "projects") renderProjectsView();
  if (name === "personnel") renderPersonnelView();
  if (name === "urlaub") renderUrlaubPlan();
}

function hasValidTeamLeader(emp) {
  const raw = emp.Teamleiter_ID;
  if (raw === null || raw === undefined || raw === "") return false;
  const id = Number(raw);
  if (!Number.isFinite(id)) return false;
  return !!getTeamLeader(id);
}

function employeesWithoutTeamLeader() {
  if (!state) return [];
  return state.employees.filter((e) => !hasValidTeamLeader(e));
}

/** Abwesenheits-Hinweise für eine Person (Dashboard: Teamkarte & Chip). */
function dashboardMemberAbsenceBlock(emp) {
  const ret = absenceReturnBadgeHtml(emp).trim();
  const plan = plannedAbsenceBadgeHtml(emp).trim();
  if (!ret && !plan) return "";
  return `<div class="dashboard-emp-abs">${[ret, plan].filter(Boolean).join(" ")}</div>`;
}

/** True, wenn heute im inklusiven Zeitraum [ab, bis] liegt. */
function todayWithinInclusiveISO(ab, bis) {
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
function isDayInAbsenceRange(dayISO, ab, bis) {
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
function isDayAfterClosedAbsenceRange(dayISO, ab, bis) {
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
function computeAutoStatusForEmployee(emp, dayISO) {
  const inK = isDayInAbsenceRange(dayISO, emp.Krank_ab, emp.Krank_bis);
  const inU = isDayInAnyUrlaubRange(dayISO, emp);
  if (inK) return "Krank";
  if (inU) return "Urlaub";
  if (emp.Status === "Krank" && emp.Krank_ab && isDayAfterClosedAbsenceRange(dayISO, emp.Krank_ab, emp.Krank_bis)) {
    return "Verfügbar";
  }
  if (emp.Status === "Urlaub" && hasAnyUrlaubStart(emp) && !inU) {
    return "Verfügbar";
  }
  return emp.Status;
}

/** Passt alle Mitarbeitenden-Status an den Kalendertag an. @returns {boolean} true bei Änderung */
function syncEmployeeStatusesFromAbsenceDates(dayISO = todayISO()) {
  if (!state) return false;
  let changed = false;
  for (const emp of state.employees) {
    const next = computeAutoStatusForEmployee(emp, dayISO);
    if (next !== emp.Status) {
      emp.Status = next;
      changed = true;
    }
  }
  return changed;
}

async function runAutoStatusSyncAndPersist() {
  if (!state) return;
  if (!syncEmployeeStatusesFromAbsenceDates()) return;
  await persist();
}

/**
 * Status aller Mitarbeitenden an den Kalendertag anpassen, dann einmal speichern.
 * Nach Stammdaten-/Abwesenheitsänderungen (nicht bei Undo/Redo oder reinen Zuweisungen).
 */
async function syncEmployeesThenPersist() {
  if (!state) return;
  syncEmployeeStatusesFromAbsenceDates();
  await persist();
}

/** Geplanter Start sichtbar: heute im Zeitraum oder Start in 0…5 Tagen. */
function plannedWindowVisibleOnDashboard(ab, bis) {
  if (ab == null || ab === "") return false;
  if (todayWithinInclusiveISO(ab, bis)) return true;
  const d = daysUntilISODate(String(ab));
  return d !== null && Number.isFinite(d) && d >= 0 && d <= 5;
}

/** Dashboard-Abwesenheitsliste: laufend Krank/Urlaub + relevante Pläne bei „Verfügbar“. */
function employeeMatchesDashboardAbsencePanel(emp) {
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
function verfügbarDashboardAbsenceDisplayWindow(emp) {
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
function plannedVerfügbarReturnLineHtml(ab, bis, kind = "Urlaub") {
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
function activeAbsencePeriodHtml(emp) {
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

/** Ohne das frisst iOS/Safari Touch-Züge, solange draggable="true" gesetzt ist. */
function preferDashboardTouchDrag() {
  try {
    if (window.matchMedia("(pointer: coarse)").matches) return true;
    if (window.matchMedia("(hover: none)").matches && navigator.maxTouchPoints > 0) return true;
    /* Schmale Ansicht + Touch: manche Browser melden pointer:fine (z. B. iPad/Desktop-Modus). */
    if (window.matchMedia("(max-width: 720px)").matches && navigator.maxTouchPoints > 0) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * Teamkarten-Reihenfolge: natives HTML5-Drag nur, wenn keine reine Grob-Touch-Erkennung
 * (sonst bleibt draggable aus und der Pointer-Pfad übernimmt – derzeit nur Mitarbeitende).
 */
function dashboardTeamCardsUseNativeDrag() {
  try {
    if (window.matchMedia("(pointer: fine)").matches) return true;
  } catch {
    /* ignore */
  }
  return !preferDashboardTouchDrag();
}

/**
 * Mitarbeitende: immer ohne natives Drag (Pointer-Zug für Maus, Touch und Stift).
 * Teamkarten-Reihenfolge: natives HTML5-Drag nur auf `[data-dashboard-team-drag]` (Kopfzeile),
 * nicht auf der ganzen Karte — sonst startet der Browser beim Ziehen einer Person den Drag der Teamkarte.
 */
function applyDashboardDragMode(root) {
  const nativeTeam = dashboardTeamCardsUseNativeDrag();
  root.querySelectorAll("[data-dashboard-employee]").forEach((el) => {
    if (el instanceof HTMLElement) el.draggable = false;
  });
  root.querySelectorAll("[data-dashboard-team-card]").forEach((el) => {
    if (el instanceof HTMLElement) el.draggable = false;
  });
  root.querySelectorAll("[data-dashboard-team-drag]").forEach((el) => {
    if (el instanceof HTMLElement) el.draggable = nativeTeam;
  });
}

function renderDashboard() {
  if (!state) return;
  const root = /** @type {HTMLElement} */ ($("#dashboard-content"));
  const today = todayISO();

  const unassigned = employeesWithoutTeamLeader();
  const unassignedChips =
    unassigned.length === 0
      ? '<p class="hint">Alle Mitarbeitenden haben eine gültige Teamleitung oder sind ohne Teamleitung erfasst.</p>'
      : `<div class="dashboard-chip-row" aria-label="Ohne Teamleitung">${unassigned
          .map(
            (e) => {
              const absBlock = dashboardMemberAbsenceBlock(e);
              return `<div class="dashboard-emp-chip" draggable="true" data-dashboard-employee="${e.ID}" title="Auf eine Teamkarte oder nach „Abwesenheit melden“ ziehen">
            <span class="dashboard-emp-chip__name">${escapeHtml(e.Vorname)} ${escapeHtml(e.Nachname)}</span>
            <span class="tag-mini">${escapeHtml(e.Qualifikation)}</span>
            ${absBlock}
          </div>`;
            }
          )
          .join("")}</div>`;

  const sortedTls = teamLeadersSortedForDashboard();

  /** @param {TeamLeader} tl */
  function dashboardTeamCardArticleHtml(tl) {
    const members = state.employees.filter((e) => Number(e.Teamleiter_ID) === Number(tl.ID));
    const assignedCount = members.filter((m) =>
      state.assignments.some(
        (a) =>
          Number(a.Employee_ID) === Number(m.ID) &&
          rangesOverlap(a.Startdatum, a.Enddatum, today, today)
      )
    ).length;
    const items = members
      .map((m) => {
        const absBlock = dashboardMemberAbsenceBlock(m);
        const onProject = employeeActiveOnProjectToday(m.ID);
        return `<li draggable="true" data-dashboard-employee="${m.ID}" class="dashboard-emp-row" title="Auf andere Teamkarte, „Ohne Teamleitung“ oder „Abwesenheit melden“ ziehen">
            <div class="dashboard-emp-row__top">
            <span>${escapeHtml(m.Vorname)} ${escapeHtml(m.Nachname)} <span class="tag-mini">${escapeHtml(m.Qualifikation)}</span></span>
            <span>${
              onProject
                ? '<span class="badge">im Projekt</span>'
                : '<span class="badge badge--muted">frei</span>'
            }</span>
            </div>
            ${absBlock}
          </li>`;
      })
      .join("");
    return `<article class="panel card-team team-drop-zone" data-dashboard-team-card="${tl.ID}" data-drop-teamleader="${tl.ID}" style="--team-color:${sanitizeTeamColor(tl.Team_Farbe)}">
        <div class="card-team__drag-handle" data-dashboard-team-drag="1">
          <div class="card-team__title">
            <strong>${escapeHtml(tl.Name)}</strong>
          </div>
        </div>
        <p class="hint card-team__meta">${assignedCount} heute im Projekt</p>
        <ul>${items || '<li class="hint">Keine Personen zugeordnet.</li>'}</ul>
      </article>`;
  }

  const deptsOrdered = /** @type {string[]} */ ([]);
  for (const abt of ABTEILUNGEN) {
    if (sortedTls.some((tl) => normalizeAbteilung(tl.Abteilung) === abt)) deptsOrdered.push(abt);
  }
  for (const tl of sortedTls) {
    const a = normalizeAbteilung(tl.Abteilung);
    if (!deptsOrdered.includes(a)) deptsOrdered.push(a);
  }

  const teamSectionsHtml =
    deptsOrdered.length === 0
      ? '<p class="hint">Keine Teamleitungen erfasst.</p>'
      : deptsOrdered
          .map((abt) => {
            const tls = sortedTls.filter((tl) => normalizeAbteilung(tl.Abteilung) === abt);
            if (!tls.length) return "";
            const accent = dashboardAbteilungAkzentfarbe(abt);
            const cards = tls.map((tl) => dashboardTeamCardArticleHtml(tl)).join("");
            return `<section class="dashboard-abteilung-block" style="--abteilung-accent: ${accent}">
        <h3 class="dashboard-abteilung__title">${escapeHtml(abt)}</h3>
        <div class="grid-dashboard">${cards}</div>
      </section>`;
          })
          .filter(Boolean)
          .join("");

  const absences = state.employees.filter(employeeMatchesDashboardAbsencePanel);
  absences.sort((a, b) => {
    const rank = (e) => (e.Status === "Krank" || e.Status === "Urlaub" ? 0 : 1);
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    return `${a.Nachname} ${a.Vorname}`.localeCompare(`${b.Nachname} ${b.Vorname}`, "de");
  });
  const absenceHtml =
    absences.length === 0
      ? '<p class="hint">Keine Abwesenheiten erfasst.</p>'
      : `<ul class="absence-list">${absences
      .map((e) => {
        if (e.Status === "Krank" || e.Status === "Urlaub") {
          const pill =
            e.Status === "Krank"
              ? '<span class="pill pill--krank">Krank</span>'
              : '<span class="pill pill--urlaub">Urlaub</span>';
          const period = activeAbsencePeriodHtml(e);
          const ret = absenceReturnBadgeHtml(e);
          return `<li class="absence-list__item">
          <div class="absence-list__head">
            <strong>${escapeHtml(`${e.Vorname} ${e.Nachname}`)}</strong> ${pill}
          </div>
          <div class="absence-list__body">
            ${period ? `<div class="absence-list__line">${period}</div>` : ""}
            <div class="absence-list__line absence-list__line--return">${ret || '<span class="hint">Zeitraum-Ende (bis) nicht gesetzt</span>'}</div>
          </div>
        </li>`;
        }
        const win = verfügbarDashboardAbsenceDisplayWindow(e);
        if (!win) return "";
        const pillKind =
          win.kind === "Krank"
            ? '<span class="pill pill--krank">Krank geplant</span>'
            : '<span class="pill pill--urlaub">Urlaub geplant</span>';
        const dem = '<span class="pill pill--geplant">Demnächst</span>';
        const period = `<span class="absence-list__period">Geplant abwesend <strong>${escapeHtml(formatDateDE(win.ab))}</strong> – <strong>${escapeHtml(formatDateDE(win.bis))}</strong> <span class="hint">(Status noch „Verfügbar“)</span></span>`;
        const t = todayISO();
        let preLine = "";
        if (t < win.ab) {
          const ds = daysUntilISODate(win.ab);
          if (ds !== null && Number.isFinite(ds) && ds >= 0) {
            preLine = `<div class="absence-list__line"><span class="hint">Beginn in ${ds} Tag${ds === 1 ? "" : "en"}</span></div>`;
          }
        } else if (t >= win.ab && t <= win.bis) {
          preLine = `<div class="absence-list__line"><span class="hint">Laut Plan heute abwesend – Status ggf. auf „${escapeHtml(win.kind)}“ setzen</span></div>`;
        }
        const ret = plannedVerfügbarReturnLineHtml(win.ab, win.bis, win.kind);
        return `<li class="absence-list__item absence-list__item--geplant">
          <div class="absence-list__head">
            <strong>${escapeHtml(`${e.Vorname} ${e.Nachname}`)}</strong> ${dem} ${pillKind}
          </div>
          <div class="absence-list__body">
            <div class="absence-list__line">${period}</div>
            ${preLine}
            <div class="absence-list__line absence-list__line--return">${ret}</div>
          </div>
        </li>`;
      })
          .filter(Boolean)
          .join("")}</ul>`;

  const available = state.employees.filter((e) => e.Status === "Verfügbar");
  const byQual = {};
  for (const e of available) {
    byQual[e.Qualifikation] = (byQual[e.Qualifikation] || 0) + 1;
  }
  const statsItems = Object.entries(byQual)
    .map(
      ([q, n]) =>
        `<div class="stat-item"><span>${q}</span><strong>${n}</strong><span class="hint">verfügbar</span></div>`
    )
    .join("");

  root.innerHTML = `
    <div class="panel panel--unassigned team-drop-zone" data-drop-unassigned="1">
      <div class="panel__head">
        <h2><i class="fa-solid fa-user-slash"></i> Ohne Teamleitung</h2>
        <span class="badge badge--muted">${unassigned.length} Person(en)</span>
      </div>
      <p class="hint">
        Teamleitung ist freiwillig: hier erscheinen Personen ohne Teamleitung oder mit ungültiger
        Teamleiter-Referenz. Ziehen Sie sie auf eine Teamkarte – oder weisen Sie die Teamleitung in
        der Personalverwaltung zu.
      </p>
      ${unassignedChips}
    </div>
    <div class="panel dashboard-teams-wrap">
      <div class="panel__head">
        <h2><i class="fa-solid fa-building-user"></i> Die Abteilung für die Person</h2>
      </div>
      <div class="dashboard-abteilungen-stack">${teamSectionsHtml}</div>
    </div>
    <div class="panel dashboard-absence-drop panel--drop-hint team-drop-zone" data-drop-absence="1" id="dashboard-absence-drop">
      <div class="panel__head">
        <h2><i class="fa-solid fa-user-injured"></i> Abwesenheit melden</h2>
      </div>
      <p class="hint">
        Mitarbeitende aus einer Teamliste oder von „Ohne Teamleitung“ hierher ziehen. Anschließend wählen Sie
        <strong>Krank</strong> oder <strong>Urlaub</strong> und den Zeitraum (erster und letzter freier Tag).
      </p>
    </div>
    <div class="panel">
      <div class="panel__head"><h2><i class="fa-solid fa-bed-pulse"></i> Abwesenheiten</h2></div>
      <p class="hint">Laufende Krankheit/Urlaub sowie <strong>geplante</strong> Abwesenheiten (Start in den nächsten 5 Tagen oder heute im geplanten Zeitraum, bei Status „Verfügbar“). Geplanter erster Arbeitstag = Tag nach „bis“.</p>
      ${absenceHtml}
    </div>
    <div class="panel">
      <div class="panel__head"><h2><i class="fa-solid fa-chart-simple"></i> Verfügbarkeit nach Qualifikation</h2></div>
      <div class="stats-grid">${statsItems || '<p class="hint">Keine verfügbaren Personen.</p>'}</div>
    </div>
  `;
  applyDashboardDragMode(root);
}

/** Gantt: Projektnamen entlang des Balkens wiederholen (horizontal scrollbar). */
/** @type {MutationObserver | null} */
let ganttBarLabelRepeatObserver = null;
/** @type {AbortController | null} */
let ganttBarLabelRepeatAbort = null;
let ganttBarLabelRepeatLayoutRaf = 0;

function teardownProjectGanttBarLabelRepeats() {
  if (ganttBarLabelRepeatObserver) {
    ganttBarLabelRepeatObserver.disconnect();
    ganttBarLabelRepeatObserver = null;
  }
  ganttBarLabelRepeatAbort?.abort();
  ganttBarLabelRepeatAbort = null;
  if (ganttBarLabelRepeatLayoutRaf) {
    cancelAnimationFrame(ganttBarLabelRepeatLayoutRaf);
    ganttBarLabelRepeatLayoutRaf = 0;
  }
}

function scheduleLayoutProjectGanttBarLabelRepeats() {
  if (ganttBarLabelRepeatLayoutRaf) return;
  ganttBarLabelRepeatLayoutRaf = requestAnimationFrame(() => {
    ganttBarLabelRepeatLayoutRaf = 0;
    layoutProjectGanttBarLabelRepeats();
  });
}

function layoutProjectGanttBarLabelRepeats() {
  const host = /** @type {HTMLElement | null} */ ($("#gantt-container"));
  if (!host) return;
  const svg = host.querySelector("svg.gantt");
  if (!svg) return;
  const svgNS = "http://www.w3.org/2000/svg";

  for (const wrap of svg.querySelectorAll("g.bar-wrapper")) {
    const bar = wrap.querySelector("rect.bar");
    const primary = /** @type {SVGTextElement | null} */ (wrap.querySelector("text.bar-label:not(.bar-label--repeat)"));
    for (const old of wrap.querySelectorAll("text.bar-label--repeat")) {
      old.remove();
    }
    if (primary) primary.removeAttribute("opacity");

    if (!(bar instanceof SVGRectElement) || !primary) continue;
    if (bar.classList.contains("bar-invalid")) continue;

    const name = primary.textContent?.trim() ?? "";
    if (!name) continue;

    const bx = bar.x.baseVal.value;
    const bw = bar.width.baseVal.value;
    const bh = bar.height.baseVal.value;
    const by = bar.y.baseVal.value;
    if (!(bw >= 48)) continue;

    let textW = 0;
    try {
      textW = primary.getBBox().width;
    } catch {
      continue;
    }

    const minStride = 72;
    const stride = Math.min(bw, Math.max(minStride, textW + 28));
    const maxTiles = 48;
    const centers = [];
    let cx = bx + stride / 2;
    while (cx <= bx + bw - stride / 2 + 0.5 && centers.length < maxTiles) {
      centers.push(cx);
      cx += stride;
    }
    if (centers.length <= 1) continue;

    const y = primary.getAttribute("y") ?? String(by + bh / 2);
    /** Auf farbigem Balken immer heller Text (Primary kann .big außerhalb grau sein). */
    const fill = "#fff";
    const barGroup = bar.parentElement;
    if (!barGroup) continue;

    primary.setAttribute("opacity", "0");

    for (const xc of centers) {
      const t = document.createElementNS(svgNS, "text");
      t.setAttribute("x", String(xc));
      t.setAttribute("y", y);
      t.setAttribute("class", "bar-label bar-label--repeat");
      t.setAttribute("fill", fill);
      t.textContent = name;
      barGroup.appendChild(t);
    }
  }
}

function bindGanttBarLabelRepeatListeners() {
  ganttBarLabelRepeatAbort?.abort();
  ganttBarLabelRepeatAbort = new AbortController();
  const { signal } = ganttBarLabelRepeatAbort;
  const h = () => scheduleLayoutProjectGanttBarLabelRepeats();
  const host = /** @type {HTMLElement} */ ($("#gantt-container"));
  host.addEventListener("scroll", h, { passive: true, signal });
  const inner = host.querySelector(".gantt-container");
  if (inner) inner.addEventListener("scroll", h, { passive: true, signal });
  window.addEventListener("resize", h, { passive: true, signal });
}

function observeGanttSvgForBarLabelRepeats(svg) {
  ganttBarLabelRepeatObserver?.disconnect();
  ganttBarLabelRepeatObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.target instanceof SVGRectElement && m.target.classList.contains("bar")) {
        scheduleLayoutProjectGanttBarLabelRepeats();
        return;
      }
    }
  });
  ganttBarLabelRepeatObserver.observe(svg, {
    attributes: true,
    attributeFilter: ["x", "width"],
    subtree: true,
  });
}

function refreshProjectGanttBarLabelRepeats() {
  const host = /** @type {HTMLElement | null} */ ($("#gantt-container"));
  const svg = host?.querySelector("svg.gantt");
  if (!(svg instanceof SVGSVGElement)) return;
  observeGanttSvgForBarLabelRepeats(svg);
  bindGanttBarLabelRepeatListeners();
  scheduleLayoutProjectGanttBarLabelRepeats();
}

function destroyGantt() {
  teardownProjectGanttBarLabelRepeats();
  const wrap = /** @type {HTMLElement} */ ($("#gantt-container"));
  wrap.innerHTML = "";
  ganttInstance = null;
}

/** Nach Drag/Resize in der frappe-gantt-Zeitleiste: Projektdaten und UI synchronisieren. */
async function applyProjectDatesFromGantt(projectId, startISO, endISO) {
  if (!state) return;
  if (!startISO || !endISO || startISO > endISO) return;
  const idx = state.projects.findIndex((p) => Number(p.ID) === projectId);
  if (idx < 0) return;
  const prev = state.projects[idx];
  if (prev.Startdatum === startISO && prev.Enddatum === endISO) return;
  recordUndoSnapshot();
  state.projects[idx] = { ...prev, Startdatum: startISO, Enddatum: endISO };
  try {
    await persist();
  } catch (err) {
    console.error(err);
    return;
  }
  renderProjectsTable();
  renderProjectDropZones();
  const sel = /** @type {HTMLSelectElement | null} */ ($("#project-select"));
  if (sel && String(projectId) === sel.value) {
    const as = /** @type {HTMLInputElement | null} */ ($("#assign-start"));
    const ae = /** @type {HTMLInputElement | null} */ ($("#assign-end"));
    if (as) as.value = startISO;
    if (ae) ae.value = endISO;
    renderProjectDetail();
  }
  renderDashboard();
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      renderGantt();
    });
  });
}

/**
 * frappe-gantt 0.6 ruft date_changed nur bei mouseup **auf dem SVG** auf.
 * Loslassen außerhalb des Diagramms → kein on_date_change: hier per Balken-Geometrie nachziehen.
 */
function syncProjectDatesFromGanttBarsIfNeeded() {
  if (!state) return;
  const pv = /** @type {HTMLElement | null} */ ($("#view-projects"));
  if (!pv?.classList.contains("view--active")) return;
  const inst = /** @type {{ bars?: { task?: { id?: string; invalid?: boolean }; compute_start_end_date?: () => { new_start_date: Date; new_end_date: Date } }[] }} */ (
    ganttInstance
  );
  const bars = inst?.bars;
  if (!Array.isArray(bars)) return;
  for (const bar of bars) {
    const task = bar?.task;
    if (!task || task.invalid) continue;
    const compute = bar.compute_start_end_date;
    if (typeof compute !== "function") continue;
    const { new_start_date, new_end_date } = compute.call(bar);
    const startISO = dateFromGanttToProjectISO(new_start_date);
    const endISO = inclusiveEndISOFromGanttExclusiveEnd(new_end_date);
    if (!startISO || !endISO || startISO > endISO) continue;
    const pid = Number(task.id);
    if (!Number.isFinite(pid)) continue;
    void applyProjectDatesFromGantt(pid, startISO, endISO);
  }
}

let ganttDateSyncRaf = 0;
function scheduleSyncProjectDatesFromGanttBars() {
  if (ganttDateSyncRaf) cancelAnimationFrame(ganttDateSyncRaf);
  ganttDateSyncRaf = requestAnimationFrame(() => {
    ganttDateSyncRaf = 0;
    syncProjectDatesFromGanttBarsIfNeeded();
  });
}

/** Nur nach echtem Balken-Drag: sonst würde jedes document-mouseup (z. B. Scrollbar) sync → renderGantt → scrollLeft zurücksetzen. */
let ganttBarPointerDownForDateSync = false;

function onGanttBarPointerDownForDateSync(ev) {
  if (!(ev.target instanceof Element)) return;
  if (!ev.target.closest(".bar-wrapper")) return;
  ganttBarPointerDownForDateSync = true;
}

function onDocumentReleaseSyncGanttProjectDates() {
  if (!ganttBarPointerDownForDateSync) return;
  ganttBarPointerDownForDateSync = false;
  scheduleSyncProjectDatesFromGanttBars();
}

let ganttDocumentDateSyncBound = false;
function bindGanttProjectDateDocumentSync() {
  if (ganttDocumentDateSyncBound) return;
  ganttDocumentDateSyncBound = true;
  const ganttHost = /** @type {HTMLElement} */ ($("#gantt-container"));
  ganttHost.addEventListener("pointerdown", onGanttBarPointerDownForDateSync, true);
  ganttHost.addEventListener("mousedown", onGanttBarPointerDownForDateSync, true);
  document.addEventListener("mouseup", onDocumentReleaseSyncGanttProjectDates);
  document.addEventListener("pointerup", onDocumentReleaseSyncGanttProjectDates);
  document.addEventListener("pointercancel", onDocumentReleaseSyncGanttProjectDates);
}

function renderProjectDropZones() {
  if (!state) return;
  const host = /** @type {HTMLElement} */ ($("#project-drop-zones"));
  host.innerHTML = state.projects
    .map((p) => {
      const name = escapeHtml(p.Name);
      return `<div class="project-drop-card" data-drop-project="${p.ID}" tabindex="0" role="region" aria-label="Ablage ${name}">
        <p class="project-drop-card__name">${name}</p>
        <p class="project-drop-card__meta">${p.Startdatum} – ${p.Enddatum}</p>
      </div>`;
    })
    .join("");
}

function openDndAssignModal(employeeId, projectId) {
  const emp = getEmployee(employeeId);
  const proj = getProject(projectId);
  if (!emp || !proj || !state) return;
  /** @type {HTMLInputElement} */ ($("#dnd-emp-id")).value = String(employeeId);
  /** @type {HTMLInputElement} */ ($("#dnd-proj-id")).value = String(projectId);
  $("#dnd-modal-project-label").textContent = `Projekt: ${proj.Name}`;
  /** @type {HTMLInputElement} */ ($("#dnd-start")).value = proj.Startdatum;
  /** @type {HTMLInputElement} */ ($("#dnd-end")).value = proj.Enddatum;
  $("#dnd-modal-backdrop").hidden = false;
  $("#dnd-assign-modal").hidden = false;
}

function closeDndAssignModal() {
  $("#dnd-modal-backdrop").hidden = true;
  $("#dnd-assign-modal").hidden = true;
}

function setupDndAssignModal() {
  $("#dnd-cancel").addEventListener("click", closeDndAssignModal);
  $("#dnd-modal-backdrop").addEventListener("click", closeDndAssignModal);
  $("#dnd-assign-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state) return;
    const employeeId = /** @type {HTMLInputElement} */ ($("#dnd-emp-id")).value;
    const projectId = /** @type {HTMLInputElement} */ ($("#dnd-proj-id")).value;
    const start = /** @type {HTMLInputElement} */ ($("#dnd-start")).value;
    const end = /** @type {HTMLInputElement} */ ($("#dnd-end")).value;
    if (!employeeId || !projectId || !start || !end) return;
    if (start > end) {
      await openModal(
        "Datum ungültig",
        "<div>Startdatum darf nicht nach dem Enddatum liegen.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    const v = validateAssignmentForSave(employeeId, start, end);
    if (v.conflict) {
      const ok = await openAssignmentConflictModal(v.fullName);
      if (!ok) return;
    }
    closeDndAssignModal();
    await pushAssignmentAndRefresh(employeeId, projectId, start, end);
    const projSel = /** @type {HTMLSelectElement} */ ($("#project-select"));
    projSel.value = String(projectId);
    renderProjectDetail();
    fillAssignmentEmployeeSelect(projectId);
    /** @type {HTMLSelectElement} */ ($("#assign-employee")).value = String(employeeId);
    /** @type {HTMLInputElement} */ ($("#assign-start")).value = start;
    /** @type {HTMLInputElement} */ ($("#assign-end")).value = end;
  });
}

let activeProjectDropCard = null;

function setupProjectDropDelegation() {
  const view = /** @type {HTMLElement} */ ($("#view-projects"));

  view.addEventListener("dragenter", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const card = /** @type {HTMLElement | null} */ (el?.closest("[data-drop-project]"));
    if (!card) return;
    if (activeProjectDropCard && activeProjectDropCard !== card) {
      activeProjectDropCard.classList.remove("project-drop-card--active");
    }
    activeProjectDropCard = card;
    card.classList.add("project-drop-card--active");
  });

  view.addEventListener("dragover", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const card = /** @type {HTMLElement | null} */ (el?.closest("[data-drop-project]"));
    if (card) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = "copy";
    }
  });

  view.addEventListener("dragleave", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const card = /** @type {HTMLElement | null} */ (el?.closest("[data-drop-project]"));
    if (!card) return;
    const rel = /** @type {Node | null} */ (ev.relatedTarget);
    if (!rel || !card.contains(rel)) {
      card.classList.remove("project-drop-card--active");
      if (activeProjectDropCard === card) activeProjectDropCard = null;
    }
  });

  view.addEventListener("drop", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const card = /** @type {HTMLElement | null} */ (el?.closest("[data-drop-project]"));
    if (!card) return;
    ev.preventDefault();
    card.classList.remove("project-drop-card--active");
    activeProjectDropCard = null;
    const projectId = card.dataset.dropProject;
    const employeeId =
      ev.dataTransfer.getData("text/plain") || ev.dataTransfer.getData("text/employee-id");
    if (!employeeId || !projectId || !state) return;
    openDndAssignModal(employeeId, projectId);
  });
}

function renderGanttCore() {
  if (!state) return;
  destroyGantt();
  const wrap = /** @type {HTMLElement} */ ($("#gantt-container"));
  if (state.projects.length === 0) {
    wrap.innerHTML = '<p class="hint">Keine Projekte angelegt.</p>';
    return;
  }
  const anchor = document.createElement("div");
  anchor.id = "gantt-anchor";
  wrap.appendChild(anchor);

  const tasks = state.projects.map((p) => {
    const mod = ((Number(p.ID) - 1) % 5) + 1;
    return {
      id: String(p.ID),
      name: p.Name,
      start: p.Startdatum,
      end: p.Enddatum,
      progress: 0,
      custom_class: `gantt-p${mod}`,
    };
  });

  const GanttCtor = window.Gantt;
  if (typeof GanttCtor !== "function") {
    wrap.innerHTML =
      '<p class="hint">Gantt-Bibliothek nicht geladen. Bitte Seite neu laden oder CDN prüfen.</p>';
    return;
  }
  try {
    ganttInstance = new GanttCtor("#gantt-anchor", tasks, {
      view_mode: ganttViewMode,
      // frappe-gantt 0.6.1: keine Locale "de" (month_names) → sonst TypeError in date_utils
      language: "en",
      date_format: "YYYY-MM-DD",
      on_date_change(task, start, end) {
        const startISO = dateFromGanttToProjectISO(start);
        const endISO = dateFromGanttToProjectISO(end ?? start);
        const pid = Number(task.id);
        if (!Number.isFinite(pid)) return;
        void applyProjectDatesFromGantt(pid, startISO, endISO);
      },
    });
    refreshProjectGanttBarLabelRepeats();
    requestAnimationFrame(() => {
      scheduleLayoutProjectGanttBarLabelRepeats();
      requestAnimationFrame(() => scheduleLayoutProjectGanttBarLabelRepeats());
    });
  } catch (err) {
    console.error(err);
    wrap.innerHTML =
      '<p class="hint">Die Zeitleiste konnte nicht gezeichnet werden. Bitte Konsole prüfen oder Seite neu laden.</p>';
  }
}

/** Gantt erst nach Layout der sichtbaren Zeitleisten-Ansicht zeichnen (sonst oft leeres/weißes SVG). */
function renderGantt() {
  const projectsView = /** @type {HTMLElement | null} */ ($("#view-projects"));
  if (!state || !projectsView || !projectsView.classList.contains("view--active")) return;
  const run = () => {
    if (!state) return;
    const pv = /** @type {HTMLElement | null} */ ($("#view-projects"));
    if (!pv || !pv.classList.contains("view--active")) return;
    renderGanttCore();
  };
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      requestAnimationFrame(run);
    });
  } else {
    setTimeout(run, 0);
  }
}

function syncGanttViewModeButtons() {
  $all("#view-projects [data-gantt-mode]").forEach((btn) => {
    const m = /** @type {HTMLElement} */ (btn).dataset.ganttMode;
    btn.classList.toggle("is-active", m === ganttViewMode);
  });
}

/**
 * @param {"Day"|"Week"|"Month"} mode
 */
function setGanttViewMode(mode) {
  if (mode !== "Day" && mode !== "Week" && mode !== "Month") return;
  ganttViewMode = mode;
  if (ganttInstance && typeof ganttInstance.change_view_mode === "function") {
    try {
      ganttInstance.change_view_mode(mode);
      refreshProjectGanttBarLabelRepeats();
      requestAnimationFrame(() => scheduleLayoutProjectGanttBarLabelRepeats());
    } catch (err) {
      console.error(err);
      renderGantt();
    }
  } else {
    renderGantt();
  }
  syncGanttViewModeButtons();
}


function renderProjectsTable() {
  if (!state) return;
  const tbody = /** @type {HTMLElement} */ ($("#projects-tbody"));
  const rows = state.projects
    .slice()
    .sort((a, b) => Number(a.ID) - Number(b.ID))
    .map(
      (p) => `<tr data-select-project="${p.ID}" class="projects-table__row-selectable" title="Projekt auswählen">
        <td>${p.ID}</td>
        <td>${escapeHtml(p.Name)}</td>
        <td>${escapeHtml(p.Startdatum)}</td>
        <td>${escapeHtml(p.Enddatum)}</td>
        <td class="actions-cell">
          <button type="button" class="btn btn--icon btn--ghost" data-edit-project="${p.ID}" title="Bearbeiten" aria-label="Bearbeiten"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="btn btn--icon btn--delete-icon" data-delete-project="${p.ID}" title="Projekt löschen" aria-label="Projekt löschen"><i class="fa-solid fa-trash-can"></i></button>
        </td>
      </tr>`
    )
    .join("");
  tbody.innerHTML =
    rows || '<tr><td colspan="5" class="hint">Noch keine Projekte. Legen Sie eines an.</td></tr>';
}

function closeProjectModal() {
  /** @type {HTMLElement} */ ($("#project-modal-backdrop")).hidden = true;
  /** @type {HTMLElement} */ ($("#project-modal")).hidden = true;
}

/** @param {Project | null} proj */
function openProjectModal(proj) {
  /** @type {HTMLElement} */ ($("#project-modal-backdrop")).hidden = false;
  /** @type {HTMLElement} */ ($("#project-modal")).hidden = false;
  /** @type {HTMLInputElement} */ ($("#project-form-id")).value = proj ? String(proj.ID) : "";
  /** @type {HTMLInputElement} */ ($("#project-form-name")).value = proj ? proj.Name : "";
  /** @type {HTMLInputElement} */ ($("#project-form-start")).value = proj ? proj.Startdatum : todayISO();
  /** @type {HTMLInputElement} */ ($("#project-form-end")).value = proj
    ? proj.Enddatum
    : addCalendarDaysToISO(todayISO(), 30) || todayISO();
  renderProjectQualificationsEditor(proj ? { ...(proj.Benötigte_Qualifikationen ?? {}) } : {});
  $("#project-modal-title").textContent = proj ? "Projekt bearbeiten" : "Neues Projekt";
  /** @type {HTMLInputElement} */ ($("#project-form-name")).focus();
}

function uniqueQualifications() {
  if (!state) return [];
  const set = new Set(QUALIFICATIONS);
  state.employees.forEach((e) => set.add(e.Qualifikation));
  state.projects.forEach((p) => {
    Object.keys(p.Benötigte_Qualifikationen || {}).forEach((k) => set.add(k));
  });
  return [...set].sort();
}

/** Eine Zeile im Qualifikations-Editor anhängen. */
function appendProjectQualRow(qualValue = "", count = 1) {
  const host = /** @type {HTMLElement | null} */ ($("#project-form-quals-host"));
  if (!state || !host) return;
  const quals = uniqueQualifications();
  const n = Math.max(1, Math.min(999, Math.floor(Number(count)) || 1));
  const opts = ['<option value="">Qualifikation wählen…</option>'].concat(
    quals.map(
      (q) =>
        `<option value="${escapeHtml(q)}"${q === qualValue ? " selected" : ""}>${escapeHtml(q)}</option>`
    )
  );
  const row = document.createElement("div");
  row.className = "project-qual-row";
  row.innerHTML = `
    <select class="project-qual-row__qual" aria-label="Qualifikation">${opts.join("")}</select>
    <input type="number" class="project-qual-row__count" min="1" max="999" step="1" value="${n}" aria-label="Anzahl" />
    <button type="button" class="btn btn--ghost btn--icon btn--small" data-pq-remove title="Zeile entfernen" aria-label="Zeile entfernen"><i class="fa-solid fa-xmark"></i></button>
  `;
  const sel = row.querySelector("select");
  if (qualValue && sel instanceof HTMLSelectElement && ![...sel.options].some((o) => o.value === qualValue)) {
    const o = document.createElement("option");
    o.value = qualValue;
    o.textContent = qualValue;
    o.selected = true;
    sel.appendChild(o);
  }
  host.appendChild(row);
}

function ensureProjectQualEditorHasRow() {
  const host = /** @type {HTMLElement | null} */ ($("#project-form-quals-host"));
  if (!host) return;
  if (!host.querySelector(".project-qual-row")) appendProjectQualRow("", 1);
}

/** @param {Record<string, number>} data */
function renderProjectQualificationsEditor(data) {
  const host = /** @type {HTMLElement | null} */ ($("#project-form-quals-host"));
  if (!host) return;
  const entries = Object.entries(data).filter(([k, v]) => {
    const key = String(k).trim();
    const num = Number(v);
    return key && Number.isFinite(num) && num > 0;
  });
  host.innerHTML = "";
  if (entries.length === 0) {
    appendProjectQualRow("", 1);
  } else {
    for (const [k, v] of entries) {
      appendProjectQualRow(k, v);
    }
  }
}

/** @returns {Record<string, number>} */
function collectProjectQualificationsFromEditor() {
  const host = /** @type {HTMLElement | null} */ ($("#project-form-quals-host"));
  if (!host) return {};
  /** @type {Record<string, number>} */
  const out = {};
  const seen = new Set();
  for (const row of host.querySelectorAll(".project-qual-row")) {
    const sel = row.querySelector("select.project-qual-row__qual");
    const numEl = row.querySelector("input.project-qual-row__count");
    if (!(sel instanceof HTMLSelectElement) || !(numEl instanceof HTMLInputElement)) continue;
    const q = sel.value.trim();
    if (!q) continue;
    const n = Math.floor(Number(numEl.value));
    if (!Number.isFinite(n) || n < 1) continue;
    if (seen.has(q)) {
      throw new Error(`Qualifikation „${q}“ ist mehrfach eingetragen.`);
    }
    seen.add(q);
    out[q] = Math.min(999, n);
  }
  return out;
}

function employeeHasAssignmentOverlappingWindow(employeeId, winStart, winEnd) {
  if (!state) return false;
  if (!winStart || !winEnd || winStart > winEnd) return false;
  const id = Number(employeeId);
  return state.assignments.some((a) => {
    if (Number(a.Employee_ID) !== id) return false;
    return rangesOverlap(a.Startdatum, a.Enddatum, winStart, winEnd);
  });
}

/**
 * Wenn ein Projekt gewählt ist und die Checkbox „auch zugewiesene“ nicht aktiv:
 * Pool nur Personen ohne Zuweisung, deren Zeitraum sich mit dem Projektzeitraum überschneidet.
 */
function employeePoolRestrictsToUnassigned() {
  if (!state || state.projects.length === 0) return false;
  const projSel = /** @type {HTMLSelectElement | null} */ (document.getElementById("project-select"));
  if (!projSel?.value) return false;
  const incl = /** @type {HTMLInputElement | null} */ (document.getElementById("pool-include-assigned"));
  if (incl?.checked) return false;
  return true;
}

function availableEmployeesForPool(filterQual) {
  if (!state) return [];
  const restrict = employeePoolRestrictsToUnassigned();
  const projSel = /** @type {HTMLSelectElement | null} */ (document.getElementById("project-select"));
  const proj = projSel?.value ? getProject(projSel.value) : undefined;
  const winStart = proj?.Startdatum ?? "";
  const winEnd = proj?.Enddatum ?? "";

  return state.employees.filter((e) => {
    if (e.Status !== "Verfügbar") return false;
    if (filterQual && e.Qualifikation !== filterQual) return false;
    if (restrict && proj && employeeHasAssignmentOverlappingWindow(e.ID, winStart, winEnd)) return false;
    return true;
  });
}

function renderEmployeePool() {
  if (!state) return;
  const qual = /** @type {HTMLSelectElement} */ ($("#filter-qualification")).value;
  const list = /** @type {HTMLElement} */ ($("#employee-pool"));
  const emps = availableEmployeesForPool(qual || null);
  const restrict = employeePoolRestrictsToUnassigned();
  const qualNote = qual ? ` · Qualifikation „${qual}“` : "";
  $("#employees-hint").textContent = restrict
    ? `${emps.length} Person(en): verfügbar und im Projektzeitraum ohne überschneidende Zuweisung${qualNote}.`
    : `${emps.length} Person(en) im Pool (nur Status „Verfügbar“)${qualNote}.`;
  list.innerHTML = emps
    .map(
      (e) => {
        const planLine = plannedAbsencePoolLine(e);
        const planHtml = planLine
          ? `<div class="hint" style="margin-top:0.2rem">${escapeHtml(planLine)}</div>`
          : "";
        return `<div class="employee-card" draggable="true" data-id="${e.ID}">
      <div>
        <div class="name">${e.Vorname} ${e.Nachname}</div>
        <div class="hint">${e.Qualifikation} · ${e.Personalnummer}</div>
        ${planHtml}
      </div>
      <i class="fa-solid fa-grip-lines-vertical" aria-hidden="true"></i>
    </div>`;
      }
    )
    .join("");
  const poolCb = /** @type {HTMLInputElement | null} */ ($("#pool-include-assigned"));
  if (poolCb) poolCb.disabled = state.projects.length === 0;
}

function renderProjectAssignments(projectId) {
  if (!state) return "";
  const rows = state.assignments
    .filter((a) => Number(a.Project_ID) === Number(projectId))
    .map((a) => {
      const emp = getEmployee(a.Employee_ID);
      const name = emp ? `${emp.Vorname} ${emp.Nachname}` : `ID ${a.Employee_ID}`;
      return `<tr>
        <td>${name}</td>
        <td>${a.Startdatum}</td>
        <td>${a.Enddatum}</td>
        <td><button type="button" class="btn btn--icon btn--ghost" data-del-assignment="${a.ID}" title="Zuweisung löschen"><i class="fa-solid fa-trash"></i></button></td>
      </tr>`;
    })
    .join("");
  return `<table class="assignments-table">
    <thead><tr><th>Person</th><th>Von</th><th>Bis</th><th></th></tr></thead>
    <tbody>${rows || '<tr><td colspan="4" class="hint">Noch keine Zuweisungen.</td></tr>'}</tbody>
  </table>`;
}

function renderProjectDetail() {
  if (!state) return;
  const pid = /** @type {HTMLSelectElement} */ ($("#project-select")).value;
  const panel = /** @type {HTMLElement} */ ($("#project-detail"));
  const proj = getProject(pid);
  if (!proj) {
    panel.innerHTML = '<p class="hint">Kein Projekt ausgewählt.</p>';
    return;
  }
  const reqs = Object.entries(proj.Benötigte_Qualifikationen || {})
    .map(([k, v]) => `${v}× ${k}`)
    .join(", ");
  panel.innerHTML = `
    <div class="meta">
      <div><strong>Start</strong><br>${proj.Startdatum}</div>
      <div><strong>Ende</strong><br>${proj.Enddatum}</div>
      <div><strong>Bedarf</strong><br>${reqs || "—"}</div>
    </div>
    ${renderProjectAssignments(proj.ID)}
  `;
  $all("[data-del-assignment]", panel).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(/** @type {HTMLElement} */ (btn).dataset.delAssignment);
      recordUndoSnapshot();
      state.assignments = state.assignments.filter((a) => Number(a.ID) !== id);
      await persist();
      renderProjectDetail();
      renderProjectDropZones();
      renderEmployeePool();
      renderDashboard();
      renderGantt();
    });
  });
}

function fillAssignmentEmployeeSelect(projectId) {
  if (!state) return;
  const sel = /** @type {HTMLSelectElement} */ ($("#assign-employee"));
  if (!projectId) {
    sel.innerHTML = "";
    return;
  }
  const inProject = new Set(
    state.assignments
      .filter((a) => Number(a.Project_ID) === Number(projectId))
      .map((a) => Number(a.Employee_ID))
  );
  const emps = state.employees.filter(
    (e) => e.Status === "Verfügbar" || inProject.has(Number(e.ID))
  );
  sel.innerHTML = emps
    .map(
      (e) =>
        `<option value="${e.ID}">${e.Vorname} ${e.Nachname} (${e.Qualifikation})${
          e.Status !== "Verfügbar" ? " – " + e.Status : ""
        }</option>`
    )
    .join("");
}

function renderProjectsView() {
  if (!state) return;
  const qualSelect = /** @type {HTMLSelectElement} */ ($("#filter-qualification"));
  const quals = ["", ...uniqueQualifications()];
  qualSelect.innerHTML = quals
    .map((q) =>
      q === ""
        ? '<option value="">Alle Qualifikationen</option>'
        : `<option value="${q}">${q}</option>`
    )
    .join("");

  const projSelect = /** @type {HTMLSelectElement} */ ($("#project-select"));
  projSelect.innerHTML = state.projects
    .map((p) => `<option value="${p.ID}">${escapeHtml(p.Name)}</option>`)
    .join("");

  if (state.projects.length === 0) {
    projSelect.value = "";
  } else {
    const cur = projSelect.value;
    if (!cur || !state.projects.some((p) => String(p.ID) === cur)) {
      projSelect.value = String(state.projects[0].ID);
    }
  }

  renderProjectDropZones();
  renderEmployeePool();
  renderProjectDetail();
  fillAssignmentEmployeeSelect(projSelect.value);

  const proj = getProject(projSelect.value);
  if (proj) {
    /** @type {HTMLInputElement} */ ($("#assign-start")).value = proj.Startdatum;
    /** @type {HTMLInputElement} */ ($("#assign-end")).value = proj.Enddatum;
  }

  renderProjectsTable();
  syncGanttViewModeButtons();
  renderGantt();
}

async function pushAssignmentAndRefresh(employeeId, projectId, start, end) {
  if (!state) return;
  recordUndoSnapshot();
  const newRow = {
    ID: nextId(state.assignments),
    Project_ID: Number(projectId),
    Employee_ID: Number(employeeId),
    Startdatum: start,
    Enddatum: end,
  };
  state.assignments.push(newRow);
  await persist();
  renderProjectDetail();
  renderProjectDropZones();
  renderEmployeePool();
  renderDashboard();
  renderGantt();
}

async function submitAssignment(employeeId, projectId, start, end) {
  if (!state) return;
  const v = validateAssignmentForSave(employeeId, start, end);
  if (v.conflict) {
    const ok = await openAssignmentConflictModal(v.fullName);
    if (!ok) return;
  }
  await pushAssignmentAndRefresh(employeeId, projectId, start, end);
}

function closeAllModalsAndBackdrops() {
  const ids = [
    "modal-backdrop",
    "modal",
    "dnd-modal-backdrop",
    "dnd-assign-modal",
    "assign-conflict-backdrop",
    "assign-conflict-modal",
    "dash-abs-backdrop",
    "dash-abs-modal",
    "project-modal-backdrop",
    "project-modal",
    "teamleader-modal-backdrop",
    "teamleader-modal",
  ];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el) el.hidden = true;
  }
}

function setupProjectsInteractions() {
  const qualSelect = /** @type {HTMLSelectElement} */ ($("#filter-qualification"));
  const projSelect = /** @type {HTMLSelectElement} */ ($("#project-select"));
  const form = /** @type {HTMLFormElement} */ ($("#assignment-form"));
  const rightPanel = document.querySelector(".panel--right");

  qualSelect.addEventListener("change", () => renderEmployeePool());

  /** @type {HTMLInputElement | null} */ (document.getElementById("pool-include-assigned"))?.addEventListener(
    "change",
    () => renderEmployeePool()
  );

  projSelect.addEventListener("change", () => {
    renderProjectDetail();
    fillAssignmentEmployeeSelect(projSelect.value);
    renderEmployeePool();
    const proj = getProject(projSelect.value);
    if (proj) {
      /** @type {HTMLInputElement} */ ($("#assign-start")).value = proj.Startdatum;
      /** @type {HTMLInputElement} */ ($("#assign-end")).value = proj.Enddatum;
    }
  });

  $("#employee-pool").addEventListener("dragstart", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const card = /** @type {HTMLElement | null} */ (el?.closest(".employee-card[data-id]"));
    if (!card || !card.dataset.id) return;
    ev.dataTransfer.setData("text/plain", card.dataset.id);
    ev.dataTransfer.setData("text/employee-id", card.dataset.id);
    ev.dataTransfer.effectAllowed = "copy";
  });

  if (rightPanel) {
    rightPanel.addEventListener("dragover", (ev) => {
      ev.preventDefault();
      rightPanel.classList.add("drop-target");
      ev.dataTransfer.dropEffect = "copy";
    });
    rightPanel.addEventListener("dragleave", () => {
      rightPanel.classList.remove("drop-target");
    });
    rightPanel.addEventListener("drop", (ev) => {
      ev.preventDefault();
      rightPanel.classList.remove("drop-target");
      const id = ev.dataTransfer.getData("text/plain") || ev.dataTransfer.getData("text/employee-id");
      if (!id) return;
      /** @type {HTMLSelectElement} */ ($("#assign-employee")).value = id;
    });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const employeeId = /** @type {HTMLSelectElement} */ ($("#assign-employee")).value;
    const projectId = /** @type {HTMLSelectElement} */ ($("#project-select")).value;
    const start = /** @type {HTMLInputElement} */ ($("#assign-start")).value;
    const end = /** @type {HTMLInputElement} */ ($("#assign-end")).value;
    if (!employeeId || !projectId || !start || !end) return;
    if (start > end) {
      await openModal(
        "Datum ungültig",
        "<div>Startdatum darf nicht nach dem Enddatum liegen.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    await submitAssignment(employeeId, projectId, start, end);
  });

  const projectsView = /** @type {HTMLElement} */ ($("#view-projects"));

  projectsView.addEventListener("click", async (ev) => {
    const modeEl = ev.target instanceof Element ? ev.target.closest("[data-gantt-mode]") : null;
    if (modeEl instanceof HTMLElement && modeEl.dataset.ganttMode) {
      const m = modeEl.dataset.ganttMode;
      if (m === "Day" || m === "Week" || m === "Month") setGanttViewMode(m);
      return;
    }

    const projRow = ev.target instanceof Element ? ev.target.closest("#projects-tbody tr[data-select-project]") : null;
    if (projRow instanceof HTMLElement && projRow.dataset.selectProject) {
      if (!(ev.target instanceof Element && ev.target.closest("button, .actions-cell"))) {
        const sid = projRow.dataset.selectProject;
        if (state?.projects.some((p) => String(p.ID) === sid)) {
          projSelect.value = sid;
          projSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
    }

    const dropPick = ev.target instanceof Element ? ev.target.closest(".project-drop-card[data-drop-project]") : null;
    if (dropPick instanceof HTMLElement && dropPick.dataset.dropProject) {
      const sid = dropPick.dataset.dropProject;
      if (state?.projects.some((p) => String(p.ID) === sid)) {
        projSelect.value = sid;
        projSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    if (ev.target instanceof Element && ev.target.closest("#btn-new-project")) {
      openProjectModal(null);
      return;
    }

    const editBtn = ev.target instanceof Element ? ev.target.closest("[data-edit-project]") : null;
    if (editBtn instanceof HTMLElement && editBtn.dataset.editProject) {
      const p = getProject(editBtn.dataset.editProject);
      if (p) openProjectModal(p);
      return;
    }

    const delBtn = ev.target instanceof Element ? ev.target.closest("[data-delete-project]") : null;
    if (delBtn instanceof HTMLElement && delBtn.dataset.deleteProject) {
      const pid = Number(delBtn.dataset.deleteProject);
      const proj = getProject(pid);
      if (!proj || !state) return;
      const ok = await openModal(
        "Projekt löschen",
        `<div>Das Projekt „${escapeHtml(proj.Name)}“ und alle zugehörigen Zuweisungen werden unwiderruflich entfernt.</div>`,
        { confirmText: "Ja, löschen", confirmDanger: true }
      );
      if (!ok) return;
      recordUndoSnapshot();
      state.projects = state.projects.filter((p) => Number(p.ID) !== pid);
      state.assignments = state.assignments.filter((a) => Number(a.Project_ID) !== pid);
      await persist();
      renderProjectsView();
      renderDashboard();
    }
  });

  $("#project-modal-backdrop").addEventListener("click", closeProjectModal);
  $("#project-form-cancel").addEventListener("click", closeProjectModal);

  const projectFormEl = /** @type {HTMLFormElement | null} */ ($("#project-form"));
  if (projectFormEl && projectFormEl.dataset.qualUi !== "1") {
    projectFormEl.dataset.qualUi = "1";
    projectFormEl.addEventListener("click", (ev) => {
      const t = ev.target instanceof Element ? ev.target : null;
      if (t?.closest("#project-form-quals-add")) {
        ev.preventDefault();
        appendProjectQualRow("", 1);
        return;
      }
      if (t?.closest("[data-pq-remove]")) {
        ev.preventDefault();
        const btn = t.closest("[data-pq-remove]");
        const row = btn?.closest(".project-qual-row");
        row?.remove();
        ensureProjectQualEditorHasRow();
      }
    });
  }

  /** @type {HTMLFormElement} */ ($("#project-form")).addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state) return;
    const idRaw = /** @type {HTMLInputElement} */ ($("#project-form-id")).value.trim();
    const name = /** @type {HTMLInputElement} */ ($("#project-form-name")).value.trim();
    const start = /** @type {HTMLInputElement} */ ($("#project-form-start")).value;
    const end = /** @type {HTMLInputElement} */ ($("#project-form-end")).value;
    if (!name || !start || !end) return;
    if (start > end) {
      await openModal(
        "Datum ungültig",
        "<div>Startdatum darf nicht nach dem Enddatum liegen.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    let Benötigte_Qualifikationen;
    try {
      Benötigte_Qualifikationen = collectProjectQualificationsFromEditor();
    } catch (err) {
      const detail =
        err && typeof err === "object" && "message" in err
          ? String(/** @type {{ message: string }} */ (err).message)
          : String(err);
      await openModal(
        "Qualifikationen",
        `<div>${escapeHtml(detail)}</div>`,
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    if (idRaw !== "") {
      const idxEarly = state.projects.findIndex((p) => String(p.ID) === idRaw);
      if (idxEarly < 0) {
        await openModal(
          "Projekt",
          "<div>Dieses Projekt existiert nicht mehr.</div>",
          { variant: "info", confirmText: "Verstanden" }
        );
        closeProjectModal();
        renderProjectsView();
        renderDashboard();
        return;
      }
    }
    recordUndoSnapshot();
    if (idRaw === "") {
      state.projects.push({
        ID: nextId(state.projects),
        Name: name,
        Startdatum: start,
        Enddatum: end,
        Benötigte_Qualifikationen,
      });
    } else {
      const idx = state.projects.findIndex((p) => String(p.ID) === idRaw);
      const prev = state.projects[idx];
      state.projects[idx] = {
        ...prev,
        Name: name,
        Startdatum: start,
        Enddatum: end,
        Benötigte_Qualifikationen,
      };
    }
    await persist();
    closeProjectModal();
    renderProjectsView();
    renderDashboard();
  });

  bindGanttProjectDateDocumentSync();
}

function statusCellClass(status) {
  if (status === "Verfügbar") return "status-cell status-cell--verfügbar";
  if (status === "Krank") return "status-cell status-cell--krank";
  if (status === "Urlaub") return "status-cell status-cell--urlaub";
  return "status-cell";
}

function renderTeamLeadersTable() {
  if (!state) return;
  const tbody = /** @type {HTMLElement} */ ($("#teamleaders-tbody"));
  const rows = teamLeadersSortedForDashboard()
    .map((tl) => {
      const count = state.employees.filter((e) => Number(e.Teamleiter_ID) === Number(tl.ID)).length;
      const col = sanitizeTeamColor(tl.Team_Farbe);
      const abt = normalizeAbteilung(tl.Abteilung);
      return `<tr>
        <td>${escapeHtml(tl.Name)}</td>
        <td>
          <span class="tl-color-dot" style="--tl-dot:${col}" title="${escapeHtml(col)}"></span>
          <code>${escapeHtml(col)}</code>
        </td>
        <td>${escapeHtml(abt)}</td>
        <td>${count}</td>
        <td class="actions-cell">
          <button type="button" class="btn btn--icon btn--ghost" data-edit-tl="${tl.ID}" title="Bearbeiten" aria-label="Bearbeiten"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="btn btn--icon btn--delete-icon" data-delete-tl="${tl.ID}" title="Teamleiter/in löschen" aria-label="Teamleiter/in löschen"><i class="fa-solid fa-trash-can"></i></button>
        </td>
      </tr>`;
    })
    .join("");
  tbody.innerHTML =
    rows ||
    '<tr><td colspan="5" class="hint">Noch keine Teamleitenden. Legen Sie unten eine Person an.</td></tr>';

  tbody.querySelectorAll("[data-edit-tl]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(/** @type {HTMLElement} */ (btn).dataset.editTl);
      if (!state || !Number.isFinite(id)) return;
      const tl = getTeamLeader(id);
      if (tl) openTeamLeaderEditModal(tl);
    });
  });

  tbody.querySelectorAll("[data-delete-tl]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(/** @type {HTMLElement} */ (btn).dataset.deleteTl);
      if (!state || !Number.isFinite(id)) return;
      const tl = getTeamLeader(id);
      if (!tl) return;
      const count = state.employees.filter((e) => Number(e.Teamleiter_ID) === id).length;
      const ok = await openModal(
        "Teamleiter/in löschen",
        `<div>${
          count > 0
            ? `${count} Mitarbeitende werden auf „Keine Teamleitung“ gesetzt. `
            : ""
        }Der Eintrag wird dauerhaft entfernt.</div>`,
        { confirmText: "Ja, löschen", confirmDanger: true }
      );
      if (!ok) return;
      recordUndoSnapshot();
      for (const e of state.employees) {
        if (Number(e.Teamleiter_ID) === id) e.Teamleiter_ID = null;
      }
      state.team_leaders = state.team_leaders.filter((t) => Number(t.ID) !== id);
      state.team_leaders.sort(
        (a, b) => Number(a.Reihenfolge) - Number(b.Reihenfolge) || Number(a.ID) - Number(b.ID)
      );
      state.team_leaders.forEach((t, i) => {
        t.Reihenfolge = i;
      });
      await persist();
      renderPersonnelView();
      renderDashboard();
      if ($("#view-projects").classList.contains("view--active")) {
        renderProjectsView();
      }
    });
  });
}

function renderPersonnelTable() {
  if (!state) return;
  const tbody = /** @type {HTMLElement} */ ($("#personnel-tbody"));
  const q = /** @type {HTMLInputElement} */ ($("#personnel-search")).value.trim().toLowerCase();
  const st = /** @type {HTMLSelectElement} */ ($("#personnel-filter-status")).value;
  const fq = /** @type {HTMLSelectElement} */ ($("#personnel-filter-qual")).value;
  const fBesch = /** @type {HTMLSelectElement} */ ($("#personnel-filter-beschäftigung")).value;
  const fStufe = /** @type {HTMLSelectElement} */ ($("#personnel-filter-stufe")).value;
  const fAbt = /** @type {HTMLSelectElement} */ ($("#personnel-filter-abteilung")).value;

  const rows = state.employees
    .filter((e) => {
      const hay = `${e.Vorname} ${e.Nachname} ${e.Personalnummer}`.toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (st && e.Status !== st) return false;
      if (fq && e.Qualifikation !== fq) return false;
      if (fBesch && normalizeBeschäftigung(e.Beschäftigung) !== fBesch) return false;
      if (fStufe && String(e.Stufe ?? "").trim() !== fStufe) return false;
      if (fAbt && normalizeAbteilung(e.Abteilung) !== fAbt) return false;
      return true;
    })
    .map((e) => {
      const tl = getTeamLeader(e.Teamleiter_ID);
      const sc = statusCellClass(e.Status);
      const besch = normalizeBeschäftigung(e.Beschäftigung);
      const stufe = String(e.Stufe ?? "").trim();
      const abt = normalizeAbteilung(e.Abteilung);
      return `<tr>
        <td>${e.Personalnummer}</td>
        <td>${e.Vorname} ${e.Nachname}</td>
        <td>${e.Qualifikation}</td>
        <td>${escapeHtml(besch)}</td>
        <td>${stufe ? escapeHtml(stufe) : "—"}</td>
        <td>${escapeHtml(abt)}</td>
        <td>${tl ? escapeHtml(tl.Name) : "Keine"}</td>
        <td class="${sc}">${e.Status}</td>
        <td class="hint">${escapeHtml(absenceSummaryPlain(e))}</td>
        <td class="actions-cell">
          <button type="button" class="btn btn--icon btn--ghost" data-action="edit-employee" data-emp-id="${e.ID}" title="Bearbeiten" aria-label="Bearbeiten"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="btn btn--icon btn--delete-icon" data-action="delete-employee" data-emp-id="${e.ID}" title="Löschen" aria-label="Löschen"><i class="fa-solid fa-trash-can"></i></button>
        </td>
      </tr>`;
    })
    .join("");
  tbody.innerHTML =
    rows || '<tr><td colspan="10" class="hint">Keine Treffer für die aktuelle Filterung.</td></tr>';
}

async function deleteEmployeeById(id) {
  if (!state || !Number.isFinite(id)) return;
  const ok = await openModal(
    "Mitarbeitende/n löschen",
    "<div>Zugehörige Zuweisungen werden ebenfalls entfernt. Fortfahren?</div>",
    { confirmText: "Ja, löschen", confirmDanger: true }
  );
  if (!ok) return;
  recordUndoSnapshot();
  state.employees = state.employees.filter((e) => Number(e.ID) !== id);
  state.assignments = state.assignments.filter((a) => Number(a.Employee_ID) !== id);
  await syncEmployeesThenPersist();
  renderPersonnelView();
  renderDashboard();
  if ($("#view-projects").classList.contains("view--active")) {
    renderProjectsView();
  }
}

function setupPersonnelTableActions() {
  const tbody = /** @type {HTMLElement | null} */ ($("#personnel-tbody"));
  if (!tbody || tbody.dataset.personnelActions === "1") return;
  tbody.dataset.personnelActions = "1";
  tbody.addEventListener("click", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const btn = el?.closest("button[data-action]");
    if (!(btn instanceof HTMLButtonElement)) return;
    const action = btn.getAttribute("data-action");
    const empId = Number(btn.getAttribute("data-emp-id"));
    if (!Number.isFinite(empId)) return;
    if (action === "edit-employee") {
      loadEmployeeIntoForm(empId);
      return;
    }
    if (action === "delete-employee") {
      void deleteEmployeeById(empId);
    }
  });
}

function setupQuickReturnDateButtons() {
  const ws = /** @type {HTMLElement | null} */ ($("#app-workspace"));
  if (!ws || ws.dataset.quickReturn === "1") return;
  ws.dataset.quickReturn = "1";
  ws.addEventListener("click", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const btn = el?.closest("button[data-quick-return]");
    if (!(btn instanceof HTMLButtonElement)) return;
    ev.preventDefault();
    const fieldId = btn.getAttribute("data-quick-return");
    const days = Number(btn.getAttribute("data-days"));
    const inp = fieldId ? document.getElementById(fieldId) : null;
    if (inp instanceof HTMLInputElement && Number.isFinite(days)) {
      inp.value = addDaysFromTodayISO(days);
      inp.focus();
    }
  });
}

function loadEmployeeIntoForm(id) {
  try {
    const e = getEmployee(id);
    if (!e) return;
    const panel = /** @type {HTMLElement | null} */ ($("#employee-edit-panel"));
    if (panel) panel.hidden = false;
    /** @type {HTMLInputElement} */ ($("#emp-id")).value = String(e.ID);
    /** @type {HTMLInputElement} */ ($("#emp-pnr")).value = String(e.Personalnummer ?? "");
    /** @type {HTMLInputElement} */ ($("#emp-vorname")).value = String(e.Vorname ?? "");
    /** @type {HTMLInputElement} */ ($("#emp-nachname")).value = String(e.Nachname ?? "");
    const qualSel = /** @type {HTMLSelectElement} */ ($("#emp-qual"));
    ensureSelectHasValue(qualSel, e.Qualifikation, String(e.Qualifikation ?? ""));
    const beschSel = /** @type {HTMLSelectElement} */ ($("#emp-beschäftigung"));
    ensureSelectHasValue(beschSel, normalizeBeschäftigung(e.Beschäftigung), normalizeBeschäftigung(e.Beschäftigung));
    /** @type {HTMLInputElement} */ ($("#emp-stufe")).value =
      e.Stufe != null && e.Stufe !== "" ? String(e.Stufe) : "";
    /** @type {HTMLSelectElement} */ ($("#emp-abteilung")).value = normalizeAbteilung(e.Abteilung);
    /** @type {HTMLInputElement} */ ($("#emp-tags")).value = (e.Zusatz_Tags || []).join(", ");
    /** @type {HTMLSelectElement} */ ($("#emp-tl")).value =
      e.Teamleiter_ID != null && e.Teamleiter_ID !== "" && hasValidTeamLeader(e)
        ? String(e.Teamleiter_ID)
        : "";
    const statusSel = /** @type {HTMLSelectElement} */ ($("#emp-status"));
    ensureSelectHasValue(statusSel, e.Status, String(e.Status ?? ""));
    /** @type {HTMLInputElement} */ ($("#emp-krank-ab")).value =
      e.Krank_ab != null && e.Krank_ab !== "" ? String(e.Krank_ab) : "";
    /** @type {HTMLInputElement} */ ($("#emp-krank-bis")).value =
      e.Krank_bis != null && e.Krank_bis !== "" ? String(e.Krank_bis) : "";
    /** @type {HTMLInputElement} */ ($("#emp-urlaub-ab")).value =
      e.Urlaub_ab != null && e.Urlaub_ab !== "" ? String(e.Urlaub_ab) : "";
    /** @type {HTMLInputElement} */ ($("#emp-urlaub-bis")).value =
      e.Urlaub_bis != null && e.Urlaub_bis !== "" ? String(e.Urlaub_bis) : "";
    renderUrlaubPeriodenContainer("emp-urlaub-perioden", e.Urlaub_perioden || []);
    $("#employee-form-title").innerHTML =
      '<i class="fa-solid fa-user-pen"></i> Mitarbeitende bearbeiten';
    syncEditAbsenceHint();
    if (panel) {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      panel.focus({ preventScroll: true });
      panel.classList.add("panel--focus");
      window.setTimeout(() => panel.classList.remove("panel--focus"), 1200);
    }
  } catch (err) {
    console.error("loadEmployeeIntoForm", err);
    const errPanel = /** @type {HTMLElement | null} */ ($("#employee-edit-panel"));
    if (errPanel) errPanel.hidden = true;
    void openModal(
      "Bearbeiten",
      "<div>Die Stammdaten konnten nicht geladen werden. Details siehe Konsole.</div>",
      { variant: "info", confirmText: "Verstanden" }
    );
  }
}

function resetEmployeeForm() {
  /** @type {HTMLFormElement} */ ($("#employee-form")).reset();
  /** @type {HTMLInputElement} */ ($("#emp-id")).value = "";
  renderUrlaubPeriodenContainer("emp-urlaub-perioden", []);
  $("#employee-form-title").innerHTML =
    '<i class="fa-solid fa-user-pen"></i> Mitarbeitende bearbeiten';
  syncEditAbsenceHint();
  const panel = /** @type {HTMLElement | null} */ ($("#employee-edit-panel"));
  if (panel) panel.hidden = true;
}

function fillNewEmployeeSelects() {
  const quals = uniqueQualifications();
  /** @type {HTMLSelectElement} */ ($("#new-emp-qual")).innerHTML = quals
    .map((q) => `<option value="${q}">${q}</option>`)
    .join("");
  if (!state) return;
  /** @type {HTMLSelectElement} */ ($("#new-emp-tl")).innerHTML =
    '<option value="">Keine Teamleitung</option>' +
    teamLeadersSortedForDashboard()
      .map((t) => {
        const abt = normalizeAbteilung(t.Abteilung);
        return `<option value="${t.ID}">${escapeHtml(t.Name)} (${escapeHtml(abt)})</option>`;
      })
      .join("");
}

function fillQualificationSelects() {
  const quals = uniqueQualifications();
  const opts = quals.map((q) => `<option value="${q}">${q}</option>`).join("");
  /** @type {HTMLSelectElement} */ ($("#emp-qual")).innerHTML = opts;
  /** @type {HTMLSelectElement} */ ($("#personnel-filter-qual")).innerHTML =
    `<option value="">Alle</option>` + quals.map((q) => `<option value="${q}">${q}</option>`).join("");
  fillNewEmployeeSelects();
}

function fillTeamLeaderSelect() {
  if (!state) return;
  const sel = /** @type {HTMLSelectElement} */ ($("#emp-tl"));
  const sorted = teamLeadersSortedForDashboard();
  sel.innerHTML =
    '<option value="">Keine Teamleitung</option>' +
    sorted
      .map((t) => {
        const abt = normalizeAbteilung(t.Abteilung);
        return `<option value="${t.ID}">${escapeHtml(t.Name)} (${escapeHtml(abt)})</option>`;
      })
      .join("");
}

function fillTeamleaderAbteilungSelect(selectEl, currentAbteilung) {
  const sel = typeof selectEl === "string" ? $(selectEl) : selectEl;
  if (!(sel instanceof HTMLSelectElement)) return;
  const v = normalizeAbteilung(currentAbteilung);
  sel.innerHTML = ABTEILUNGEN.map(
    (a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`
  ).join("");
  sel.value = v;
}

function openTeamLeaderEditModal(tl) {
  if (!tl) return;
  /** @type {HTMLInputElement} */ ($("#teamleader-form-id")).value = String(tl.ID);
  /** @type {HTMLInputElement} */ ($("#teamleader-form-name")).value = tl.Name;
  /** @type {HTMLInputElement} */ ($("#teamleader-form-color")).value = sanitizeTeamColor(tl.Team_Farbe);
  fillTeamleaderAbteilungSelect("#teamleader-form-abteilung", tl.Abteilung);
  /** @type {HTMLElement} */ ($("#teamleader-modal-backdrop")).hidden = false;
  /** @type {HTMLElement} */ ($("#teamleader-modal")).hidden = false;
}

function closeTeamLeaderEditModal() {
  /** @type {HTMLElement} */ ($("#teamleader-modal-backdrop")).hidden = true;
  /** @type {HTMLElement} */ ($("#teamleader-modal")).hidden = true;
}

function fillPersonnelStufeFilter() {
  if (!state) return;
  const sel = /** @type {HTMLSelectElement} */ ($("#personnel-filter-stufe"));
  const prev = sel.value;
  const stufen = [
    ...new Set(state.employees.map((e) => String(e.Stufe ?? "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "de"));
  sel.innerHTML =
    '<option value="">Alle</option>' +
    stufen.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

function renderPersonnelView() {
  fillQualificationSelects();
  fillTeamLeaderSelect();
  fillPersonnelStufeFilter();
  renderTeamLeadersTable();
  renderPersonnelTable();
  fillTeamleaderAbteilungSelect("#new-tl-abteilung", ABTEILUNGEN[0]);
  syncEditAbsenceHint();
  syncNewAbsenceHint();
  if ($("#view-urlaub")?.classList?.contains("view--active")) {
    renderUrlaubPlan();
  }
}

function bindUrlaubPeriodenButtonsOnce() {
  const ws = /** @type {HTMLElement | null} */ ($("#app-workspace"));
  if (!ws || ws.dataset.urlaubPeriodUi === "1") return;
  ws.dataset.urlaubPeriodUi = "1";
  ws.addEventListener("click", (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    if (t?.closest("#emp-urlaub-add")) {
      ev.preventDefault();
      document.getElementById("emp-urlaub-perioden")?.insertAdjacentHTML("beforeend", urlaubPeriodRowTemplate());
      return;
    }
    if (t?.closest("#new-emp-urlaub-add")) {
      ev.preventDefault();
      document.getElementById("new-emp-urlaub-perioden")?.insertAdjacentHTML("beforeend", urlaubPeriodRowTemplate());
      return;
    }
    const rem = t?.closest(".js-u-remove");
    if (rem) {
      ev.preventDefault();
      rem.closest(".urlaub-per-row")?.remove();
    }
  });
}

function setupPersonnelInteractions() {
  bindUrlaubPeriodenButtonsOnce();
  $("#personnel-search").addEventListener("input", renderPersonnelTable);
  $("#personnel-filter-status").addEventListener("change", renderPersonnelTable);
  $("#personnel-filter-qual").addEventListener("change", renderPersonnelTable);
  $("#personnel-filter-beschäftigung").addEventListener("change", renderPersonnelTable);
  $("#personnel-filter-stufe").addEventListener("change", renderPersonnelTable);
  $("#personnel-filter-abteilung").addEventListener("change", renderPersonnelTable);

  $("#emp-status").addEventListener("change", syncEditAbsenceHint);
  $("#new-emp-status").addEventListener("change", syncNewAbsenceHint);

  $("#emp-reset").addEventListener("click", resetEmployeeForm);

  $("#employee-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state) return;
    const existingId = /** @type {HTMLInputElement} */ ($("#emp-id")).value;
    if (!existingId) {
      await openModal(
        "Bearbeiten",
        "<div>Bitte wählen Sie in der Tabelle zuerst einen Mitarbeitenden über das Stift-Symbol.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    const tags = /** @type {HTMLInputElement} */ ($("#emp-tags"))
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const tlRaw = /** @type {HTMLSelectElement} */ ($("#emp-tl")).value;
    const kAb = readOptionalISODateFromInput("#emp-krank-ab");
    const kBis = readOptionalISODateFromInput("#emp-krank-bis");
    const uAb = readOptionalISODateFromInput("#emp-urlaub-ab");
    const uBis = readOptionalISODateFromInput("#emp-urlaub-bis");
    if (kAb && kBis && kBis < kAb) {
      await openModal(
        "Datum prüfen",
        "<div>„Krankheit bis“ darf nicht vor „Krankheit von“ liegen.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    if (uAb && uBis && uBis < uAb) {
      await openModal(
        "Datum prüfen",
        "<div>„Urlaub bis“ darf nicht vor „Urlaub von“ liegen.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    const uPeriods = collectUrlaubPeriodenFromContainer("emp-urlaub-perioden");
    for (const p of uPeriods) {
      if (!validateUrlaubPeriodOrder(p.von, p.bis)) {
        await openModal(
          "Datum prüfen",
          "<div>Bei einem weiteren Urlaubszeitraum darf „Bis“ nicht vor „Von“ liegen.</div>",
          { variant: "info", confirmText: "Verstanden" }
        );
        return;
      }
    }
    const payload = {
      Personalnummer: /** @type {HTMLInputElement} */ ($("#emp-pnr")).value.trim(),
      Vorname: /** @type {HTMLInputElement} */ ($("#emp-vorname")).value.trim(),
      Nachname: /** @type {HTMLInputElement} */ ($("#emp-nachname")).value.trim(),
      Qualifikation: /** @type {HTMLSelectElement} */ ($("#emp-qual")).value,
      Zusatz_Tags: tags,
      Teamleiter_ID: tlRaw === "" ? null : Number(tlRaw),
      Beschäftigung: normalizeBeschäftigung(/** @type {HTMLSelectElement} */ ($("#emp-beschäftigung")).value),
      Stufe: /** @type {HTMLInputElement} */ ($("#emp-stufe")).value.trim(),
      Abteilung: normalizeAbteilung(/** @type {HTMLSelectElement} */ ($("#emp-abteilung")).value),
      Status: /** @type {HTMLSelectElement} */ ($("#emp-status")).value,
      Krank_ab: kAb,
      Krank_bis: kBis,
      Urlaub_ab: uAb,
      Urlaub_bis: uBis,
      Urlaub_perioden: uPeriods,
    };
    const idx = state.employees.findIndex((e) => Number(e.ID) === Number(existingId));
    if (idx >= 0) {
      recordUndoSnapshot();
      const merged = /** @type {Employee} */ ({ ...state.employees[idx], ...payload });
      syncLegacyAbsenceFields(merged);
      state.employees[idx] = merged;
      await syncEmployeesThenPersist();
    }
    resetEmployeeForm();
    renderPersonnelView();
    renderDashboard();
    if ($("#view-projects").classList.contains("view--active")) {
      renderProjectsView();
    }
  });

  $("#new-employee-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state) return;
    const kAbN = readOptionalISODateFromInput("#new-emp-krank-ab");
    const kBisN = readOptionalISODateFromInput("#new-emp-krank-bis");
    const uAbN = readOptionalISODateFromInput("#new-emp-urlaub-ab");
    const uBisN = readOptionalISODateFromInput("#new-emp-urlaub-bis");
    if (kAbN && kBisN && kBisN < kAbN) {
      await openModal(
        "Datum prüfen",
        "<div>„Krankheit bis“ darf nicht vor „Krankheit von“ liegen.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    if (uAbN && uBisN && uBisN < uAbN) {
      await openModal(
        "Datum prüfen",
        "<div>„Urlaub bis“ darf nicht vor „Urlaub von“ liegen.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    const uPeriodsN = collectUrlaubPeriodenFromContainer("new-emp-urlaub-perioden");
    for (const p of uPeriodsN) {
      if (!validateUrlaubPeriodOrder(p.von, p.bis)) {
        await openModal(
          "Datum prüfen",
          "<div>Bei einem weiteren Urlaubszeitraum darf „Bis“ nicht vor „Von“ liegen.</div>",
          { variant: "info", confirmText: "Verstanden" }
        );
        return;
      }
    }
    const newEmp = /** @type {Employee} */ ({
      ID: nextId(state.employees),
      Personalnummer: /** @type {HTMLInputElement} */ ($("#new-emp-pnr")).value.trim(),
      Vorname: /** @type {HTMLInputElement} */ ($("#new-emp-vorname")).value.trim(),
      Nachname: /** @type {HTMLInputElement} */ ($("#new-emp-nachname")).value.trim(),
      Qualifikation: /** @type {HTMLSelectElement} */ ($("#new-emp-qual")).value,
      Beschäftigung: normalizeBeschäftigung(/** @type {HTMLSelectElement} */ ($("#new-emp-beschäftigung")).value),
      Stufe: /** @type {HTMLInputElement} */ ($("#new-emp-stufe")).value.trim(),
      Abteilung: normalizeAbteilung(/** @type {HTMLSelectElement} */ ($("#new-emp-abteilung")).value),
      Teamleiter_ID: (() => {
        const raw = /** @type {HTMLSelectElement} */ ($("#new-emp-tl")).value;
        return raw === "" ? null : Number(raw);
      })(),
      Status: /** @type {HTMLSelectElement} */ ($("#new-emp-status")).value,
      Zusatz_Tags: [],
      Krank_ab: kAbN,
      Krank_bis: kBisN,
      Urlaub_ab: uAbN,
      Urlaub_bis: uBisN,
      Urlaub_perioden: uPeriodsN,
      Rückkehr_erwartet_am: null,
      Abwesenheit_geplant_ab: null,
      Abwesenheit_geplant_bis: null,
    });
    syncLegacyAbsenceFields(newEmp);
    recordUndoSnapshot();
    state.employees.push(newEmp);
    await syncEmployeesThenPersist();
    /** @type {HTMLFormElement} */ ($("#new-employee-form")).reset();
    renderUrlaubPeriodenContainer("new-emp-urlaub-perioden", []);
    fillNewEmployeeSelects();
    renderPersonnelView();
    renderDashboard();
    if ($("#view-projects").classList.contains("view--active")) {
      renderProjectsView();
    }
  });

  $("#new-teamleader-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state) return;
    const name = /** @type {HTMLInputElement} */ ($("#new-tl-name")).value.trim();
    if (!name) return;
    const colorIn = /** @type {HTMLInputElement} */ ($("#new-tl-color")).value;
    const maxR = state.team_leaders.reduce((m, t) => Math.max(m, Number(t.Reihenfolge) || 0), -1);
    recordUndoSnapshot();
    state.team_leaders.push({
      ID: nextId(state.team_leaders),
      Name: name,
      Team_Farbe: sanitizeTeamColor(colorIn),
      Abteilung: normalizeAbteilung(/** @type {HTMLSelectElement} */ ($("#new-tl-abteilung")).value),
      Reihenfolge: maxR + 1,
    });
    await persist();
    /** @type {HTMLFormElement} */ ($("#new-teamleader-form")).reset();
    /** @type {HTMLInputElement} */ ($("#new-tl-color")).value = "#64748b";
    renderPersonnelView();
    renderDashboard();
    if ($("#view-projects").classList.contains("view--active")) {
      renderProjectsView();
    }
  });

  const tlBackdrop = /** @type {HTMLElement | null} */ ($("#teamleader-modal-backdrop"));
  if (tlBackdrop && tlBackdrop.dataset.bound !== "1") {
    tlBackdrop.dataset.bound = "1";
    tlBackdrop.addEventListener("click", closeTeamLeaderEditModal);
  }
  const tlCancel = /** @type {HTMLButtonElement | null} */ ($("#teamleader-form-cancel"));
  if (tlCancel && tlCancel.dataset.bound !== "1") {
    tlCancel.dataset.bound = "1";
    tlCancel.addEventListener("click", closeTeamLeaderEditModal);
  }
  const tlForm = /** @type {HTMLFormElement | null} */ (document.getElementById("teamleader-edit-form"));
  if (tlForm && tlForm.dataset.bound !== "1") {
    tlForm.dataset.bound = "1";
    tlForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!state) return;
      const idRaw = /** @type {HTMLInputElement} */ ($("#teamleader-form-id")).value.trim();
      const tl = getTeamLeader(idRaw);
      if (!tl) {
        closeTeamLeaderEditModal();
        return;
      }
      const name = /** @type {HTMLInputElement} */ ($("#teamleader-form-name")).value.trim();
      if (!name) return;
      recordUndoSnapshot();
      tl.Name = name;
      tl.Team_Farbe = sanitizeTeamColor(/** @type {HTMLInputElement} */ ($("#teamleader-form-color")).value);
      tl.Abteilung = normalizeAbteilung(/** @type {HTMLSelectElement} */ ($("#teamleader-form-abteilung")).value);
      await persist();
      closeTeamLeaderEditModal();
      renderPersonnelView();
      renderDashboard();
      if ($("#view-projects").classList.contains("view--active")) {
        renderProjectsView();
      }
    });
  }
}

function setNavEnabled(enabled) {
  $all(".nav-btn").forEach((b) => {
    /** @type {HTMLButtonElement} */ (b).disabled = !enabled;
  });
}

function setupNavigation() {
  $all(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(/** @type {any} */ (btn).dataset.view));
  });
}

function setupFileLinking() {
  $("#btn-link-file").addEventListener("click", async () => {
    const err = /** @type {HTMLParagraphElement} */ ($("#file-error"));
    const meta = /** @type {HTMLParagraphElement} */ ($("#file-meta"));
    err.hidden = true;
    err.textContent = "";
    if (!isFileSystemAccessSupported()) {
      err.hidden = false;
      err.textContent =
        "Ihr Browser unterstützt die File System Access API nicht. Bitte Chrome/Edge und http://localhost verwenden.";
      return;
    }
    try {
      const data = await linkLocalDataFile();
      state = data;
      clearUndoHistory();
      await runAutoStatusSyncAndPersist();
      meta.textContent = `Aktiv: ${getLinkedFileName()} · Daten geladen`;
      $("#gate-screen").hidden = true;
      $("#app-workspace").hidden = false;
      setNavEnabled(true);
      switchView("dashboard");
    } catch (e) {
      if (e && typeof e === "object" && "name" in e && /** @type {{name:string}} */ (e).name === "AbortError") {
        return;
      }
      err.hidden = false;
      err.textContent =
        e && typeof e === "object" && "message" in e
          ? /** @type {{message:string}} */ (e).message
          : String(e);
    }
  });
}

function dashAbsRangeHintText(status) {
  if (status === "Krank") {
    return "Wird in den Stammdaten unter Krankheit von/bis gespeichert. Geplanter Urlaub (Felder Urlaub und weitere Urlaubszeiträume) bleibt unverändert.";
  }
  return "Wird in den Stammdaten unter Urlaub von/bis gespeichert. Weitere Urlaubsblöcke und geplante Krankheit bleiben unverändert.";
}

function syncDashAbsRangeHint() {
  const st = /** @type {HTMLSelectElement | null} */ ($("#dash-abs-status"));
  const hint = /** @type {HTMLElement | null} */ ($("#dash-abs-range-hint"));
  if (!st || !hint) return;
  hint.textContent = dashAbsRangeHintText(st.value);
}

function closeDashboardAbsenceModal() {
  const bd = document.getElementById("dash-abs-backdrop");
  const md = document.getElementById("dash-abs-modal");
  if (bd) bd.hidden = true;
  if (md) md.hidden = true;
}

function openDashboardAbsenceModal(empId) {
  if (!state) return;
  const emp = getEmployee(empId);
  if (!emp) return;
  /** @type {HTMLInputElement} */ ($("#dash-abs-emp-id")).value = String(emp.ID);
  const nameEl = document.getElementById("dash-abs-name");
  if (nameEl) nameEl.textContent = `${emp.Vorname} ${emp.Nachname}`.trim();
  const statusSel = /** @type {HTMLSelectElement | null} */ ($("#dash-abs-status"));
  if (statusSel) {
    statusSel.value = emp.Status === "Urlaub" ? "Urlaub" : "Krank";
  }
  const t = todayISO();
  const vonEl = /** @type {HTMLInputElement | null} */ ($("#dash-abs-von"));
  const bisEl = /** @type {HTMLInputElement | null} */ ($("#dash-abs-bis"));
  if (emp.Status === "Krank" && emp.Krank_ab) {
    if (vonEl) vonEl.value = String(emp.Krank_ab);
    if (bisEl) bisEl.value = emp.Krank_bis ? String(emp.Krank_bis) : t;
  } else if (emp.Status === "Urlaub") {
    const r = currentUrlaubRangeForDay(emp, t);
    if (r) {
      if (vonEl) vonEl.value = String(r.ab);
      if (bisEl) bisEl.value = r.bis ? String(r.bis) : t;
    } else if (emp.Urlaub_ab) {
      if (vonEl) vonEl.value = String(emp.Urlaub_ab);
      if (bisEl) bisEl.value = emp.Urlaub_bis ? String(emp.Urlaub_bis) : t;
    } else {
      const ranges = getUrlaubRanges(emp);
      const first = ranges[0];
      if (first) {
        if (vonEl) vonEl.value = String(first.ab);
        if (bisEl) bisEl.value = first.bis ? String(first.bis) : t;
      } else {
        if (vonEl) vonEl.value = t;
        if (bisEl) bisEl.value = t;
      }
    }
  } else {
    if (vonEl) vonEl.value = t;
    if (bisEl) bisEl.value = t;
  }
  syncDashAbsRangeHint();
  const bd = document.getElementById("dash-abs-backdrop");
  const md = document.getElementById("dash-abs-modal");
  if (bd) bd.hidden = false;
  if (md) md.hidden = false;
  vonEl?.focus();
}

function setupDashboardAbsenceModal() {
  const cancel = document.getElementById("dash-abs-cancel");
  const bd = document.getElementById("dash-abs-backdrop");
  const form = /** @type {HTMLFormElement | null} */ (document.getElementById("dash-abs-form"));
  const statusSel = document.getElementById("dash-abs-status");
  if (!cancel || !bd || !form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";
  cancel.addEventListener("click", closeDashboardAbsenceModal);
  bd.addEventListener("click", (ev) => {
    if (ev.target === bd) closeDashboardAbsenceModal();
  });
  statusSel?.addEventListener("change", syncDashAbsRangeHint);
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!state) return;
    const idRaw = /** @type {HTMLInputElement} */ ($("#dash-abs-emp-id")).value;
    const empId = Number(idRaw);
    if (!Number.isFinite(empId)) return;
    const status = /** @type {"Krank" | "Urlaub"} */ (
      /** @type {HTMLSelectElement} */ ($("#dash-abs-status")).value
    );
    const vAb = readOptionalISODateFromInput("#dash-abs-von");
    const vBis = readOptionalISODateFromInput("#dash-abs-bis");
    if (!vAb || !vBis) {
      await openModal("Datum", "<div>Bitte „Von“ und „Bis“ ausfüllen.</div>", {
        variant: "info",
        confirmText: "Verstanden",
      });
      return;
    }
    if (vBis < vAb) {
      await openModal(
        "Datum prüfen",
        "<div>„Bis“ darf nicht vor „Von“ liegen.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    const idx = state.employees.findIndex((e) => Number(e.ID) === empId);
    if (idx < 0) return;
    recordUndoSnapshot();
    const prev = state.employees[idx];
    const next = /** @type {Employee} */ ({
      ...prev,
      Status: status,
    });
    if (status === "Krank") {
      next.Krank_ab = vAb;
      next.Krank_bis = vBis;
    } else {
      next.Urlaub_ab = vAb;
      next.Urlaub_bis = vBis;
    }
    syncLegacyAbsenceFields(next);
    state.employees[idx] = next;
    await syncEmployeesThenPersist();
    closeDashboardAbsenceModal();
    renderDashboard();
    renderPersonnelView();
    if ($("#view-projects").classList.contains("view--active")) {
      renderProjectsView();
    }
  });
}

let dashboardDnDActiveZone = null;

/** Entfernt Drop-Zonen-Hervorhebung (Maus- und Touch-Zug). */
function clearDashboardDropZoneHighlight() {
  if (dashboardDnDActiveZone) {
    dashboardDnDActiveZone.classList.remove("team-drop-zone--active");
    dashboardDnDActiveZone = null;
  }
}

/**
 * @param {string} empId
 * @param {Element | null} targetEl Element unter dem Cursor bzw. dem Finger (drop target)
 */
async function dashboardHandleEmployeeDrop(empId, targetEl) {
  if (!state) return;
  const absZone = /** @type {HTMLElement | null} */ (targetEl?.closest("[data-drop-absence]"));
  if (absZone) {
    clearDashboardDropZoneHighlight();
    if (!getEmployee(empId)) return;
    openDashboardAbsenceModal(empId);
    return;
  }
  const zone = /** @type {HTMLElement | null} */ (
    targetEl?.closest("[data-drop-teamleader], [data-drop-unassigned]")
  );
  if (!zone) {
    clearDashboardDropZoneHighlight();
    return;
  }
  clearDashboardDropZoneHighlight();
  const emp = getEmployee(empId);
  if (!emp) return;
  if (zone.hasAttribute("data-drop-unassigned")) {
    recordUndoSnapshot();
    emp.Teamleiter_ID = null;
  } else {
    const tlId = zone.getAttribute("data-drop-teamleader");
    if (!tlId || !getTeamLeader(tlId)) return;
    if (Number(emp.Teamleiter_ID) === Number(tlId)) return;
    recordUndoSnapshot();
    emp.Teamleiter_ID = Number(tlId);
  }
  await persist();
  renderDashboard();
  if ($("#view-personnel").classList.contains("view--active")) {
    renderPersonnelView();
  }
}

/** Hebt die Zone unter (x,y) hervor (Touch-Zug). */
function dashboardHighlightDropZoneUnderPoint(clientX, clientY) {
  const el = document.elementFromPoint(clientX, clientY);
  const zone = /** @type {HTMLElement | null} */ (
    el?.closest("[data-drop-absence], [data-drop-teamleader], [data-drop-unassigned]")
  );
  if (dashboardDnDActiveZone && dashboardDnDActiveZone !== zone) {
    dashboardDnDActiveZone.classList.remove("team-drop-zone--active");
  }
  dashboardDnDActiveZone = zone;
  zone?.classList.add("team-drop-zone--active");
}

/**
 * Pointer-Zug für Mitarbeitende (Maus, Touch, Stift): zuverlässiger als HTML5-Drag
 * bei gemischten Geräten; setPointerCapture + elementFromPoint beim Loslassen.
 */
function setupDashboardPointerDrag(view) {
  if (view.dataset.dashboardPointer === "1") return;
  view.dataset.dashboardPointer = "1";
  const THRESH = 10;

  /** @type {{ pointerId: number | null; id: string | null; row: HTMLElement | null; startX: number; startY: number; lastX: number; lastY: number; active: boolean; cleanup: (() => void) | null }} */
  const st = {
    pointerId: null,
    id: null,
    row: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    active: false,
    cleanup: null,
  };

  function resetPointerDrag() {
    if (st.cleanup) {
      st.cleanup();
      st.cleanup = null;
    }
    if (st.row?.hasAttribute("data-dashboard-drag-lock")) {
      st.row.draggable = st.row.getAttribute("data-dashboard-drag-lock") === "1";
      st.row.removeAttribute("data-dashboard-drag-lock");
    }
    st.row?.classList.remove("dashboard-emp-dragging");
    view.classList.remove("dashboard-view--touch-drag");
    clearDashboardDropZoneHighlight();
    st.pointerId = null;
    st.id = null;
    st.row = null;
    st.active = false;
  }

  view.addEventListener(
    "pointerdown",
    (ev) => {
      if (ev.button !== 0) return;
      const row =
        ev.target instanceof Element ? ev.target.closest("[data-dashboard-employee]") : null;
      if (!(row instanceof HTMLElement)) return;
      const id = row.getAttribute("data-dashboard-employee");
      if (!id) return;

      if (st.pointerId != null) resetPointerDrag();

      if (!row.hasAttribute("data-dashboard-drag-lock")) {
        row.setAttribute("data-dashboard-drag-lock", row.draggable ? "1" : "0");
      }
      row.draggable = false;

      st.pointerId = ev.pointerId;
      st.id = id;
      st.row = row;
      st.startX = ev.clientX;
      st.startY = ev.clientY;
      st.lastX = ev.clientX;
      st.lastY = ev.clientY;
      st.active = false;

      const moveOpts = { passive: false, capture: true };
      const upOpts = { passive: false, capture: true };

      const onMove = (e) => {
        if (e.pointerId !== st.pointerId || st.id == null) return;
        st.lastX = e.clientX;
        st.lastY = e.clientY;
        const dx = e.clientX - st.startX;
        const dy = e.clientY - st.startY;
        if (!st.active) {
          if (dx * dx + dy * dy < THRESH * THRESH) return;
          st.active = true;
          st.row?.classList.add("dashboard-emp-dragging");
          view.classList.add("dashboard-view--touch-drag");
        }
        e.preventDefault();
        dashboardHighlightDropZoneUnderPoint(e.clientX, e.clientY);
      };

      const onUp = async (e) => {
        if (e.pointerId !== st.pointerId) return;
        const pendingId = st.id;
        const wasActive = st.active;
        const endX = st.lastX;
        const endY = st.lastY;
        const pid = st.pointerId;
        const capRow = st.row;
        try {
          if (capRow != null && pid != null) capRow.releasePointerCapture(pid);
        } catch {
          /* ignore */
        }
        if (wasActive) e.preventDefault();
        resetPointerDrag();
        if (!pendingId || !wasActive || !state) return;
        await new Promise((r) => requestAnimationFrame(r));
        let under = document.elementFromPoint(endX, endY);
        if (!(under instanceof Element)) {
          under = document.elementFromPoint(e.clientX, e.clientY);
        }
        await dashboardHandleEmployeeDrop(pendingId, under instanceof Element ? under : null);
      };

      let captured = false;
      try {
        row.setPointerCapture(ev.pointerId);
        captured = true;
      } catch {
        /* ältere Engines: Listener auf document */
      }

      if (captured) {
        row.addEventListener("pointermove", onMove, moveOpts);
        row.addEventListener("pointerup", onUp, upOpts);
        row.addEventListener("pointercancel", onUp, upOpts);
        st.cleanup = () => {
          row.removeEventListener("pointermove", onMove, moveOpts);
          row.removeEventListener("pointerup", onUp, upOpts);
          row.removeEventListener("pointercancel", onUp, upOpts);
        };
      } else {
        document.addEventListener("pointermove", onMove, moveOpts);
        document.addEventListener("pointerup", onUp, upOpts);
        document.addEventListener("pointercancel", onUp, upOpts);
        st.cleanup = () => {
          document.removeEventListener("pointermove", onMove, moveOpts);
          document.removeEventListener("pointerup", onUp, upOpts);
          document.removeEventListener("pointercancel", onUp, upOpts);
        };
      }
    },
    { capture: true, passive: true }
  );
}

/** Touch-Zug (Fallback ohne Pointer Events, z. B. sehr alte WebViews). */
function setupDashboardTouchDrag(view) {
  if (view.dataset.dashboardTouch === "1") return;
  view.dataset.dashboardTouch = "1";
  const THRESH = 12;
  /** @type {{ id: string | null; startX: number; startY: number; lastX: number; lastY: number; row: HTMLElement | null; active: boolean; touchId: number | null; moveDoc: ((ev: TouchEvent) => void) | null; endDoc: ((ev: TouchEvent) => void) | null }} */
  const st = {
    id: null,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    row: null,
    active: false,
    touchId: null,
    moveDoc: null,
    endDoc: null,
  };

  function cleanupDocListeners() {
    if (st.moveDoc) {
      document.removeEventListener("touchmove", st.moveDoc);
      st.moveDoc = null;
    }
    if (st.endDoc) {
      document.removeEventListener("touchend", st.endDoc);
      document.removeEventListener("touchcancel", st.endDoc);
      st.endDoc = null;
    }
  }

  function resetTouchDrag() {
    cleanupDocListeners();
    st.row?.classList.remove("dashboard-emp-dragging");
    view.classList.remove("dashboard-view--touch-drag");
    clearDashboardDropZoneHighlight();
    st.id = null;
    st.row = null;
    st.active = false;
    st.touchId = null;
  }

  view.addEventListener(
    "touchstart",
    (ev) => {
      if (st.id != null) resetTouchDrag();
      const t = ev.targetTouches[0];
      if (!t) return;
      const row =
        ev.target instanceof Element ? ev.target.closest("[data-dashboard-employee]") : null;
      if (!(row instanceof HTMLElement)) return;
      const id = row.getAttribute("data-dashboard-employee");
      if (!id) return;
      st.id = id;
      st.touchId = t.identifier;
      st.startX = t.clientX;
      st.startY = t.clientY;
      st.lastX = t.clientX;
      st.lastY = t.clientY;
      st.row = row;
      st.active = false;

      const onMove = (e) => {
        const ti = [...e.touches].find((x) => x.identifier === st.touchId);
        if (!ti || st.id == null) return;
        st.lastX = ti.clientX;
        st.lastY = ti.clientY;
        const dx = ti.clientX - st.startX;
        const dy = ti.clientY - st.startY;
        if (!st.active) {
          if (dx * dx + dy * dy < THRESH * THRESH) return;
          st.active = true;
          st.row?.classList.add("dashboard-emp-dragging");
          view.classList.add("dashboard-view--touch-drag");
        }
        e.preventDefault();
        dashboardHighlightDropZoneUnderPoint(ti.clientX, ti.clientY);
      };

      const onEnd = async (e) => {
        const ti = [...e.changedTouches].find((x) => x.identifier === st.touchId);
        const pendingId = st.id;
        const wasActive = st.active;
        const endX = ti ? ti.clientX : st.lastX;
        const endY = ti ? ti.clientY : st.lastY;
        const fallbackX = st.lastX;
        const fallbackY = st.lastY;
        if (wasActive) e.preventDefault();
        resetTouchDrag();
        if (!pendingId || !wasActive || !state) return;
        await new Promise((r) => requestAnimationFrame(r));
        let under = document.elementFromPoint(endX, endY);
        if (!(under instanceof Element)) {
          under = document.elementFromPoint(fallbackX, fallbackY);
        }
        await dashboardHandleEmployeeDrop(pendingId, under instanceof Element ? under : null);
      };

      st.moveDoc = onMove;
      st.endDoc = onEnd;
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd, { passive: false });
      document.addEventListener("touchcancel", onEnd, { passive: false });
    },
    { capture: true, passive: true }
  );
}

function setupDashboardDnD() {
  const view = /** @type {HTMLElement | null} */ ($("#view-dashboard"));
  if (!view || view.dataset.dashboardDnd === "1") return;
  view.dataset.dashboardDnd = "1";

  view.addEventListener(
    "contextmenu",
    (ev) => {
      const t = ev.target instanceof Element ? ev.target.closest("[data-dashboard-employee]") : null;
      if (t && preferDashboardTouchDrag()) ev.preventDefault();
    },
    { capture: true }
  );

  view.addEventListener("dragstart", (ev) => {
    const path = ev.composedPath();
    let row = /** @type {HTMLElement | null} */ (null);
    for (const n of path) {
      if (n instanceof Element && n.hasAttribute("data-dashboard-employee")) {
        row = /** @type {HTMLElement} */ (n);
        break;
      }
    }
    if (row) {
      const id = row.getAttribute("data-dashboard-employee");
      if (!id) return;
      row.classList.add("dashboard-emp-dragging");
      ev.dataTransfer.setData("text/plain", id);
      ev.dataTransfer.setData("application/x-employee-id", id);
      ev.dataTransfer.effectAllowed = "move";
      return;
    }
    const teamDragEl =
      ev.target instanceof Element ? ev.target.closest("[data-dashboard-team-drag]") : null;
    if (teamDragEl instanceof HTMLElement) {
      const teamCard = teamDragEl.closest("[data-dashboard-team-card]");
      if (!(teamCard instanceof HTMLElement)) return;
      const tid = teamCard.getAttribute("data-dashboard-team-card");
      if (!tid) return;
      teamCard.classList.add("card-team--reorder-drag");
      ev.dataTransfer.setData("application/x-teamleader-reorder", tid);
      ev.dataTransfer.effectAllowed = "move";
    }
  });

  view.addEventListener("dragend", () => {
    view.querySelectorAll(".dashboard-emp-dragging").forEach((el) => el.classList.remove("dashboard-emp-dragging"));
    view.querySelectorAll(".card-team--reorder-drag").forEach((el) => el.classList.remove("card-team--reorder-drag"));
  });

  view.addEventListener("dragenter", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const zone = /** @type {HTMLElement | null} */ (
      el?.closest("[data-drop-absence], [data-drop-teamleader], [data-drop-unassigned]")
    );
    if (!zone) return;
    ev.preventDefault();
  });

  view.addEventListener("dragover", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const zone = /** @type {HTMLElement | null} */ (
      el?.closest("[data-drop-absence], [data-drop-teamleader], [data-drop-unassigned]")
    );
    if (!zone) return;
    ev.preventDefault();
    ev.dataTransfer.dropEffect = "move";
    if (dashboardDnDActiveZone && dashboardDnDActiveZone !== zone) {
      dashboardDnDActiveZone.classList.remove("team-drop-zone--active");
    }
    dashboardDnDActiveZone = zone;
    zone.classList.add("team-drop-zone--active");
  });

  view.addEventListener("dragleave", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const zone = /** @type {HTMLElement | null} */ (
      el?.closest("[data-drop-absence], [data-drop-teamleader], [data-drop-unassigned]")
    );
    if (!zone) return;
    const rel = /** @type {Node | null} */ (ev.relatedTarget);
    if (!rel || !zone.contains(rel)) {
      zone.classList.remove("team-drop-zone--active");
      if (dashboardDnDActiveZone === zone) dashboardDnDActiveZone = null;
    }
  });

  view.addEventListener("drop", async (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    ev.preventDefault();
    const tlReorder = ev.dataTransfer.getData("application/x-teamleader-reorder");
    if (tlReorder && state) {
      clearDashboardDropZoneHighlight();
      const targetCard = el?.closest("[data-dashboard-team-card]");
      const toId = targetCard?.getAttribute("data-dashboard-team-card");
      if (toId && toId !== tlReorder) {
        recordUndoSnapshot();
        reorderTeamLeadersOnDashboard(tlReorder, toId);
        await persist();
        renderDashboard();
        if ($("#view-personnel").classList.contains("view--active")) {
          renderPersonnelView();
        }
      }
      return;
    }

    const empId =
      ev.dataTransfer.getData("text/plain") || ev.dataTransfer.getData("application/x-employee-id");
    if (!empId || !state) {
      clearDashboardDropZoneHighlight();
      return;
    }
    const absZone = /** @type {HTMLElement | null} */ (el?.closest("[data-drop-absence]"));
    if (absZone) {
      absZone.classList.remove("team-drop-zone--active");
      if (dashboardDnDActiveZone === absZone) dashboardDnDActiveZone = null;
    } else {
      const zone = /** @type {HTMLElement | null} */ (
        el?.closest("[data-drop-teamleader], [data-drop-unassigned]")
      );
      zone?.classList.remove("team-drop-zone--active");
      dashboardDnDActiveZone = null;
    }
    await dashboardHandleEmployeeDrop(empId, el);
  });

  setupDashboardPointerDrag(view);
  if (typeof PointerEvent === "undefined") {
    setupDashboardTouchDrag(view);
  }
}

function setupAutoEmployeeStatusSync() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !state) return;
    void (async () => {
      if (!syncEmployeeStatusesFromAbsenceDates()) return;
      await persist();
      refreshAllDataViews();
    })();
  });
}

function boot() {
  closeAllModalsAndBackdrops();
  state = null;
  clearUndoHistory();
  setupNavigation();
  setupDashboardDnD();
  setupDashboardAbsenceModal();
  setupProjectsInteractions();
  setupPersonnelInteractions();
  setupUrlaubView();
  setupUrlaubGanttBlockModal();
  setupPersonnelTableActions();
  setupQuickReturnDateButtons();
  setupDndAssignModal();
  setupProjectDropDelegation();
  setupFileLinking();
  setupAutoEmployeeStatusSync();
  setupHistoryKeyboard();
  setNavEnabled(false);
}

function startApp() {
  try {
    boot();
  } catch (err) {
    console.error(err);
    const msg = err && typeof err === "object" && "message" in err ? String(/** @type {{message:string}} */ (err).message) : String(err);
    window.alert(`Die Anwendung konnte nicht starten: ${msg}`);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp, { once: true });
} else {
  startApp();
}
