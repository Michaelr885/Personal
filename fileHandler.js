/**
 * Lokale Persistenz über die File System Access API (Chrome/Edge, localhost/https).
 * Hält ein FileSystemFileHandle im Speicher und schreibt `daten.json` bei Bedarf vollständig neu.
 */

/** @type {FileSystemFileHandle | null} */
let dataFileHandle = null;

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function createMockDataset() {
  const t = todayISO();
  return {
    team_leaders: [
      { ID: 1, Name: "Anna Schmidt", Team_Farbe: "#2563eb", Abteilung: "Mechanik", Reihenfolge: 0 },
      { ID: 2, Name: "Markus Weber", Team_Farbe: "#059669", Abteilung: "Steriltechnik", Reihenfolge: 1 },
      { ID: 3, Name: "Laura Chen", Team_Farbe: "#d97706", Abteilung: "Rohrfertigung", Reihenfolge: 2 },
    ],
    employees: [
      {
        ID: 101,
        Personalnummer: "P-24001",
        Vorname: "Tom",
        Nachname: "Bauer",
        Qualifikation: "Monteur",
        Zusatz_Tags: ["Höhenarbeit", "Kran"],
        Teamleiter_ID: 1,
        Beschäftigung: "Eigene",
        Stufe: "2",
        Abteilung: "Mechanik",
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
        Krank_ab: null,
        Krank_bis: null,
        Urlaub_ab: addDays(t, 2),
        Urlaub_bis: addDays(t, 6),
        Urlaub_perioden: [{ von: addDays(t, 20), bis: addDays(t, 24) }],
        Abwesenheit_geplant_ab: addDays(t, 2),
        Abwesenheit_geplant_bis: addDays(t, 6),
      },
      {
        ID: 102,
        Personalnummer: "P-24002",
        Vorname: "Sina",
        Nachname: "Keller",
        Qualifikation: "Schweißer",
        Zusatz_Tags: ["MAG", "WIG"],
        Teamleiter_ID: 1,
        Beschäftigung: "AÜG",
        Stufe: "1",
        Abteilung: "Steriltechnik",
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
        Krank_ab: null,
        Krank_bis: null,
        Urlaub_ab: null,
        Urlaub_bis: null,
        Abwesenheit_geplant_ab: null,
        Abwesenheit_geplant_bis: null,
      },
      {
        ID: 103,
        Personalnummer: "P-24003",
        Vorname: "Jonas",
        Nachname: "Meier",
        Qualifikation: "Monteur",
        Zusatz_Tags: ["Schalung"],
        Teamleiter_ID: 2,
        Beschäftigung: "Eigene",
        Stufe: "3",
        Abteilung: "Kunststofftechnik und Gewerbe",
        Status: "Krank",
        Krank_ab: addDays(t, -2),
        Krank_bis: addDays(t, 2),
        Urlaub_ab: null,
        Urlaub_bis: null,
        Rückkehr_erwartet_am: addDays(t, 3),
        Abwesenheit_geplant_ab: null,
        Abwesenheit_geplant_bis: null,
      },
      {
        ID: 104,
        Personalnummer: "P-24004",
        Vorname: "Elena",
        Nachname: "Fischer",
        Qualifikation: "Bauleiter",
        Zusatz_Tags: ["SiGeKo"],
        Teamleiter_ID: 2,
        Beschäftigung: "AÜG",
        Stufe: "Bau",
        Abteilung: "Rohrfertigung",
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
        Krank_ab: null,
        Krank_bis: null,
        Urlaub_ab: addDays(t, 4),
        Urlaub_bis: addDays(t, 12),
        Abwesenheit_geplant_ab: addDays(t, 4),
        Abwesenheit_geplant_bis: addDays(t, 12),
      },
      {
        ID: 105,
        Personalnummer: "P-24005",
        Vorname: "Omar",
        Nachname: "Haddad",
        Qualifikation: "Schweißer",
        Zusatz_Tags: ["Stahl"],
        Teamleiter_ID: 2,
        Beschäftigung: "Eigene",
        Stufe: "2",
        Abteilung: "Mechanik",
        Status: "Urlaub",
        Krank_ab: null,
        Krank_bis: null,
        Urlaub_ab: addDays(t, 1),
        Urlaub_bis: addDays(t, 7),
        Rückkehr_erwartet_am: addDays(t, 8),
        Abwesenheit_geplant_ab: null,
        Abwesenheit_geplant_bis: null,
      },
      {
        ID: 106,
        Personalnummer: "P-24006",
        Vorname: "Petra",
        Nachname: "Wolf",
        Qualifikation: "Monteur",
        Zusatz_Tags: ["Führerschein CE"],
        Teamleiter_ID: 3,
        Beschäftigung: "AÜG",
        Stufe: "1",
        Abteilung: "Steriltechnik",
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
        Krank_ab: null,
        Krank_bis: null,
        Urlaub_ab: null,
        Urlaub_bis: null,
        Abwesenheit_geplant_ab: null,
        Abwesenheit_geplant_bis: null,
      },
      {
        ID: 107,
        Personalnummer: "P-24007",
        Vorname: "Lukas",
        Nachname: "Arnold",
        Qualifikation: "Elektriker",
        Zusatz_Tags: ["MSR"],
        Teamleiter_ID: 3,
        Beschäftigung: "Eigene",
        Stufe: "ET",
        Abteilung: "Rohrfertigung",
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
        Krank_ab: null,
        Krank_bis: null,
        Urlaub_ab: addDays(t, 1),
        Urlaub_bis: addDays(t, 10),
        Abwesenheit_geplant_ab: addDays(t, 1),
        Abwesenheit_geplant_bis: addDays(t, 10),
      },
      {
        ID: 108,
        Personalnummer: "P-24008",
        Vorname: "Mira",
        Nachname: "Novak",
        Qualifikation: "Monteur",
        Zusatz_Tags: [],
        Teamleiter_ID: 3,
        Beschäftigung: "Eigene",
        Stufe: "",
        Abteilung: "Kunststofftechnik und Gewerbe",
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
        Krank_ab: null,
        Krank_bis: null,
        Urlaub_ab: null,
        Urlaub_bis: null,
        Abwesenheit_geplant_ab: null,
        Abwesenheit_geplant_bis: null,
      },
    ],
    projects: [
      {
        ID: 1,
        Name: "Brückensanierung A7",
        Startdatum: addDays(t, -20),
        Enddatum: addDays(t, 40),
        Benötigte_Qualifikationen: { Monteur: 3, Schweißer: 1, Bauleiter: 1 },
        leiterId: "2",
      },
      {
        ID: 2,
        Name: "Industriehalle Neubau",
        Startdatum: addDays(t, -5),
        Enddatum: addDays(t, 70),
        Benötigte_Qualifikationen: { Monteur: 4, Elektriker: 2, Bauleiter: 1 },
        leiterId: "1",
      },
      {
        ID: 3,
        Name: "Leitungsbau Phase 2",
        Startdatum: addDays(t, 10),
        Enddatum: addDays(t, 55),
        Benötigte_Qualifikationen: { Monteur: 2, Schweißer: 2 },
        leiterId: "",
      },
    ],
    qualifications: ["Monteur", "Schweißer", "Bauleiter", "Elektriker", "Lagerist"],
    dashboard_abteilung_reihenfolge: [
      "Mechanik",
      "Steriltechnik",
      "Kunststofftechnik und Gewerbe",
      "Rohrfertigung",
    ],
    assignments: [
      {
        ID: 1,
        Project_ID: 1,
        Employee_ID: 101,
        Startdatum: addDays(t, -15),
        Enddatum: addDays(t, 10),
      },
      {
        ID: 2,
        Project_ID: 1,
        Employee_ID: 102,
        Startdatum: addDays(t, -10),
        Enddatum: addDays(t, 5),
      },
      {
        ID: 3,
        Project_ID: 2,
        Employee_ID: 104,
        Startdatum: addDays(t, -3),
        Enddatum: addDays(t, 30),
      },
      {
        ID: 4,
        Project_ID: 2,
        Employee_ID: 106,
        Startdatum: addDays(t, 0),
        Enddatum: addDays(t, 25),
      },
      {
        ID: 5,
        Project_ID: 2,
        Employee_ID: 107,
        Startdatum: addDays(t, 2),
        Enddatum: addDays(t, 40),
      },
    ],
  };
}

/**
 * @param {unknown} raw
 * @returns {{ team_leaders:any[], employees:any[], projects:any[], assignments:any[], qualifications:string[], dashboard_abteilung_reihenfolge:string[] } | null}
 */
function normalizeDataset(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const team_leaders = Array.isArray(o.team_leaders) ? o.team_leaders : [];
  const employees = Array.isArray(o.employees) ? o.employees : [];
  const projects = Array.isArray(o.projects) ? o.projects : [];
  const assignments = Array.isArray(o.assignments) ? o.assignments : [];
  /** @type {string[]} */
  let qualifications = [];
  if (Array.isArray(o.qualifications)) {
    qualifications = o.qualifications
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
  }
  /** @type {string[]} */
  let dashboard_abteilung_reihenfolge = [];
  if (Array.isArray(o.dashboard_abteilung_reihenfolge)) {
    dashboard_abteilung_reihenfolge = o.dashboard_abteilung_reihenfolge
      .map((x) => String(x ?? "").trim())
      .filter(Boolean);
  }
  const empty =
    team_leaders.length === 0 &&
    employees.length === 0 &&
    projects.length === 0 &&
    assignments.length === 0;
  if (empty) return null;
  for (const row of employees) {
    if (!row || typeof row !== "object") continue;
    const e = /** @type {Record<string, unknown>} */ (row);
    delete e.Zertifikat_Gültig_Bis;
    if (e.Rückkehr_erwartet_am === undefined) e.Rückkehr_erwartet_am = null;
    if (e.Abwesenheit_geplant_ab === undefined) e.Abwesenheit_geplant_ab = null;
    if (e.Abwesenheit_geplant_bis === undefined) e.Abwesenheit_geplant_bis = null;
    if (e.Krank_ab === undefined) e.Krank_ab = null;
    if (e.Krank_bis === undefined) e.Krank_bis = null;
    if (e.Urlaub_ab === undefined) e.Urlaub_ab = null;
    if (e.Urlaub_bis === undefined) e.Urlaub_bis = null;
    if (e.Urlaub_halber_Tag === undefined) e.Urlaub_halber_Tag = false;
    if (e.Urlaub_perioden === undefined || !Array.isArray(e.Urlaub_perioden)) e.Urlaub_perioden = [];
    if (e.Abteilung === undefined || e.Abteilung === null || String(e.Abteilung).trim() === "") {
      e.Abteilung = "Mechanik";
    } else {
      e.Abteilung = String(e.Abteilung).trim();
    }

    const bRaw = e.Beschäftigung;
    if (bRaw === undefined || bRaw === null || bRaw === "") {
      e.Beschäftigung = "Eigene";
    } else {
      const b = String(bRaw).trim();
      e.Beschäftigung = b === "AÜG" ? "AÜG" : "Eigene";
    }
    if (e.Stufe === undefined || e.Stufe === null) e.Stufe = "";
    else e.Stufe = String(e.Stufe).trim();

    const legacyAb = e.Abwesenheit_geplant_ab;
    const urlaubAbEmpty = e.Urlaub_ab == null || e.Urlaub_ab === "";
    if (legacyAb != null && legacyAb !== "" && urlaubAbEmpty) {
      e.Urlaub_ab = legacyAb;
      e.Urlaub_bis = e.Abwesenheit_geplant_bis ?? null;
    }

    const rück = e.Rückkehr_erwartet_am;
    if (e.Status === "Krank" && rück != null && rück !== "" && (e.Krank_bis == null || e.Krank_bis === "")) {
      e.Krank_bis = addDays(String(rück), -1);
    }
    if (e.Status === "Urlaub" && rück != null && rück !== "" && (e.Urlaub_bis == null || e.Urlaub_bis === "")) {
      e.Urlaub_bis = addDays(String(rück), -1);
    }
  }

  const ABTL = ["Mechanik", "Steriltechnik", "Kunststofftechnik und Gewerbe", "Rohrfertigung"];
  const normTLAbt = (raw) => {
    const s = String(raw ?? "").trim();
    return ABTL.includes(s) ? s : ABTL[0];
  };
  for (let i = 0; i < team_leaders.length; i++) {
    const row = team_leaders[i];
    if (!row || typeof row !== "object") continue;
    const t = /** @type {Record<string, unknown>} */ (row);
    t.Abteilung = normTLAbt(t.Abteilung);
    const ro = Number(t.Reihenfolge);
    t.Reihenfolge = Number.isFinite(ro) ? ro : i * 10;
  }
  team_leaders.sort(
    (a, b) =>
      (Number(/** @type {{ Reihenfolge?: number }} */ (a).Reihenfolge) || 0) -
        (Number(/** @type {{ Reihenfolge?: number }} */ (b).Reihenfolge) || 0) ||
      (Number(/** @type {{ ID?: number }} */ (a).ID) || 0) - (Number(/** @type {{ ID?: number }} */ (b).ID) || 0)
  );
  team_leaders.forEach((row, i) => {
    if (row && typeof row === "object") /** @type {{ Reihenfolge: number }} */ (row).Reihenfolge = i;
  });

  for (const row of projects) {
    if (!row || typeof row !== "object") continue;
    const p = /** @type {Record<string, unknown>} */ (row);
    if (p.leiterId === undefined || p.leiterId === null) p.leiterId = "";
    else p.leiterId = String(p.leiterId).trim();
  }

  return { team_leaders, employees, projects, assignments, qualifications, dashboard_abteilung_reihenfolge };
}

export function isFileSystemAccessSupported() {
  return typeof window !== "undefined" && "showOpenFilePicker" in window;
}

export function hasLinkedDataFile() {
  return !!dataFileHandle;
}

export function getLinkedFileName() {
  return dataFileHandle?.name ?? "";
}

/**
 * Öffnet eine lokale `daten.json`, hält das Handle und liefert die Datenstruktur.
 * Leere/neue oder ungültige Dateien werden mit Mock-Daten gefüllt und sofort gespeichert.
 */
export async function linkLocalDataFile() {
  if (!isFileSystemAccessSupported()) {
    throw new Error(
      "Die File System Access API wird in diesem Browser nicht unterstützt. Bitte Chrome oder Edge nutzen (idealerweise über http://localhost)."
    );
  }

  const [handle] = await window.showOpenFilePicker({
    types: [
      {
        description: "Planungsdaten (daten.json)",
        accept: { "application/json": [".json"] },
      },
    ],
    excludeAcceptAllOption: false,
    multiple: false,
  });

  dataFileHandle = handle;
  const file = await handle.getFile();
  const text = await file.text();

  if (!text.trim()) {
    const fresh = createMockDataset();
    await saveDataToFile(fresh);
    return fresh;
  }

  try {
    const parsed = JSON.parse(text);
    const normalized = normalizeDataset(parsed);
    if (!normalized) {
      const fresh = createMockDataset();
      await saveDataToFile(fresh);
      return fresh;
    }
    return normalized;
  } catch {
    const fresh = createMockDataset();
    await saveDataToFile(fresh);
    return fresh;
  }
}

/**
 * Überschreibt die verknüpfte Datei vollständig (Auto-Save).
 * @param {{ team_leaders:any[], employees:any[], projects:any[], assignments:any[], qualifications?:string[], dashboard_abteilung_reihenfolge?:string[] }} data
 */
export async function saveDataToFile(data) {
  if (!dataFileHandle) {
    throw new Error("Keine Datei verknüpft. Bitte zuerst „Datei laden / verknüpfen“ verwenden.");
  }
  const writable = await dataFileHandle.createWritable();
  try {
    await writable.write(JSON.stringify(data, null, 2));
  } finally {
    await writable.close();
  }
}
