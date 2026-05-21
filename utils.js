/**
 * Kleine Hilfsfunktionen ohne eigene Geschäftslogik.
 *
 * DOM ($, $all), ISO-Datum (todayISO, formatDateDE), HTML escapen, CSV-Zellen.
 * Wird von fast allen Modulen importiert — hier nichts mit „Urlaub“ oder „Projekt“ regeln.
 */

export function isSingleCalendarDayUrlaub(/** @type {string} */ von, /** @type {string|null|undefined} */ bis) {
  if (!von || String(von).trim() === "") return false;
  const b = bis == null || bis === "" ? null : String(bis).trim();
  if (!b) return true;
  return von === b;
}

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** @param {string|null|undefined} isoStr @param {number} deltaDays */
export function addCalendarDaysToISO(isoStr, deltaDays) {
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
export function dateFromGanttToProjectISO(/** @type {unknown} */ d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * frappe-gantt speichert task._end als exklusives Ende; letzter belegter Kalendertag = Tag davor.
 * @param {Date} exclusiveEnd
 */
export function inclusiveEndISOFromGanttExclusiveEnd(exclusiveEnd) {
  if (!(exclusiveEnd instanceof Date) || Number.isNaN(exclusiveEnd.getTime())) return "";
  const t = new Date(exclusiveEnd.getTime());
  t.setMilliseconds(t.getMilliseconds() - 1);
  return dateFromGanttToProjectISO(t);
}

export function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

export function daysUntilISODate(isoStr) {
  if (isoStr == null || isoStr === "") return null;
  const end = parseISODate(String(isoStr));
  if (Number.isNaN(end.getTime())) return null;
  const start = parseISODate(todayISO());
  return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
}

/** ISO-Datum (yyyy-mm-dd) → Anzeige dd.mm.yyyy */
export function formatDateDE(iso) {
  if (iso == null || iso === "") return "";
  const parts = String(iso).trim().split("-");
  if (parts.length < 3) return String(iso);
  const [y, m, d] = parts;
  if (!y || !m || !d) return String(iso);
  return `${d}.${m}.${y}`;
}

export function readOptionalISODateFromInput(id) {
  const el = /** @type {HTMLInputElement | null} */ ($(id));
  if (!el) return null;
  const v = el.value.trim();
  return v === "" ? null : v;
}

export function addDaysFromTodayISO(days) {
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
export function ensureSelectHasValue(sel, value, labelText) {
  if (!sel || value == null || value === "") return;
  const v = String(value);
  if ([...sel.options].some((o) => o.value === v)) return;
  const opt = document.createElement("option");
  opt.value = v;
  opt.textContent = labelText || v;
  sel.appendChild(opt);
  sel.value = v;
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Ein Feld für CSV (Semikolon, Excel DE): bei Sonderzeichen in doppelte Anführungszeichen einschließen. */
export function csvSemicolonCell(raw) {
  const s = String(raw ?? "");
  if (/[;"\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function validateUrlaubPeriodOrder(rawVon, rawBis) {
  const von = rawVon == null || rawVon === "" ? null : String(rawVon);
  const bis = rawBis == null || rawBis === "" ? null : String(rawBis);
  if (von && bis && bis < von) return false;
  return true;
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

/** @param {number} y @param {number} m0 Monat 0–11 */
export function monthRangeISO(y, m0) {
  const days = new Date(y, m0 + 1, 0).getDate();
  const start = `${y}-${pad2(m0 + 1)}-01`;
  const end = `${y}-${pad2(m0 + 1)}-${pad2(days)}`;
  return { start, end, days };
}


export function isoFromYearMonthDay(y, m0, day) {
  return `${y}-${pad2(m0 + 1)}-${pad2(day)}`;
}
