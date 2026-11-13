# Chemical Chain of Custody

A Jazz smart app (`d3340961-d93b-47b8-83ec-3c73032c01e1`) that draws a chain of
custody over Scispot labsheets: pick a chemical, see every lot of it, who
supplied each one, and how much is left.

Vite 5 · React 18 · TypeScript · Vitest · Playwright.

---

## The one rule that matters

**`src/` is the application under test. Do not change it.**

Everything in this repo exists to verify `src/`, not to improve it. A fix that
makes a test pass by editing the app is the wrong fix unless someone explicitly
asked for the app to be fixed.

Before finishing any task, `git diff HEAD -- src/` must be empty. If it is not,
either the change was asked for or it is a mistake. There is no third case.

The one legitimate exception: a demo or test may edit `src/` **transiently** if
it restores the file in a `finally`. `demo/custody-demo.spec.ts` does this.

---

## Layout

| Path | What it is |
|---|---|
| `src/` | the app under test — read, do not edit |
| `tests/` | logic, contract, dependency and coverage checks (Vitest, node env) |
| `e2e/` | browser cases against a **stand-in** Scispot SDK (Playwright) |
| `e2e-live/` | browser and schema cases against the **real** tenant (Playwright) |
| `scripts/` | report, gate, surface scan, Scispot login |
| `tools/runner/` | local web UI on `:4100` that runs the suite and exports a PDF |
| `demo/` | the recorded demo and the captured terminal session |
| `docs/AUTOMATION.md` | what each piece does, in full |

---

## Commands

```
npm run test          # 194 checks against the stand-in
npm run test:gate     # the commit gate (husky runs this + typecheck)
npm run test:report   # run everything, write reports/
npm run test:e2e      # the 49 browser cases only
npm run test:live     # the 42 against the real tenant, headless
npm run runner        # the runner UI on :4100
npm run demo:video    # re-record docs/media/custody-demo.webm
```

Environment: `WORKERS` (parallelism, both Playwright configs), `HEADED=1`
(visible browser), `SLOWMO`, `CHANNEL` (`chrome` default), `TRACE=1`.

---

## Conventions

### Test names carry their own root cause

```
it("PAGE-001 | with no filters it reads rows(), not search() || RCA: ...")
```

`ID | what it checks || RCA: why a failure matters to a user`.
`scripts/report.ts` splits on `|` and `||` to build the report, so **keep the
shape**. The RCA names the user-visible consequence, not the mechanism.

Live cases use Given / When / Then instead:

```
test("L1.3 | Given a chemical has an item ID, When I type the full ID, Then that chemical is found")
```

### ID prefixes

`LOGIC-` `PAGE-` `CONTRACT-` `CHAIN-` `SCHEMA-` `UUID-` `BOOT-` `CONN-`
`GUARD-` `COVER-` (Vitest) · `UI-` (stand-in browser) · `L<n>.<n>` (live).

---

## The two baselines

Both exist so the build stays meaningful instead of permanently red. **Neither
is a place to hide a new problem.**

**`tests/known-failures.json`** — the 8 documented defects. The gate lets these
through and blocks anything new. Fixing one means deleting its entry, never
editing its test to pass.

**`tests/coverage/coverage-baseline.json`** — the 11 parts of `src/` that no
test mentions. `scripts/coverage-surface.ts` scans `src/` for functions,
components, controls, messages, SDK calls and Scispot columns (60 today) and
`COVER-001` fails on anything new that is neither tested nor listed here.

Adding a line to either file is a decision. Make it explicitly, and say so.

---

## The live suite

Runs against the real Scispot tenant as a signed-in user.

**It is read-only.** It searches, views and opens. It creates nothing, edits
nothing, deletes nothing. Keep it that way — this points at real lab data.

- Session lives in `.auth/scispot.json` (git-ignored), from
  `npm run scispot:login -- <email>`. Expires about daily. The magic link and
  OTP need a human; they cannot be automated.
- **Tracing is off on purpose.** Saving a trace tears down the browser context
  after a failure, which closes the page the suite shares and makes the next
  tests fail for no reason. `TRACE=1` re-enables it for debugging one test.
  Leaving it on costs three false failures and 6 minutes.
- Every worker discovers its own chemical in `beforeAll`. Nothing may depend on
  another test having run — the suite runs parallel.
- Data is discovered at run time, never hard-coded. The lab edits its own
  labsheets.

---

## Gotchas worth knowing

- **`npm run demo:video` needs the runner on `:4100`** or Act 6's UI scenes fail.
- The 49 browser cases are **already inside** the 191 the report prints —
  `scripts/report.ts` merges `reports/playwright.json` into it. Do not add them
  again when totalling.
- `npm run test:gate` re-runs Vitest. In a sequence that already ran
  `test:report`, call `scripts/test-gate.ts reports/vitest.json` directly
  instead of running the suite twice.
- The stand-in SDK models Scispot rejecting a `Contains` filter on an
  `ID_BARCODE` column. **The live tenant accepts it.** `UI-018` and
  `CONTRACT-004` are red because the fixture is wrong about Scispot, not
  because the app is broken.

---

## Never commit

`.auth/` (session and tokens), `reports/` (generated, and the PDFs embed real
lab data), `test-results/`, `playwright-report/`, `demo-output/`.

`e2e-live/live-schema.json` **is** tracked and holds the tenant's real labsheet
and column names. Fine for a private repo; flag it before one goes public.

---

## Working here

- Do not commit or push unless asked.
- `main` is the default branch; branch before committing.
- The pre-commit hook runs `npm run typecheck && npm run test:gate`. It is the
  real gate, not a formality — if it refuses, read what it says rather than
  working around it.
- When a test fails, say whether it is the app or the test that is wrong.
  Several "defects" in this repo's history turned out to be test bugs, and
  saying so plainly is worth more than a green suite.
