/**
 * Zentraler App-State, Persistenz, Undo/Redo, Planungsmodus, globale Modale.
 */
import {
  linkLocalDataFile,
  saveDataToFile,
  getLinkedFileName,
} from "./fileHandler.js";
import { $ } from "./utils.js";
import { normalizeAllEmployeesShape } from "./employees.js";

/** @typedef {{ employees: object[], team_leaders: object[], projects: object[], assignments: object[], qualifications: string[], dashboard_abteilung_reihenfolge: string[] }} AppState */

/** @type {AppState | null} */
let state = null;

const UNDO_HISTORY_LIMIT = 80;
/** @type {string[]} */
const undoStack = [];
/** @type {string[]} */
const redoStack = [];
let historySuspended = false;

let isPlanningMode = false;
let prePlanningStateJson = "";

/** @type {() => void} */
let refreshViewsCallback = () => {};

/** @param {() => void} fn */
export function setRefreshViewsCallback(fn) {
  refreshViewsCallback = fn;
}

export function getState() {
  return state;
}

/** @param {AppState | null} s */
export function setState(s) {
  state = s;
}

export function isPlanningModeActive() {
  return isPlanningMode;
}

/** Nach Dateiload oder Boot: Planungsmodus zurücksetzen. */
export function resetPlanningSession() {
  isPlanningMode = false;
  prePlanningStateJson = "";
  syncPlanningModeChrome();
}

export function clearUndoHistory() {
  undoStack.length = 0;
  redoStack.length = 0;
}

function cloneStateJson() {
  if (!state) return "";
  return JSON.stringify(state);
}

export function recordUndoSnapshot() {
  if (!state || historySuspended) return;
  undoStack.push(cloneStateJson());
  if (undoStack.length > UNDO_HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
}

export function refreshAllDataViews() {
  if (!state) return;
  refreshViewsCallback();
}

export async function undoLastChange() {
  if (!state || historySuspended || undoStack.length === 0) return;
  const prevJson = undoStack.pop();
  if (!prevJson) return;
  redoStack.push(cloneStateJson());
  historySuspended = true;
  try {
    state = /** @type {AppState} */ (JSON.parse(prevJson));
    normalizeAllEmployeesShape();
    await persist();
    refreshAllDataViews();
    showUndoRedoToast("undo");
  } finally {
    historySuspended = false;
  }
}

export async function redoLastChange() {
  if (!state || historySuspended || redoStack.length === 0) return;
  const nextJson = redoStack.pop();
  if (!nextJson) return;
  undoStack.push(cloneStateJson());
  historySuspended = true;
  try {
    state = /** @type {AppState} */ (JSON.parse(nextJson));
    normalizeAllEmployeesShape();
    await persist();
    refreshAllDataViews();
    showUndoRedoToast("redo");
  } finally {
    historySuspended = false;
  }
}

/** @param {"undo" | "redo"} kind */
function showUndoRedoToast(kind) {
  const stack = /** @type {HTMLElement | null} */ (document.querySelector("#toast-stack"));
  if (!stack) return;
  const msg = kind === "redo" ? "Wiederhergestellt." : "Aktion rückgängig gemacht.";
  const el = document.createElement("div");
  el.className = "toast toast--history";
  el.setAttribute("role", "status");
  el.textContent = msg;
  stack.appendChild(el);
  requestAnimationFrame(() => {
    el.classList.add("toast--visible");
  });
  window.setTimeout(() => {
    el.classList.remove("toast--visible");
    window.setTimeout(() => el.remove(), 320);
  }, 2400);
}

/** @param {Event} ev */
export function isTypingFieldUndoTarget(ev) {
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

export function setupHistoryKeyboard() {
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

export function nextId(list, key = "ID") {
  if (!list.length) return 1;
  return Math.max(...list.map((item) => Number(item[key]) || 0)) + 1;
}

export async function persist() {
  if (!state) return;
  const err = /** @type {HTMLParagraphElement} */ (document.querySelector("#file-error"));
  const meta = /** @type {HTMLParagraphElement} */ (document.querySelector("#file-meta"));
  err.hidden = true;
  err.textContent = "";
  if (isPlanningMode) {
    if (meta) {
      meta.textContent = `Aktiv: ${getLinkedFileName()} · Planungsmodus – noch nicht auf die Festplatte geschrieben`;
    }
    return;
  }
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

export function syncPlanningModeChrome() {
  const banner = /** @type {HTMLElement | null} */ ($("#planning-banner"));
  const shell = /** @type {HTMLElement | null} */ ($(".app-shell"));
  const btn = /** @type {HTMLButtonElement | null} */ ($("#btn-toggle-planning"));
  if (banner) banner.hidden = !isPlanningMode;
  shell?.classList.toggle("is-planning", isPlanningMode);
  if (btn) {
    btn.disabled = !state || isPlanningMode;
    btn.innerHTML = isPlanningMode
      ? '<i class="fa-solid fa-flask" aria-hidden="true"></i> Planungsmodus aktiv'
      : '<i class="fa-solid fa-flask" aria-hidden="true"></i> Planungsmodus starten';
  }
}

export function startPlanningMode() {
  if (!state || isPlanningMode) return;
  const snap = cloneStateJson();
  if (!snap) return;
  prePlanningStateJson = snap;
  isPlanningMode = true;
  syncPlanningModeChrome();
}

export async function commitPlanningMode() {
  if (!isPlanningMode || !state) return;
  isPlanningMode = false;
  prePlanningStateJson = "";
  syncPlanningModeChrome();
  clearUndoHistory();
  await persist();
}

export async function cancelPlanningMode() {
  if (!isPlanningMode) return;
  const backup = prePlanningStateJson;
  isPlanningMode = false;
  prePlanningStateJson = "";
  syncPlanningModeChrome();
  if (!backup) {
    refreshAllDataViews();
    return;
  }
  historySuspended = true;
  try {
    state = /** @type {AppState} */ (JSON.parse(backup));
    normalizeAllEmployeesShape();
  } catch (err) {
    console.error(err);
    await openModal(
      "Planungsmodus",
      "<div>Der gespeicherte Zwischenstand konnte nicht wiederhergestellt werden.</div>",
      { variant: "info", confirmText: "Verstanden" }
    );
  } finally {
    historySuspended = false;
  }
  clearUndoHistory();
  refreshAllDataViews();
}

export function setupPlanningModeControls() {
  const ws = /** @type {HTMLElement | null} */ ($("#app-workspace"));
  if (!ws || ws.dataset.planningBound === "1") return;
  ws.dataset.planningBound = "1";
  $("#btn-toggle-planning")?.addEventListener("click", () => startPlanningMode());
  $("#btn-planning-commit")?.addEventListener("click", () => {
    void commitPlanningMode();
  });
  $("#btn-planning-cancel")?.addEventListener("click", () => {
    void cancelPlanningMode();
  });
}

export function openAssignmentConflictModal(employeeFullName) {
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

/**
 * @param {string} title
 * @param {string} bodyHtml
 * @param {{ confirmText?: string, cancelText?: string, variant?: string, confirmDanger?: boolean }} [opts]
 */
export function openModal(title, bodyHtml, opts = {}) {
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

export function closeAllModalsAndBackdrops() {
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
