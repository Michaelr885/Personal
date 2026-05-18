/**
 * Persistenz und Mock-Daten für die Personal- und Projektplanung.
 * Alle Daten werden unter einem Schlüssel in localStorage gehalten.
 */

export const STORAGE_KEY = "personalProjektPlan_v1";

const today = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const addDays = (isoDate, days) => {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

function createMockDataset() {
  const t = today();
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
        Zertifikat_Gültig_Bis: addDays(t, 14),
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
        Zertifikat_Gültig_Bis: addDays(t, 120),
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
        Zertifikat_Gültig_Bis: addDays(t, 45),
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
        Zertifikat_Gültig_Bis: addDays(t, 8),
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
        Zertifikat_Gültig_Bis: addDays(t, 200),
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
        Zertifikat_Gültig_Bis: addDays(t, 25),
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
        Zertifikat_Gültig_Bis: addDays(t, 90),
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
        Zertifikat_Gültig_Bis: addDays(t, -5),
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

export function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveData(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function initStorageIfNeeded() {
  const existing = loadData();
  if (existing) return existing;
  const fresh = createMockDataset();
  saveData(fresh);
  return fresh;
}

export function nextId(list, key = "ID") {
  if (!list.length) return 1;
  return Math.max(...list.map((item) => Number(item[key]) || 0)) + 1;
}
