/**
 * Turns the vitest JSON run into a QA report: pass/fail per test case, the RCA
 * for each failure, and the dependency inventory from the manifest.
 *
 *   npm run test:report      -> runs the suite and writes reports/
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { ACTION_DEPS, CALL_DEPS, COLUMN_DEPS, SHEET_DEPS } from "../tests/deps/manifest";
import snapshot from "../tests/deps/scispot-snapshot.json";
import { writeHtml } from "./html-report";

type Assertion = { title: string; status: string; failureMessages?: string[]; duration?: number };
type FileResult = { name: string; assertionResults: Assertion[] };
type Run = { numTotalTests: number; numPassedTests: number; numFailedTests: number; testResults: FileResult[] };

const AREAS: Array<[prefix: string, area: string]> = [
  ["LOGIC-0", "Quantity maths"],
  ["LOGIC-04", "Field reading"],
  ["LOGIC-05", "Field reading"],
  ["LOGIC-06", "Field reading"],
  ["LOGIC-07", "Row parsing"],
  ["PAGE-", "Paging"],
  ["CONTRACT-", "Search & resolve (API)"],
  ["CHAIN-", "Custody graph (API)"],
  ["SCHEMA-", "Schema check (API)"],
  ["UUID-", "Labsheet lookup (API)"],
  ["BOOT-", "Boot parameters"],
  ["CONN-", "Connection (API)"],
  ["GUARD-", "Dependency guard"],
];

function areaOf(id: string, file: string): string {
  if (file.includes("quantity.test.ts")) return "Pre-existing tests";
  const hit = [...AREAS].reverse().find(([prefix]) => id.startsWith(prefix));
  return hit ? hit[1] : "Other";
}

type Case = { id: string; what: string; rca: string; status: "PASS" | "FAIL"; area: string; detail: string; file: string };

function parse(run: Run): Case[] {
  const cases: Case[] = [];
  for (const file of run.testResults) {
    for (const a of file.assertionResults) {
      const [head, ...rcaParts] = a.title.split("||");
      const [id, ...whatParts] = (head ?? "").split("|");
      const assertionRca = (a.failureMessages ?? []).join("\n").match(/RCA:([^:]*?:)?([\s\S]*?)(?:\n|: expected)/);
      cases.push({
        id: (id ?? "").trim() || "(unnamed)",
        what: whatParts.join("|").trim() || (head ?? "").trim(),
        rca: rcaParts.join("||").replace(/^\s*RCA:\s*/, "").trim() || (assertionRca ? assertionRca[0].replace(/^RCA:\s*/, "").replace(/: expected$/, "").trim() : ""),
        status: a.status === "passed" ? "PASS" : "FAIL",
        area: areaOf((id ?? "").trim(), file.name),
        detail: (a.failureMessages ?? []).join("\n").split("\n").slice(0, 6).join("\n"),
        file: file.name,
      });
    }
  }
  return cases.sort((x, y) => x.id.localeCompare(y.id, undefined, { numeric: true }));
}

/** Folds the Playwright run in, when reports/playwright.json is present. */
type PwSpec = { title: string; file: string; tests?: Array<{ results?: Array<{ status?: string; errors?: Array<{ message?: string }> }> }> };
type PwSuite = { file?: string; specs?: PwSpec[]; suites?: PwSuite[] };

const BROWSER_AREAS: Record<string, string> = {
  "connect.spec.ts": "Browser: connection",
  "search.spec.ts": "Browser: search",
  "graph.spec.ts": "Browser: custody graph",
  "node-sheet.spec.ts": "Browser: detail sheet",
};

function readPlaywright(path = "reports/playwright.json"): Case[] {
  if (!existsSync(path)) return [];
  const report = JSON.parse(readFileSync(path, "utf8")) as { suites?: PwSuite[] };
  const specs: PwSpec[] = [];
  const walk = (node: PwSuite) => {
    for (const spec of node.specs ?? []) specs.push(spec);
    for (const child of node.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);

  return specs.map((spec) => {
    const [head, ...rcaParts] = spec.title.split("||");
    const [id, ...whatParts] = (head ?? "").split("|");
    const result = spec.tests?.[spec.tests.length - 1]?.results ?? [];
    const last = result[result.length - 1];
    const errors = (last?.errors ?? []).map((e) => e.message ?? "").join("\n");
    return {
      id: (id ?? "").trim() || "(unnamed)",
      what: whatParts.join("|").trim(),
      rca: rcaParts.join("||").replace(/^\s*RCA:\s*/, "").trim(),
      status: last?.status === "passed" ? "PASS" : "FAIL",
      area: BROWSER_AREAS[spec.file] ?? "Browser",
      detail: errors.replace(/\u001b\[[0-9;]*m/g, "").split("\n").slice(0, 8).join("\n"),
      file: `e2e/${spec.file}`,
    } satisfies Case;
  });
}

const run: Run = JSON.parse(readFileSync(process.argv[2] ?? "reports/vitest.json", "utf8"));
const browser = readPlaywright();
const cases = [...parse(run), ...browser];
const failed = cases.filter((c) => c.status === "FAIL");
const total = cases.length;
const passed = cases.filter((c) => c.status === "PASS").length;
const byArea = new Map<string, Case[]>();
for (const c of cases) byArea.set(c.area, [...(byArea.get(c.area) ?? []), c]);

const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s.padEnd(n));
const esc = (s: string) => s.replace(/\|/g, "\\|");

// ---------- terminal ----------
const line = "─".repeat(78);
console.log(`\n${line}\nCHEMICAL CHAIN OF CUSTODY — TEST REPORT`);
console.log(`app d3340961-d93b-47b8-83ec-3c73032c01e1 · schema snapshot ${snapshot.capturedAt} (${snapshot.environment})`);
console.log(`${line}`);
console.log(`\nTotal ${total}   PASS ${passed}   FAIL ${failed.length}   (browser cases: ${browser.length})\n`);
console.log(`${pad("AREA", 26)}${pad("PASS", 7)}${pad("FAIL", 7)}`);
for (const [area, list] of [...byArea].sort()) {
  const f = list.filter((c) => c.status === "FAIL").length;
  console.log(`${pad(area, 26)}${pad(String(list.length - f), 7)}${pad(String(f), 7)}${f ? "←" : ""}`);
}
if (failed.length) {
  console.log(`\n${line}\nFAILURES — ROOT CAUSE\n${line}`);
  failed.forEach((c, i) => {
    console.log(`\n${i + 1}. [${c.id}] ${c.what}`);
    console.log(`   RCA: ${c.rca || "(see assertion output)"}`);
  });
}
console.log(`\n${line}\nDEPENDENCIES GUARDED`);
console.log(`  labsheets ${SHEET_DEPS.length}   columns ${COLUMN_DEPS.length}   SDK calls ${CALL_DEPS.length}   user actions ${ACTION_DEPS.length}`);
console.log(`${line}\n`);

// ---------- markdown ----------
const md: string[] = [];
md.push(`# Chemical Chain of Custody — Test Report`);
md.push(``);
md.push(`**App** \`d3340961-d93b-47b8-83ec-3c73032c01e1\` · **Scispot schema snapshot** ${snapshot.capturedAt} (${snapshot.environment}) · **Generated** ${new Date().toISOString().slice(0, 10)}`);
md.push(``);
md.push(`| | |`);
md.push(`|---|---|`);
md.push(`| Test cases | **${total}** |`);
md.push(`| Passed | **${passed}** |`);
md.push(`| Failed | **${failed.length}** |`);
md.push(`| Dependencies guarded | ${SHEET_DEPS.length} labsheets · ${COLUMN_DEPS.length} columns · ${CALL_DEPS.length} SDK calls · ${ACTION_DEPS.length} user actions |`);
md.push(``);
md.push(`## Results by area`);
md.push(``);
md.push(`| Area | Cases | Pass | Fail |`);
md.push(`|---|--:|--:|--:|`);
for (const [area, list] of [...byArea].sort()) {
  const f = list.filter((c) => c.status === "FAIL").length;
  md.push(`| ${area} | ${list.length} | ${list.length - f} | ${f || ""} |`);
}
md.push(``);
if (failed.length) {
  md.push(`## Failures and root cause`);
  md.push(``);
  failed.forEach((c, i) => {
    md.push(`### ${i + 1}. ${c.id} — ${c.what}`);
    md.push(``);
    md.push(`**Root cause.** ${c.rca || "See assertion output below."}`);
    md.push(``);
    md.push("```");
    md.push(c.detail);
    md.push("```");
    md.push(``);
  });
}
md.push(`## Every test case`);
md.push(``);
md.push(`| ID | Status | What it checks |`);
md.push(`|---|---|---|`);
for (const c of cases) md.push(`| ${c.id} | ${c.status === "PASS" ? "PASS" : "**FAIL**"} | ${esc(c.what)} |`);
md.push(``);
md.push(`## Dependency inventory`);
md.push(``);
md.push(`### Labsheets`);
md.push(``);
md.push(`| ID | Labsheet | Access | Severity | Role |`);
md.push(`|---|---|---|---|---|`);
for (const d of SHEET_DEPS) md.push(`| ${d.id} | \`${d.sheet}\` | ${d.access} | ${d.severity} | ${esc(d.role)} |`);
md.push(``);
md.push(`### Columns`);
md.push(``);
md.push(`| ID | Labsheet | Column | Type | Severity | Used for |`);
md.push(`|---|---|---|---|---|---|`);
for (const d of COLUMN_DEPS) {
  md.push(`| ${d.id} | \`${d.sheet}\` | ${d.column ? `\`${d.column}\`` : "_(not mapped)_"} | ${d.expectedType || "—"} | ${d.severity} | ${esc(d.usedFor)} |`);
}
md.push(``);
md.push(`### SDK calls`);
md.push(``);
md.push(`| ID | Call | Severity | Triggered by |`);
md.push(`|---|---|---|---|`);
for (const d of CALL_DEPS) md.push(`| ${d.id} | \`${esc(d.call)}\` | ${d.severity} | ${esc(d.triggeredBy)} |`);
md.push(``);
md.push(`### User actions`);
md.push(``);
md.push(`| ID | Action | Severity | Depends on |`);
md.push(`|---|---|---|---|`);
for (const d of ACTION_DEPS) md.push(`| ${d.id} | ${esc(d.action)} | ${d.severity} | ${d.dependsOn.join(", ")} |`);
md.push(``);

mkdirSync("reports", { recursive: true });
writeFileSync("reports/test-report.md", md.join("\n"));
writeFileSync("reports/test-cases.csv", ["ID,Area,Status,What it checks,Root cause", ...cases.map((c) => [c.id, c.area, c.status, c.what, c.rca].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))].join("\n"));
writeHtml(cases, {
  total,
  passed,
  failed: failed.length,
  capturedAt: snapshot.capturedAt,
  environment: snapshot.environment,
  appId: "d3340961-d93b-47b8-83ec-3c73032c01e1",
});
console.log(`Wrote reports/test-report.html, reports/test-report.md and reports/test-cases.csv`);
if (failed.length > 0) process.exitCode = 1;
