# Skripte (Entwicklung)

| Datei | Zweck |
|--------|--------|
| `verify-modules.mjs` | Prüft, ob alle `.js`-Module ohne Fehler importiert werden können (`node scripts/verify-modules.mjs`). |
| `build-modules.mjs` | Baut View-Dateien aus `app.monolith.js` neu (nur bei großen Umbauten). |
| `split-app.mjs` | Hilfsskript beim ersten Aufteilen der Monolith-Datei. |

Für die normale Nutzung der Planungs-App sind diese Skripte **nicht** nötig.
