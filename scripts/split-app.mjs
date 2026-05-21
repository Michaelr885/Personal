/**
 * Einmaliges Hilfsskript: app.js in Module aufteilen (Zeilenbereiche 1-basiert).
 * Ausführen: node scripts/split-app.mjs
 */
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const lines = fs.readFileSync(path.join(root, "app.js"), "utf8").split("\n");

/** @param {number[][]} ranges */
function extract(ranges) {
  const out = [];
  for (const [start, end] of ranges) {
    for (let i = start - 1; i < end && i < lines.length; i++) out.push(lines[i]);
  }
  return out.join("\n");
}

/** @param {string} body @param {string[]} names */
function addExports(body, names) {
  let b = body;
  for (const name of names) {
    b = b.replace(new RegExp(`(^|\\n)(async )?function ${name}\\b`, "g"), "$1export $2function $3".replace("$3", name));
    b = b.replace(new RegExp(`(^|\\n)(async )?function ${name}\\b`, "g"), `$1export $2function ${name}`);
  }
  return b;
}

function exportFunctions(body) {
  return body.replace(/(^|\n)(async )?function ([a-zA-Z_$][\w$]*)\s*\(/g, "$1export $2function $3(");
}

function exportConsts(body, names) {
  let b = body;
  for (const n of names) {
    b = b.replace(new RegExp(`^const ${n}\\b`, "m"), `export const ${n}`);
    b = b.replace(new RegExp(`^let ${n}\\b`, "m"), `export let ${n}`);
  }
  return b;
}

const fileImport = `import {
  linkLocalDataFile,
  saveDataToFile,
  isFileSystemAccessSupported,
  getLinkedFileName,
} from "./fileHandler.js";\n\n`;

const utilsRanges = [
  [8, 14],
  [442, 448],
  [486, 524],
  [578, 579],
  [857, 868],
  [1030, 1051],
  [1088, 1101],
  [1177, 1195],
  [1575, 1577],
];

let utilsBody = extract(utilsRanges);
utilsBody = exportFunctions(utilsBody);
fs.writeFileSync(
  path.join(root, "utils.js"),
  `/** DOM-, Datums- und Format-Helfer (ohne App-State). */\n\n${utilsBody}\n`
);

const holidaysRanges = [[1231, 1448]];
let holidaysBody = extract(holidaysRanges);
holidaysBody = exportFunctions(holidaysBody);
holidaysBody = exportConsts(holidaysBody, ["BUNDESLAND_LIST", "STORAGE_FEIERLAND"]);
fs.writeFileSync(
  path.join(root, "holidays.js"),
  `import { pad2, parseISODate, todayISO, addCalendarDaysToISO } from "./utils.js";\n\n${holidaysBody}\n`
);

console.log("Wrote utils.js and holidays.js — run full split manually for remaining modules.");
