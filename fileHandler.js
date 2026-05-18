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
      { ID: 1, Name: "Anna Schmidt", Team_Farbe: "#2563eb" },
      { ID: 2, Name: "Markus Weber", Team_Farbe: "#059669" },
      { ID: 3, Name: "Laura Chen", Team_Farbe: "#d97706" },
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
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
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
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
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
        Status: "Krank",
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
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
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
        Status: "Urlaub",
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
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
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
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
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
        Status: "Verfügbar",
        Rückkehr_erwartet_am: null,
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
      },
      {
        ID: 2,
        Name: "Industriehalle Neubau",
        Startdatum: addDays(t, -5),
        Enddatum: addDays(t, 70),
        Benötigte_Qualifikationen: { Monteur: 4, Elektriker: 2, Bauleiter: 1 },
      },
      {
        ID: 3,
        Name: "Leitungsbau Phase 2",
        Startdatum: addDays(t, 10),
        Enddatum: addDays(t, 55),
        Benötigte_Qualifikationen: { Monteur: 2, Schweißer: 2 },
      },
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
 * @returns {{ team_leaders:any[], employees:any[], projects:any[], assignments:any[] } | null}
 */
function normalizeDataset(raw) {
  if (!raw || typeof raw !== "object") return null;
  const o = /** @type {Record<string, unknown>} */ (raw);
  const team_leaders = Array.isArray(o.team_leaders) ? o.team_leaders : [];
  const employees = Array.isArray(o.employees) ? o.employees : [];
  const projects = Array.isArray(o.projects) ? o.projects : [];
  const assignments = Array.isArray(o.assignments) ? o.assignments : [];
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
  }
  return { team_leaders, employees, projects, assignments };
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
 * @param {{ team_leaders:any[], employees:any[], projects:any[], assignments:any[] }} data
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
