/**
 * Captures a REAL terminal session for the demo video.
 *
 * Everything the video shows in its terminal acts is recorded here by actually
 * running the commands — nothing is hand-written. The scenario runs inside a
 * throwaway clone of this repo, so a commit can genuinely be blocked and then
 * genuinely allowed without touching your working tree.
 *
 *   npx vite-node demo/capture-session.ts
 *   -> demo/captured-session.json
 */
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

type Step = {
  /** What the viewer sees typed at the prompt. */
  command: string;
  /** Real captured output. */
  output: string;
  exitCode: number;
  /** Caption shown while this step plays. */
  note: string;
};

const ROOT = resolve(".");
const work = mkdtempSync(join(tmpdir(), "custody-demo-"));
const repo = join(work, "repo");
const steps: Step[] = [];

function run(command: string, note: string, opts: { cwd?: string } = {}): Step {
  // Redirect stderr into stdout inside the shell so hook output and git's own
  // output stay in true chronological order. The viewer sees `command`, not this.
  const r = spawnSync("bash", ["-lc", `{ ${command} ; } 2>&1`], {
    cwd: opts.cwd ?? repo,
    encoding: "utf8",
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CI: "" },
    maxBuffer: 20 * 1024 * 1024,
  });
  // Cosmetic only: strip ANSI, make the throwaway clone's absolute paths look
  // like ordinary repo paths, and drop node_modules stack frames. No line's
  // meaning is changed and no line is invented.
  const output = `${r.stdout ?? ""}`
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .replace(/\r/g, "")
    .split("\n")
    .filter((l) => !/^\s+at .*node_modules/.test(l) && !/^\s+at processTicksAndRejections/.test(l))
    .map((l) => {
      // macOS reports temp dirs under /private, so strip both spellings.
      for (const base of [realpathSync(repo), repo]) l = l.split(`${base}/`).join("").split(base).join(".");
      return l.split(`file://${encodeURI(ROOT)}/`).join("");
    })
    .join("\n")
    .trimEnd();
  const step: Step = { command, output, exitCode: r.status ?? 0, note };
  steps.push(step);
  console.log(`\n$ ${command}\n  exit ${step.exitCode}, ${output.split("\n").length} lines`);
  return step;
}

try {
  console.log("Cloning into throwaway workspace…");
  execSync(`git clone --quiet "${ROOT}" "${repo}"`, { stdio: "inherit" });
  symlinkSync(join(ROOT, "node_modules"), join(repo, "node_modules"), "dir");
  // .husky/_ is self-ignored, so a clone has no hook wrappers until npm install
  // runs the `prepare` script. Run exactly that, so the hooks are real.
  execSync("npx husky", { cwd: repo, stdio: "inherit" });
  execSync('git config user.email "demo@example.com" && git config user.name "Demo"', { cwd: repo });

  // ── 1. the suite, as it stands ────────────────────────────────────────────
  run(
    "npm run test:gate",
    "The gate as it stands: 8 failures, all of them defects we already documented. Nothing new broke.",
  );

  // ── 2. a developer changes a column name while adding a feature ───────────
  const configPath = join(repo, "src/config.ts");
  writeFileSync(
    configPath,
    readFileSync(configPath, "utf8").replace('lot: "Lot Number"', 'lot: "LotNumber"'),
  );
  run(
    "git diff --stat src/config.ts && git diff src/config.ts | tail -8",
    "A developer renames a column constant while adding a feature. One character. It looks harmless.",
  );

  // ── 3. the commit is refused ──────────────────────────────────────────────
  run(
    'git add src/config.ts && git commit -m "feat: filter lots by supplier"',
    "They try to commit. The hook runs the whole suite first — and refuses, naming all five things that just broke.",
  );

  // ── 4. prove nothing got in ───────────────────────────────────────────────
  run(
    "git log --oneline -1 && git status --short",
    "Nothing was committed. The broken change is still sitting in the working tree, where it can be fixed.",
  );

  // ── 5. fix it ─────────────────────────────────────────────────────────────
  // `git checkout --` restores from the index, which still holds the broken
  // staged copy. Restore the worktree AND the index from HEAD.
  run(
    'git restore --source=HEAD --staged --worktree src/config.ts && git diff HEAD --quiet && echo "working tree now matches the last commit"',
    "The developer reverts the rename.",
  );

  // ── 6. a legitimate change commits cleanly ────────────────────────────────
  writeFileSync(join(repo, "docs/FEATURE.md"), "# Supplier filter\n\nNotes for the new feature.\n");
  run(
    'git add docs/FEATURE.md && git commit -m "feat: notes for supplier filter" && git log --oneline -1',
    "A change that breaks nothing sails straight through. The gate blocks regressions, not progress.",
  );

  writeFileSync("demo/captured-session.json", JSON.stringify({ capturedAt: new Date().toISOString(), steps }, null, 2));
  console.log(`\nWrote demo/captured-session.json (${steps.length} steps)`);
} finally {
  rmSync(work, { recursive: true, force: true });
  console.log("Throwaway workspace removed.");
}
