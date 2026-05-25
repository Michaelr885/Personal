/**
 * Einstiegspunkt der App (wird von index.html geladen).
 *
 * Startet nach dem Laden der Seite: verknüpft daten.json, schaltet Tabs um,
 * ruft die render/setup-Funktionen der View-Module auf. Hier beginnt das Lesen
 * des Codes — die Fachlogik steckt in state.js, employees.js und *View.js.
 */
import {
  linkLocalDataFile,
  isFileSystemAccessSupported,
  getLinkedFileName,
  parseAndNormalizeText,
  downloadDataAsFile,
  setFallbackFileName,
} from "./fileHandler.js";
import { $, $all, escapeHtml } from "./utils.js";
import {
  BUNDESLAND_LIST,
  getFeierlandCode,
  setFeierlandCode,
} from "./holidays.js";
import { ABTEILUNGEN, normalizeAllEmployeesShape, runAutoStatusSyncAndPersist } from "./employees.js";
import {
  getState,
  setState,
  clearUndoHistory,
  setRefreshViewsCallback,
  setupHistoryKeyboard,
  setupPlanningModeControls,
  syncPlanningModeChrome,
  resetPlanningSession,
  closeAllModalsAndBackdrops,
} from "./state.js";
import {
  renderDashboard,
  setupDashboardDnD,
  setupDashboardTeamsExport,
  setupDashboardAbsenceModal,
  setupAutoEmployeeStatusSync,
} from "./dashboardView.js";
import {
  renderProjectsView,
  setupProjectsInteractions,
  setupDndAssignModal,
  setupProjectDropDelegation,
} from "./ganttView.js";
import {
  renderPersonnelView,
  setupPersonnelInteractions,
  setupPersonnelTableActions,
  setupQuickReturnDateButtons,
} from "./personnelView.js";
import { renderUrlaubPlan, setupUrlaubView, setupUrlaubGanttBlockModal } from "./urlaubView.js";

const STORAGE_THEME = "app_theme";

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
    subtitle: "Monatsraster und Jahresstatistik – Feiertage nach gewähltem Bundesland (Sidebar).",
  },
};

function populateAllDepartmentDropdowns() {
  const filterIds = ["#personnel-filter-abteilung", "#urlaub-filter-abteilung"];
  filterIds.forEach((selId) => {
    const sel = /** @type {HTMLSelectElement | null} */ ($(selId));
    if (sel) {
      sel.innerHTML =
        '<option value="">Alle</option>' +
        ABTEILUNGEN.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("");
    }
  });

  const formIds = ["#new-tl-abteilung", "#new-emp-abteilung", "#emp-abteilung", "#teamleader-form-abteilung"];
  formIds.forEach((selId) => {
    const sel = /** @type {HTMLSelectElement | null} */ ($(selId));
    if (sel) {
      sel.innerHTML = ABTEILUNGEN.map(
        (a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`
      ).join("");
    }
  });
}

function applyThemeFromStorage() {
  let theme = "light";
  try {
    const t = localStorage.getItem(STORAGE_THEME);
    if (t === "dark" || t === "light") theme = t;
  } catch {
    /* ignore */
  }
  document.documentElement.dataset.theme = theme;
  const label = /** @type {HTMLElement | null} */ (document.querySelector("#pref-theme-label"));
  const icon = /** @type {HTMLElement | null} */ (document.querySelector("#pref-theme-icon"));
  if (label) label.textContent = theme === "dark" ? "Hellmodus" : "Dark Mode";
  if (icon) {
    icon.className = theme === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  }
}

function initAppPreferences() {
  applyThemeFromStorage();
  const sel = /** @type {HTMLSelectElement | null} */ (document.querySelector("#pref-feierland"));
  if (sel && sel.dataset.bound !== "1") {
    sel.dataset.bound = "1";
    sel.innerHTML = BUNDESLAND_LIST.map(
      ([code, name]) => `<option value="${escapeHtml(code)}">${escapeHtml(name)}</option>`
    ).join("");
    sel.value = getFeierlandCode();
    sel.addEventListener("change", () => {
      setFeierlandCode(sel.value);
      renderUrlaubPlan();
      renderDashboard();
    });
  }
  const themeBtn = /** @type {HTMLButtonElement | null} */ (document.querySelector("#pref-theme-toggle"));
  if (themeBtn && themeBtn.dataset.bound !== "1") {
    themeBtn.dataset.bound = "1";
    themeBtn.addEventListener("click", () => {
      const cur = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
      const next = cur === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_THEME, next);
      } catch {
        /* ignore */
      }
      applyThemeFromStorage();
    });
  }
}

/** @param {string} name */
function switchView(name) {
  if (!getState()) return;
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
  const fileLinkBtn = $("#btn-link-file");
  const fallbackInput = /** @type {HTMLInputElement | null} */ ($("#fallback-file-input"));
  const dlFallbackBtn = $("#btn-download-fallback");

  dlFallbackBtn?.addEventListener("click", () => {
    const data = getState();
    if (data) {
      downloadDataAsFile(data, getLinkedFileName() || "daten.json");
    }
  });

  fileLinkBtn.addEventListener("click", async () => {
    const err = /** @type {HTMLParagraphElement} */ ($("#file-error"));
    const meta = /** @type {HTMLParagraphElement} */ ($("#file-meta"));
    err.hidden = true;
    err.textContent = "";

    if (!isFileSystemAccessSupported()) {
      fallbackInput?.click();
      return;
    }

    try {
      const data = await linkLocalDataFile();
      setState(data);
      normalizeAllEmployeesShape();
      clearUndoHistory();
      resetPlanningSession();
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

  fallbackInput?.addEventListener("change", async () => {
    const err = /** @type {HTMLParagraphElement} */ ($("#file-error"));
    const meta = /** @type {HTMLParagraphElement} */ ($("#file-meta"));
    err.hidden = true;
    err.textContent = "";

    const file = fallbackInput.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setFallbackFileName(file.name);
      const data = parseAndNormalizeText(text);
      setState(data);
      normalizeAllEmployeesShape();
      clearUndoHistory();
      resetPlanningSession();
      await runAutoStatusSyncAndPersist();

      localStorage.setItem("app_fallback_data", JSON.stringify(data));
      localStorage.setItem("app_fallback_filename", file.name);

      meta.textContent = `Aktiv: ${getLinkedFileName()} · im Browser gespeichert · Bitte herunterladen!`;
      dlFallbackBtn?.removeAttribute("hidden");

      $("#gate-screen").hidden = true;
      $("#app-workspace").hidden = false;
      setNavEnabled(true);
      switchView("dashboard");
    } catch (e) {
      err.hidden = false;
      err.textContent = "Fehler beim Lesen der Datei: " + String(e);
    }
    fallbackInput.value = "";
  });
}

function boot() {
  closeAllModalsAndBackdrops();
  setState(null);
  clearUndoHistory();
  resetPlanningSession();
  syncPlanningModeChrome();

  setRefreshViewsCallback(() => {
    if (!getState()) return;
    renderDashboard();
    renderPersonnelView();
    if ($("#view-projects").classList.contains("view--active")) {
      renderProjectsView();
    }
    if ($("#view-urlaub")?.classList?.contains("view--active")) {
      renderUrlaubPlan();
    }
  });

  populateAllDepartmentDropdowns();
  initAppPreferences();
  setupNavigation();
  setupPlanningModeControls();
  setupDashboardDnD();
  setupDashboardTeamsExport();
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

  try {
    const cachedData = localStorage.getItem("app_fallback_data");
    const cachedFilename = localStorage.getItem("app_fallback_filename");
    if (cachedData && cachedFilename) {
      const parsed = JSON.parse(cachedData);
      setFallbackFileName(cachedFilename);
      setState(parsed);
      normalizeAllEmployeesShape();
      const meta = /** @type {HTMLParagraphElement} */ ($("#file-meta"));
      if (meta) {
        meta.textContent = `Aktiv: ${cachedFilename} · aus Browser-Speicher geladen · Bitte herunterladen!`;
      }
      const dlBtn = $("#btn-download-fallback");
      if (dlBtn) dlBtn.removeAttribute("hidden");
      $("#gate-screen").hidden = true;
      $("#app-workspace").hidden = false;
      setNavEnabled(true);
      switchView("dashboard");
    }
  } catch (e) {
    console.warn("Konnte Fallback-Sitzung nicht laden:", e);
  }
}

function startApp() {
  try {
    boot();
  } catch (err) {
    console.error(err);
    const msg =
      err && typeof err === "object" && "message" in err
        ? String(/** @type {{message:string}} */ (err).message)
        : String(err);
    window.alert(`Die Anwendung konnte nicht starten: ${msg}`);
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApp, { once: true });
} else {
  startApp();
}
