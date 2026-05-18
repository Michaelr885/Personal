import { initStorageIfNeeded, saveData, nextId } from "./data.js";

/** @typedef {{ ID:number, Personalnummer:string, Vorname:string, Nachname:string, Qualifikation:string, Zusatz_Tags:string[], Teamleiter_ID:number, Status:string, Zertifikat_Gültig_Bis:string }} Employee */
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

/** @type {{ employees: Employee[], team_leaders: TeamLeader[], projects: Project[], assignments: Assignment[] }} */
let state = initStorageIfNeeded();

function persist() {
  saveData(state);
}

function $(sel, root = document) {
  return root.querySelector(sel);
}

function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

const views = {
  dashboard: $("#view-dashboard"),
  projects: $("#view-projects"),
  personnel: $("#view-personnel"),
};

const titles = {
  dashboard: {
    title: "Dashboard",
    subtitle: "Teams, Verfügbarkeit und Kennzahlen auf einen Blick.",
  },
  projects: {
    title: "Projekt-Zeitleiste & Zuweisung",
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

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function getEmployee(id) {
  return state.employees.find((e) => Number(e.ID) === Number(id));
}

function getProject(id) {
  return state.projects.find((p) => Number(p.ID) === Number(id));
}

function getTeamLeader(id) {
  return state.team_leaders.find((t) => Number(t.ID) === Number(id));
}

function employeeActiveOnProjectToday(empId) {
  const t = todayISO();
  return state.assignments.some(
    (a) =>
      Number(a.Employee_ID) === Number(empId) &&
      rangesOverlap(a.Startdatum, a.Enddatum, t, t)
  );
}

function certificateWarningDays(certDateStr) {
  const end = parseISODate(certDateStr);
  const start = parseISODate(todayISO());
  const diffMs = end - start;
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function collectAssignmentConflicts(employeeId, start, end, projectId, excludeAssignmentId) {
  const messages = [];
  const emp = getEmployee(employeeId);
  if (!emp) {
    messages.push("Mitarbeitende/r wurde nicht gefunden.");
    return messages;
  }
  if (emp.Status === "Krank" || emp.Status === "Urlaub") {
    messages.push(
      `Hinweis: Status ist „${emp.Status}“. Abwesende Personen sollen nicht in Projekten geführt werden.`
    );
  }
  for (const a of state.assignments) {
    if (excludeAssignmentId && Number(a.ID) === Number(excludeAssignmentId)) continue;
    if (Number(a.Employee_ID) !== Number(employeeId)) continue;
    if (!rangesOverlap(a.Startdatum, a.Enddatum, start, end)) continue;
    if (Number(a.Project_ID) !== Number(projectId)) {
      const other = getProject(a.Project_ID);
      messages.push(
        `Konflikt: bereits im Zeitraum in Projekt „${other ? other.Name : a.Project_ID}“ eingeteilt.`
      );
    }
  }
  return messages;
}

function openModal(title, bodyHtml, opts = {}) {
  const confirmText = opts.confirmText ?? "Trotzdem zuweisen";
  const cancelText = opts.cancelText ?? "Abbrechen";
  const variant = opts.variant ?? "confirm";

  return new Promise((resolve) => {
    const backdrop = $("#modal-backdrop");
    const modal = $("#modal");
    const cancelBtn = $("#modal-cancel");
    const confirmBtn = $("#modal-confirm");

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
  $all(".nav-btn").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.view === name);
  });
  Object.entries(views).forEach(([key, el]) => {
    const active = key === name;
    el.hidden = !active;
    el.classList.toggle("view--active", active);
  });
  const meta = titles[name];
  $("#page-title").textContent = meta.title;
  $("#page-subtitle").textContent = meta.subtitle;
  if (name === "dashboard") renderDashboard();
  if (name === "projects") renderProjectsView();
  if (name === "personnel") renderPersonnelView();
}

function renderDashboard() {
  const root = $("#dashboard-content");
  const today = todayISO();

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
          const certDays = certificateWarningDays(m.Zertifikat_Gültig_Bis);
          const certWarn =
            certDays < 30 && certDays >= 0
              ? `<span class="warn-cert" title="Zertifikat läuft bald ab"><i class="fa-solid fa-triangle-exclamation"></i> ${certDays} Tage</span>`
              : certDays < 0
                ? `<span class="warn-cert"><i class="fa-solid fa-circle-xmark"></i> abgelaufen</span>`
                : "";
          const onProject = employeeActiveOnProjectToday(m.ID);
          return `<li>
            <span>${m.Vorname} ${m.Nachname} <span class="tag-mini">${m.Qualifikation}</span></span>
            <span>${onProject ? '<span class="badge">im Projekt</span>' : '<span class="badge badge--muted">frei</span>'} ${certWarn}</span>
          </li>`;
        })
        .join("");
      return `<article class="panel card-team" style="--team-color:${tl.Team_Farbe}">
        <div class="card-team__title">
          <strong>${tl.Name}</strong>
          <span class="badge">${assignedCount} heute im Projekt</span>
        </div>
        <div class="hint">Mitarbeitende nur unter dieser Teamleitung (Stammdaten).</div>
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
            return `<li><span>${e.Vorname} ${e.Nachname}</span>${pill}</li>`;
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
    <div class="grid-dashboard">${teamCards}</div>
    <div class="panel">
      <div class="panel__head"><h2><i class="fa-solid fa-bed-pulse"></i> Abwesenheiten</h2></div>
      <p class="hint">Personen mit Status Krank oder Urlaub werden nicht als „verfügbar“ im Zuweisungs-Pool geführt.</p>
      ${absenceHtml}
    </div>
    <div class="panel">
      <div class="panel__head"><h2><i class="fa-solid fa-chart-simple"></i> Verfügbarkeit nach Qualifikation</h2></div>
      <div class="stats-grid">${statsItems || '<p class="hint">Keine verfügbaren Personen.</p>'}</div>
    </div>
  `;
}

function destroyGantt() {
  const wrap = $("#gantt-container");
  wrap.innerHTML = "";
  ganttInstance = null;
}

function renderGantt() {
  destroyGantt();
  const wrap = $("#gantt-container");
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
  ganttInstance = new GanttCtor("#gantt-anchor", tasks, {
    view_mode: "Month",
    language: "de",
    date_format: "YYYY-MM-DD",
  });
}

function uniqueQualifications() {
  const set = new Set(QUALIFICATIONS);
  state.employees.forEach((e) => set.add(e.Qualifikation));
  state.projects.forEach((p) => {
    Object.keys(p.Benötigte_Qualifikationen || {}).forEach((k) => set.add(k));
  });
  return [...set].sort();
}

function availableEmployeesForPool(filterQual) {
  return state.employees.filter((e) => {
    if (e.Status !== "Verfügbar") return false;
    if (filterQual && e.Qualifikation !== filterQual) return false;
    return true;
  });
}

function renderEmployeePool() {
  const qual = $("#filter-qualification").value;
  const list = $("#employee-pool");
  const emps = availableEmployeesForPool(qual || null);
  $("#employees-hint").textContent = `${emps.length} Person(en) im Pool (nur Status „Verfügbar“).`;
  list.innerHTML = emps
    .map(
      (e) => `<li draggable="true" data-employee-id="${e.ID}">
      <div>
        <div class="name">${e.Vorname} ${e.Nachname}</div>
        <div class="hint">${e.Qualifikation} · ${e.Personalnummer}</div>
      </div>
      <i class="fa-solid fa-grip-lines-vertical" aria-hidden="true"></i>
    </li>`
    )
    .join("");
}

function renderProjectAssignments(projectId) {
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
  const pid = $("#project-select").value;
  const panel = $("#project-detail");
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
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.delAssignment);
      state.assignments = state.assignments.filter((a) => Number(a.ID) !== id);
      persist();
      renderProjectDetail();
      renderEmployeePool();
      renderDashboard();
      renderGantt();
    });
  });
}

function fillAssignmentEmployeeSelect(projectId) {
  const sel = $("#assign-employee");
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
  const qualSelect = $("#filter-qualification");
  const quals = ["", ...uniqueQualifications()];
  qualSelect.innerHTML = quals
    .map((q) =>
      q === ""
        ? '<option value="">Alle Qualifikationen</option>'
        : `<option value="${q}">${q}</option>`
    )
    .join("");

  const projSelect = $("#project-select");
  projSelect.innerHTML = state.projects
    .map((p) => `<option value="${p.ID}">${p.Name}</option>`)
    .join("");

  if (!projSelect.value && state.projects[0]) projSelect.value = String(state.projects[0].ID);

  renderGantt();
  renderEmployeePool();
  renderProjectDetail();
  fillAssignmentEmployeeSelect(projSelect.value);

  const proj = getProject(projSelect.value);
  if (proj) {
    $("#assign-start").value = proj.Startdatum;
    $("#assign-end").value = proj.Enddatum;
  }
}

async function submitAssignment(employeeId, projectId, start, end) {
  const conflicts = collectAssignmentConflicts(employeeId, start, end, projectId, null);
  const hardOtherProject = conflicts.some((c) => c.startsWith("Konflikt:"));
  const absenceNote = conflicts.some((c) => c.startsWith("Hinweis:"));

  if (hardOtherProject || absenceNote) {
    const html = `<span>${conflicts.map((c) => `<div>${c}</div>`).join("")}</span>`;
    const ok = await openModal("Zuweisung prüfen", html, {
      confirmText: "Trotzdem zuweisen",
      confirmDanger: true,
    });
    if (!ok) return;
  }

  const newRow = {
    ID: nextId(state.assignments),
    Project_ID: Number(projectId),
    Employee_ID: Number(employeeId),
    Startdatum: start,
    Enddatum: end,
  };
  state.assignments.push(newRow);
  persist();
  renderProjectDetail();
  renderEmployeePool();
  renderDashboard();
  renderGantt();
}

function setupProjectsInteractions() {
  const qualSelect = $("#filter-qualification");
  const projSelect = $("#project-select");
  const form = $("#assignment-form");
  const rightPanel = document.querySelector(".panel--right");

  qualSelect.addEventListener("change", () => renderEmployeePool());

  projSelect.addEventListener("change", () => {
    renderProjectDetail();
    fillAssignmentEmployeeSelect(projSelect.value);
    const proj = getProject(projSelect.value);
    if (proj) {
      $("#assign-start").value = proj.Startdatum;
      $("#assign-end").value = proj.Enddatum;
    }
  });

  $("#employee-pool").addEventListener("dragstart", (ev) => {
    const li = ev.target.closest("li[draggable]");
    if (!li) return;
    ev.dataTransfer.setData("text/employee-id", li.dataset.employeeId);
    ev.dataTransfer.effectAllowed = "copy";
  });

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
    const id = ev.dataTransfer.getData("text/employee-id");
    if (!id) return;
    $("#assign-employee").value = id;
  });

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const employeeId = $("#assign-employee").value;
    const projectId = $("#project-select").value;
    const start = $("#assign-start").value;
    const end = $("#assign-end").value;
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

function renderPersonnelTable() {
  const tbody = $("#personnel-tbody");
  const q = $("#personnel-search").value.trim().toLowerCase();
  const st = $("#personnel-filter-status").value;
  const fq = $("#personnel-filter-qual").value;

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
      return `<tr>
        <td>${e.Personalnummer}</td>
        <td>${e.Vorname} ${e.Nachname}</td>
        <td>${e.Qualifikation}</td>
        <td>${tl ? tl.Name : "—"}</td>
        <td>${e.Status}</td>
        <td>${e.Zertifikat_Gültig_Bis}</td>
        <td>
          <button type="button" class="btn btn--ghost" data-edit="${e.ID}"><i class="fa-solid fa-pen"></i></button>
          <button type="button" class="btn btn--ghost" data-delete="${e.ID}"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`;
    })
    .join("");
  tbody.innerHTML =
    rows || '<tr><td colspan="7" class="hint">Keine Treffer für die aktuelle Filterung.</td></tr>';

  tbody.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => loadEmployeeIntoForm(Number(btn.dataset.edit)));
  });
  tbody.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.delete);
      const ok = await openModal(
        "Mitarbeitende/n löschen",
        "<div>Zugehörige Zuweisungen werden ebenfalls entfernt. Fortfahren?</div>",
        { confirmText: "Ja, löschen", confirmDanger: true }
      );
      if (!ok) return;
      state.employees = state.employees.filter((e) => Number(e.ID) !== id);
      state.assignments = state.assignments.filter((a) => Number(a.Employee_ID) !== id);
      persist();
      renderPersonnelView();
      renderDashboard();
      renderGantt();
    });
  });
}

function loadEmployeeIntoForm(id) {
  const e = getEmployee(id);
  if (!e) return;
  $("#emp-id").value = e.ID;
  $("#emp-pnr").value = e.Personalnummer;
  $("#emp-vorname").value = e.Vorname;
  $("#emp-nachname").value = e.Nachname;
  $("#emp-qual").value = e.Qualifikation;
  $("#emp-tags").value = (e.Zusatz_Tags || []).join(", ");
  $("#emp-tl").value = e.Teamleiter_ID;
  $("#emp-status").value = e.Status;
  $("#emp-cert").value = e.Zertifikat_Gültig_Bis;
  $("#employee-form-title").innerHTML =
    '<i class="fa-solid fa-user-pen"></i> Mitarbeitende/n bearbeiten';
}

function resetEmployeeForm() {
  $("#employee-form").reset();
  $("#emp-id").value = "";
  $("#employee-form-title").innerHTML =
    '<i class="fa-solid fa-user-plus"></i> Mitarbeitende/n anlegen';
}

function fillQualificationSelects() {
  const quals = uniqueQualifications();
  const opts = quals.map((q) => `<option value="${q}">${q}</option>`).join("");
  $("#emp-qual").innerHTML = opts;
  $("#personnel-filter-qual").innerHTML =
    `<option value="">Alle</option>` + quals.map((q) => `<option value="${q}">${q}</option>`).join("");
}

function fillTeamLeaderSelect() {
  const sel = $("#emp-tl");
  sel.innerHTML = state.team_leaders
    .map((t) => `<option value="${t.ID}">${t.Name}</option>`)
    .join("");
}

function renderPersonnelView() {
  fillQualificationSelects();
  fillTeamLeaderSelect();
  renderPersonnelTable();
}

function setupPersonnelInteractions() {
  $("#personnel-search").addEventListener("input", renderPersonnelTable);
  $("#personnel-filter-status").addEventListener("change", renderPersonnelTable);
  $("#personnel-filter-qual").addEventListener("change", renderPersonnelTable);

  $("#emp-reset").addEventListener("click", resetEmployeeForm);

  $("#employee-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const tags = $("#emp-tags")
      .value.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const payload = {
      Personalnummer: $("#emp-pnr").value.trim(),
      Vorname: $("#emp-vorname").value.trim(),
      Nachname: $("#emp-nachname").value.trim(),
      Qualifikation: $("#emp-qual").value,
      Zusatz_Tags: tags,
      Teamleiter_ID: Number($("#emp-tl").value),
      Status: $("#emp-status").value,
      Zertifikat_Gültig_Bis: $("#emp-cert").value,
    };
    const existingId = $("#emp-id").value;
    if (existingId) {
      const idx = state.employees.findIndex((e) => Number(e.ID) === Number(existingId));
      if (idx >= 0) {
        state.employees[idx] = { ...state.employees[idx], ...payload };
      }
    } else {
      state.employees.push({
        ID: nextId(state.employees),
        ...payload,
      });
    }
    persist();
    resetEmployeeForm();
    renderPersonnelView();
    renderDashboard();
    if ($("#view-projects").classList.contains("view--active")) {
      renderEmployeePool();
      renderGantt();
    }
  });
}

function setupNavigation() {
  $all(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchView(btn.dataset.view));
  });
}

function boot() {
  state = initStorageIfNeeded();
  setupNavigation();
  setupProjectsInteractions();
  setupPersonnelInteractions();
  switchView("dashboard");
}

document.addEventListener("DOMContentLoaded", boot);
