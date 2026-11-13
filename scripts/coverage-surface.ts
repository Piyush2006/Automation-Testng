/**
 * The app's testable surface, read straight out of src/.
 *
 * Anything a developer can ADD that users will notice shows up here: an exported
 * function, a component, a labelled control, a Scispot column the app reads, an
 * SDK call it makes. The coverage guard compares this against what the tests
 * actually mention, so a new feature with no test case is reported by name.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type SurfaceItem = { id: string; kind: string; name: string; where: string };

const read = (p: string) => readFileSync(p, "utf8");
const srcFiles = (dir: string, ext: string[]): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((d) => (d.isDirectory() ? srcFiles(join(dir, d.name), ext) : [join(dir, d.name)]))
    .filter((f) => ext.some((e) => f.endsWith(e)) && !/\.test\.|\.spec\./.test(f));

export function surface(): SurfaceItem[] {
  const out: SurfaceItem[] = [];
  const seen = new Set<string>();
  const add = (kind: string, name: string, where: string) => {
    const id = `${kind}:${name}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, kind, name, where });
  };

  for (const file of srcFiles("src", [".ts", ".tsx"])) {
    const body = read(file);

    // exported functions and consts — the logic a test can call directly
    for (const m of body.matchAll(/^export (?:async )?function ([A-Za-z0-9_]+)/gm)) add("function", m[1]!, file);
    for (const m of body.matchAll(/^export const ([A-Za-z0-9_]+)\s*[:=]\s*(?:async\s*)?\(/gm)) add("function", m[1]!, file);

    // React components
    for (const m of body.matchAll(/^export (?:default )?function ([A-Z][A-Za-z0-9_]*)/gm)) add("component", m[1]!, file);

    // controls a user can see or click
    for (const m of body.matchAll(/aria-label="([^"]+)"/g)) add("control", m[1]!, file);
    for (const m of body.matchAll(/placeholder="([^"]+)"/g)) add("control", m[1]!, file);

    // messages the app can show — a new one is a new user-visible state
    for (const m of body.matchAll(/(?:>|\s|\{")([A-Z][a-z][^<>{}"'`]{18,90}?[.?])(?:<|"|\s*\})/g)) {
      const t = m[1]!.trim();
      if (/\$\{|\bfunction\b|=>/.test(t)) continue;
      add("message", t, file);
    }

    // Scispot SDK calls
    for (const m of body.matchAll(/labsheets\.([a-zA-Z0-9_]+)\s*\(/g)) add("sdk", `labsheets.${m[1]!}`, file);
  }

  // every Scispot column and sheet the app names
  const cfg = read("src/config.ts");
  for (const m of cfg.matchAll(/^\s{2}([a-zA-Z0-9_]+):\s*"([^"]*)"/gm)) {
    if (m[2]) add("column", m[2]!, "src/config.ts");
  }
  return out;
}

/** Everything the test suites mention, as one haystack. */
export function testText(): string {
  const dirs = ["tests", "e2e", "e2e-live", "src"];
  let all = "";
  for (const d of dirs) {
    let files: string[] = [];
    try {
      files = readdirSync(d, { withFileTypes: true })
        .flatMap((x) => (x.isDirectory() ? srcFiles(join(d, x.name), [".ts", ".tsx"]).concat(
          readdirSync(join(d, x.name)).map((f) => join(d, x.name, f))) : [join(d, x.name)]));
    } catch { continue; }
    for (const f of new Set(files)) {
      if (!/\.(ts|tsx|json)$/.test(f)) continue;
      // The baseline NAMES each accepted gap, so counting it as coverage would
      // make every gap look tested and this guard would pass forever.
      if (/coverage-baseline/.test(f)) continue;
      if (!/\.test\.|\.spec\.|manifest|snapshot|fixtures|helpers|known-failures/.test(f)) continue;
      try { all += "\n" + read(f); } catch { /* directory */ }
    }
  }
  return all;
}

/** Items the tests never mention. */
export function untested(): SurfaceItem[] {
  const hay = testText();
  return surface().filter((s) => !hay.includes(s.name));
}
