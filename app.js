/**
 * Einstiegspunkt: lädt Module, registriert View-Refresh, startet die App.
 */
import { linkLocalDataFile, isFileSystemAccessSupported, getLinkedFileName } from "./fileHandler.js";
import { $, $all, escapeHtml } from "./utils.js";
import {
  BUNDESLAND_LIST,
  getFeierlandCode,
  setFeierlandCode,
} from "./holidays.js";
import { normalizeAllEmployeesShape, runAutoStatusSyncAndPersist } from "./employees.js";
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
