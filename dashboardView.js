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

export function sanitizeTeamColor(c) {
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
export function dashboardAbteilungAkzentfarbe(normalizedAbt) {
  const name = String(normalizedAbt ?? "").trim();
  const list = /** @type {readonly string[]} */ (ABTEILUNGEN);
  const idx = list.indexOf(name);
  if (idx >= 0) return DASHBOARD_ABTEILUNG_PALETTE[idx % DASHBOARD_ABTEILUNG_PALETTE.length];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return `hsl(${hue} 52% 36%)`;
}

/** Ohne das frisst iOS/Safari Touch-Züge, solange draggable="true" gesetzt ist. */
export function preferDashboardTouchDrag() {
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
export function dashboardTeamCardsUseNativeDrag() {
  try {
    if (window.matchMedia("(pointer: fine)").matches) return true;
  } catch {
    /* ignore */
  }
  return !preferDashboardTouchDrag();
}

/**
 * Mitarbeitende: immer ohne natives Drag (Pointer-Zug für Maus, Touch und Stift).
 * Teamkarten-Reihenfolge: natives HTML5-Drag nur auf dem **Griff** `[data-dashboard-team-drag]` (nicht auf dem Namen),
 * PL-Zuweisung auf dem **Namen** `[data-dashboard-drag-tl-to-project]` — nicht auf der ganzen Karte,
 * sonst startet der Browser beim Ziehen einer Person den Drag der Teamkarte.
 */
export function applyDashboardDragMode(root) {
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
  root.querySelectorAll("[data-dashboard-drag-tl-to-project]").forEach((el) => {
    if (el instanceof HTMLElement) el.draggable = nativeTeam;
  });
  root.querySelectorAll("[data-dashboard-abteilung-drag]").forEach((el) => {
    if (el instanceof HTMLElement) el.draggable = nativeTeam;
  });
}

export function renderDashboard() {
  if (!getState()) return;
  ensureDashboardAbteilungReihenfolge();
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
              return `<div class="dashboard-emp-chip emp-qual-surface" style="--qh:${empQualHue(e.Qualifikation)}" draggable="true" data-dashboard-employee="${e.ID}" title="Auf eine Teamkarte oder nach „Abwesenheit melden“ ziehen">
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
    const members = getState().employees.filter((e) => Number(e.Teamleiter_ID) === Number(tl.ID));
    const assignedCount = members.filter((m) =>
      getState().assignments.some(
        (a) =>
          Number(a.Employee_ID) === Number(m.ID) &&
          rangesOverlap(a.Startdatum, a.Enddatum, today, today)
      )
    ).length;
    const items = members
      .map((m) => {
        const absBlock = dashboardMemberAbsenceBlock(m);
        const onProject = employeeActiveOnProjectToday(m.ID);
        return `<li draggable="true" data-dashboard-employee="${m.ID}" class="dashboard-emp-row emp-qual-surface" style="--qh:${empQualHue(m.Qualifikation)}" title="Auf andere Teamkarte, „Ohne Teamleitung“ oder „Abwesenheit melden“ ziehen">
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
        <div class="card-team__head">
          <span class="card-team__reorder-grip" data-dashboard-team-drag="1" title="Teamkarte verschieben (Reihenfolge)" aria-label="Teamkarte verschieben"><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></span>
          <div class="card-team__title card-team__title--pl-drag" data-dashboard-drag-tl-to-project="${tl.ID}" title="Namen auf ein Projekt unten („Projekte &amp; Verantwortliche“) ziehen – als Projektleiter (PL) speichern">
            <strong>${escapeHtml(tl.Name)}</strong>
          </div>
        </div>
        <p class="hint card-team__meta">${assignedCount} heute im Projekt</p>
        <ul>${items || '<li class="hint">Keine Personen zugeordnet.</li>'}</ul>
      </article>`;
  }

  const deptsOrdered = [...getState().dashboard_abteilung_reihenfolge];

  const teamSectionsHtml =
    deptsOrdered.length === 0
      ? '<p class="hint">Keine Teamleitungen erfasst.</p>'
      : deptsOrdered
          .map((abt) => {
            const tls = sortedTls.filter((tl) => normalizeAbteilung(tl.Abteilung) === abt);
            if (!tls.length) return "";
            const accent = dashboardAbteilungAkzentfarbe(abt);
            const cards = tls.map((tl) => dashboardTeamCardArticleHtml(tl)).join("");
            const escAbt = escapeHtml(abt);
            return `<section class="dashboard-abteilung-block" data-dashboard-abteilung="${escAbt}" data-drop-dashboard-abteilung="${escAbt}" style="--abteilung-accent: ${accent}">
        <h3 class="dashboard-abteilung__title">
          <span class="dashboard-abteilung__drag-handle" data-dashboard-abteilung-drag="1" title="Reihenfolge der Abteilungen ändern" aria-label="Abteilung ${escAbt} verschieben"><i class="fa-solid fa-grip-vertical" aria-hidden="true"></i></span>
          <span class="dashboard-abteilung__name">${escAbt}</span>
        </h3>
        <div class="grid-dashboard">${cards}</div>
      </section>`;
          })
          .filter(Boolean)
          .join("");

  const absences = getState().employees.filter(employeeMatchesDashboardAbsencePanel);
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
          return `<li class="absence-list__item emp-qual-surface" style="--qh:${empQualHue(e.Qualifikation)}">
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
        return `<li class="absence-list__item absence-list__item--geplant emp-qual-surface" style="--qh:${empQualHue(e.Qualifikation)}">
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

  const available = getState().employees.filter((e) => e.Status === "Verfügbar");
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

  const nextFeier = getNextHoliday();
  const nextFeierBadge =
    nextFeier == null
      ? ""
      : `<span class="badge dashboard-next-feier-badge" title="Datum: ${escapeHtml(nextFeier.iso)}">Nächster Feiertag: ${escapeHtml(
          nextFeier.name
        )} (${
          nextFeier.daysUntil === 0 ? "heute" : nextFeier.daysUntil === 1 ? "morgen" : `in ${nextFeier.daysUntil} Tagen`
        })</span>`;

  const dashboardProjectsPanelHtml =
    getState().projects.length === 0
      ? ""
      : `<div class="panel dashboard-projects-panel">
      <div class="panel__head">
        <h2><i class="fa-solid fa-diagram-project" aria-hidden="true"></i> Projekte &amp; Verantwortliche</h2>
      </div>
      <p class="hint">Zuständige Teamleitung (PL) je Projekt: <strong>Teamleiter-Namen</strong> auf der Karte auf ein Projekt hier ziehen – oder die Zuweisung unter <strong>Zeitleiste</strong> → Projekt bearbeiten pflegen.</p>
      <div class="dashboard-project-chips" role="list">${getState().projects
        .slice()
        .sort((a, b) => Number(a.ID) - Number(b.ID))
        .map((p) => {
          const badge = projectLeiterBadgeHtml(p);
          const plSlot = badge || '<span class="hint dashboard-project-chip__no-pl">Kein PL</span>';
          return `<div class="dashboard-project-chip" role="listitem" data-drop-project-leiter="${p.ID}">
            <div class="dashboard-project-chip__row">
              <span class="dashboard-project-chip__name">${escapeHtml(p.Name)}</span>
              ${plSlot}
            </div>
            <span class="dashboard-project-chip__dates">${escapeHtml(p.Startdatum)} – ${escapeHtml(p.Enddatum)}</span>
          </div>`;
        })
        .join("")}</div>
    </div>`;

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
      <div class="panel__head panel__head--wrap dashboard-teams-wrap__head">
        <h2><i class="fa-solid fa-building-user"></i> Die Abteilung für die Person</h2>
        <button
          type="button"
          class="dashboard-teams-export-btn"
          data-dashboard-export-teams
          title="Abteilungen, Teamleitungen und Mitarbeitende als CSV speichern (in Excel öffnen)"
          aria-label="Teams als CSV exportieren"
        >
          <i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i>
        </button>
      </div>
      <p class="hint">
        Abteilungs-Reihenfolge: <strong>Griff</strong> (<i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>) neben der Abteilungsüberschrift. Teamkarten: kleiner Griff links = Karte verschieben; <strong>Name</strong> ziehen = Projektleiter (PL) auf ein Projekt unten zuweisen (wird gespeichert).
        Dezentes Download-Symbol oben rechts: gleiche Übersicht als CSV für Excel.
      </p>
      <div class="dashboard-abteilungen-stack">${teamSectionsHtml}</div>
    </div>
    ${dashboardProjectsPanelHtml}
    <div class="panel dashboard-absence-drop panel--drop-hint team-drop-zone" data-drop-absence="1" id="dashboard-absence-drop">
      <div class="panel__head panel__head--wrap">
        <h2><i class="fa-solid fa-user-injured"></i> Abwesenheit melden</h2>
        ${nextFeierBadge}
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

export function dashAbsRangeHintText(status) {
  if (status === "Krank") {
    return "Wird in den Stammdaten unter Krankheit von/bis gespeichert. Geplanter Urlaub (Felder Urlaub und weitere Urlaubszeiträume) bleibt unverändert.";
  }
  return "Wird in den Stammdaten unter Urlaub von/bis gespeichert. Weitere Urlaubsblöcke und geplante Krankheit bleiben unverändert.";
}

export function syncDashAbsRangeHint() {
  const st = /** @type {HTMLSelectElement | null} */ ($("#dash-abs-status"));
  const hint = /** @type {HTMLElement | null} */ ($("#dash-abs-range-hint"));
  if (!st || !hint) return;
  hint.textContent = dashAbsRangeHintText(st.value);
}

export function closeDashboardAbsenceModal() {
  const bd = document.getElementById("dash-abs-backdrop");
  const md = document.getElementById("dash-abs-modal");
  if (bd) bd.hidden = true;
  if (md) md.hidden = true;
}

export function openDashboardAbsenceModal(empId) {
  if (!getState()) return;
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

export function setupDashboardAbsenceModal() {
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
    if (!getState()) return;
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
    const idx = getState().employees.findIndex((e) => Number(e.ID) === empId);
    if (idx < 0) return;
    recordUndoSnapshot();
    const prev = getState().employees[idx];
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
    getState().employees[idx] = next;
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
export function clearDashboardDropZoneHighlight() {
  if (dashboardDnDActiveZone) {
    dashboardDnDActiveZone.classList.remove("team-drop-zone--active");
    dashboardDnDActiveZone = null;
  }
}

/**
 * @param {string} empId
 * @param {Element | null} targetEl Element unter dem Cursor bzw. dem Finger (drop target)
 */
export async function dashboardHandleEmployeeDrop(empId, targetEl) {
  if (!getState()) return;
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
export function dashboardHighlightDropZoneUnderPoint(clientX, clientY) {
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
export function setupDashboardPointerDrag(view) {
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
    view.classList.remove("dashboard-view--employee-dragging");
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
          view.classList.add("dashboard-view--employee-dragging");
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
        if (!pendingId || !wasActive || !getState()) return;
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
export function setupDashboardTouchDrag(view) {
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
    view.classList.remove("dashboard-view--employee-dragging");
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
          view.classList.add("dashboard-view--employee-dragging");
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
        if (!pendingId || !wasActive || !getState()) return;
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

/** @param {DataTransfer | null} dt */
export function dashboardDataTransferTypes(dt) {
  if (!dt || !dt.types) return [];
  try {
    return [...dt.types];
  } catch {
    return [];
  }
}

export function setupDashboardDnD() {
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
      view.classList.add("dashboard-view--employee-dragging");
      ev.dataTransfer.setData("text/plain", id);
      ev.dataTransfer.setData("application/x-employee-id", id);
      ev.dataTransfer.effectAllowed = "move";
      return;
    }
    const abtDragEl =
      ev.target instanceof Element ? ev.target.closest("[data-dashboard-abteilung-drag]") : null;
    if (abtDragEl instanceof HTMLElement) {
      const section = abtDragEl.closest("[data-dashboard-abteilung]");
      if (!(section instanceof HTMLElement)) return;
      const abt = section.getAttribute("data-dashboard-abteilung");
      if (!abt) return;
      section.classList.add("dashboard-abteilung--reorder-drag");
      ev.dataTransfer.setData("application/x-dashboard-abteilung-reorder", abt);
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
      return;
    }
    const tlPlDrag =
      ev.target instanceof Element ? ev.target.closest("[data-dashboard-drag-tl-to-project]") : null;
    if (tlPlDrag instanceof HTMLElement) {
      const tlId = tlPlDrag.getAttribute("data-dashboard-drag-tl-to-project");
      if (!tlId || !getTeamLeader(tlId)) return;
      tlPlDrag.classList.add("card-team__title--pl-dragging");
      ev.dataTransfer.setData("application/x-dashboard-tl-to-project", tlId);
      ev.dataTransfer.setData("text/plain", `x-dashboard-tl-project:${tlId}`);
      ev.dataTransfer.effectAllowed = "copy";
    }
  });

  view.addEventListener("dragend", () => {
    view.classList.remove("dashboard-view--employee-dragging");
    view.querySelectorAll(".dashboard-emp-dragging").forEach((el) => el.classList.remove("dashboard-emp-dragging"));
    view.querySelectorAll(".card-team--reorder-drag").forEach((el) => el.classList.remove("card-team--reorder-drag"));
    view
      .querySelectorAll(".card-team__title--pl-dragging")
      .forEach((el) => el.classList.remove("card-team__title--pl-dragging"));
    view
      .querySelectorAll(".dashboard-abteilung--reorder-drag")
      .forEach((el) => el.classList.remove("dashboard-abteilung--reorder-drag"));
    clearDashboardDropZoneHighlight();
  });

  view.addEventListener("dragenter", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const types = dashboardDataTransferTypes(ev.dataTransfer);
    if (types.includes("application/x-dashboard-abteilung-reorder")) {
      const abtZone = el?.closest("[data-drop-dashboard-abteilung]");
      if (abtZone instanceof HTMLElement) ev.preventDefault();
      return;
    }
    if (types.includes("application/x-dashboard-tl-to-project")) {
      const chip = el?.closest("[data-drop-project-leiter]");
      if (chip instanceof HTMLElement) ev.preventDefault();
      return;
    }
    const zone = /** @type {HTMLElement | null} */ (
      el?.closest("[data-drop-absence], [data-drop-teamleader], [data-drop-unassigned]")
    );
    if (!zone) return;
    ev.preventDefault();
  });

  view.addEventListener("dragover", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const types = dashboardDataTransferTypes(ev.dataTransfer);
    if (types.includes("application/x-dashboard-abteilung-reorder")) {
      const abtZone = el?.closest("[data-drop-dashboard-abteilung]");
      if (abtZone instanceof HTMLElement) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "move";
        if (dashboardDnDActiveZone && dashboardDnDActiveZone !== abtZone) {
          dashboardDnDActiveZone.classList.remove("team-drop-zone--active");
        }
        dashboardDnDActiveZone = abtZone;
        abtZone.classList.add("team-drop-zone--active");
      }
      return;
    }
    if (types.includes("application/x-dashboard-tl-to-project")) {
      const chip = el?.closest("[data-drop-project-leiter]");
      if (chip instanceof HTMLElement) {
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
        if (dashboardDnDActiveZone && dashboardDnDActiveZone !== chip) {
          dashboardDnDActiveZone.classList.remove("team-drop-zone--active");
        }
        dashboardDnDActiveZone = chip;
        chip.classList.add("team-drop-zone--active");
      }
      return;
    }
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
    const types = dashboardDataTransferTypes(ev.dataTransfer);
    if (types.includes("application/x-dashboard-abteilung-reorder")) {
      const zone = el?.closest("[data-drop-dashboard-abteilung]");
      if (!(zone instanceof HTMLElement)) return;
      const rel = /** @type {Node | null} */ (ev.relatedTarget);
      if (!rel || !zone.contains(rel)) {
        zone.classList.remove("team-drop-zone--active");
        if (dashboardDnDActiveZone === zone) dashboardDnDActiveZone = null;
      }
      return;
    }
    if (types.includes("application/x-dashboard-tl-to-project")) {
      const chip = el?.closest("[data-drop-project-leiter]");
      if (!(chip instanceof HTMLElement)) return;
      const rel = /** @type {Node | null} */ (ev.relatedTarget);
      if (!rel || !chip.contains(rel)) {
        chip.classList.remove("team-drop-zone--active");
        if (dashboardDnDActiveZone === chip) dashboardDnDActiveZone = null;
      }
      return;
    }
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
    const abtReorder = ev.dataTransfer.getData("application/x-dashboard-abteilung-reorder");
    if (abtReorder && getState()) {
      clearDashboardDropZoneHighlight();
      const targetSection = el?.closest("[data-drop-dashboard-abteilung]");
      const toAbt = targetSection?.getAttribute("data-drop-dashboard-abteilung");
      if (toAbt && toAbt !== abtReorder) {
        recordUndoSnapshot();
        reorderDashboardAbteilungen(abtReorder, toAbt);
        await persist();
        renderDashboard();
        if ($("#view-personnel").classList.contains("view--active")) {
          renderPersonnelView();
        }
      }
      return;
    }
    const tlReorder = ev.dataTransfer.getData("application/x-teamleader-reorder");
    if (tlReorder && getState()) {
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

    const tlToProject = ev.dataTransfer.getData("application/x-dashboard-tl-to-project");
    if (tlToProject && getState()) {
      clearDashboardDropZoneHighlight();
      const chip = el?.closest("[data-drop-project-leiter]");
      const projId = chip?.getAttribute("data-drop-project-leiter");
      const proj = projId ? getProject(projId) : undefined;
      const tl = getTeamLeader(tlToProject);
      if (proj && tl && String(proj.leiterId) !== String(tl.ID)) {
        recordUndoSnapshot();
        proj.leiterId = String(tl.ID);
        await persist();
        renderDashboard();
        if ($("#view-projects").classList.contains("view--active")) {
          renderProjectsView();
        }
      }
      return;
    }

    const empId =
      ev.dataTransfer.getData("text/plain") || ev.dataTransfer.getData("application/x-employee-id");
    if (!empId || !getState()) {
      clearDashboardDropZoneHighlight();
      return;
    }
    if (empId.startsWith("x-dashboard-tl-project:")) {
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

/**
 * Exportiert den Dashboard-Abschnitt „Abteilung für die Person“ wie angezeigt:
 * Reihenfolge der Abteilungen, Teamleiter, darunter alle zugeordneten Mitarbeitenden.
 * Dateiformat: UTF-8 mit BOM, Semikolon-getrennt (Excel unter Windows).
 */
export function exportDashboardTeamsSpreadsheet() {
  if (!getState()) return;
  ensureDashboardAbteilungReihenfolge();
  const sep = ";";
  const headers = [
    "Abteilung",
    "Teamleiter",
    "Mitarbeiter_ID",
    "Personalnummer",
    "Vorname",
    "Nachname",
    "Qualifikation",
    "Status",
    "Beschäftigung",
    "Stufe",
    "Abteilung_Stammdaten",
    "Zusatz_Tags",
  ];
  /** @type {string[][]} */
  const rows = [headers];
  const sortedTls = teamLeadersSortedForDashboard();
  const deptsOrdered = [...getState().dashboard_abteilung_reihenfolge];
  for (const abt of deptsOrdered) {
    const tls = sortedTls.filter((tl) => normalizeAbteilung(tl.Abteilung) === abt);
    if (!tls.length) continue;
    for (const tl of tls) {
      const tlName = String(tl.Name ?? "").trim() || `TL ${tl.ID}`;
      const members = getState().employees.filter((e) => Number(e.Teamleiter_ID) === Number(tl.ID));
      if (members.length === 0) {
        rows.push([abt, tlName, "", "", "", "", "", "", "", "", "", ""]);
        continue;
      }
      for (const m of members) {
        const tags = Array.isArray(m.Zusatz_Tags) ? m.Zusatz_Tags.map((t) => String(t ?? "").trim()).filter(Boolean).join(", ") : "";
        rows.push([
          abt,
          tlName,
          String(m.ID),
          String(m.Personalnummer ?? ""),
          String(m.Vorname ?? ""),
          String(m.Nachname ?? ""),
          String(m.Qualifikation ?? ""),
          String(m.Status ?? ""),
          String(m.Beschäftigung ?? ""),
          String(m.Stufe ?? ""),
          normalizeAbteilung(m.Abteilung),
          tags,
        ]);
      }
    }
  }
  const lines = rows.map((r) => r.map(csvSemicolonCell).join(sep));
  const content = `\uFEFF${lines.join("\r\n")}`;
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Dashboard-Teams_${todayISO()}.csv`;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Klick auf „Export“ im Team-Dashboard (Delegation, bleibt über `renderDashboard` gültig). */
export function setupDashboardTeamsExport() {
  const view = /** @type {HTMLElement | null} */ ($("#view-dashboard"));
  if (!view || view.dataset.exportTeams === "1") return;
  view.dataset.exportTeams = "1";
  view.addEventListener("click", (ev) => {
    const btn = ev.target instanceof Element ? ev.target.closest("[data-dashboard-export-teams]") : null;
    if (!(btn instanceof HTMLElement)) return;
    exportDashboardTeamsSpreadsheet();
  });
}

/** Beim Zurückkehren zum Tab: Status aus Abwesenheitsdaten ableiten und ggf. speichern. */
export function setupAutoEmployeeStatusSync() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible" || !getState()) return;
    void (async () => {
      if (!syncEmployeeStatusesFromAbsenceDates()) return;
      await persist();
      refreshAllDataViews();
    })();
  });
}
