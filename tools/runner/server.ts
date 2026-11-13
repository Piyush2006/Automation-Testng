/**
 * Local test runner UI.  `npm run runner`  ->  http://localhost:4100
 *
 * Pick a suite, press Run, watch the log stream in, press Stop to kill it.
 * When a run ends you get a summary and a PDF of the result.
 *
 * No external dependencies: node:http + node:child_process, and Playwright
 * (already a devDependency) to render the PDF.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const PORT = Number(process.env.PORT ?? 4100);
const ROOT = resolve(import.meta.dirname ?? ".", "../..");

export type SuiteId = "full" | "live" | "browser" | "logic" | "gate";
type Suite = { id: SuiteId; name: string; blurb: string; cmd: string; args: string[]; env?: Record<string, string>; minutes: string; canWatch: boolean };

const SUITES: Suite[] = [
  {
    id: "live",
    name: "The 42 lines, against real Scispot",
    blurb: "Signed in as you, on your real lab data. Read-only: nothing is created, edited or deleted.",
    cmd: "npx",
    args: ["playwright", "test", "--config", "playwright.live.config.ts", "--reporter=list"],
    minutes: "~2 min",
    canWatch: true,
  },
];

/** The six sections the 42 lines are grouped into. Shown so the run is not a black box. */
export const STAGES = [
  { name: "1 · Searching for a chemical",        detail: "9 lines — by name, by nickname, by item ID, and the edge cases" },
  { name: "2 · The lots and vendors that return", detail: "12 lines — every lot, every vendor, and whether the details are right" },
  { name: "3 · Quantity Left across vendors",     detail: "9 lines — one chemical, several lots, one total" },
  { name: "4 · A renamed column or mapping",      detail: "5 lines — what the app does when Scispot changes underneath it" },
  { name: "5 · What runs on every commit",        detail: "3 lines — the gate's dependency checks, against the live schema" },
  { name: "6 · Getting connected",                detail: "4 lines — settings, session, and the retry card" },
];

const APPS = [{ id: "ccoc", name: "Chemical Chain of Custody", appId: "d3340961-d93b-47b8-83ec-3c73032c01e1", suites: SUITES.map((s) => s.id) }];

const STATE = "/.auth/scispot.json".slice(1);

/** What we can tell about the saved Scispot session without opening a browser. */
function session() {
  const file = resolve(ROOT, STATE);
  if (!existsSync(file)) return { present: false as const };
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { cookies?: Array<{ name: string; expires?: number; domain?: string }> };
    const saved = statSync(file).mtimeMs;
    const live = (raw.cookies ?? []).filter((c) => (c.domain ?? "").includes("scispot"));
    const stamps = live.map((c) => c.expires ?? -1).filter((e) => e > 0);
    const soonest = stamps.length ? Math.min(...stamps) * 1000 : null;
    return {
      present: true as const,
      savedAt: saved,
      cookies: live.length,
      expiresAt: soonest,
      expired: soonest !== null && soonest < Date.now(),
    };
  } catch {
    return { present: true as const, savedAt: statSync(file).mtimeMs, cookies: 0, expiresAt: null, expired: false, unreadable: true };
  }
}

// ───────────────────────────── run state ─────────────────────────────

type Line = { t: number; text: string };
type Run = {
  id: string; suite: SuiteId; suiteName: string; headed: boolean; startedAt: number; endedAt?: number;
  exitCode?: number | null; stopped: boolean; lines: Line[];
};
let current: Run | null = null;
let child: ChildProcess | null = null;
const clients = new Set<ServerResponse>();
const strip = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, "");

function push(text: string) {
  if (!current) return;
  const line = { t: Date.now(), text };
  current.lines.push(line);
  if (current.lines.length > 5000) current.lines.shift();
  for (const c of clients) c.write(`event: line\ndata: ${JSON.stringify(line)}\n\n`);
}
function announce(event: string, payload: unknown) {
  for (const c of clients) c.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

/**
 * Counts, per stage, then combined.
 *
 * Care is needed: the 191 in the vitest report ALREADY contains the 49 browser
 * cases, because scripts/report.ts merges reports/playwright.json into it. So the
 * browser stage must not be added again. The 46 live checks are separate and are.
 */
type Stage = { name: string; total: number; pass: number; fail: number; skip: number; counted: boolean; note?: string };

function summarise(run: Run) {
  const text = run.lines.map((l) => l.text).join("\n");

  // split the log into stages; a single-suite run has no === markers at all
  const parts = new Map<string, string>();
  const marks = [...text.matchAll(/^=== (.+?) ===$/gm)];
  if (marks.length) {
    marks.forEach((m, i) => {
      const from = m.index! + m[0].length;
      const to = i + 1 < marks.length ? marks[i + 1]!.index! : text.length;
      parts.set(m[1]!.trim(), text.slice(from, to));
    });
  } else {
    parts.set("run", text);
  }

  const tally = (blob: string) => ({
    pass: Number((blob.match(/(\d+) passed/) ?? [])[1] ?? 0),
    fail: Number((blob.match(/(\d+) failed/) ?? [])[1] ?? 0),
    skip: Number((blob.match(/(\d+) skipped/) ?? [])[1] ?? 0),
  });

  const stages: Stage[] = [];
  let gate: { failing: number; known: number; of: number; neu: number } | null = null;

  for (const [name, blob] of parts) {
    const g = blob.match(/Failing (\d+)\s+known defects (\d+)\/(\d+)\s+NEW (\d+)/);
    if (g) gate = { failing: +g[1]!, known: +g[2]!, of: +g[3]!, neu: +g[4]! };

    const report = blob.match(/^Total (\d+)\s+PASS (\d+)\s+FAIL (\d+)/m);
    if (report) {
      stages.push({ name, total: +report[1]!, pass: +report[2]!, fail: +report[3]!, skip: 0, counted: true,
                    note: "includes the 49 browser cases" });
      continue;
    }
    if (g && !/passed|failed/.test(blob)) {
      stages.push({ name, total: 0, pass: 0, fail: 0, skip: 0, counted: false, note: "re-reads the run above" });
      continue;
    }
    const t = tally(blob);
    if (t.pass || t.fail || t.skip) {
      // the browser stage is already inside the 191 the report stage prints
      const dupe = /browser vs stand-in/i.test(name) && [...parts.keys()].some((k) => /logic \+ contract/i.test(k));
      stages.push({ name, total: t.pass + t.fail + t.skip, ...t, counted: !dupe,
                    note: dupe ? "already counted inside the 191" : undefined });
      continue;
    }
    if (/typecheck/i.test(name)) stages.push({ name, total: 0, pass: 0, fail: 0, skip: 0, counted: false, note: "compiles or it does not" });
  }

  const counted = stages.filter((x) => x.counted);
  const total = counted.reduce((n, x) => n + x.total, 0);
  const passed = counted.reduce((n, x) => n + x.pass, 0);
  const failed = counted.reduce((n, x) => n + x.fail, 0);
  const skipped = counted.reduce((n, x) => n + x.skip, 0);

  const cases = [...text.matchAll(/^\s*(✓|✘|-)\s+\d+\s+(.+?)(?:\s+\(\d+(?:\.\d+)?m?s\))?$/gm)]
    .map((m) => ({ mark: m[1]!, name: m[2]!.replace(/^\S+\.spec\.ts:\d+:\d+ › /, "").trim() }));

  return {
    total, passed, failed, skipped, stages, gate, cases,
    verdict: run.stopped ? "STOPPED" : failed === 0 ? "PASS" : "ISSUES",
  };
}

function start(suiteId: SuiteId, headed = false, workers = 2) {
  if (child) return { ok: false, error: "A run is already in progress." };
  const suite = SUITES.find((s) => s.id === suiteId);
  if (!suite) return { ok: false, error: "Unknown suite." };

  const watch = headed && suite.canWatch;
  // Playwright's own CLI takes --headed; full.sh reads HEADED and passes it on.
  const args = watch && suite.cmd === "npx" ? [...suite.args, "--headed"] : suite.args;
  const w = Math.max(1, Math.min(8, Math.round(workers)));
  const env = { ...process.env, ...suite.env, FORCE_COLOR: "0", WORKERS: String(w), ...(watch ? { HEADED: "1", SLOWMO: "250" } : {}) };

  current = { id: String(Date.now()), suite: suite.id, suiteName: suite.name, headed: watch, startedAt: Date.now(), stopped: false, lines: [] };
  announce("started", { suite: suite.name, at: current.startedAt, headed: watch });
  push(`$ ${watch ? "HEADED=1 " : ""}WORKERS=${w} ${suite.cmd} ${args.join(" ")}`);
  if (watch) push("  a Chrome window will open \u2014 actions are slowed to 250ms so you can follow them");
  push("");

  child = spawn(suite.cmd, args, { cwd: ROOT, env });
  const onData = (b: Buffer) => strip(b.toString()).split("\n").forEach((l) => l.trim() && push(l));
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("close", (code) => {
    if (!current) return;
    current.exitCode = code;
    current.endedAt = Date.now();
    child = null;
    push("");
    push(current.stopped ? "— stopped —" : `— finished, exit ${code} —`);
    announce("done", { ...summarise(current), stopped: current.stopped, seconds: Math.round((current.endedAt - current.startedAt) / 1000) });
  });
  return { ok: true };
}

function login(email: string) {
  if (child) return { ok: false, error: "A run is already in progress." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, error: "That does not look like an email address." };

  current = { id: String(Date.now()), suite: "live", suiteName: `Sign in to Scispot as ${email}`, headed: true, startedAt: Date.now(), stopped: false, lines: [] };
  announce("started", { suite: current.suiteName, at: current.startedAt, headed: true, login: true });
  push(`$ npx vite-node scripts/scispot-login.ts -- ${email}`);
  push("");
  push("  A Chrome window is opening. In it:");
  push("    1. the email is filled in and the magic link requested");
  push("    2. open that email and click the link");
  push("    3. type the OTP in the SAME window \u2014 do not close it");
  push("    4. the workspace is chosen and the Jazz app opened for you");
  push("");

  child = spawn("npx", ["vite-node", "scripts/scispot-login.ts", "--", email], {
    cwd: ROOT, env: { ...process.env, FORCE_COLOR: "0" },
  });
  const onData = (b: Buffer) => strip(b.toString()).split("\n").forEach((l) => l.trim() && push(l));
  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);
  child.on("close", (code) => {
    if (!current) return;
    current.exitCode = code; current.endedAt = Date.now(); child = null;
    push("");
    push(code === 0 ? "\u2014 signed in, session saved to .auth/scispot.json \u2014" : `\u2014 sign-in ended, exit ${code} \u2014`);
    announce("done", { ...summarise(current), stopped: current.stopped, login: true, session: session(),
                       seconds: Math.round((current.endedAt - current.startedAt) / 1000) });
  });
  return { ok: true };
}

function stop() {
  if (!child || !current) return { ok: false, error: "Nothing is running." };
  current.stopped = true;
  child.kill("SIGINT");
  setTimeout(() => child?.kill("SIGKILL"), 4000);
  return { ok: true };
}

// ───────────────────────────── PDF ─────────────────────────────

function reportHtml(run: Run) {
  const s = summarise(run);
  const esc = (x: string) => x.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
  const when = new Date(run.startedAt).toLocaleString("en-GB", { dateStyle: "long", timeStyle: "short" });
  const secs = Math.round(((run.endedAt ?? Date.now()) - run.startedAt) / 1000);
  const colour = s.verdict === "PASS" ? "#157347" : s.verdict === "STOPPED" ? "#596a70" : "#9a5b06";
  const rows = s.cases.map((c) => {
    const label = c.mark === "✓" ? "PASS" : c.mark === "✘" ? "FAIL" : "SKIP";
    const col = c.mark === "✓" ? "#157347" : c.mark === "✘" ? "#a52020" : "#8a9499";
    return `<tr><td style="color:${col};font-weight:600;white-space:nowrap">${label}</td><td>${esc(c.name)}</td></tr>`;
  }).join("");
  const log = esc(run.lines.map((l) => l.text).join("\n")).slice(0, 60000);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { margin: 16mm 14mm; }
    body{font:12px/1.6 -apple-system,"Segoe UI",sans-serif;color:#101619;margin:0}
    h1{font-size:23px;margin:0 0 4px} h2{font-size:15px;margin:22px 0 8px;border-bottom:1px solid #dce3e3;padding-bottom:5px}
    .meta{color:#596a70;font-size:11px;margin-bottom:14px}
    .v{display:inline-block;border:1.5px solid ${colour};color:${colour};font-weight:700;padding:6px 14px;border-radius:6px;font-size:15px;margin-bottom:14px}
    table{border-collapse:collapse;width:100%;font-size:11px} td{padding:4px 8px;border-bottom:1px solid #eef2f2;vertical-align:top}
    .k{display:flex;gap:22px;margin:10px 0;font-size:12px} .k b{font-size:19px;display:block;font-family:ui-monospace,monospace}
    pre{background:#f6f8f8;border:1px solid #dce3e3;border-radius:5px;padding:9px;font-size:9px;line-height:1.5;white-space:pre-wrap;word-break:break-word}
  </style></head><body>
    <h1>Chemical Chain of Custody — Test Result</h1>
    <div class="meta">${esc(run.suiteName)}${run.headed ? " (visible browser)" : ""} &middot; ${when} &middot; ${secs}s &middot; exit ${run.exitCode ?? "—"}${run.stopped ? " &middot; stopped by operator" : ""}</div>
    <div class="v">${s.verdict}</div>
    <div class="k">
      <span><b>${s.total}</b>checks</span>
      <span><b style="color:#157347">${s.passed}</b>passed</span>
      <span><b style="color:#a52020">${s.failed}</b>failed</span>
      ${s.skipped ? `<span><b style="color:#8a9499">${s.skipped}</b>skipped</span>` : ""}
      ${s.gate ? `<span><b style="color:${s.gate.neu ? "#a52020" : "#157347"}">${s.gate.neu}</b>new failures</span>` : ""}
    </div>
    ${s.stages.length ? `<h2>Stages</h2><table>${s.stages.map((x) => `<tr><td style="white-space:nowrap">${esc(x.name)}</td>
      <td style="white-space:nowrap">${x.counted ? `${x.pass} / ${x.total}` : "\u2014"}</td>
      <td style="color:#596a70">${esc(x.note ?? "")}</td></tr>`).join("")}</table>` : ""}
    ${s.gate ? `<p style="font-size:12px;color:#596a70">Gate: ${s.gate.failing} failing, ${s.gate.known}/${s.gate.of} are known defects, ${s.gate.neu} new.</p>` : ""}
    ${rows ? `<h2>Cases (${s.cases.length})</h2><table>${rows}</table>` : ""}
    <h2>Full log</h2><pre>${log}</pre>
  </body></html>`;
}

async function pdf(run: Run): Promise<Buffer> {
  const { chromium } = await import("@playwright/test");
  const b = await chromium.launch({ channel: "chrome" }).catch(() => chromium.launch());
  const p = await b.newPage();
  await p.setContent(reportHtml(run), { waitUntil: "load" });
  const buf = await p.pdf({ format: "A4", printBackground: true, margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" } });
  await b.close();
  return buf;
}

// ───────────────────────────── http ─────────────────────────────

const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};
const body = (req: IncomingMessage) => new Promise<string>((ok) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => ok(d)); });

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(readFileSync(resolve(ROOT, "tools/runner/ui.html"), "utf8"));
  }
  if (url.pathname === "/api/apps") return json(res, 200, { apps: APPS, stages: STAGES, suites: SUITES.map(({ id, name, blurb, minutes, canWatch }) => ({ id, name, blurb, minutes, canWatch })) });
  if (url.pathname === "/api/state") {
    return json(res, 200, {
      running: Boolean(child),
      run: current && { suite: current.suiteName, startedAt: current.startedAt, lines: current.lines.slice(-400) },
      summary: current?.endedAt ? summarise(current) : null,
    });
  }
  if (url.pathname === "/api/run" && req.method === "POST") {
    const { suite, headed, workers } = JSON.parse((await body(req)) || "{}");
    const r = start(suite, Boolean(headed), Number(workers) || 2);
    return json(res, r.ok ? 200 : 409, r);
  }
  if (url.pathname === "/api/session") return json(res, 200, session());
  if (url.pathname === "/api/login" && req.method === "POST") {
    const { email } = JSON.parse((await body(req)) || "{}");
    const r = login(String(email ?? "").trim());
    return json(res, r.ok ? 200 : 409, r);
  }
  if (url.pathname === "/api/stop" && req.method === "POST") {
    const r = stop();
    return json(res, r.ok ? 200 : 409, r);
  }
  if (url.pathname === "/api/stream") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write("retry: 2000\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }
  if (url.pathname === "/api/report.pdf") {
    if (!current?.endedAt) return json(res, 409, { error: "No finished run to report on." });
    try {
      const buf = await pdf(current);
      mkdirSync(resolve(ROOT, "reports"), { recursive: true });
      const name = `test-result-${current.suite}-${new Date(current.startedAt).toISOString().slice(0, 16).replace(/[:T]/g, "")}.pdf`;
      writeFileSync(resolve(ROOT, "reports", name), buf);
      res.writeHead(200, { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"` });
      return res.end(buf);
    } catch (e) {
      return json(res, 500, { error: String(e) });
    }
  }
  res.writeHead(404).end("not found");
}).listen(PORT, () => {
  console.log(`\n  Test runner  ->  http://localhost:${PORT}\n`);
});
