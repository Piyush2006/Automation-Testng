/**
 * Coverage drift.
 *
 * Reads the app's testable surface out of src/ — exported functions, components,
 * labelled controls, user-visible messages, SDK calls, Scispot columns — and
 * checks that the test suites mention each one. Anything new that no test names
 * is reported by name, so a feature cannot be added without someone noticing
 * that it shipped untested.
 *
 * tests/coverage/coverage-baseline.json records the gaps accepted today. To
 * accept a new one, add it there deliberately; to close one, write the test and
 * delete the line.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { surface, untested } from "../../scripts/coverage-surface";

const baseline = JSON.parse(readFileSync("tests/coverage/coverage-baseline.json", "utf8")) as {
  acceptedWithoutTests: string[];
};
const accepted = new Set(baseline.acceptedWithoutTests);

describe("coverage guard — new functionality must arrive with test cases", () => {
  it("COVER-001 | no part of the app is untested without being signed off || RCA: something was added to src/ that no test names. It ships unverified: nobody will notice when it breaks, and the suite will stay green while it does. Either write a case for it, or add its id to tests/coverage/coverage-baseline.json to accept the gap on purpose.", () => {
    const gaps = untested().filter((s) => !accepted.has(s.id));
    const msg = gaps.map((g) => `\n    NEW, UNTESTED  ${g.kind.padEnd(9)} ${g.name}   (${g.where})`).join("");
    expect(gaps.length, `${gaps.length} new thing(s) in src/ that no test mentions:${msg}\n  `).toBe(0);
  });

  it("COVER-002 | the baseline has no stale entries || RCA: an accepted gap is now either tested or deleted from the app. Leaving it in the baseline means a future regression there would be waved through. Remove the line.", () => {
    const live = new Set(untested().map((s) => s.id));
    const stale = [...accepted].filter((id) => !live.has(id));
    expect(stale.join("  |  "), "accepted as untested, but no longer untested or no longer present").toBe("");
  });

  it("COVER-003 | the surface scan still finds the app || RCA: if the extractor silently matches nothing - a refactor, a moved folder, a changed export style - this guard goes green forever while covering nothing at all.", () => {
    const found = surface();
    expect(found.length, "the surface scan found almost nothing, so it is no longer watching the app").toBeGreaterThan(30);
    for (const kind of ["function", "component", "control", "column", "sdk"]) {
      expect(found.filter((s) => s.kind === kind).length, `no ${kind} found in src/`).toBeGreaterThan(0);
    }
  });
});
