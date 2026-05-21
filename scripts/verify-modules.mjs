/**
 * Prüft, ob alle ES-Module ohne Syntaxfehler laden (ohne Browser-DOM).
 * Erwartet: ReferenceError zu document/$ ist OK — zeigt, dass die Import-Kette bis zur Ausführung kommt.
 */
import { pathToFileURL } from "url";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const modules = [
  "utils.js",
  "holidays.js",
  "state.js",
  "employees.js",
  "dashboardView.js",
  "ganttView.js",
  "personnelView.js",
  "urlaubView.js",
  "app.js",
];

const results = [];
for (const file of modules) {
  const url = pathToFileURL(path.join(root, file)).href;
  try {
    await import(url);
    results.push({ file, ok: true, err: null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const domOk =
      /document is not defined|window is not defined|\$ is not a function|Cannot read properties of undefined \(reading 'querySelector'\)/i.test(
        msg
      ) ||
      /HTMLElement|localStorage|Frappe|Gantt/i.test(msg);
    results.push({ file, ok: domOk, err: msg });
  }
}

let failed = 0;
for (const r of results) {
  if (r.ok) {
    console.log(`OK (import chain): ${r.file}`);
  } else {
    console.error(`FAIL: ${r.file}: ${r.err}`);
    failed++;
  }
}
process.exit(failed > 0 ? 1 : 0);
