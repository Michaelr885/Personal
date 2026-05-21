/**
 * Tab „Zeitleiste“: Gantt-Chart, Projektliste, Ressourcenpool, Zuweisungen.
 *
 * Projekte bearbeiten, Mitarbeitende per Drag auf Projekte legen, Gantt-Balken
 * und Konflikt-Dialoge. Nutzt die externe Bibliothek „Frappe Gantt“ (über index.html).
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
  ABTEILUNGEN,
  normalizeBeschäftigung,
  fillProjectLeiterSelect,
  projectLeiterBadgeHtml,
  ganttTaskTitleForDisplay,
  teamLeaderAbbreviatedName,
  uniqueQualifications,
} from "./employees.js";
import {
  getFeierlandCode,
  setFeierlandCode,
  getNextHoliday,
  bundeslandHolidayNameDE,
  betrieblichFreierDezemberTagLabelDE,
  countsAsUrlaubArbeitstag,
  countUrlaubWorkdaysInInclusiveRange,
  isLandPublicHolidayISO,
  isBetrieblichFreierDezemberTagISO,
  BUNDESLAND_LIST,
} from "./holidays.js";

export function teardownProjectGanttBarLabelRepeats() {
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

export function scheduleLayoutProjectGanttBarLabelRepeats() {
  if (ganttBarLabelRepeatLayoutRaf) return;
  ganttBarLabelRepeatLayoutRaf = requestAnimationFrame(() => {
    ganttBarLabelRepeatLayoutRaf = 0;
    layoutProjectGanttBarLabelRepeats();
  });
}

export function layoutProjectGanttBarLabelRepeats() {
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

export function bindGanttBarLabelRepeatListeners() {
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

export function observeGanttSvgForBarLabelRepeats(svg) {
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

export function refreshProjectGanttBarLabelRepeats() {
  const host = /** @type {HTMLElement | null} */ ($("#gantt-container"));
  const svg = host?.querySelector("svg.gantt");
  if (!(svg instanceof SVGSVGElement)) return;
  observeGanttSvgForBarLabelRepeats(svg);
  bindGanttBarLabelRepeatListeners();
  scheduleLayoutProjectGanttBarLabelRepeats();
}

export function destroyGantt() {
  teardownProjectGanttBarLabelRepeats();
  clearGanttBarSyncMoveListener();
  ganttBarSyncArmed = false;
  ganttBarSyncMoved = false;
  const wrap = /** @type {HTMLElement} */ ($("#gantt-container"));
  wrap.innerHTML = "";
  ganttInstance = null;
}

/** Nach Drag/Resize in der frappe-gantt-Zeitleiste: Projektdaten und UI synchronisieren. */
export async function applyProjectDatesFromGantt(projectId, startISO, endISO) {
  if (!getState()) return;
  if (!startISO || !endISO || startISO > endISO) return;
  const idx = getState().projects.findIndex((p) => Number(p.ID) === projectId);
  if (idx < 0) return;
  const prev = getState().projects[idx];
  if (prev.Startdatum === startISO && prev.Enddatum === endISO) return;
  recordUndoSnapshot();
  getState().projects[idx] = { ...prev, Startdatum: startISO, Enddatum: endISO };
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
export function syncProjectDatesFromGanttBarsIfNeeded() {
  if (!getState()) return;
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
export function scheduleSyncProjectDatesFromGanttBars() {
  if (ganttDateSyncRaf) cancelAnimationFrame(ganttDateSyncRaf);
  ganttDateSyncRaf = requestAnimationFrame(() => {
    ganttDateSyncRaf = 0;
    syncProjectDatesFromGanttBarsIfNeeded();
  });
}

/** Nur nach echtem Balken-Zug (Pixelbewegung): sonst feuert document-pointerup nach einfachem Klick und triggert sync → renderGantt → Popup verschwindet sofort. */
let ganttBarSyncArmed = false;
let ganttBarSyncMoved = false;
let ganttBarSyncLastX = 0;
let ganttBarSyncLastY = 0;
/** @type {null | (() => void)} */
let ganttBarSyncMoveCleanup = null;

export function clearGanttBarSyncMoveListener() {
  if (typeof ganttBarSyncMoveCleanup === "function") {
    ganttBarSyncMoveCleanup();
  }
  ganttBarSyncMoveCleanup = null;
}

export function onGanttBarPointerDownForDateSync(ev) {
  if (!(ev.target instanceof Element)) return;
  if (!ev.target.closest(".bar-wrapper")) return;
  ganttBarSyncArmed = true;
  ganttBarSyncMoved = false;
  ganttBarSyncLastX = ev.clientX;
  ganttBarSyncLastY = ev.clientY;
  clearGanttBarSyncMoveListener();
  const onMove = (e) => {
    if (!ganttBarSyncArmed) return;
    const dx = e.clientX - ganttBarSyncLastX;
    const dy = e.clientY - ganttBarSyncLastY;
    if (dx * dx + dy * dy >= 9) ganttBarSyncMoved = true;
  };
  document.addEventListener("pointermove", onMove, { passive: true });
  ganttBarSyncMoveCleanup = () => document.removeEventListener("pointermove", onMove);
}

export function onDocumentReleaseSyncGanttProjectDates() {
  clearGanttBarSyncMoveListener();
  if (!ganttBarSyncArmed) return;
  ganttBarSyncArmed = false;
  const should = ganttBarSyncMoved;
  ganttBarSyncMoved = false;
  if (!should) return;
  scheduleSyncProjectDatesFromGanttBars();
}

let ganttDocumentDateSyncBound = false;
export function bindGanttProjectDateDocumentSync() {
  if (ganttDocumentDateSyncBound) return;
  ganttDocumentDateSyncBound = true;
  const ganttHost = /** @type {HTMLElement} */ ($("#gantt-container"));
  ganttHost.addEventListener("pointerdown", onGanttBarPointerDownForDateSync, true);
  ganttHost.addEventListener("mousedown", onGanttBarPointerDownForDateSync, true);
  document.addEventListener("mouseup", onDocumentReleaseSyncGanttProjectDates);
  document.addEventListener("pointerup", onDocumentReleaseSyncGanttProjectDates);
  document.addEventListener("pointercancel", onDocumentReleaseSyncGanttProjectDates);
}

export function renderProjectDropZones() {
  if (!getState()) return;
  const host = /** @type {HTMLElement} */ ($("#project-drop-zones"));
  host.innerHTML = getState().projects
    .map((p) => {
      const name = escapeHtml(p.Name);
      const badge = projectLeiterBadgeHtml(p);
      const leiterRow = badge
        ? `<div class="project-drop-card__leiter">${badge}</div>`
        : `<div class="project-drop-card__leiter project-drop-card__leiter--empty"><span class="hint">Kein PL</span></div>`;
      return `<div class="project-drop-card" data-drop-project="${p.ID}" tabindex="0" role="region" aria-label="Ablage ${name}">
        <p class="project-drop-card__name">${name}</p>
        ${leiterRow}
        <p class="project-drop-card__meta">${p.Startdatum} – ${p.Enddatum}</p>
      </div>`;
    })
    .join("");
}

export function openDndAssignModal(employeeId, projectId) {
  const emp = getEmployee(employeeId);
  const proj = getProject(projectId);
  if (!emp || !proj || !getState()) return;
  /** @type {HTMLInputElement} */ ($("#dnd-emp-id")).value = String(employeeId);
  /** @type {HTMLInputElement} */ ($("#dnd-proj-id")).value = String(projectId);
  const pl = getProjectLeiterTeamLeader(proj);
  const plPart = pl ? ` · PL: ${teamLeaderAbbreviatedName(pl)}` : "";
  $("#dnd-modal-project-label").textContent = `Projekt: ${proj.Name}${plPart}`;
  /** @type {HTMLInputElement} */ ($("#dnd-start")).value = proj.Startdatum;
  /** @type {HTMLInputElement} */ ($("#dnd-end")).value = proj.Enddatum;
  $("#dnd-modal-backdrop").hidden = false;
  $("#dnd-assign-modal").hidden = false;
}

export function closeDndAssignModal() {
  $("#dnd-modal-backdrop").hidden = true;
  $("#dnd-assign-modal").hidden = true;
}

export function setupDndAssignModal() {
  $("#dnd-cancel").addEventListener("click", closeDndAssignModal);
  $("#dnd-modal-backdrop").addEventListener("click", closeDndAssignModal);
  $("#dnd-assign-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!getState()) return;
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

export function setupProjectDropDelegation() {
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
    if (!employeeId || !projectId || !getState()) return;
    openDndAssignModal(employeeId, projectId);
  });
}

/**
 * Kalenderbasierte Abwesenheitsart an einem Tag (Krank hat Vorrang wie bei der Konfliktprüfung).
 * @param {Employee} emp
 * @param {string} dayISO
 * @returns {"Krank"|"Urlaub"|null}
 */
export function absenceKindOnCalendarDay(emp, dayISO) {
  if (isDayInAbsenceRange(dayISO, emp.Krank_ab, emp.Krank_bis)) return "Krank";
  if (isDayInAnyUrlaubRange(dayISO, emp)) return "Urlaub";
  return null;
}

/** @param {Employee} emp */
export function employeeDisplayName(emp) {
  const n = `${String(emp.Vorname ?? "").trim()} ${String(emp.Nachname ?? "").trim()}`.trim();
  return n || `ID ${emp.ID}`;
}

/**
 * Eindeutige Zeilen für Gantt-Tooltip: zugewiesene Personen mit Krank/Urlaub im Überlappungszeitraum.
 * @param {Project} p
 * @returns {string[]}
 */
export function getProjectGanttConflictNameLines(p) {
  if (!getState()) return [];
  const pStart = p.Startdatum;
  const pEnd = p.Enddatum;
  const unique = /** @type {Set<string>} */ (new Set());
  for (const a of getState().assignments) {
    if (Number(a.Project_ID) !== Number(p.ID)) continue;
    if (!rangesOverlap(a.Startdatum, a.Enddatum, pStart, pEnd)) continue;
    const emp = getEmployee(a.Employee_ID);
    if (!emp) continue;
    const s = a.Startdatum > pStart ? a.Startdatum : pStart;
    const e = a.Enddatum < pEnd ? a.Enddatum : pEnd;
    if (s > e) continue;
    let cur = s;
    let guard = 0;
    while (cur <= e && guard++ < 4000) {
      const kind = absenceKindOnCalendarDay(emp, cur);
      if (kind) {
        unique.add(`${employeeDisplayName(emp)} (${kind})`);
      }
      const nxt = addCalendarDaysToISO(cur, 1);
      if (!nxt || nxt <= cur) break;
      cur = nxt;
    }
  }
  return [...unique].sort((a, b) => a.localeCompare(b, "de"));
}

export function renderGanttCore() {
  if (!getState()) return;
  destroyGantt();
  const wrap = /** @type {HTMLElement} */ ($("#gantt-container"));
  if (getState().projects.length === 0) {
    wrap.innerHTML = '<p class="hint">Keine Projekte angelegt.</p>';
    return;
  }
  const anchor = document.createElement("div");
  anchor.id = "gantt-anchor";
  wrap.appendChild(anchor);

  const tasks = getState().projects.map((p) => {
    const mod = ((Number(p.ID) - 1) % 5) + 1;
    const conflictLines = getProjectGanttConflictNameLines(p);
    const conflict = conflictLines.length > 0;
    const cls = conflict ? `gantt-p${mod} gantt-conflict` : `gantt-p${mod}`;
    const conflict_html = conflict
      ? conflictLines.map((line) => escapeHtml(line)).join("<br>")
      : "";
    return {
      id: String(p.ID),
      name: ganttTaskTitleForDisplay(p),
      start: p.Startdatum,
      end: p.Enddatum,
      progress: 0,
      custom_class: cls,
      conflict_html,
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
      custom_popup_html(task) {
        let html = `<div class="gantt-popup-custom"><h5>${escapeHtml(task.name)}</h5><p class="hint gantt-popup-dates">${escapeHtml(
          String(task.start)
        )} bis ${escapeHtml(String(task.end))}</p>`;
        if (task.conflict_html) {
          html += `<div class="gantt-popup-conflicts"><div class="gantt-popup-conflicts__title"><i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Konflikte:</div><div class="gantt-popup-conflicts__list">${task.conflict_html}</div></div>`;
        }
        html += `</div>`;
        return html;
      },
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
export function renderGantt() {
  const projectsView = /** @type {HTMLElement | null} */ ($("#view-projects"));
  if (!getState() || !projectsView || !projectsView.classList.contains("view--active")) return;
  const run = () => {
    if (!getState()) return;
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

export function syncGanttViewModeButtons() {
  $all("#view-projects [data-gantt-mode]").forEach((btn) => {
    const m = /** @type {HTMLElement} */ (btn).dataset.ganttMode;
    btn.classList.toggle("is-active", m === ganttViewMode);
  });
}

/**
 * @param {"Day"|"Week"|"Month"} mode
 */
export function setGanttViewMode(mode) {
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


export function renderProjectsTable() {
  if (!getState()) return;
  const tbody = /** @type {HTMLElement} */ ($("#projects-tbody"));
  const rows = getState().projects
    .slice()
    .sort((a, b) => Number(a.ID) - Number(b.ID))
    .map(
      (p) => `<tr data-select-project="${p.ID}" class="projects-table__row-selectable" title="Projekt auswählen">
        <td>${p.ID}</td>
        <td><div class="projects-table__projcell"><span class="projects-table__name">${escapeHtml(p.Name)}</span>${projectLeiterBadgeHtml(
          p
        )}</div></td>
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

export function closeProjectModal() {
  /** @type {HTMLElement} */ ($("#project-modal-backdrop")).hidden = true;
  /** @type {HTMLElement} */ ($("#project-modal")).hidden = true;
}

/** @param {Project | null} proj */
export function openProjectModal(proj) {
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
  fillProjectLeiterSelect(proj ? proj.leiterId : "");
  /** @type {HTMLInputElement} */ ($("#project-form-name")).focus();
}

/** Eine Zeile im Qualifikations-Editor anhängen. */
export function appendProjectQualRow(qualValue = "", count = 1) {
  const host = /** @type {HTMLElement | null} */ ($("#project-form-quals-host"));
  if (!getState() || !host) return;
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

export function ensureProjectQualEditorHasRow() {
  const host = /** @type {HTMLElement | null} */ ($("#project-form-quals-host"));
  if (!host) return;
  if (!host.querySelector(".project-qual-row")) appendProjectQualRow("", 1);
}

/** @param {Record<string, number>} data */
export function renderProjectQualificationsEditor(data) {
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
export function collectProjectQualificationsFromEditor() {
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

export function employeeHasAssignmentOverlappingWindow(employeeId, winStart, winEnd) {
  if (!getState()) return false;
  if (!winStart || !winEnd || winStart > winEnd) return false;
  const id = Number(employeeId);
  return getState().assignments.some((a) => {
    if (Number(a.Employee_ID) !== id) return false;
    return rangesOverlap(a.Startdatum, a.Enddatum, winStart, winEnd);
  });
}

/**
 * Wenn ein Projekt gewählt ist und die Checkbox „auch zugewiesene“ nicht aktiv:
 * Pool nur Personen ohne Zuweisung, deren Zeitraum sich mit dem Projektzeitraum überschneidet.
 */
export function employeePoolRestrictsToUnassigned() {
  if (!getState() || getState().projects.length === 0) return false;
  const projSel = /** @type {HTMLSelectElement | null} */ (document.getElementById("project-select"));
  if (!projSel?.value) return false;
  const incl = /** @type {HTMLInputElement | null} */ (document.getElementById("pool-include-assigned"));
  if (incl?.checked) return false;
  return true;
}

export function availableEmployeesForPool(filterQual) {
  if (!getState()) return [];
  const restrict = employeePoolRestrictsToUnassigned();
  const projSel = /** @type {HTMLSelectElement | null} */ (document.getElementById("project-select"));
  const proj = projSel?.value ? getProject(projSel.value) : undefined;
  const winStart = proj?.Startdatum ?? "";
  const winEnd = proj?.Enddatum ?? "";

  return getState().employees.filter((e) => {
    if (e.Status !== "Verfügbar") return false;
    if (filterQual && e.Qualifikation !== filterQual) return false;
    if (restrict && proj && employeeHasAssignmentOverlappingWindow(e.ID, winStart, winEnd)) return false;
    return true;
  });
}

export function renderEmployeePool() {
  if (!getState()) return;
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
        return `<div class="employee-card emp-qual-surface" style="--qh:${empQualHue(e.Qualifikation)}" draggable="true" data-id="${e.ID}">
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
  if (poolCb) poolCb.disabled = getState().projects.length === 0;
}

export function renderProjectAssignments(projectId) {
  if (!getState()) return "";
  const rows = getState().assignments
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

export function renderProjectDetail() {
  if (!getState()) return;
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
  const plBadge = projectLeiterBadgeHtml(proj);
  const plCell = plBadge
    ? `<div><strong>PL / Teamleiter</strong><br>${plBadge}</div>`
    : `<div><strong>PL / Teamleiter</strong><br><span class="hint">—</span></div>`;
  panel.innerHTML = `
    <div class="meta">
      <div><strong>Start</strong><br>${proj.Startdatum}</div>
      <div><strong>Ende</strong><br>${proj.Enddatum}</div>
      ${plCell}
      <div><strong>Bedarf</strong><br>${reqs || "—"}</div>
    </div>
    ${renderProjectAssignments(proj.ID)}
  `;
  $all("[data-del-assignment]", panel).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(/** @type {HTMLElement} */ (btn).dataset.delAssignment);
      recordUndoSnapshot();
      getState().assignments = getState().assignments.filter((a) => Number(a.ID) !== id);
      await persist();
      renderProjectDetail();
      renderProjectDropZones();
      renderEmployeePool();
      renderDashboard();
      renderGantt();
    });
  });
}

export function fillAssignmentEmployeeSelect(projectId) {
  if (!getState()) return;
  const sel = /** @type {HTMLSelectElement} */ ($("#assign-employee"));
  if (!projectId) {
    sel.innerHTML = "";
    return;
  }
  const inProject = new Set(
    getState().assignments
      .filter((a) => Number(a.Project_ID) === Number(projectId))
      .map((a) => Number(a.Employee_ID))
  );
  const emps = getState().employees.filter(
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

export function renderProjectsView() {
  if (!getState()) return;
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
  projSelect.innerHTML = getState().projects
    .map((p) => `<option value="${p.ID}">${escapeHtml(p.Name)}</option>`)
    .join("");

  if (getState().projects.length === 0) {
    projSelect.value = "";
  } else {
    const cur = projSelect.value;
    if (!cur || !getState().projects.some((p) => String(p.ID) === cur)) {
      projSelect.value = String(getState().projects[0].ID);
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

export async function pushAssignmentAndRefresh(employeeId, projectId, start, end) {
  if (!getState()) return;
  recordUndoSnapshot();
  const newRow = {
    ID: nextId(getState().assignments),
    Project_ID: Number(projectId),
    Employee_ID: Number(employeeId),
    Startdatum: start,
    Enddatum: end,
  };
  getState().assignments.push(newRow);
  await persist();
  renderProjectDetail();
  renderProjectDropZones();
  renderEmployeePool();
  renderDashboard();
  renderGantt();
}

export async function submitAssignment(employeeId, projectId, start, end) {
  if (!getState()) return;
  const v = validateAssignmentForSave(employeeId, start, end);
  if (v.conflict) {
    const ok = await openAssignmentConflictModal(v.fullName);
    if (!ok) return;
  }
  await pushAssignmentAndRefresh(employeeId, projectId, start, end);
}

export function setupProjectsInteractions() {
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
        if (getState()?.projects.some((p) => String(p.ID) === sid)) {
          projSelect.value = sid;
          projSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        return;
      }
    }

    const dropPick = ev.target instanceof Element ? ev.target.closest(".project-drop-card[data-drop-project]") : null;
    if (dropPick instanceof HTMLElement && dropPick.dataset.dropProject) {
      const sid = dropPick.dataset.dropProject;
      if (getState()?.projects.some((p) => String(p.ID) === sid)) {
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
      if (!proj || !getState()) return;
      const ok = await openModal(
        "Projekt löschen",
        `<div>Das Projekt „${escapeHtml(proj.Name)}“ und alle zugehörigen Zuweisungen werden unwiderruflich entfernt.</div>`,
        { confirmText: "Ja, löschen", confirmDanger: true }
      );
      if (!ok) return;
      recordUndoSnapshot();
      getState().projects = getState().projects.filter((p) => Number(p.ID) !== pid);
      getState().assignments = getState().assignments.filter((a) => Number(a.Project_ID) !== pid);
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
    if (!getState()) return;
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
    const leiterSel = /** @type {HTMLSelectElement} */ ($("#project-leiter-select"));
    const leiterRaw = leiterSel.value.trim();
    const leiterId =
      leiterRaw === "" || !getState().team_leaders.some((t) => String(t.ID) === leiterRaw) ? "" : leiterRaw;
    if (idRaw !== "") {
      const idxEarly = getState().projects.findIndex((p) => String(p.ID) === idRaw);
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
      getState().projects.push({
        ID: nextId(getState().projects),
        Name: name,
        Startdatum: start,
        Enddatum: end,
        Benötigte_Qualifikationen,
        leiterId,
      });
    } else {
      const idx = getState().projects.findIndex((p) => String(p.ID) === idRaw);
      const prev = getState().projects[idx];
      getState().projects[idx] = {
        ...prev,
        Name: name,
        Startdatum: start,
        Enddatum: end,
        Benötigte_Qualifikationen,
        leiterId,
      };
    }
    await persist();
    closeProjectModal();
    renderProjectsView();
    renderDashboard();
    renderGantt();
  });

  bindGanttProjectDateDocumentSync();
}
