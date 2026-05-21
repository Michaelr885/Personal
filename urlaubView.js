/**
 * Tab „Urlaub“: Monatskalender, Jahresstatistik, Urlaub eintragen/bearbeiten.
 *
 * Filter nach Abteilung/Qualifikation, Gantt-ähnliche Urlaubsbalken, Modal zum
 * Anlegen von Urlaubszeiträumen (inkl. halber Tage). Feiertage → holidays.js.
 */
import {
  getState,
  setState,
  recordUndoSnapshot,
  persist,
  nextId,
  refreshAllDataViews,
  openModal,
  openAssignmentConflictModal,
  closeAllModalsAndBackdrops,
  isPlanningModeActive,
} from "./state.js";
import {
  $,
  $all,
  escapeHtml,
  csvSemicolonCell,
  todayISO,
  parseISODate,
  addCalendarDaysToISO,
  formatDateDE,
  daysUntilISODate,
  rangesOverlap,
  readOptionalISODateFromInput,
  addDaysFromTodayISO,
  ensureSelectHasValue,
  dateFromGanttToProjectISO,
  inclusiveEndISOFromGanttExclusiveEnd,
  pad2,
  monthRangeISO,
  isoFromYearMonthDay,
  isSingleCalendarDayUrlaub,
  validateUrlaubPeriodOrder,
} from "./utils.js";
import {
  empQualHue,
  normalizeAbteilung,
  normalizeUrlaubPerioden,
  normalizeAllEmployeesShape,
  ensureDashboardAbteilungReihenfolge,
  getEmployee,
  getProject,
  getTeamLeader,
  getProjectLeiterTeamLeader,
  teamLeadersSortedForDashboard,
  reorderTeamLeadersOnDashboard,
  reorderDashboardAbteilungen,
  employeeActiveOnProjectToday,
  absenceReturnBadgeHtml,
  plannedAbsenceBadgeHtml,
  absenceSummaryPlain,
  plannedAbsencePoolLine,
  absenceHintText,
  validateAssignmentForSave,
  hasValidTeamLeader,
  employeesWithoutTeamLeader,
  dashboardMemberAbsenceBlock,
  todayWithinInclusiveISO,
  isDayInAbsenceRange,
  isDayAfterClosedAbsenceRange,
  computeAutoStatusForEmployee,
  syncEmployeeStatusesFromAbsenceDates,
  runAutoStatusSyncAndPersist,
  syncEmployeesThenPersist,
  plannedWindowVisibleOnDashboard,
  employeeMatchesDashboardAbsencePanel,
  verfügbarDashboardAbsenceDisplayWindow,
  plannedVerfügbarReturnLineHtml,
  activeAbsencePeriodHtml,
  urlaubPeriodRowTemplate,
  renderUrlaubPeriodenContainer,
  collectUrlaubPeriodenFromContainer,
  refreshUrlaubPeriodRowHalbUI,
  uniqueQualifications,
  getUrlaubRangeEntries,
  bisNormUrlaub,
  urlaubDuplicateAgainst,
  syncLegacyAbsenceFields,
  ABTEILUNGEN,
  normalizeBeschäftigung,
  fillProjectLeiterSelect,
  projectLeiterBadgeHtml,
  ganttTaskTitleForDisplay,
  teamLeaderAbbreviatedName,
} from "./employees.js";
import {
  getFeierlandCode,
  setFeierlandCode,
  feierlandDisplayName,
  getNextHoliday,
  bundeslandHolidayNameDE,
  betrieblichFreierDezemberTagLabelDE,
  countsAsUrlaubArbeitstag,
  countUrlaubWorkdaysInInclusiveRange,
  isLandPublicHolidayISO,
  isBetrieblichFreierDezemberTagISO,
  BUNDESLAND_LIST,
} from "./holidays.js";

export const URLAUB_GANTT_MODAL_HINT_NEW =
  "Wird als <strong>weiterer Urlaubszeitraum</strong> gespeichert (wie in der Personalverwaltung). Leeres „Bis“ = offenes Ende ab „Von“.";

export const URLAUB_GANTT_MODAL_HINT_EDIT =
  "Sie bearbeiten einen <strong>bestehenden</strong> Zeitraum (Haupt-Urlaub oder Zusatzeintrag). Leeres „Bis“ = offenes Ende.";

/** Angezeigter Monat in der Urlaubsplan-Ansicht (Jahr, Monat 0–11). */
export let urlaubCalendarYM = (() => {
  const d = new Date();
  return { y: d.getFullYear(), m: d.getMonth() };
})();

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

/** @param {string|null|undefined} ab @param {string|null|undefined} bis @param {string} windowStart @param {string} windowEnd */
export function clipUrlaubRangeToWindow(ab, bis, windowStart, windowEnd) {
  if (ab == null || ab === "") return null;
  const a = String(ab);
  const effEnd = bis != null && bis !== "" ? String(bis) : windowEnd;
  const start = a > windowStart ? a : windowStart;
  const end = effEnd < windowEnd ? effEnd : windowEnd;
  if (start > end) return null;
  return { start, end };
}

/** @param {string|null|undefined} ab @param {string|null|undefined} bis @param {string} monthStart @param {string} monthEnd */
export function clipUrlaubRangeToMonth(ab, bis, monthStart, monthEnd) {
  return clipUrlaubRangeToWindow(ab, bis, monthStart, monthEnd);
}

/** Urlaubs-Arbeitstage (Mo–Fr ohne Feiertage/Betriebs-Dez.) im Fenster [winStart, winEnd]; halbe Tage als 0,5. */
export function countVacationDaysInWindow(/** @type {Employee} */ emp, winStart, winEnd) {
  let sum = 0;
  for (const r of getUrlaubRangeEntries(emp)) {
    const clip = clipUrlaubRangeToWindow(r.ab, r.bis, winStart, winEnd);
    if (!clip) continue;
    if (r.halberTag) {
      if (clip.start !== clip.end) continue;
      if (countsAsUrlaubArbeitstag(clip.start)) sum += 0.5;
    } else {
      sum += countUrlaubWorkdaysInInclusiveRange(clip.start, clip.end);
    }
  }
  return sum;
}

/** @param {string} iso */
export function dayOfMonthFromISO(iso) {
  return Number(String(iso).slice(8, 10)) || 1;
}

/** Anzeige von Urlaubsstatistik-Zahlen (inkl. 0,5). */
export function formatUrlaubStatNumber(/** @type {number} */ n) {
  if (!Number.isFinite(n)) return "—";
  if (Math.abs(n % 1) < 1e-9) return String(Math.round(n));
  const s = n.toFixed(1);
  return s.replace(".", ",");
}

/**
 * Überlappende Urlaubsbalken auf Zeilen verteilen (grid-row).
 * @param {{ gs: number; ge: number; rangeVon: string; rangeBis: string; slot: "haupt" | "zusatz"; halber?: boolean }[]} segs gs erster Tag (1…31), ge exklusiv
 * @returns {{ gs: number; ge: number; row: number; rangeVon: string; rangeBis: string; slot: "haupt" | "zusatz"; halber: boolean }[]}
 */
export function stackVacationBars(segs) {
  const sorted = segs.map((s) => ({
    gs: s.gs,
    ge: s.ge,
    rangeVon: s.rangeVon,
    rangeBis: s.rangeBis,
    slot: s.slot,
    halber: !!s.halber,
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

export function fillUrlaubFilterSelects() {
  if (!getState()) return;
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
      ...new Set(getState().employees.map((e) => String(e.Stufe ?? "").trim()).filter(Boolean)),
    ].sort((a, b) => a.localeCompare(b, "de"));
    stufeSel.innerHTML =
      '<option value="">Alle</option>' +
      stufen.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
    if (prevS && [...stufeSel.options].some((o) => o.value === prevS)) stufeSel.value = prevS;
  }
}

export function filterEmployeesForUrlaubView() {
  if (!getState()) return [];
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
  return getState().employees.filter((e) => {
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

export function renderUrlaubPlan() {
  if (!getState()) return;
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
    const hName = bundeslandHolidayNameDE(iso);
    const betriebFrei = betrieblichFreierDezemberTagLabelDE(iso);
    const shortD = dt.toLocaleDateString("de-DE", { weekday: "short" });
    const titleBase = dt.toLocaleDateString("de-DE", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    const titleParts = [titleBase];
    if (hName) titleParts.push(hName);
    if (betriebFrei) titleParts.push(betriebFrei);
    const title = titleParts.join(" · ");
    const cls = [
      "urlaub-plan__head-col",
      isWe ? "urlaub-plan__head-col--we" : "",
      hName ? "urlaub-plan__head-col--holiday" : "",
      betriebFrei ? "urlaub-plan__head-col--betrieb" : "",
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
      betriebFrei ? "urlaub-plan__colbg--betrieb" : "",
    ]
      .filter(Boolean)
      .join(" ");
    trackColBgs.push(
      `<div class="${bgCls}" style="grid-column:${d}; grid-row:1 / -1" aria-hidden="true"></div>`
    );
  }
  const trackColBgsHtml = trackColBgs.join("");

  const rows = employees.map((emp) => {
    const entries = getUrlaubRangeEntries(emp);
    /** @type {{ gs: number; ge: number; rangeVon: string; rangeBis: string; slot: "haupt" | "zusatz"; halber: boolean }[]} */
    const rawSegs = [];
    for (let ri = 0; ri < entries.length; ri++) {
      const r = entries[ri];
      const clip = clipUrlaubRangeToMonth(r.ab, r.bis, monthStart, monthEnd);
      if (!clip) continue;
      const gs = dayOfMonthFromISO(clip.start);
      const ge = dayOfMonthFromISO(clip.end) + 1;
      const rangeBis = r.bis == null ? "" : String(r.bis);
      rawSegs.push({
        gs,
        ge,
        rangeVon: r.ab,
        rangeBis,
        slot: r.slot,
        halber: r.halberTag,
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
            const halfCls = s.halber ? " urlaub-bar--half" : "";
            return `<div class="urlaub-bar${halfCls}" style="grid-column:${s.gs} / ${s.ge}; grid-row:${s.row}" title="${escapeHtml(
              fullTitle
            )}" data-urlaub-slot="${s.slot}" data-urlaub-von="${escapeHtml(s.rangeVon)}" data-urlaub-bis="${dbAttr}" data-urlaub-halb="${
              s.halber ? "1" : ""
            }"></div>`;
          })
          .join("")
      : '<span class="hint urlaub-plan__empty">kein Urlaub</span>';
    const name = `${escapeHtml(emp.Nachname)}, ${escapeHtml(emp.Vorname)}`;
    return `<div class="urlaub-plan__row">
      <div class="urlaub-plan__namecell emp-qual-surface" style="--qh:${empQualHue(emp.Qualifikation)}">${name}</div>
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
        cells.push(`<td class="urlaub-summary__num">${escapeHtml(formatUrlaubStatNumber(n))}</td>`);
      }
      const yTotal = countVacationDaysInWindow(emp, `${y}-01-01`, `${y}-12-31`);
      return `<tr>
        <td class="emp-qual-surface" style="--qh:${empQualHue(emp.Qualifikation)}">${escapeHtml(`${emp.Nachname}, ${emp.Vorname}`)}</td>
        ${cells.join("")}
        <td class="urlaub-summary__num urlaub-summary__num--sum">${escapeHtml(formatUrlaubStatNumber(yTotal))}</td>
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
        <p class="hint">Arbeitstage für <strong>${escapeHtml(feierlandDisplayName(getFeierlandCode()))}</strong> (ohne Sa/So, ohne gesetzliche Feiertage dort, ohne 24./30. Dezember betrieblich frei; <strong>halbe Urlaubstage</strong> als 0,5) pro Kalendermonat wie im Raster oben; letzte Spalte = Summe Jahr. Pfeile: Jahr wechseln.</p>
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

export function setupUrlaubView() {
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

export function syncUrlaubGanttHalberTagWrapVisibility() {
  const wrap = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-halber-wrap"));
  const halbCb = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-halber-tag"));
  if (!wrap || !halbCb) return;
  const vAb = readOptionalISODateFromInput("#urlaub-gantt-block-von");
  if (!vAb) {
    wrap.hidden = true;
    halbCb.checked = false;
    return;
  }
  const bRaw = readOptionalISODateFromInput("#urlaub-gantt-block-bis");
  const same = !bRaw || bRaw === "" || bRaw === vAb;
  wrap.hidden = !same;
  if (!same) halbCb.checked = false;
}

export function closeUrlaubGanttBlockModal() {
  const slotInp = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-slot"));
  const vonInp = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-von"));
  const bisInp = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-orig-bis"));
  if (slotInp) slotInp.value = "";
  if (vonInp) vonInp.value = "";
  if (bisInp) bisInp.value = "";
  const halbCb = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-halber-tag"));
  if (halbCb) halbCb.checked = false;
  const halbWrap = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-halber-wrap"));
  if (halbWrap) halbWrap.hidden = true;
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
 * @param {{ slot: "haupt" | "zusatz"; von: string; bis: string | null; halberTag?: boolean } | null} [editMeta]
 */
export function openUrlaubGanttBlockModal(empId, vonISO, bisISO, editMeta = null) {
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
  const halbCb = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-halber-tag"));
  if (editMeta) {
    if (origSlot) origSlot.value = editMeta.slot;
    if (origVon) origVon.value = editMeta.von;
    if (origBis) origBis.value = editMeta.bis == null ? "" : String(editMeta.bis);
    if (titleEl) titleEl.textContent = "Urlaub bearbeiten";
    if (hintEl) hintEl.innerHTML = URLAUB_GANTT_MODAL_HINT_EDIT;
    if (halbCb) {
      if (typeof editMeta.halberTag === "boolean") {
        halbCb.checked = editMeta.halberTag;
      } else if (editMeta.slot === "haupt") {
        halbCb.checked =
          emp.Urlaub_halber_Tag === true &&
          isSingleCalendarDayUrlaub(String(emp.Urlaub_ab ?? "").trim(), emp.Urlaub_bis);
      } else {
        const np = normalizeUrlaubPerioden(emp.Urlaub_perioden).find(
          (p) => p.von === editMeta.von && bisNormUrlaub(p.bis) === bisNormUrlaub(editMeta.bis)
        );
        halbCb.checked = !!np?.Halber_Tag;
      }
    }
  } else {
    if (origSlot) origSlot.value = "";
    if (origVon) origVon.value = "";
    if (origBis) origBis.value = "";
    if (titleEl) titleEl.textContent = "Urlaub eintragen";
    if (hintEl) hintEl.innerHTML = URLAUB_GANTT_MODAL_HINT_NEW;
    if (halbCb) halbCb.checked = false;
  }
  const bd = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-backdrop"));
  const md = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-modal"));
  if (bd) bd.hidden = false;
  if (md) md.hidden = false;
  syncUrlaubGanttHalberTagWrapVisibility();
  vEl?.focus();
}

export function setupUrlaubGanttBlockModal() {
  const wrap = /** @type {HTMLElement | null} */ (document.querySelector(".urlaub-plan-wrap"));
  if (!wrap || wrap.dataset.urlaubGanttClick === "1") return;
  wrap.dataset.urlaubGanttClick = "1";
  wrap.addEventListener("click", (ev) => {
    if (!getState()) return;
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
        halberTag: bar.getAttribute("data-urlaub-halb") === "1",
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
  if (!form.dataset.halberListeners) {
    form.dataset.halberListeners = "1";
    $("#urlaub-gantt-block-von")?.addEventListener("input", syncUrlaubGanttHalberTagWrapVisibility);
    $("#urlaub-gantt-block-von")?.addEventListener("change", syncUrlaubGanttHalberTagWrapVisibility);
    $("#urlaub-gantt-block-bis")?.addEventListener("input", syncUrlaubGanttHalberTagWrapVisibility);
    $("#urlaub-gantt-block-bis")?.addEventListener("change", syncUrlaubGanttHalberTagWrapVisibility);
  }
  cancel?.addEventListener("click", closeUrlaubGanttBlockModal);
  bd?.addEventListener("click", (e) => {
    if (e.target === bd) closeUrlaubGanttBlockModal();
  });
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!getState()) return;
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
    const halbWrap = /** @type {HTMLElement | null} */ ($("#urlaub-gantt-block-halber-wrap"));
    const halbCb = /** @type {HTMLInputElement | null} */ ($("#urlaub-gantt-block-halber-tag"));
    const wantHalb = !!(halbCb?.checked && halbWrap && !halbWrap.hidden);
    if (wantHalb && !isSingleCalendarDayUrlaub(vAb, vBis)) {
      await openModal(
        "Halber Urlaubstag",
        "<div>„Halber Tag“ ist nur zulässig, wenn „Von“ und „Bis“ dasselbe Kalenderdatum sind oder „Bis“ leer bleibt.</div>",
        { variant: "info", confirmText: "Verstanden" }
      );
      return;
    }
    const idx = getState().employees.findIndex((e) => Number(e.ID) === empId);
    if (idx < 0) return;
    const emp = getState().employees[idx];
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
        emp.Urlaub_halber_Tag = wantHalb && isSingleCalendarDayUrlaub(vAb, vBis);
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
        /** @type {Urlaubsperiode} */
        const np = { von: vAb, bis: vBis };
        if (wantHalb && isSingleCalendarDayUrlaub(vAb, vBis)) np.Halber_Tag = true;
        normalized[oi] = np;
        emp.Urlaub_perioden = normalized;
      }
    } else {
      recordUndoSnapshot();
      /** @type {Urlaubsperiode} */
      const period = { von: vAb, bis: vBis };
      if (wantHalb && isSingleCalendarDayUrlaub(vAb, vBis)) period.Halber_Tag = true;
      const normalized = normalizeUrlaubPerioden(emp.Urlaub_perioden);
      normalized.push(period);
      emp.Urlaub_perioden = normalized;
    }
    syncLegacyAbsenceFields(emp);
    getState().employees[idx] = emp;
    await syncEmployeesThenPersist();
    closeUrlaubGanttBlockModal();
    refreshAllDataViews();
  });
}
