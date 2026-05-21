# Personal- & Projektplanung

Web-App zur Planung von Mitarbeitenden, Teams, Projekten und Urlaub. Läuft **ohne Build-Schritt** direkt im Browser (native ES-Module).

## Schnellstart (für Einsteiger)

1. Ordner lokal öffnen (z. B. mit **VS Code** oder Cursor).
2. Einen lokalen Webserver starten, z. B. `python3 -m http.server 8080` im Projektordner.
3. Im Browser **Chrome** oder **Edge** aufrufen: `http://localhost:8080`
4. Auf **„Datei verknüpfen“** klicken und `daten.json` auswählen — ab dann werden Änderungen in diese Datei gespeichert.

> Ohne localhost/HTTPS funktioniert das Speichern in eine Datei oft nicht (Browser-Sicherheit).

---

## Welche Datei wofür? (Übersicht)

| Datei | Wofür? | Bearbeiten als Anfänger? |
|--------|--------|---------------------------|
| **index.html** | Seitenaufbau: Menü, Tabs, Formulare, Modale (nur Struktur, kaum Logik) | Selten — eher Layout/Text |
| **app.js** | **Start der App**: lädt alle Module, Navigation zwischen Tabs, `boot()` | Ja — Einstieg verstehen |
| **state.js** | **Zentrale Daten** aller Mitarbeitenden/Projekte + Undo/Redo, Planungsmodus, Speichern, Bestätigungs-Dialoge | Bei globalen Features |
| **employees.js** | **Fachlogik Personen**: Urlaub, Krank, Qualifikationen, Teamleiter, Zuweisungs-Konflikte (ohne große Bildschirme) | Häufig bei Regeln/Berechnungen |
| **utils.js** | **Kleine Helfer**: Datum formatieren, HTML escapen, DOM `$()` — keine Geschäftslogik | Selten |
| **holidays.js** | **Feiertage & Arbeitstage** nach Bundesland (Urlaubszähler, „nächster Feiertag“) | Bei Kalender/Feiertagen |
| **dashboardView.js** | Tab **Dashboard**: Teamkarten, Drag & Drop, Abwesenheit melden, CSV-Export | Bei Dashboard-UI/Interaktion |
| **ganttView.js** | Tab **Zeitleiste**: Gantt-Chart, Projekte, Pool, Zuweisungen | Bei Projekten/Zeitleiste |
| **personnelView.js** | Tab **Personalverwaltung**: Tabelle, Formulare, Qualifikationen, Teamleiter | Bei Stammdaten-Formularen |
| **urlaubView.js** | Tab **Urlaub**: Monatsraster, Jahresübersicht, Urlaub eintragen/bearbeiten | Bei Urlaubs-Ansicht |
| **fileHandler.js** | **Datei am PC**: `daten.json` öffnen und speichern (File System Access API) | Bei Speicher-Themen |
| **styles.css** | **Aussehen**: Farben, Abstände, Dark Mode, Layout | Ja — für Design |
| **daten.json** | **Deine Daten** (Mitarbeitende, Projekte, …) — wird von der App gelesen/geschrieben | Nur über die App pflegen, nicht von Hand editieren |
| **app.monolith.js** | **Backup** der alten einzelnen `app.js` vor der Aufteilung — nur Referenz | **Nicht** für den Alltag nutzen |
| **scripts/** | Hilfsskripte für Entwickler (`verify-modules.mjs` prüft Imports) | Nur wenn du am Projekt mitentwickelst |

---

## Wie hängt das zusammen?

```
index.html
    └── lädt app.js (type="module")
            ├── state.js          ← alle Daten + Undo + Speichern
            ├── utils.js, holidays.js, employees.js
            ├── dashboardView.js  ← Tab Dashboard
            ├── ganttView.js      ← Tab Zeitleiste
            ├── personnelView.js  ← Tab Personalverwaltung
            └── urlaubView.js     ← Tab Urlaub
            └── fileHandler.js    (über state.js / app.js)
```

**Merksatz:** In **Views** (`*View.js`) wird der Bildschirm gebaut und Klicks verarbeitet. In **employees.js** stehen Regeln zu Personen/Urlaub. In **state.js** liegt, *was* gespeichert wird.

---

## Die vier Tabs in der App

| Tab in der App | Modul |
|----------------|--------|
| Dashboard | `dashboardView.js` |
| Zeitleiste | `ganttView.js` |
| Personalverwaltung | `personnelView.js` |
| Urlaub | `urlaubView.js` |

---

## Typische Fragen

**Wo ändere ich Texte im UI?**  
Meist in `index.html` (statische Texte) oder in den `render*`-Funktionen der jeweiligen `*View.js`.

**Wo ändere ich, wann jemand „Krank“ oder „Urlaub“ ist?**  
`employees.js` (Logik) und ggf. `personnelView.js` / `dashboardView.js` (Formulare).

**Wo ist Strg+Z / Rückgängig?**  
`state.js` (`undoLastChange`, `redoLastChange`).

**Planungsmodus (Sandkasten)?**  
`state.js` — Änderungen erst nach „Übernehmen“ in die Datei.

---

## Entwickler-Hinweis

```bash
node scripts/verify-modules.mjs   # prüft, ob alle Module laden
node --check app.js               # Syntax-Check
```

Module neu aus dem Monolith erzeugen (nur bei großen Refactorings): `node scripts/build-modules.mjs` (liest `app.monolith.js`).
