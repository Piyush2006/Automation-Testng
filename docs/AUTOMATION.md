# QA automation

What exists, what each piece does, and how to run it.

The app under test is **Chemical Chain of Custody**, a Jazz smart app
(`d3340961-d93b-47b8-83ec-3c73032c01e1`) that reads three Scispot labsheets:

| Labsheet | What the app uses it for |
|---|---|
| `List of Inventory Items` | the chemical catalogue — the search box reads `Item Name` and `Note` |
| `A. Materials Manager` | lots — quantities, units, lot numbers, expiry, location and supplier |
| `SUP. Suppliers` | suppliers — opened from a vendor node |

Between them the app reads **18 named columns**. Any lab admin can rename one
without telling engineering. The app does not crash when that happens; the field
silently empties and the screen is confidently wrong. Most of what follows
exists because of that.

---

## 1. Checks against a stand-in — 191

No login, no network, no production data. A fake Scispot SDK is served in place
of the real one, so the app connects to it exactly as it would in production and
cannot tell the difference.

```
npm run test          # all of it
npm run test:e2e      # the 49 browser cases only
npm run test:report   # run everything and write reports/
```

Split roughly: 145 logic and contract checks under `tests/` and
`src/lib/quantity.test.ts`, plus 49 browser cases under `e2e/` that drive the
real app in Chromium.

**Result today: 183 pass, 8 fail.** The 8 are documented defects listed in
`tests/known-failures.json`, not surprises.

---

## 2. Checks against real Scispot — 42

Signs in as a real user with a saved session, opens the app in real Chrome
inside the Jazz iframe, and drives it against live lab data.

```
npm run test:live         # headless, about 2 minutes
npm run test:live:watch   # visible Chrome, slowed down, for showing people
```

**Read-only.** It searches, views and opens. It creates nothing, edits nothing
and deletes nothing.

Each case is written as Given / When / Then and grouped into six sections:

| | Section | Cases |
|---|---|--:|
| 1 | Searching for a chemical | 11 |
| 2 | The lots and vendors that come back | 12 |
| 3 | Quantity Left, and the sum across vendors | 10 |
| 4 | When somebody renames a column or changes a mapping | 6 |
| 5 | What runs on every commit | 3 |
| 6 | Getting connected | 4 |

Files: `e2e-live/live.spec.ts` (36 browser checks),
`e2e-live/schema.spec.ts` (6 checks comparing `src/config.ts` against the live
schema), `e2e-live/live-schema.json` (the tenant's schema as captured).

**Result today: 37 pass, 3 fail, 6 not testable live.** The six skips each state
their reason rather than disappearing quietly.

### Signing in

```
npm run scispot:login -- you@company.com
```

Opens a Chrome window, fills the email, requests the magic link, then waits
while you click the link and type the OTP. The session is saved to
`.auth/scispot.json`, which is git-ignored, and reused by every later run until
it expires — about a day.

---

## 3. The commit gate

Runs automatically before every commit, via husky.

```
npm run test:gate   # to run it by hand
```

It compares the current failures against `tests/known-failures.json`. Known
defects pass through; anything new blocks the commit and is named by its ID.

```
Failing 8   known defects 8/8   NEW 0
PASS. No regression: every failure is a known defect.
```

A change that breaks something that worked before cannot be committed. It is not
a review step anyone can skip.

---

## 4. The coverage guard

The gate protects what is already tested. This protects what is not.

`scripts/coverage-surface.ts` reads the app's testable surface out of `src/` —
**60 items today**:

| Kind | Count | What a new one means |
|---|--:|---|
| function | 25 | a new exported helper |
| column | 17 | a new Scispot column read |
| component | 5 | a new screen or panel |
| control | 5 | a new button, field or `aria-label` |
| sdk | 5 | a new Scispot call |
| message | 3 | a new user-visible message |

It then checks whether any test file mentions each one. **11 do not**, and those
are recorded in `tests/coverage/coverage-baseline.json` as accepted.

Anything new that nothing mentions fails `COVER-001` by name:

```
1 new thing(s) in src/ that no test mentions:
    NEW, UNTESTED  function  daysUntilExpiry   (src/lib/quantity.ts)
```

Three cases, in `tests/coverage/coverage-guard.test.ts`:

- `COVER-001` — no untested part of the app without sign-off
- `COVER-002` — the baseline has no stale entries, so closed gaps get pruned
- `COVER-003` — the scan still finds the app, so a refactor cannot quietly turn
  the guard into a no-op

`COVER-002` earned its place immediately: the first version counted the baseline
file itself as coverage, and since that file names every accepted gap, all of
them looked tested. The guard would have passed forever while watching nothing.

**To close a gap**, write the check and delete its line. **To accept one**, add
the line deliberately.

---

## 5. The runner

A local web app. Nothing to remember, and it produces something you can hand over.

```
npm run runner    # http://localhost:4100
```

- **Session strip** — green when signed in, with the expiry; amber when not
- **Coverage alert** — names anything added to the app that nothing checks,
  refreshed on load, after each run, and on demand
- **What runs** — the 42, with its six sections listed
- **Workers** — parallelism, default 2
- **Watch** — opens a visible Chrome window, slowed to 250ms
- **Run / Stop** — Stop reports the partial result rather than discarding it
- **Live log** — streams as it happens
- **Download PDF** — Scispot logo, entity, application, labsheets used,
  environment, every case, and the full log. Also saved to `reports/`.

---

## 6. The demo video

```
npm run demo:video
```

Seven acts, in `docs/media/custody-demo.webm`. Acts 3 to 6 replay a session
captured by actually running the commands against a throwaway clone
(`demo/capture-session.ts`), so a commit is genuinely blocked on camera. Act 6
genuinely edits `src/lib/quantity.ts`, reads the alert back from the live runner,
and restores the file.

**The runner must be on `:4100` when you record**, or Act 6's UI scenes fail.

---

## What the three live defects are

| ID | What it found |
|---|---|
| `L3.10` | The lot panel shows `Containers -450`. Quantity is 50 uL, Quantity Consumed is 0.5 mL — 500 uL. The two are subtracted without reconciling their scales. |
| `L3.9` | The Unit dropdown offers `ng` and `ug`. `UNIT_TABLE` in `src/lib/quantity.ts` does not list them, so a lot measured in either never joins its total. No live row uses them yet. |
| `L4.4` | The app reads the `Location` column as a fallback but leaves it out of the startup schema check, so renaming it warns nobody. |

`L3.10` could only be found by running against real data. The stand-in suite
asserts the opposite — that containers are always 1 on this tenant.

---

## Known gaps

**There is no specification.** Every check was derived from the code and the live
schema. They catch regressions, and the code disagreeing with Scispot. They
cannot catch the app doing something the lab never asked for.

**Two of the eight known defects are wrong about Scispot.** `UI-018` and
`CONTRACT-004` are red because the fixture SDK models Scispot rejecting a
`Contains` filter on an `ID_BARCODE` column. The live tenant accepts it —
searching by item ID works. The stand-in is wrong, not the app. Worth saying
before the number 8 gets quoted.

**It runs as one person's login.** A personal session that expires daily, with
every call audit-logged to that account. A service account is the prerequisite
for anything unattended.

**One app, fixed in place.** The app id and its three labsheets are constants.

**The screen is not checked against the rows.** The live checks prove the app
shows something plausible, not that it shows the truth. Pulling the real rows
through the API and comparing would catch a wrong number, not just a missing one.

---

## Every command

| Command | What it does |
|---|---|
| `npm run runner` | the local runner UI on :4100 |
| `npm run test` | all 194 stand-in checks |
| `npm run test:e2e` | the 49 browser cases only |
| `npm run test:report` | run everything, write `reports/` |
| `npm run test:gate` | the commit gate, by hand |
| `npm run test:deps` | the dependency guard only |
| `npm run test:live` | the 42, headless |
| `npm run test:live:watch` | the 42, visible Chrome |
| `npm run scispot:login -- <email>` | sign in and save the session |
| `npm run demo:video` | re-record the demo |
| `npm run test:ui` / `test:e2e:ui` | Vitest and Playwright interactive runners |

### Environment variables

| | |
|---|---|
| `WORKERS` | parallelism for both Playwright configs |
| `HEADED=1` | visible browser, slowed down |
| `SLOWMO` | milliseconds between actions, default 250 |
| `CHANNEL` | `chrome` by default; `chromium` to fall back |
| `TRACE=1` | turn Playwright tracing back on for the live suite |

Tracing is **off** in the live config on purpose. Saving a trace tears the
browser context down after a failure, which closes the page the suite shares and
makes the following tests fail for no reason. With it off the suite runs in
under two minutes instead of eight.

---

## What is git-ignored, and why

| Path | Why |
|---|---|
| `.auth/` | the signed-in Scispot session and captured tokens |
| `reports/*.pdf`, `*.json`, `*.csv`, `*.html`, `*.md` | generated output, and the PDFs embed real lab data |
| `test-results/`, `playwright-report/`, `demo-output/` | run artifacts |

`e2e-live/live-schema.json` **is** tracked and contains the tenant's real
labsheet and column names. Fine for a private repo; worth knowing before one
goes public.
