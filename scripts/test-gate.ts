/**
 * The commit gate. Compares the vitest run against tests/known-failures.json
 * and fails only on a failure that is NOT already a known defect — so adding a
 * feature cannot quietly break an existing one, while the eight red tests that
 * document real unfixed bugs stay red without blocking every commit.
 *
 *   npm run test:gate        -> runs the suite and checks it against the baseline
 *
 * Run by .husky/pre-commit and .husky/pre-push.
 */
import { readFileSync } from "node:fs";

type Assertion = { title: string; status: string; failureMessages?: string[] };
type FileResult = { name: string; status?: string; message?: string; assertionResults: Assertion[] };
type Run = { numFailedTests: number; testResults: FileResult[] };

type Baseline = { expectedFailures: Array<{ id: string; defect: string }> };

const idOf = (title: string) => (title.split("||")[0] ?? "").split("|")[0]?.trim() || "(unnamed)";

const run: Run = JSON.parse(readFileSync(process.argv[2] ?? "reports/vitest.json", "utf8"));
const baseline: Baseline = JSON.parse(readFileSync("tests/known-failures.json", "utf8"));
const known = new Set(baseline.expectedFailures.map((f) => f.id));

const failed = run.testResults.flatMap((file) =>
  file.assertionResults
    .filter((a) => a.status !== "passed")
    .map((a) => ({ id: idOf(a.title), title: a.title, file: file.name, detail: (a.failureMessages ?? []).join("\n") })),
);

const unexpected = failed.filter((f) => !known.has(f.id));
const stillRed = new Set(failed.map((f) => f.id));
const fixed = baseline.expectedFailures.filter((f) => !stillRed.has(f.id));

// A file that fails without reporting a failing assertion did not compile or collect.
const broken = run.testResults.filter(
  (file) => file.status === "failed" && !file.assertionResults.some((a) => a.status !== "passed"),
);

const line = "─".repeat(78);
console.log(`\n${line}\nREGRESSION GATE — new failures block, known defects do not\n${line}`);
console.log(`\nFailing ${failed.length}   known defects ${failed.length - unexpected.length}/${known.size}   NEW ${unexpected.length}\n`);

for (const file of broken) {
  console.log(`BROKEN TEST FILE  ${file.name}`);
  console.log(`  ${(file.message ?? "no assertions ran").split("\n").slice(0, 3).join("\n  ")}\n`);
}

for (const f of unexpected) {
  console.log(`NEW FAILURE  [${f.id}]  ${f.file}`);
  console.log(`  ${f.title.split("||")[0]?.split("|").slice(1).join("|").trim()}`);
  console.log(`  ${f.detail.split("\n").slice(0, 4).join("\n  ")}\n`);
}

if (fixed.length) {
  console.log(`FIXED since the baseline was captured — remove from tests/known-failures.json:`);
  for (const f of fixed) console.log(`  ${f.id}  ${f.defect}`);
  console.log("");
}

if (unexpected.length || broken.length) {
  console.log(`${line}`);
  console.log(`BLOCKED. ${unexpected.length} new failure(s), ${broken.length} broken file(s).`);
  console.log(`Something that worked before this change does not work now. Fix it, or if the`);
  console.log(`behaviour change is deliberate, update the test that pins it.`);
  console.log(`${line}\n`);
  process.exitCode = 1;
} else {
  console.log(`${line}`);
  console.log(`PASS. No regression: every failure is a known defect in tests/known-failures.json.`);
  console.log(`${line}\n`);
}
