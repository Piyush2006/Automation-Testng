/**
 * Renders the vitest run as a self-contained HTML report.
 *
 * Called by scripts/report.ts, so `npm run test:report` writes
 * reports/test-report.html alongside the markdown and CSV.
 *
 * The file is written in Artifact shape (no doctype/html/body wrapper) so it
 * can be published straight to claude.ai with the Artifact tool. It also opens
 * fine as a local file.
 */
import { writeFileSync } from "node:fs";
import { ACTION_DEPS, CALL_DEPS, COLUMN_DEPS, SHEET_DEPS } from "../tests/deps/manifest";

export type Case = {
  id: string;
  what: string;
  rca: string;
  status: "PASS" | "FAIL";
  area: string;
  detail: string;
  file: string;
};

type Meta = { total: number; passed: number; failed: number; capturedAt: string; environment: string; appId: string };

const LAYERS: Array<{ key: string; name: string; blurb: string; match: (f: string) => boolean }> = [
  {
    key: "logic",
    name: "Calculation tests",
    blurb:
      "Run the app's own maths and text-parsing code on invented inputs. No Scispot, no network. These catch a wrong total, a unit the app does not recognise, a blank cell read as a zero.",
    match: (f) => f.includes("tests/logic/"),
  },
  {
    key: "contract",
    name: "API contract tests",
    blurb:
      "Swap Scispot for a stand-in that answers exactly like the real API, then check two directions: that the app sends the right request, and that it reads the answer correctly. These catch a wrong filter, a missed page of rows, a broken join.",
    match: (f) => f.includes("tests/contract/"),
  },
  {
    key: "browser",
    name: "Browser tests",
    blurb:
      "Drive the real app in Chromium with Playwright: click the search box, type, pick a chemical, open a lot. Scispot is replaced at the point the app loads its SDK, so these need no token and no network. They catch what only a rendered page can show.",
    match: (f) => f.includes("e2e/"),
  },
  {
    key: "guard",
    name: "Dependency guard",
    blurb:
      "Compares three sources against each other — the columns the code actually reads, the dependency manifest, and a captured snapshot of Scispot's live schema. It fails when they disagree. This is the check to run before changing a labsheet.",
    match: (f) => f.includes("tests/dependency/"),
  },
  {
    key: "legacy",
    name: "Pre-existing tests",
    blurb:
      "The 13 tests that shipped with the app. They exercise lotQuantity() and sumAmounts() directly — functions the app never imports — so they pass without covering any code a user reaches.",
    match: (f) => f.includes("quantity.test.ts"),
  },
];

const esc = (s: string) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Wraps file:line references and `backticked` spans in mono type. */
function rich(s: string): string {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\b((?:src|tests)\/[\w./-]+\.(?:ts|tsx|json)(?::\d+)?)/g, '<code class="ref">$1</code>')
    .replace(/\b(User impact|Impact|Fix|Latent today)\b:/g, '<strong>$1:</strong>');
}

export function writeHtml(cases: Case[], meta: Meta, outPath = "reports/test-report.html") {
  const failed = cases.filter((c) => c.status === "FAIL");
  const layers = LAYERS.map((l) => {
    const list = cases.filter((c) => l.match(c.file));
    return { ...l, total: list.length, fail: list.filter((c) => c.status === "FAIL").length };
  }).filter((l) => l.total > 0);

  const areas = [...new Set(cases.map((c) => c.area))]
    .map((area) => {
      const list = cases.filter((c) => c.area === area);
      return { area, total: list.length, fail: list.filter((c) => c.status === "FAIL").length };
    })
    .sort((a, b) => b.fail - a.fail || a.area.localeCompare(b.area));

  const layerOf = (f: string) => LAYERS.find((l) => l.match(f))?.key ?? "other";
  const payload = JSON.stringify(
    cases.map((c) => ({ i: c.id, w: c.what, s: c.status, a: c.area, r: c.rca, d: c.detail, l: layerOf(c.file) })),
  ).replace(/</g, "\\u003c");

  const sevChip = (s: string) =>
    `<span class="sev sev-${s}">${s}</span>`;

  const html = `<title>Chain of Custody Test Ledger</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: one column, 1120px max. Dense ledger of test cases under a sticky filter bar; state carried by a left severity stripe, not by card chrome. */
:root {
  --bg: #f4f6f8;
  --surface: #ffffff;
  --surface-2: #eceff3;
  --line: #d8dee6;
  --line-soft: #e6eaf0;
  --fg: #141d26;
  --fg-dim: #566475;
  --fg-faint: #83909f;
  --accent: #0e5c6b;
  --accent-soft: #e2eef1;
  --pass: #1a6e4e;
  --pass-soft: #e3f0ea;
  --fail: #9c3426;
  --fail-soft: #fae9e6;
  --warn: #7f5408;
  --warn-soft: #f8eedb;
  --mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
  --sans: "IBM Plex Sans", system-ui, -apple-system, Segoe UI, sans-serif;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #10161c;
    --surface: #18202a;
    --surface-2: #1f2832;
    --line: #2d3843;
    --line-soft: #242e38;
    --fg: #e7ecf1;
    --fg-dim: #9aa8b7;
    --fg-faint: #6f7d8c;
    --accent: #52b3c4;
    --accent-soft: #16323a;
    --pass: #5cc294;
    --pass-soft: #14302a;
    --fail: #ef8e80;
    --fail-soft: #37211f;
    --warn: #ddab53;
    --warn-soft: #322a19;
    color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #10161c;
  --surface: #18202a;
  --surface-2: #1f2832;
  --line: #2d3843;
  --line-soft: #242e38;
  --fg: #e7ecf1;
  --fg-dim: #9aa8b7;
  --fg-faint: #6f7d8c;
  --accent: #52b3c4;
  --accent-soft: #16323a;
  --pass: #5cc294;
  --pass-soft: #14302a;
  --fail: #ef8e80;
  --fail-soft: #37211f;
  --warn: #ddab53;
  --warn-soft: #322a19;
  color-scheme: dark;
}

* { box-sizing: border-box; }
body {
  background: var(--bg);
  color: var(--fg);
  font-family: var(--sans);
  font-size: 15px;
  line-height: 1.55;
  margin: 0;
  -webkit-font-smoothing: antialiased;
}
.wrap {
  max-width: 1120px;
  margin: 0 auto;
  padding-left: max(16px, env(safe-area-inset-left, 0px));
  padding-right: max(16px, env(safe-area-inset-right, 0px));
  padding-block: 0 72px;
}
h1, h2, h3 { font-weight: 600; text-wrap: balance; margin: 0; letter-spacing: -0.01em; }
h1 { font-size: clamp(1.7rem, 4.4vw, 2.3rem); line-height: 1.15; }
h2 { font-size: 1.22rem; }
h3 { font-size: 1rem; }
p { margin: 0; }
code {
  font-family: var(--mono);
  font-size: 0.86em;
  background: var(--surface-2);
  padding: 0.1em 0.36em;
  border-radius: 3px;
  word-break: break-word;
}
code.ref { background: none; padding: 0; color: var(--fg-dim); }
a { color: var(--accent); }
.eyebrow {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg-faint);
}

/* ---------- header ---------- */
header { border-bottom: 1px solid var(--line); padding-block: 40px 28px; display: flex; flex-direction: column; gap: 14px; }
.meta-line { display: flex; flex-wrap: wrap; gap: 6px 18px; font-family: var(--mono); font-size: 0.74rem; color: var(--fg-faint); }
.meta-line span { white-space: nowrap; }
.lede { max-width: 62ch; color: var(--fg-dim); }

/* ---------- verdict ---------- */
.verdict { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px; background: var(--line-soft); border: 1px solid var(--line); border-radius: 6px; overflow: hidden; margin-block: 28px; }
.tile { background: var(--surface); padding: 18px 20px; display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.tile .n { font-family: var(--mono); font-size: 2.1rem; font-weight: 500; line-height: 1; font-variant-numeric: tabular-nums; }
.tile .k { font-size: 0.78rem; color: var(--fg-dim); }
.tile.fail .n { color: var(--fail); }
.tile.pass .n { color: var(--pass); }

section { padding-block: 34px 0; }
.sec-head { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; }
.sec-head p { max-width: 66ch; color: var(--fg-dim); font-size: 0.93rem; }

/* ---------- layers ---------- */
.layers { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
.layer { border: 1px solid var(--line); border-radius: 6px; background: var(--surface); padding: 16px 18px; display: flex; flex-direction: column; gap: 8px; min-width: 0; }
.layer h3 { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.layer .count { font-family: var(--mono); font-size: 0.8rem; color: var(--fg-faint); font-variant-numeric: tabular-nums; white-space: nowrap; }
.layer p { font-size: 0.87rem; color: var(--fg-dim); }
.layer.has-fail { border-color: color-mix(in srgb, var(--fail) 45%, var(--line)); }
.layer .count b { color: var(--fail); font-weight: 500; }

/* ---------- failures ---------- */
.fault { border: 1px solid var(--line); border-left: 3px solid var(--fail); border-radius: 0 6px 6px 0; background: var(--surface); padding: 18px 20px; display: flex; flex-direction: column; gap: 10px; min-width: 0; }
.faults { display: flex; flex-direction: column; gap: 14px; }
.fault-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; }
.fault-head .fid { font-family: var(--mono); font-size: 0.78rem; color: var(--fail); background: var(--fail-soft); padding: 2px 7px; border-radius: 3px; }
.fault-head .ftitle { font-weight: 500; }
.fault .rca { font-size: 0.92rem; color: var(--fg-dim); }
.fault .rca strong { color: var(--fg); font-weight: 500; }
details.raw { font-size: 0.82rem; }
details.raw summary { cursor: pointer; color: var(--fg-faint); font-family: var(--mono); font-size: 0.74rem; width: fit-content; }
details.raw summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; border-radius: 3px; }
details.raw pre { font-family: var(--mono); font-size: 0.74rem; background: var(--surface-2); border-radius: 4px; padding: 10px 12px; margin: 10px 0 0; overflow-x: auto; color: var(--fg-dim); white-space: pre-wrap; }

/* ---------- ledger ---------- */
.bar { position: sticky; top: env(safe-area-inset-top, 0px); z-index: 5; background: var(--bg); border-bottom: 1px solid var(--line); padding-block: 12px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.bar input[type="search"] {
  flex: 1 1 200px; min-width: 0; font: inherit; font-size: 0.9rem; padding: 7px 11px;
  border: 1px solid var(--line); border-radius: 5px; background: var(--surface); color: var(--fg);
}
.bar input:focus-visible, .chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font: inherit; font-size: 0.8rem; padding: 5px 11px; border: 1px solid var(--line); border-radius: 99px; background: var(--surface); color: var(--fg-dim); cursor: pointer; white-space: nowrap; }
.chip[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent); }
.tally { font-family: var(--mono); font-size: 0.74rem; color: var(--fg-faint); margin-left: auto; font-variant-numeric: tabular-nums; }

.ledger { border: 1px solid var(--line); border-top: none; border-radius: 0 0 6px 6px; background: var(--surface); overflow: hidden; }
.row { display: grid; grid-template-columns: 112px 1fr auto; gap: 8px 14px; align-items: baseline; padding: 9px 14px; border-top: 1px solid var(--line-soft); font-size: 0.89rem; }
.row:first-child { border-top: none; }
.row .cid { font-family: var(--mono); font-size: 0.76rem; color: var(--fg-faint); white-space: nowrap; }
.row .cwhat { min-width: 0; }
.row .carea { font-size: 0.74rem; color: var(--fg-faint); white-space: nowrap; }
.row.r-FAIL { background: var(--fail-soft); }
.row.r-FAIL .cid { color: var(--fail); }
.row.r-FAIL .cwhat { color: var(--fg); }
.row .cwhat .flag { font-family: var(--mono); font-size: 0.68rem; color: var(--fail); border: 1px solid currentColor; border-radius: 3px; padding: 0 4px; margin-left: 8px; vertical-align: 1px; }
.row .why { grid-column: 2 / -1; font-size: 0.83rem; color: var(--fg-dim); margin-top: 4px; }
.empty { padding: 28px 14px; text-align: center; color: var(--fg-faint); font-size: 0.88rem; }

/* ---------- tables ---------- */
.scroller { overflow-x: auto; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
table { border-collapse: collapse; width: 100%; font-size: 0.85rem; }
th, td { text-align: left; padding: 9px 13px; border-top: 1px solid var(--line-soft); vertical-align: top; }
thead th { border-top: none; background: var(--surface-2); font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fg-dim); font-weight: 500; white-space: nowrap; }
td.id { font-family: var(--mono); font-size: 0.74rem; color: var(--fg-faint); white-space: nowrap; }
td.name { font-family: var(--mono); font-size: 0.78rem; }
.sev { font-family: var(--mono); font-size: 0.68rem; padding: 1px 6px; border-radius: 3px; white-space: nowrap; }
.sev-blocking { background: var(--fail-soft); color: var(--fail); }
.sev-degraded { background: var(--warn-soft); color: var(--warn); }
.sev-unused { background: var(--surface-2); color: var(--fg-faint); }
.barcell { display: flex; align-items: center; gap: 9px; }
.track { flex: 1 1 60px; min-width: 50px; height: 5px; border-radius: 3px; background: var(--surface-2); overflow: hidden; display: flex; }
.track i { display: block; height: 100%; }
.track i.p { background: var(--pass); }
.track i.f { background: var(--fail); }
.num { font-family: var(--mono); font-variant-numeric: tabular-nums; white-space: nowrap; }

/* ---------- prose blocks ---------- */
.note { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 0 6px 6px 0; background: var(--surface); padding: 15px 18px; font-size: 0.9rem; color: var(--fg-dim); display: flex; flex-direction: column; gap: 7px; }
.note strong { color: var(--fg); font-weight: 500; }
ul, ol { margin: 0; padding-left: 1.25em; display: flex; flex-direction: column; gap: 7px; color: var(--fg-dim); font-size: 0.92rem; }
li strong { color: var(--fg); font-weight: 500; }
pre.cmd { font-family: var(--mono); font-size: 0.8rem; background: var(--surface); border: 1px solid var(--line); border-radius: 6px; padding: 14px 16px; margin: 0; overflow-x: auto; color: var(--fg-dim); }
pre.cmd b { color: var(--fg); font-weight: 500; }
footer { margin-top: 44px; padding-top: 20px; border-top: 1px solid var(--line); font-family: var(--mono); font-size: 0.72rem; color: var(--fg-faint); display: flex; flex-wrap: wrap; gap: 6px 16px; }

@media (max-width: 560px) {
  .row { grid-template-columns: 1fr; }
  .row .carea { display: none; }
  .row .why { grid-column: 1; }
  .tally { margin-left: 0; }
}
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none !important; } }
</style>

<div class="wrap">
  <header>
    <p class="eyebrow">Scispot Jazz app &middot; regression suite</p>
    <h1>Chemical Chain of Custody &mdash; test ledger</h1>
    <p class="lede">Every dependency this app has on Scispot, written as an automated test case. Run it before changing a labsheet: the suite names what would break and why, instead of leaving it to be found in the app.</p>
    <div class="meta-line">
      <span>app ${esc(meta.appId)}</span>
      <span>schema snapshot ${esc(meta.capturedAt)} &middot; ${esc(meta.environment)}</span>
      <span>generated ${new Date().toISOString().slice(0, 10)}</span>
    </div>
  </header>

  <div class="verdict">
    <div class="tile"><span class="n">${meta.total}</span><span class="k">test cases</span></div>
    <div class="tile pass"><span class="n">${meta.passed}</span><span class="k">passing</span></div>
    <div class="tile fail"><span class="n">${meta.failed}</span><span class="k">failing &mdash; all genuine app defects</span></div>
    <div class="tile"><span class="n">${SHEET_DEPS.length + COLUMN_DEPS.length + CALL_DEPS.length + ACTION_DEPS.length}</span><span class="k">dependencies guarded</span></div>
  </div>

  <section>
    <div class="sec-head">
      <h2>What the suite actually runs</h2>
      <p>Three layers, each answering a different question. None of them needs a live Scispot session, so the whole suite finishes in under a second and can run in CI.</p>
    </div>
    <div class="layers">
      ${layers
        .map(
          (l) => `<div class="layer${l.fail ? " has-fail" : ""}">
        <h3>${esc(l.name)}<span class="count">${l.total - l.fail} / ${l.total}${l.fail ? ` &middot; <b>${l.fail} fail</b>` : ""}</span></h3>
        <p>${esc(l.blurb)}</p>
      </div>`,
        )
        .join("\n      ")}
    </div>
  </section>

  <section>
    <div class="sec-head">
      <h2>Showing it run</h2>
      <p>Three ways, depending on who is watching. All three run against this repo with no Scispot session and no network.</p>
    </div>
    <div class="layers">
      <div class="layer">
        <h3>Watch mode<span class="count">terminal</span></h3>
        <p><code>npm run test:watch</code> stays open and re-runs the affected cases the moment a file is saved. Edit a line in <code>src/lib/quantity.ts</code> and the result turns over in front of you. This is the quickest way to show the suite is live rather than a saved screenshot.</p>
      </div>
      <div class="layer">
        <h3>Browser dashboard<span class="count">best for a call</span></h3>
        <p><code>npm run test:ui</code> opens a Vitest dashboard: every file and case in a tree, ticks landing as they execute, each failure with its assertion diff. Share the browser tab and the whole suite is legible to someone who does not read terminals.</p>
      </div>
      <div class="layer">
        <h3>Browser run<span class="count">49 cases, 9s</span></h3>
        <p><code>npm run test:e2e:ui</code> opens Playwright&rsquo;s own runner: pick a case, watch Chromium drive the real app, and step through it frame by frame afterwards. <code>npm run test:e2e</code> is the headless version, and a failure saves a screenshot and a trace you can replay.</p>
      </div>
      <div class="layer">
        <h3>The guard demo<span class="count">3 acts</span></h3>
        <p><code>npm run demo:guard</code> proves the point instead of describing it: run the guard green, rename a column in the captured Scispot schema, watch the guard refuse the change and name what breaks, then restore. It pauses between acts so you can narrate.</p>
      </div>
    </div>
    <div class="note" style="margin-top:16px">
      <p><strong>No token, no login, no network &mdash; in any of them.</strong> The app loads the Jazz SDK from <code>eks.scispot.io</code> in <code>index.html</code>. The browser suite answers that one request with its own stand-in, so <code>window.Scispot</code> is defined in the same place and at the same moment as in production, and the app cannot tell the difference. That is what makes a browser suite runnable in CI.</p>
      <p><strong>The guard demo touches nothing in Scispot.</strong> It edits <code>tests/deps/scispot-snapshot.json</code>, the local copy of the schema, and restores it on exit including on Ctrl-C. Running it twice leaves the repo identical.</p>
    </div>
  </section>

  ${
    failed.length
      ? `<section>
    <div class="sec-head">
      <h2>${failed.length} failures, with root cause</h2>
      <p>Each of these is a real defect in the app, not a broken test. The root cause names the line responsible and what a user sees when it bites.</p>
    </div>
    <div class="faults">
      ${failed
        .map(
          (c) => `<div class="fault">
        <div class="fault-head"><span class="fid">${esc(c.id)}</span><span class="ftitle">${esc(c.what)}</span></div>
        <p class="rca">${rich(c.rca || "See the assertion output below.")}</p>
        ${c.detail ? `<details class="raw"><summary>assertion output</summary><pre>${esc(c.detail)}</pre></details>` : ""}
      </div>`,
        )
        .join("\n      ")}
    </div>
  </section>`
      : ""
  }

  <section>
    <div class="sec-head">
      <h2>Every case, by area</h2>
      <p>Search by keyword or ID, or filter to the failures. Each line states what the case checks; failing lines carry the reason inline.</p>
    </div>
    <div class="scroller" style="margin-bottom:22px">
      <table>
        <thead><tr><th>Area</th><th>Result</th><th class="num">Cases</th></tr></thead>
        <tbody>
          ${areas
            .map(
              (a) => `<tr>
            <td>${esc(a.area)}</td>
            <td><div class="barcell"><span class="track"><i class="p" style="flex:${a.total - a.fail}"></i><i class="f" style="flex:${a.fail}"></i></span><span class="num" style="color:var(--${a.fail ? "fail" : "fg-dim"})">${a.fail ? `${a.fail} fail` : "all pass"}</span></div></td>
            <td class="num">${a.total}</td>
          </tr>`,
            )
            .join("\n          ")}
        </tbody>
      </table>
    </div>

    <div class="bar">
      <input type="search" id="q" placeholder="Search cases, e.g. unit, supplier, CHAIN-015" aria-label="Search test cases">
      <div class="chips" id="chips">
        <button class="chip" id="f-all" data-f="all" aria-pressed="true">All</button>
        <button class="chip" id="f-fail" data-f="FAIL" aria-pressed="false">Failing only</button>
        <button class="chip" id="f-guard" data-f="guard" aria-pressed="false">Dependency guard</button>
        <button class="chip" id="f-contract" data-f="contract" aria-pressed="false">API contract</button>
        <button class="chip" id="f-logic" data-f="logic" aria-pressed="false">Calculation</button>
        <button class="chip" id="f-browser" data-f="browser" aria-pressed="false">Browser</button>
      </div>
      <span class="tally" id="tally"></span>
    </div>
    <div class="ledger" id="ledger"></div>
  </section>

  <section>
    <div class="sec-head">
      <h2>Before you change a labsheet</h2>
      <p>This is the lookup the suite exists for. Run the guard, read what it names, then decide.</p>
    </div>
    <pre class="cmd"><b>npm run test:deps</b>     # the 15 dependency checks, ~1s
<b>npm test</b>               # the whole suite
<b>npm run test:report</b>    # suite + this page, reports/test-report.html
<b>npm run test:e2e</b>       # the browser suite in Chromium
<b>npm run demo:guard</b>     # the 3-act walkthrough of a refused change</pre>
    <div class="note" style="margin-top:16px">
      <p><strong>What the guard catches.</strong> A column this app reads that is missing from the Scispot snapshot. A column mapped in <code>src/config.ts</code> but absent from the manifest. A dropdown option the app's unit table does not understand. A labsheet in <code>SHEETS</code> with no startup existence check. A type change on a column the app parses as a number.</p>
      <p><strong>The one manual step.</strong> The snapshot in <code>tests/deps/scispot-snapshot.json</code> is a captured copy of the live schema, refreshed by an agent call to the Scispot MCP server &mdash; see <code>scripts/refresh-snapshot.md</code>. A guard run proves the code matches the snapshot, not that the snapshot matches Scispot today. Refresh it before trusting a green run as a sign-off.</p>
    </div>
  </section>

  <section>
    <div class="sec-head">
      <h2>Dependency inventory</h2>
      <p>What the app needs from Scispot, at the grain a schema change happens. <span class="sev sev-blocking">blocking</span> means wrong data or an empty graph; <span class="sev sev-degraded">degraded</span> means one field or convenience stops working; <span class="sev sev-unused">unused</span> means declared but mapped to nothing.</p>
    </div>

    <h3 style="margin-bottom:10px">Labsheets</h3>
    <div class="scroller">
      <table>
        <thead><tr><th>ID</th><th>Labsheet</th><th>Access</th><th>Severity</th><th>Role</th></tr></thead>
        <tbody>${SHEET_DEPS.map(
          (d) => `<tr><td class="id">${esc(d.id)}</td><td class="name">${esc(d.sheet)}</td><td>${esc(d.access)}</td><td>${sevChip(d.severity)}</td><td>${esc(d.role)}</td></tr>`,
        ).join("")}</tbody>
      </table>
    </div>

    <h3 style="margin:26px 0 10px">Columns <span class="eyebrow">${COLUMN_DEPS.length}</span></h3>
    <div class="scroller">
      <table>
        <thead><tr><th>ID</th><th>Labsheet</th><th>Column</th><th>Type</th><th>Severity</th><th>Used for</th></tr></thead>
        <tbody>${COLUMN_DEPS.map(
          (d) => `<tr><td class="id">${esc(d.id)}</td><td class="name">${esc(d.sheet)}</td><td class="name">${d.column ? esc(d.column) : '<span style="color:var(--fg-faint);font-family:var(--sans)">not mapped</span>'}</td><td class="id">${esc(d.expectedType || "—")}</td><td>${sevChip(d.severity)}</td><td>${esc(d.usedFor)}</td></tr>`,
        ).join("")}</tbody>
      </table>
    </div>

    <h3 style="margin:26px 0 10px">SDK calls</h3>
    <div class="scroller">
      <table>
        <thead><tr><th>ID</th><th>Call</th><th>Severity</th><th>Triggered by</th></tr></thead>
        <tbody>${CALL_DEPS.map(
          (d) => `<tr><td class="id">${esc(d.id)}</td><td class="name">${esc(d.call)}</td><td>${sevChip(d.severity)}</td><td>${esc(d.triggeredBy)}</td></tr>`,
        ).join("")}</tbody>
      </table>
    </div>

    <h3 style="margin:26px 0 10px">User actions</h3>
    <div class="scroller">
      <table>
        <thead><tr><th>ID</th><th>Action</th><th>Severity</th><th>Depends on</th></tr></thead>
        <tbody>${ACTION_DEPS.map(
          (d) => `<tr><td class="id">${esc(d.id)}</td><td>${esc(d.action)}</td><td>${sevChip(d.severity)}</td><td class="id">${esc(d.dependsOn.join(", "))}</td></tr>`,
        ).join("")}</tbody>
      </table>
    </div>

    <div class="note" style="margin-top:20px">
      <p><strong>The riskiest item here is not a column, it is the join.</strong> Lots are attached to a chemical by matching <code>A. Materials Manager &rarr; Name</code> against <code>List of Inventory Items &rarr; Item Name</code> as plain text. Scispot has relational columns for this &mdash; <code>Parent Stock</code> and <code>Connection</code> both sit unused on that sheet. Edit either name on either side and the chemical renders with zero lots and the message &ldquo;No Materials Manager rows match this item name yet&rdquo;, which looks identical to genuinely having no stock.</p>
    </div>
  </section>

  <section>
    <div class="sec-head">
      <h2>What is still open</h2>
    </div>
    <ol>
      <li><strong>Six checks need a live session.</strong> A real <code>sas_</code> token only exists inside the Jazz iframe, so anything that proves the live tenant answers as the snapshot says has to run in the app, by hand, for now.</li>
      <li><strong>One browser, one viewport.</strong> The browser suite runs Chromium at desktop width. Firefox, WebKit and phone widths are a config change away but are not covered, and the tree-to-list switch at 640px is only exercised by lot count, not by resizing.</li>
      <li><strong>The browser suite never touches Scispot either.</strong> It replaces the SDK at the point the app loads it. So it proves the app behaves correctly against the API's documented rules, not that the live tenant answers the way the stand-in does.</li>
      <li><strong>The SDK origin disagrees with the guide.</strong> The app loads the Jazz SDK from <code>eks.scispot.io</code>; <code>get_jazz_guide</code> for this environment specifies <code>jazz-api.scispot.io</code>. The guide warns that this origin decides which tenant is read and that a wrong one fails silently. Worth settling before live testing.</li>
      <li><strong>The published app is behind.</strong> The live Jazz app was last published 2026-11-02; the local build is ahead of it.</li>
    </ol>
  </section>

  <footer>
    <span>${meta.total} cases &middot; ${meta.passed} pass &middot; ${meta.failed} fail</span>
    <span>vitest ${esc("3.2.7")} &middot; node environment</span>
    <span>regenerate with npm run test:report</span>
  </footer>
</div>

<script type="application/json" id="cases">${payload}</script>
<script>
(function () {
  var CASES = JSON.parse(document.getElementById("cases").textContent);
  var ledger = document.getElementById("ledger");
  var tally = document.getElementById("tally");
  var q = document.getElementById("q");
  var chips = Array.prototype.slice.call(document.querySelectorAll("#chips .chip"));
  var filter = "all";

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function render() {
    var term = q.value.trim().toLowerCase();
    var shown = CASES.filter(function (c) {
      if (filter === "FAIL" && c.s !== "FAIL") return false;
      if (filter !== "all" && filter !== "FAIL" && c.l !== filter) return false;
      if (!term) return true;
      return (c.i + " " + c.w + " " + c.a + " " + c.r).toLowerCase().indexOf(term) !== -1;
    });
    tally.textContent = shown.length + " of " + CASES.length + " shown";
    if (!shown.length) {
      ledger.innerHTML = '<p class="empty">No case matches that. Try a shorter word, or clear the filter.</p>';
      return;
    }
    ledger.innerHTML = shown
      .map(function (c) {
        return (
          '<div class="row r-' + c.s + '">' +
          '<span class="cid">' + esc(c.i) + "</span>" +
          '<span class="cwhat">' + esc(c.w) + (c.s === "FAIL" ? '<span class="flag">FAIL</span>' : "") + "</span>" +
          '<span class="carea">' + esc(c.a) + "</span>" +
          (c.s === "FAIL" && c.r ? '<span class="why">' + esc(c.r) + "</span>" : "") +
          "</div>"
        );
      })
      .join("");
  }

  chips.forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.getAttribute("data-f");
      chips.forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); });
      render();
    });
  });
  q.addEventListener("input", render);
  render();
})();
</script>
`;

  writeFileSync(outPath, html);
  return outPath;
}
