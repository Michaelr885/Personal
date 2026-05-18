import {
  linkLocalDataFile,
  saveDataToFile,
  isFileSystemAccessSupported,
  getLinkedFileName,
} from "./fileHandler.js";

/** @typedef {{ ID:number, Personalnummer:string, Vorname:string, Nachname:string, Qualifikation:string, Zusatz_Tags:string[], Teamleiter_ID:number|null, Status:string, Rückkehr_erwartet_am:string|null, Abwesenheit_geplant_ab:string|null, Abwesenheit_geplant_bis:string|null, Krank_ab:string|null, Krank_bis:string|null, Urlaub_ab:string|null, Urlaub_bis:string|null }} Employee */
/** @typedef {{ ID:number, Name:string, Team_Farbe:string }} TeamLeader */
/** @typedef {{ ID:number, Name:string, Startdatum:string, Enddatum:string, Benötigte_Qualifikationen:Record<string, number> }} Project */
/** @typedef {{ ID:number, Project_ID:number, Employee_ID:number, Startdatum:string, Enddatum:string }} Assignment */

const QUALIFICATIONS = [
  "Monteur",
  "Schweißer",
  "Bauleiter",
  "Elektriker",
  "Lagerist",
];

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
}

async function undoLastChange() {
  if (!state || historySuspended || undoStack.length === 0) return;
  const prevJson = undoStack.pop();
  if (!prevJson) return;
  redoStack.push(cloneStateJson());
  historySuspended = true;
  try {
    state = /** @type {typeof state} */ (JSON.parse(prevJson));
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
};

let ganttInstance = null;

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
    const bis = emp.Urlaub_bis;
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
    emp.Rückkehr_erwartet_am =
      emp.Urlaub_bis != null && emp.Urlaub_bis !== "" ? addCalendarDaysToISO(String(emp.Urlaub_bis), 1) : null;
  } else {
    emp.Rückkehr_erwartet_am = null;
  }
  emp.Abwesenheit_geplant_ab =
    emp.Urlaub_ab != null && emp.Urlaub_ab !== "" ? String(emp.Urlaub_ab) : null;
  emp.Abwesenheit_geplant_bis =
    emp.Urlaub_bis != null && emp.Urlaub_bis !== "" ? String(emp.Urlaub_bis) : null;
}

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
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
    return `<span class="tag-mini" title="„Krankheit bis“ bzw. „Urlaub bis“ setzen (letzter freier Tag vor der Rückkehr)">kein Zeitraum-Ende</span>`;
  }
  const d = daysUntilISODate(raw);
  if (d === null || !Number.isFinite(d)) {
    return `<span class="tag-mini" title="Erster Arbeitstag nach Abwesenheit"><i class="fa-solid fa-calendar-check"></i> Rückkehr ab ${escapeHtml(de)}</span>`;
  }
  if (d < 0) {
    return `<span class="warn-abs" title="Geplanter erster Arbeitstag ${escapeHtml(String(raw))}"><i class="fa-solid fa-circle-xmark"></i> Rückkehr <strong>${escapeHtml(de)}</strong> überfällig</span>`;
  }
  if (d === 0) {
    return `<span class="warn-abs" title="Rückkehr an Arbeit geplant"><i class="fa-solid fa-triangle-exclamation"></i> Rückkehr heute · <strong>${escapeHtml(de)}</strong></span>`;
  }
  const urgent = d < 30;
  const cls = urgent ? "warn-abs" : "tag-mini";
  const icon = urgent ? "fa-triangle-exclamation" : "fa-calendar-check";
  return `<span class="${cls}" title="Erster Arbeitstag nach Abwesenheit: ${escapeHtml(String(raw))}"><i class="fa-solid ${icon}"></i> Rückkehr ab <strong>${escapeHtml(de)}</strong> · noch ${d} Tag${d === 1 ? "" : "e"}</span>`;
}

/** Verfügbar: ab 5 Tage vor geplantem Beginn Hinweis (HTML), getrennt für Krank- und Urlaubsplan. */
function plannedAbsenceBadgeHtml(emp) {
  if (emp.Status !== "Verfügbar") return "";
  const chunks = [];
  for (const spec of [
    { label: "Urlaub", von: emp.Urlaub_ab, bis: emp.Urlaub_bis, icon: "fa-umbrella-beach" },
    { label: "Krank", von: emp.Krank_ab, bis: emp.Krank_bis, icon: "fa-file-medical" },
  ]) {
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
      `<span class="warn-abs" title="Geplanter ${label} ab ${escapeHtml(String(von))}${bis ? ` bis ${escapeHtml(String(bis))}` : ""}"><i class="fa-solid ${icon}"></i> ${label} ab <strong>${escapeHtml(vonDe)}</strong>${bisPart} · noch ${d} Tag${d === 1 ? "" : "e"}</span>`
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
  return `<span class="warn-abs" title="Geplante Abwesenheit ab ${escapeHtml(String(von))}${bis ? ` bis ${escapeHtml(String(bis))}` : ""}"><i class="fa-solid fa-plane-departure"></i> Abwesenheit ab <strong>${escapeHtml(vonDe)}</strong>${bisPart} · noch ${d} Tag${d === 1 ? "" : "e"}</span>`;
}

/** Fließtext für Personal-Tabelle (ohne HTML). */
function absenceSummaryPlain(emp) {
  const parts = [];
  if (emp.Status === "Krank" || emp.Status === "Urlaub") {
    const ab = emp.Status === "Krank" ? emp.Krank_ab : emp.Urlaub_ab;
    const bis = emp.Status === "Krank" ? emp.Krank_bis : emp.Urlaub_bis;
    if ((ab != null && ab !== "") || (bis != null && bis !== "")) {
      parts.push(`${emp.Status} ${ab ?? "…"}–${bis ?? "…"}`);
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
    pushPlan("Urlaub", emp.Urlaub_ab);
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
  for (const [label, von] of /** @type {const} */ ([
    ["Urlaub", emp.Urlaub_ab],
    ["Krank", emp.Krank_ab],
  ])) {
    if (von == null || von === "") continue;
    const d = daysUntilISODate(String(von));
    if (d === null || !Number.isFinite(d) || d < 0 || d > 5) continue;
    lines.push(`${label} ab ${formatDateDE(String(von))} · in ${d} Tag${d === 1 ? "" : "en"}`);
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
    return "Zwei Pläne: Krankheit von/bis und Urlaub von/bis (Kalendertage inklusive). Ab 5 Tage vor „von“ zeigt das Dashboard je einen Hinweis. Laufende Abwesenheit: Status auf Krank oder Urlaub stellen und den passenden Zeitraum pflegen.";
  }
  if (status === "Krank" || status === "Urlaub") {
    return "„Von“ und „bis“ = erster bzw. letzter freier Tag; der erste Arbeitstag ist automatisch der Tag nach „bis“. Schnellbuttons setzen „bis“ auf eine bzw. zwei Wochen ab heute.";
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

/** @param {unknown} c */
function sanitizeTeamColor(c) {
  const s = typeof c === "string" ? c.trim() : "";
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s;
  return "#64748b";
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
  const meta = titles[/** @type {"dashboard"|"projects"|"personnel"} */ (name)];
  $("#page-title").textContent = meta.title;
  $("#page-subtitle").textContent = meta.subtitle;
  if (name === "dashboard") renderDashboard();
  if (name === "projects") renderProjectsView();
  if (name === "personnel") renderPersonnelView();
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

/** Krank/Urlaub: Abwesenheitszeitraum für die Dashboard-Abwesenheitsliste. */
function activeAbsencePeriodHtml(emp) {
  if (emp.Status !== "Krank" && emp.Status !== "Urlaub") return "";
  const ab = emp.Status === "Krank" ? emp.Krank_ab : emp.Urlaub_ab;
  const bis = emp.Status === "Krank" ? emp.Krank_bis : emp.Urlaub_bis;
  if ((!ab || ab === "") && (!bis || bis === "")) return "";
  const a = ab ? formatDateDE(String(ab)) : "…";
  const b = bis ? formatDateDE(String(bis)) : "…";
  return `<span class="absence-list__period">Abwesend <strong>${escapeHtml(a)}</strong> – <strong>${escapeHtml(b)}</strong></span>`;
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
              return `<div class="dashboard-emp-chip" draggable="true" data-dashboard-employee="${e.ID}" title="Auf eine Teamkarte ziehen">
            <span class="dashboard-emp-chip__name">${escapeHtml(e.Vorname)} ${escapeHtml(e.Nachname)}</span>
            <span class="tag-mini">${escapeHtml(e.Qualifikation)}</span>
            ${absBlock}
          </div>`;
            }
          )
          .join("")}</div>`;

  const teamCards = state.team_leaders
    .map((tl) => {
      const members = state.employees.filter(
        (e) => Number(e.Teamleiter_ID) === Number(tl.ID)
      );
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
          return `<li draggable="true" data-dashboard-employee="${m.ID}" class="dashboard-emp-row" title="Auf andere Teamkarte oder „Ohne Teamleitung“ ziehen">
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
      return `<article class="panel card-team team-drop-zone" data-drop-teamleader="${tl.ID}" style="--team-color:${tl.Team_Farbe}">
        <div class="card-team__title">
          <strong>${escapeHtml(tl.Name)}</strong>
          <span class="badge">${assignedCount} heute im Projekt</span>
        </div>
        <div class="hint">Person aus dieser oder einer anderen Teamliste hierher ziehen, um die Teamleitung zu setzen. Auf eine <strong>andere Teamkarte</strong> ziehen, um das Team zu wechseln. Auf „Ohne Teamleitung“ oben ziehen, um die Zuordnung zu entfernen.</div>
        <ul>${items || '<li class="hint">Keine Personen zugeordnet.</li>'}</ul>
      </article>`;
    })
    .join("");

  const absences = state.employees.filter((e) => e.Status === "Krank" || e.Status === "Urlaub");
  const absenceHtml =
    absences.length === 0
      ? '<p class="hint">Keine Abwesenheiten erfasst.</p>'
      : `<ul class="absence-list">${absences
      .map((e) => {
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
      })
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
    <div class="grid-dashboard">${teamCards}</div>
    <div class="panel">
      <div class="panel__head"><h2><i class="fa-solid fa-bed-pulse"></i> Abwesenheiten</h2></div>
      <p class="hint">Bei Krankheit oder Urlaub: Abwesenheitszeitraum und geplanter erster Arbeitstag (Rückkehr) stehen unten. Bei Status „Verfügbar“ erscheint auf den Teamkarten ab fünf Tage vor Urlaubs- oder Krankheitsbeginn ein Hinweis mit Datum.</p>
      ${absenceHtml}
    </div>
    <div class="panel">
      <div class="panel__head"><h2><i class="fa-solid fa-chart-simple"></i> Verfügbarkeit nach Qualifikation</h2></div>
      <div class="stats-grid">${statsItems || '<p class="hint">Keine verfügbaren Personen.</p>'}</div>
    </div>
  `;
}

function destroyGantt() {
  const wrap = /** @type {HTMLElement} */ ($("#gantt-container"));
  wrap.innerHTML = "";
  ganttInstance = null;
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
      view_mode: "Month",
      // frappe-gantt 0.6.1: keine Locale "de" (month_names) → sonst TypeError in date_utils
      language: "en",
      date_format: "YYYY-MM-DD",
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

function uniqueQualifications() {
  if (!state) return [];
  const set = new Set(QUALIFICATIONS);
  state.employees.forEach((e) => set.add(e.Qualifikation));
  state.projects.forEach((p) => {
    Object.keys(p.Benötigte_Qualifikationen || {}).forEach((k) => set.add(k));
  });
  return [...set].sort();
}

function availableEmployeesForPool(filterQual) {
  if (!state) return [];
  return state.employees.filter((e) => {
    if (e.Status !== "Verfügbar") return false;
    if (filterQual && e.Qualifikation !== filterQual) return false;
    return true;
  });
}

function renderEmployeePool() {
  if (!state) return;
  const qual = /** @type {HTMLSelectElement} */ ($("#filter-qualification")).value;
  const list = /** @type {HTMLElement} */ ($("#employee-pool"));
  const emps = availableEmployeesForPool(qual || null);
  $("#employees-hint").textContent = `${emps.length} Person(en) im Pool (nur Status „Verfügbar“).`;
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
    .map((p) => `<option value="${p.ID}">${p.Name}</option>`)
    .join("");

  if (!projSelect.value && state.projects[0]) projSelect.value = String(state.projects[0].ID);

  renderProjectDropZones();
  renderEmployeePool();
  renderProjectDetail();
  fillAssignmentEmployeeSelect(projSelect.value);

  const proj = getProject(projSelect.value);
  if (proj) {
    /** @type {HTMLInputElement} */ ($("#assign-start")).value = proj.Startdatum;
    /** @type {HTMLInputElement} */ ($("#assign-end")).value = proj.Enddatum;
  }

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

  projSelect.addEventListener("change", () => {
    renderProjectDetail();
    fillAssignmentEmployeeSelect(projSelect.value);
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
  const rows = state.team_leaders
    .map((tl) => {
      const count = state.employees.filter((e) => Number(e.Teamleiter_ID) === Number(tl.ID)).length;
      const col = sanitizeTeamColor(tl.Team_Farbe);
      return `<tr>
        <td>${escapeHtml(tl.Name)}</td>
        <td>
          <span class="tl-color-dot" style="--tl-dot:${col}" title="${escapeHtml(col)}"></span>
          <code>${escapeHtml(col)}</code>
        </td>
        <td>${count}</td>
        <td class="actions-cell">
          <button type="button" class="btn btn--icon btn--delete-icon" data-delete-tl="${tl.ID}" title="Teamleiter/in löschen" aria-label="Teamleiter/in löschen"><i class="fa-solid fa-trash-can"></i></button>
        </td>
      </tr>`;
    })
    .join("");
  tbody.innerHTML =
    rows ||
    '<tr><td colspan="4" class="hint">Noch keine Teamleitenden. Legen Sie unten eine Person an.</td></tr>';

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

  const rows = state.employees
    .filter((e) => {
      const hay = `${e.Vorname} ${e.Nachname} ${e.Personalnummer}`.toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (st && e.Status !== st) return false;
      if (fq && e.Qualifikation !== fq) return false;
      return true;
    })
    .map((e) => {
      const tl = getTeamLeader(e.Teamleiter_ID);
      const sc = statusCellClass(e.Status);
      return `<tr>
        <td>${e.Personalnummer}</td>
        <td>${e.Vorname} ${e.Nachname}</td>
        <td>${e.Qualifikation}</td>
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
    rows || '<tr><td colspan="7" class="hint">Keine Treffer für die aktuelle Filterung.</td></tr>';
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
  await persist();
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
    /** @type {HTMLInputElement} */ ($("#emp-id")).value = String(e.ID);
    /** @type {HTMLInputElement} */ ($("#emp-pnr")).value = String(e.Personalnummer ?? "");
    /** @type {HTMLInputElement} */ ($("#emp-vorname")).value = String(e.Vorname ?? "");
    /** @type {HTMLInputElement} */ ($("#emp-nachname")).value = String(e.Nachname ?? "");
    const qualSel = /** @type {HTMLSelectElement} */ ($("#emp-qual"));
    ensureSelectHasValue(qualSel, e.Qualifikation, String(e.Qualifikation ?? ""));
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
    $("#employee-form-title").innerHTML =
      '<i class="fa-solid fa-user-pen"></i> Mitarbeitende bearbeiten';
    syncEditAbsenceHint();
    const panel = /** @type {HTMLElement | null} */ ($("#employee-edit-panel"));
    if (panel) {
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      panel.focus({ preventScroll: true });
      panel.classList.add("panel--focus");
      window.setTimeout(() => panel.classList.remove("panel--focus"), 1200);
    }
  } catch (err) {
    console.error("loadEmployeeIntoForm", err);
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
  $("#employee-form-title").innerHTML =
    '<i class="fa-solid fa-user-pen"></i> Mitarbeitende bearbeiten';
  syncEditAbsenceHint();
}

function fillNewEmployeeSelects() {
  const quals = uniqueQualifications();
  /** @type {HTMLSelectElement} */ ($("#new-emp-qual")).innerHTML = quals
    .map((q) => `<option value="${q}">${q}</option>`)
    .join("");
  if (!state) return;
  /** @type {HTMLSelectElement} */ ($("#new-emp-tl")).innerHTML =
    '<option value="">Keine Teamleitung</option>' +
    state.team_leaders
      .map((t) => `<option value="${t.ID}">${escapeHtml(t.Name)}</option>`)
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
  sel.innerHTML =
    '<option value="">Keine Teamleitung</option>' +
    state.team_leaders.map((t) => `<option value="${t.ID}">${escapeHtml(t.Name)}</option>`).join("");
}

function renderPersonnelView() {
  fillQualificationSelects();
  fillTeamLeaderSelect();
  renderTeamLeadersTable();
  renderPersonnelTable();
  syncEditAbsenceHint();
  syncNewAbsenceHint();
}

function setupPersonnelInteractions() {
  $("#personnel-search").addEventListener("input", renderPersonnelTable);
  $("#personnel-filter-status").addEventListener("change", renderPersonnelTable);
  $("#personnel-filter-qual").addEventListener("change", renderPersonnelTable);

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
    const payload = {
      Personalnummer: /** @type {HTMLInputElement} */ ($("#emp-pnr")).value.trim(),
      Vorname: /** @type {HTMLInputElement} */ ($("#emp-vorname")).value.trim(),
      Nachname: /** @type {HTMLInputElement} */ ($("#emp-nachname")).value.trim(),
      Qualifikation: /** @type {HTMLSelectElement} */ ($("#emp-qual")).value,
      Zusatz_Tags: tags,
      Teamleiter_ID: tlRaw === "" ? null : Number(tlRaw),
      Status: /** @type {HTMLSelectElement} */ ($("#emp-status")).value,
      Krank_ab: kAb,
      Krank_bis: kBis,
      Urlaub_ab: uAb,
      Urlaub_bis: uBis,
    };
    const idx = state.employees.findIndex((e) => Number(e.ID) === Number(existingId));
    if (idx >= 0) {
      recordUndoSnapshot();
      const merged = /** @type {Employee} */ ({ ...state.employees[idx], ...payload });
      syncLegacyAbsenceFields(merged);
      state.employees[idx] = merged;
    }
    await persist();
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
    const newEmp = /** @type {Employee} */ ({
      ID: nextId(state.employees),
      Personalnummer: /** @type {HTMLInputElement} */ ($("#new-emp-pnr")).value.trim(),
      Vorname: /** @type {HTMLInputElement} */ ($("#new-emp-vorname")).value.trim(),
      Nachname: /** @type {HTMLInputElement} */ ($("#new-emp-nachname")).value.trim(),
      Qualifikation: /** @type {HTMLSelectElement} */ ($("#new-emp-qual")).value,
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
      Rückkehr_erwartet_am: null,
      Abwesenheit_geplant_ab: null,
      Abwesenheit_geplant_bis: null,
    });
    syncLegacyAbsenceFields(newEmp);
    recordUndoSnapshot();
    state.employees.push(newEmp);
    await persist();
    /** @type {HTMLFormElement} */ ($("#new-employee-form")).reset();
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
    recordUndoSnapshot();
    state.team_leaders.push({
      ID: nextId(state.team_leaders),
      Name: name,
      Team_Farbe: sanitizeTeamColor(colorIn),
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

let dashboardDnDActiveZone = null;

function setupDashboardDnD() {
  const view = /** @type {HTMLElement | null} */ ($("#view-dashboard"));
  if (!view || view.dataset.dashboardDnd === "1") return;
  view.dataset.dashboardDnd = "1";

  view.addEventListener("dragstart", (ev) => {
    const path = ev.composedPath();
    let row = /** @type {HTMLElement | null} */ (null);
    for (const n of path) {
      if (n instanceof Element && n.hasAttribute("data-dashboard-employee")) {
        row = /** @type {HTMLElement} */ (n);
        break;
      }
    }
    if (!row) return;
    const id = row.getAttribute("data-dashboard-employee");
    if (!id) return;
    row.classList.add("dashboard-emp-dragging");
    ev.dataTransfer.setData("text/plain", id);
    ev.dataTransfer.setData("application/x-employee-id", id);
    ev.dataTransfer.effectAllowed = "move";
  });

  view.addEventListener("dragend", () => {
    view.querySelectorAll(".dashboard-emp-dragging").forEach((el) => el.classList.remove("dashboard-emp-dragging"));
  });

  view.addEventListener("dragenter", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const zone = /** @type {HTMLElement | null} */ (
      el?.closest("[data-drop-teamleader], [data-drop-unassigned]")
    );
    if (!zone) return;
    ev.preventDefault();
  });

  view.addEventListener("dragover", (ev) => {
    const el = ev.target instanceof Element ? ev.target : null;
    const zone = /** @type {HTMLElement | null} */ (
      el?.closest("[data-drop-teamleader], [data-drop-unassigned]")
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
      el?.closest("[data-drop-teamleader], [data-drop-unassigned]")
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
    const zone = /** @type {HTMLElement | null} */ (
      el?.closest("[data-drop-teamleader], [data-drop-unassigned]")
    );
    if (!zone || !state) return;
    ev.preventDefault();
    zone.classList.remove("team-drop-zone--active");
    dashboardDnDActiveZone = null;
    const empId =
      ev.dataTransfer.getData("text/plain") || ev.dataTransfer.getData("application/x-employee-id");
    if (!empId) return;
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
  });
}

function boot() {
  closeAllModalsAndBackdrops();
  state = null;
  clearUndoHistory();
  setupNavigation();
  setupDashboardDnD();
  setupProjectsInteractions();
  setupPersonnelInteractions();
  setupPersonnelTableActions();
  setupQuickReturnDateButtons();
  setupDndAssignModal();
  setupProjectDropDelegation();
  setupFileLinking();
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
