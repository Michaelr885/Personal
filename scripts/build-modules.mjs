/**
 * Generiert View-Module aus app.js (app.js bleibt als app.monolith.js gesichert).
 */
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const monolithPath = path.join(root, "app.monolith.js");
const srcPath = fs.existsSync(monolithPath) ? monolithPath : path.join(root, "app.js");
if (!fs.existsSync(path.join(root, "app.monolith.js"))) {
  fs.copyFileSync(path.join(root, "app.js"), path.join(root, "app.monolith.js"));
}
const allLines = fs.readFileSync(srcPath, "utf8").split("\n");
const bodyLines = allLines.slice(7);

/** @param {number} start @param {number} end */
function sliceOrig(start, end) {
  return bodyLines.slice(start - 8, end - 7).join("\n");
}

/** @param {string} code */
function exportAllFunctions(code) {
  return code.replace(/(^|\n)(async )?function ([A-Za-z_$][\w$]*)\s*\(/g, "$1export $2function $3(");
}

/** @param {string} code @param {string[]} names */
function exportConsts(code, names) {
  let c = code;
  for (const n of names) {
    c = c.replace(new RegExp(`^const ${n} =`, "gm"), `export const ${n} =`);
    c = c.replace(new RegExp(`^let ${n} =`, "gm"), `export let ${n} =`);
  }
  return c;
}

/** @param {string} code */
function useGetState(code) {
  let c = code;
  c = c.replace(/\bstate\s*=\s*\/\*\* @type/g, "setState(/** @type");
  c = c.replace(/\bstate\s*=\s*null\b/g, "setState(null)");
  c = c.replace(/\bstate\s*=\s*JSON\.parse/g, "setState(JSON.parse");
  c = c.replace(/\bstate\s*=\s*data\b/g, "setState(data)");
  c = c.replace(/\bif\s*\(\s*!state\b/g, "if (!getState()");
  c = c.replace(/\bif\s*\(\s*state\b/g, "if (getState()");
  c = c.replace(/\bfor\s*\(\s*const\s+(\w+)\s+of\s+state\./g, "for (const $1 of getState().");
  c = c.replace(/\bstate\.([a-zA-Z_]+)/g, "getState().$1");
  c = c.replace(/\btypeof state\b/g, "typeof getState()");
  return c;
}

const stateImports = `import {
  getState,
  setState,
  recordUndoSnapshot,
  persist,
  nextId,
  refreshAllDataViews,
  openModal,
  openAssignmentConflictModal,
  closeAllModalsAndBackdrops,
  isPlanningModeActive,
} from "./state.js";
`;

const utilsImports = `import {
  $,
  $all,
  escapeHtml,
  csvSemicolonCell,
  todayISO,
  parseISODate,
  addCalendarDaysToISO,
  formatDateDE,
  daysUntilISODate,
  rangesOverlap,
  readOptionalISODateFromInput,
  addDaysFromTodayISO,
  ensureSelectHasValue,
  dateFromGanttToProjectISO,
  inclusiveEndISOFromGanttExclusiveEnd,
  pad2,
  monthRangeISO,
  isoFromYearMonthDay,
  isSingleCalendarDayUrlaub,
  validateUrlaubPeriodOrder,
} from "./utils.js";
`;

const empImports = `import {
  empQualHue,
  normalizeAbteilung,
  normalizeAllEmployeesShape,
  ensureDashboardAbteilungReihenfolge,
  getEmployee,
  getProject,
  getTeamLeader,
  getProjectLeiterTeamLeader,
  teamLeadersSortedForDashboard,
  reorderTeamLeadersOnDashboard,
  reorderDashboardAbteilungen,
  employeeActiveOnProjectToday,
  absenceReturnBadgeHtml,
  plannedAbsenceBadgeHtml,
  absenceSummaryPlain,
  plannedAbsencePoolLine,
  absenceHintText,
  validateAssignmentForSave,
  hasValidTeamLeader,
  employeesWithoutTeamLeader,
  dashboardMemberAbsenceBlock,
  todayWithinInclusiveISO,
  isDayInAbsenceRange,
  isDayAfterClosedAbsenceRange,
  computeAutoStatusForEmployee,
  syncEmployeeStatusesFromAbsenceDates,
  runAutoStatusSyncAndPersist,
  syncEmployeesThenPersist,
  plannedWindowVisibleOnDashboard,
  employeeMatchesDashboardAbsencePanel,
  verfügbarDashboardAbsenceDisplayWindow,
  plannedVerfügbarReturnLineHtml,
  activeAbsencePeriodHtml,
  urlaubPeriodRowTemplate,
  renderUrlaubPeriodenContainer,
  collectUrlaubPeriodenFromContainer,
  refreshUrlaubPeriodRowHalbUI,
  uniqueQualifications,
  ABTEILUNGEN,
  normalizeBeschäftigung,
  fillProjectLeiterSelect,
  projectLeiterBadgeHtml,
  ganttTaskTitleForDisplay,
  teamLeaderAbbreviatedName,
} from "./employees.js";
`;

const holImports = `import {
  getFeierlandCode,
  setFeierlandCode,
  getNextHoliday,
  bundeslandHolidayNameDE,
  betrieblichFreierDezemberTagLabelDE,
  countsAsUrlaubArbeitstag,
  countUrlaubWorkdaysInInclusiveRange,
  isLandPublicHolidayISO,
  isBetrieblichFreierDezemberTagISO,
  BUNDESLAND_LIST,
} from "./holidays.js";
`;

function writeView(name, ranges, extraImports = "", extraConsts = []) {
  let code = ranges.map(([a, b]) => sliceOrig(a, b)).join("\n\n");
  code = exportAllFunctions(exportConsts(code, extraConsts));
  code = useGetState(code);
  fs.writeFileSync(
    path.join(root, `${name}.js`),
    `${stateImports}${utilsImports}${empImports}${holImports}${extraImports}\n${code}\n`
  );
}

writeView(
  "dashboardView",
  [
    [2050, 2078],
    [2428, 2729],
    [4841, 5644],
  ],
  "",
  ["DASHBOARD_ABTEILUNG_PALETTE"]
);

let ganttCode = sliceOrig(2731, 3925);
ganttCode = exportAllFunctions(ganttCode);
ganttCode = exportConsts(ganttCode, ["ganttInstance", "ganttViewMode"]);
ganttCode = useGetState(ganttCode);
fs.writeFileSync(
  path.join(root, "ganttView.js"),
  `${stateImports}${utilsImports}${empImports}${holImports}\n${ganttCode}\n`
);

writeView("personnelView", [[3927, 4788]]);

let urlaubCode =
  sliceOrig(1103, 1107) +
  "\n\n" +
  sliceOrig(1434, 2047);
urlaubCode = exportAllFunctions(exportConsts(urlaubCode, ["urlaubCalendarYM", "URLAUB_GANTT_MODAL_HINT_NEW", "URLAUB_GANTT_MODAL_HINT_EDIT"]));
urlaubCode = useGetState(urlaubCode);
fs.writeFileSync(
  path.join(root, "urlaubView.js"),
  `${stateImports}${utilsImports}${empImports}${holImports}\n${urlaubCode}\n`
);

console.log("dashboardView, ganttView, personnelView, urlaubView written");
