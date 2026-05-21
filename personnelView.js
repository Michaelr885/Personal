/**
 * Tab „Personalverwaltung“: Mitarbeitertabelle, Formulare, Qualifikationen, Teamleiter.
 *
 * Anlegen/Bearbeiten/Löschen von Personen, Qualifikationsliste pflegen,
 * Teamleiter-Verwaltung. Schreibt über state.js in die verknüpfte daten.json.
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
  syncEditAbsenceHint,
  syncNewAbsenceHint,
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
  ensureStateQualifications,
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
  getNextHoliday,
  bundeslandHolidayNameDE,
  betrieblichFreierDezemberTagLabelDE,
  countsAsUrlaubArbeitstag,
  countUrlaubWorkdaysInInclusiveRange,
  isLandPublicHolidayISO,
  isBetrieblichFreierDezemberTagISO,
  BUNDESLAND_LIST,
} from "./holidays.js";
import { sanitizeTeamColor } from "./dashboardView.js";

export function statusCellClass(status) {
  if (status === "Verfügbar") return "status-cell status-cell--verfügbar";
  if (status === "Krank") return "status-cell status-cell--krank";
  if (status === "Urlaub") return "status-cell status-cell--urlaub";
  return "status-cell";
}

export function renderTeamLeadersTable() {
  if (!getState()) return;
  const tbody = /** @type {HTMLElement} */ ($("#teamleaders-tbody"));
  const rows = teamLeadersSortedForDashboard()
    .map((tl) => {
      const count = getState().employees.filter((e) => Number(e.Teamleiter_ID) === Number(tl.ID)).length;
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
      if (!getState() || !Number.isFinite(id)) return;
      const tl = getTeamLeader(id);
      if (tl) openTeamLeaderEditModal(tl);
    });
  });

  tbody.querySelectorAll("[data-delete-tl]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(/** @type {HTMLElement} */ (btn).dataset.deleteTl);
      if (!getState() || !Number.isFinite(id)) return;
      const tl = getTeamLeader(id);
      if (!tl) return;
      const count = getState().employees.filter((e) => Number(e.Teamleiter_ID) === id).length;
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
      for (const e of getState().employees) {
        if (Number(e.Teamleiter_ID) === id) e.Teamleiter_ID = null;
      }
      getState().team_leaders = getState().team_leaders.filter((t) => Number(t.ID) !== id);
      getState().team_leaders.sort(
        (a, b) => Number(a.Reihenfolge) - Number(b.Reihenfolge) || Number(a.ID) - Number(b.ID)
      );
      getState().team_leaders.forEach((t, i) => {
        t.Reihenfolge = i;
      });
      await persist();
      refreshAllDataViews();
    });
  });
}

/** @param {string} qual */
export function qualificationUsageCounts(qual) {
  if (!getState()) return { emps: 0, projects: 0 };
  let emps = 0;
  for (const e of getState().employees) {
    if (String(e.Qualifikation ?? "").trim() === qual) emps += 1;
  }
  let projects = 0;
  for (const p of getState().projects) {
    const bq = p.Benötigte_Qualifikationen || {};
    if (Object.prototype.hasOwnProperty.call(bq, qual)) projects += 1;
  }
  return { emps, projects };
}

/**
 * @param {string} oldName
 * @param {string} newName
 */
export function applyQualificationRename(oldName, newName) {
  if (!getState()) return;
  const old = String(oldName).trim();
  const neu = String(newName).trim();
  if (!old || !neu || old === neu) return;
  const hadNew = getState().qualifications.includes(neu);
  for (const e of getState().employees) {
    if (String(e.Qualifikation ?? "").trim() === old) e.Qualifikation = neu;
  }
  for (const p of getState().projects) {
    const bq = p.Benötigte_Qualifikationen || {};
    if (!Object.prototype.hasOwnProperty.call(bq, old)) continue;
    const nOld = Number(bq[old]);
    delete bq[old];
    const cur = Number(bq[neu]);
    const add = Number.isFinite(nOld) && nOld > 0 ? nOld : 0;
    const base = Number.isFinite(cur) && cur > 0 ? cur : 0;
    bq[neu] = Math.min(999, base + add);
  }
  if (hadNew) {
    getState().qualifications = getState().qualifications.filter((q) => q !== old);
  } else {
    getState().qualifications = getState().qualifications.map((q) => (q === old ? neu : q));
  }
  const seen = new Set();
  getState().qualifications = getState().qualifications.filter((q) => {
    if (seen.has(q)) return false;
    seen.add(q);
    return true;
  });
  getState().qualifications.sort((a, b) => a.localeCompare(b, "de"));
  ensureStateQualifications();
}

export function renderQualificationsTable() {
  const tbody = /** @type {HTMLElement | null} */ ($("#quals-tbody"));
  if (!tbody || !getState()) return;
  const quals = [...getState().qualifications].sort((a, b) => a.localeCompare(b, "de"));
  tbody.innerHTML = quals.length
    ? quals
        .map((q) => {
          const { emps, projects } = qualificationUsageCounts(q);
          const used = emps > 0 || projects > 0;
          const usage = `${emps} Person${emps === 1 ? "" : "en"}, ${projects} Projekt${projects === 1 ? "" : "e"}`;
          const esc = escapeHtml(q);
          return `<tr data-qual-original="${esc}">
      <td><input type="text" class="input-inline qual-edit-name" maxlength="80" value="${esc}" aria-label="Qualifikation ${esc}" /></td>
      <td class="hint">${usage}</td>
      <td class="actions-cell">
        <button type="button" class="btn btn--small btn--primary" data-qual-save title="Namen speichern">Speichern</button>
        <button type="button" class="btn btn--small btn--ghost" data-qual-delete ${
          used ? "disabled" : ""
        } title="${used ? "Zuerst aus Personen und Projekten entfernen" : "Eintrag aus der Liste entfernen"}">Löschen</button>
      </td>
    </tr>`;
        })
        .join("")
    : '<tr><td colspan="3" class="hint">Keine Einträge.</td></tr>';
}

export function bindQualificationsTableOnce() {
  const tbody = /** @type {HTMLElement | null} */ ($("#quals-tbody"));
  if (!tbody || tbody.dataset.qualBound === "1") return;
  tbody.dataset.qualBound = "1";
  tbody.addEventListener("click", async (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    const saveBtn = t?.closest("button[data-qual-save]");
    const delBtn = t?.closest("button[data-qual-delete]");
    const row = t?.closest("tr[data-qual-original]");
    if (!(row instanceof HTMLTableRowElement) || !getState()) return;
    const origRaw = row.getAttribute("data-qual-original");
    const original = origRaw ?? "";
    if (saveBtn) {
      const inp = row.querySelector("input.qual-edit-name");
      if (!(inp instanceof HTMLInputElement)) return;
      const neu = inp.value.trim();
      if (!neu) {
        await openModal("Qualifikation", "<div>Der Name darf nicht leer sein.</div>", {
          variant: "info",
          confirmText: "Verstanden",
        });
        return;
      }
      if (neu === original) return;
      if (neu !== original && getState().qualifications.includes(neu)) {
        const ok = await openModal(
          "Zusammenführen",
          `<div>„${escapeHtml(neu)}“ ist bereits vorhanden. Alle Personen und Projekt-Anforderungen mit „${escapeHtml(
            original
          )}“ werden auf „${escapeHtml(neu)}“ umgestellt und der doppelte Eintrag entfernt.</div>`,
          { confirmText: "Zusammenführen", confirmDanger: true }
        );
        if (!ok) return;
      }
      recordUndoSnapshot();
      applyQualificationRename(original, neu);
      await syncEmployeesThenPersist();
      refreshAllDataViews();
      return;
    }
    if (delBtn) {
      if (delBtn instanceof HTMLButtonElement && delBtn.disabled) return;
      const { emps, projects } = qualificationUsageCounts(original);
      if (emps > 0 || projects > 0) {
        await openModal(
          "Löschen nicht möglich",
          "<div>Diese Qualifikation ist noch Personen oder Projekten zugeordnet.</div>",
          { variant: "info", confirmText: "Verstanden" }
        );
        return;
      }
      const ok = await openModal(
        "Qualifikation löschen",
        `<div>„${escapeHtml(original)}“ aus der Stammliste entfernen?</div>`,
        { confirmText: "Ja, löschen", confirmDanger: true }
      );
      if (!ok) return;
      recordUndoSnapshot();
      getState().qualifications = getState().qualifications.filter((q) => q !== original);
      await persist();
      refreshAllDataViews();
    }
  });
}

export function renderPersonnelTable() {
  if (!getState()) return;
  const tbody = /** @type {HTMLElement} */ ($("#personnel-tbody"));
  const q = /** @type {HTMLInputElement} */ ($("#personnel-search")).value.trim().toLowerCase();
  const st = /** @type {HTMLSelectElement} */ ($("#personnel-filter-status")).value;
  const fq = /** @type {HTMLSelectElement} */ ($("#personnel-filter-qual")).value;
  const fBesch = /** @type {HTMLSelectElement} */ ($("#personnel-filter-beschäftigung")).value;
  const fStufe = /** @type {HTMLSelectElement} */ ($("#personnel-filter-stufe")).value;
  const fAbt = /** @type {HTMLSelectElement} */ ($("#personnel-filter-abteilung")).value;

  const rows = getState().employees
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
      return `<tr class="emp-qual-surface" style="--qh:${empQualHue(e.Qualifikation)}">
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

export async function deleteEmployeeById(id) {
  if (!getState() || !Number.isFinite(id)) return;
  const ok = await openModal(
    "Mitarbeitende/n löschen",
    "<div>Zugehörige Zuweisungen werden ebenfalls entfernt. Fortfahren?</div>",
    { confirmText: "Ja, löschen", confirmDanger: true }
  );
  if (!ok) return;
  recordUndoSnapshot();
  getState().employees = getState().employees.filter((e) => Number(e.ID) !== id);
  getState().assignments = getState().assignments.filter((a) => Number(a.Employee_ID) !== id);
  await syncEmployeesThenPersist();
  refreshAllDataViews();
}

export function setupPersonnelTableActions() {
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

export function setupQuickReturnDateButtons() {
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

export function loadEmployeeIntoForm(id) {
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
    const uHalb = /** @type {HTMLInputElement | null} */ ($("#emp-urlaub-halber-tag"));
    if (uHalb) {
      uHalb.checked =
        e.Urlaub_halber_Tag === true &&
        isSingleCalendarDayUrlaub(String(e.Urlaub_ab ?? "").trim(), e.Urlaub_bis);
    }
    renderUrlaubPeriodenContainer("emp-urlaub-perioden", e.Urlaub_perioden || []);
    syncPersonnelMainUrlaubHalberWrap("emp");
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

export function resetEmployeeForm() {
  /** @type {HTMLFormElement} */ ($("#employee-form")).reset();
  /** @type {HTMLInputElement} */ ($("#emp-id")).value = "";
  renderUrlaubPeriodenContainer("emp-urlaub-perioden", []);
  syncPersonnelMainUrlaubHalberWrap("emp");
  syncPersonnelMainUrlaubHalberWrap("new-emp");
  $("#employee-form-title").innerHTML =
    '<i class="fa-solid fa-user-pen"></i> Mitarbeitende bearbeiten';
  syncEditAbsenceHint();
  const panel = /** @type {HTMLElement | null} */ ($("#employee-edit-panel"));
  if (panel) panel.hidden = true;
}

export function fillNewEmployeeSelects() {
  const quals = uniqueQualifications();
  /** @type {HTMLSelectElement} */ ($("#new-emp-qual")).innerHTML = quals
    .map((q) => `<option value="${q}">${q}</option>`)
    .join("");
  if (!getState()) return;
  /** @type {HTMLSelectElement} */ ($("#new-emp-tl")).innerHTML =
    '<option value="">Keine Teamleitung</option>' +
    teamLeadersSortedForDashboard()
      .map((t) => {
        const abt = normalizeAbteilung(t.Abteilung);
        return `<option value="${t.ID}">${escapeHtml(t.Name)} (${escapeHtml(abt)})</option>`;
      })
      .join("");
}

export function fillQualificationSelects() {
  const quals = uniqueQualifications();
  const opts = quals.map((q) => `<option value="${q}">${q}</option>`).join("");
  /** @type {HTMLSelectElement} */ ($("#emp-qual")).innerHTML = opts;
  /** @type {HTMLSelectElement} */ ($("#personnel-filter-qual")).innerHTML =
    `<option value="">Alle</option>` + quals.map((q) => `<option value="${q}">${q}</option>`).join("");
  fillNewEmployeeSelects();
}

export function fillTeamLeaderSelect() {
  if (!getState()) return;
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

export function fillTeamleaderAbteilungSelect(selectEl, currentAbteilung) {
  const sel = typeof selectEl === "string" ? $(selectEl) : selectEl;
  if (!(sel instanceof HTMLSelectElement)) return;
  const v = normalizeAbteilung(currentAbteilung);
  sel.innerHTML = ABTEILUNGEN.map(
    (a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`
  ).join("");
  sel.value = v;
}

export function openTeamLeaderEditModal(tl) {
  if (!tl) return;
  /** @type {HTMLInputElement} */ ($("#teamleader-form-id")).value = String(tl.ID);
  /** @type {HTMLInputElement} */ ($("#teamleader-form-name")).value = tl.Name;
  /** @type {HTMLInputElement} */ ($("#teamleader-form-color")).value = sanitizeTeamColor(tl.Team_Farbe);
  fillTeamleaderAbteilungSelect("#teamleader-form-abteilung", tl.Abteilung);
  /** @type {HTMLElement} */ ($("#teamleader-modal-backdrop")).hidden = false;
  /** @type {HTMLElement} */ ($("#teamleader-modal")).hidden = false;
}

export function closeTeamLeaderEditModal() {
  /** @type {HTMLElement} */ ($("#teamleader-modal-backdrop")).hidden = true;
  /** @type {HTMLElement} */ ($("#teamleader-modal")).hidden = true;
}

export function fillPersonnelStufeFilter() {
  if (!getState()) return;
  const sel = /** @type {HTMLSelectElement} */ ($("#personnel-filter-stufe"));
  const prev = sel.value;
  const stufen = [
    ...new Set(getState().employees.map((e) => String(e.Stufe ?? "").trim()).filter(Boolean)),
  ].sort((a, b) => a.localeCompare(b, "de"));
  sel.innerHTML =
    '<option value="">Alle</option>' +
    stufen.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
}

export function renderPersonnelView() {
  fillQualificationSelects();
  fillTeamLeaderSelect();
  fillPersonnelStufeFilter();
  renderTeamLeadersTable();
  renderQualificationsTable();
  bindQualificationsTableOnce();
  renderPersonnelTable();
  fillTeamleaderAbteilungSelect("#new-tl-abteilung", ABTEILUNGEN[0]);
  syncEditAbsenceHint();
  syncNewAbsenceHint();
}

export function syncPersonnelMainUrlaubHalberWrap(which) {
  const ab = readOptionalISODateFromInput(`#${which}-urlaub-ab`);
  const bis = readOptionalISODateFromInput(`#${which}-urlaub-bis`);
  const wrap = /** @type {HTMLElement | null} */ ($(`#${which}-urlaub-halber-wrap`));
  const cb = /** @type {HTMLInputElement | null} */ ($(`#${which}-urlaub-halber-tag`));
  if (!wrap || !cb) return;
  const ok = !!ab && isSingleCalendarDayUrlaub(ab, bis || null);
  wrap.hidden = !ok;
  if (!ok) cb.checked = false;
}

export function bindPersonnelMainUrlabHalbListenersOnce() {
  const ws = /** @type {HTMLElement | null} */ ($("#app-workspace"));
  if (!ws || ws.dataset.personnelMainHalb === "1") return;
  ws.dataset.personnelMainHalb = "1";
  for (const id of ["emp-urlaub-ab", "emp-urlaub-bis", "new-emp-urlaub-ab", "new-emp-urlaub-bis"]) {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLElement)) continue;
    const sync = () => {
      syncPersonnelMainUrlaubHalberWrap(id.startsWith("new-emp") ? "new-emp" : "emp");
    };
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
  }
}

export function bindUrlaubPeriodenButtonsOnce() {
  const ws = /** @type {HTMLElement | null} */ ($("#app-workspace"));
  if (!ws || ws.dataset.urlaubPeriodUi === "1") return;
  ws.dataset.urlaubPeriodUi = "1";
  ws.addEventListener("input", (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (!t.classList.contains("js-u-von") && !t.classList.contains("js-u-bis")) return;
    const row = t.closest(".urlaub-per-row");
    if (row instanceof HTMLElement) refreshUrlaubPeriodRowHalbUI(row);
  });
  ws.addEventListener("click", (ev) => {
    const t = ev.target instanceof Element ? ev.target : null;
    if (t?.closest("#emp-urlaub-add")) {
      ev.preventDefault();
      const host = document.getElementById("emp-urlaub-perioden");
      host?.insertAdjacentHTML("beforeend", urlaubPeriodRowTemplate());
      const row = host?.lastElementChild;
      if (row instanceof HTMLElement) refreshUrlaubPeriodRowHalbUI(row);
      return;
    }
    if (t?.closest("#new-emp-urlaub-add")) {
      ev.preventDefault();
      const host = document.getElementById("new-emp-urlaub-perioden");
      host?.insertAdjacentHTML("beforeend", urlaubPeriodRowTemplate());
      const row = host?.lastElementChild;
      if (row instanceof HTMLElement) refreshUrlaubPeriodRowHalbUI(row);
      return;
    }
    const rem = t?.closest(".js-u-remove");
    if (rem) {
      ev.preventDefault();
      rem.closest(".urlaub-per-row")?.remove();
    }
  });
}

export function setupPersonnelInteractions() {
  bindUrlaubPeriodenButtonsOnce();
  bindPersonnelMainUrlabHalbListenersOnce();
  bindQualificationsTableOnce();
  const qualAddForm = /** @type {HTMLFormElement | null} */ (document.getElementById("qual-add-form"));
  if (qualAddForm && qualAddForm.dataset.bound !== "1") {
    qualAddForm.dataset.bound = "1";
    qualAddForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      if (!getState()) return;
      const inp = /** @type {HTMLInputElement | null} */ (document.getElementById("qual-add-input"));
      if (!inp) return;
      const name = inp.value.trim();
      if (!name) {
        await openModal("Qualifikation", "<div>Bitte einen Namen eingeben.</div>", {
          variant: "info",
          confirmText: "Verstanden",
        });
        return;
      }
      if (getState().qualifications.includes(name)) {
        await openModal("Qualifikation", "<div>Dieser Eintrag ist bereits vorhanden.</div>", {
          variant: "info",
          confirmText: "Verstanden",
        });
        return;
      }
      recordUndoSnapshot();
      getState().qualifications.push(name);
      getState().qualifications.sort((a, b) => a.localeCompare(b, "de"));
      inp.value = "";
      await persist();
      refreshAllDataViews();
    });
  }
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
    if (!getState()) return;
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
    const uHalbWrap = /** @type {HTMLElement | null} */ ($("#emp-urlaub-halber-wrap"));
    const uHalbCb = /** @type {HTMLInputElement | null} */ ($("#emp-urlaub-halber-tag"));
    const uHalbChecked = !!(uHalbCb?.checked && uHalbWrap && !uHalbWrap.hidden);
    if (uHalbChecked && !isSingleCalendarDayUrlaub(uAb || "", uBis)) {
      await openModal(
        "Halber Urlaubstag",
        "<div>„Halber Tag“ ist nur bei einem einzelnen Kalendertag möglich (gleiches „Von“/„Bis“ oder leeres „Bis“).</div>",
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
      Urlaub_halber_Tag: !!(uAb && uHalbChecked && isSingleCalendarDayUrlaub(uAb, uBis)),
      Urlaub_perioden: uPeriods,
    };
    const idx = getState().employees.findIndex((e) => Number(e.ID) === Number(existingId));
    if (idx >= 0) {
      recordUndoSnapshot();
      const merged = /** @type {Employee} */ ({ ...getState().employees[idx], ...payload });
      syncLegacyAbsenceFields(merged);
      getState().employees[idx] = merged;
      await syncEmployeesThenPersist();
    }
    resetEmployeeForm();
    refreshAllDataViews();
  });

  $("#new-employee-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!getState()) return;
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
    const uHalbWrapN = /** @type {HTMLElement | null} */ ($("#new-emp-urlaub-halber-wrap"));
    const uHalbCbN = /** @type {HTMLInputElement | null} */ ($("#new-emp-urlaub-halber-tag"));
    const uHalbCheckedN = !!(uHalbCbN?.checked && uHalbWrapN && !uHalbWrapN.hidden);
    if (uHalbCheckedN && !isSingleCalendarDayUrlaub(uAbN || "", uBisN)) {
      await openModal(
        "Halber Urlaubstag",
        "<div>„Halber Tag“ ist nur bei einem einzelnen Kalendertag möglich (gleiches „Von“/„Bis“ oder leeres „Bis“).</div>",
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
      ID: nextId(getState().employees),
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
      Urlaub_halber_Tag: !!(uAbN && uHalbCheckedN && isSingleCalendarDayUrlaub(uAbN, uBisN)),
      Urlaub_perioden: uPeriodsN,
      Rückkehr_erwartet_am: null,
      Abwesenheit_geplant_ab: null,
      Abwesenheit_geplant_bis: null,
    });
    syncLegacyAbsenceFields(newEmp);
    recordUndoSnapshot();
    getState().employees.push(newEmp);
    await syncEmployeesThenPersist();
    /** @type {HTMLFormElement} */ ($("#new-employee-form")).reset();
    renderUrlaubPeriodenContainer("new-emp-urlaub-perioden", []);
    syncPersonnelMainUrlaubHalberWrap("new-emp");
    fillNewEmployeeSelects();
    refreshAllDataViews();
  });

  $("#new-teamleader-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    if (!getState()) return;
    const name = /** @type {HTMLInputElement} */ ($("#new-tl-name")).value.trim();
    if (!name) return;
    const colorIn = /** @type {HTMLInputElement} */ ($("#new-tl-color")).value;
    const maxR = getState().team_leaders.reduce((m, t) => Math.max(m, Number(t.Reihenfolge) || 0), -1);
    recordUndoSnapshot();
    getState().team_leaders.push({
      ID: nextId(getState().team_leaders),
      Name: name,
      Team_Farbe: sanitizeTeamColor(colorIn),
      Abteilung: normalizeAbteilung(/** @type {HTMLSelectElement} */ ($("#new-tl-abteilung")).value),
      Reihenfolge: maxR + 1,
    });
    await persist();
    /** @type {HTMLFormElement} */ ($("#new-teamleader-form")).reset();
    /** @type {HTMLInputElement} */ ($("#new-tl-color")).value = "#64748b";
    refreshAllDataViews();
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
      if (!getState()) return;
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
      refreshAllDataViews();
    });
  }
}
