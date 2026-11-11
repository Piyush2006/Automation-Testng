#!/usr/bin/env bash
#
# Live demo: show the dependency guard refusing a Scispot schema change.
#
#   npm run demo:guard          # pauses between acts so you can narrate
#   NOPAUSE=1 npm run demo:guard
#
# Act 2 edits the captured schema snapshot to stand in for someone renaming a
# column in Scispot. The snapshot is backed up first and restored on exit,
# including on Ctrl-C. Nothing in Scispot is touched.
set -uo pipefail
cd "$(dirname "$0")/.."

SNAP="tests/deps/scispot-snapshot.json"
BACKUP="$(mktemp -t snapshot-backup)"
cp "$SNAP" "$BACKUP"
restore() { cp "$BACKUP" "$SNAP" && rm -f "$BACKUP"; }
trap restore EXIT INT TERM

b=$(printf '\033[1m'); dim=$(printf '\033[2m'); off=$(printf '\033[0m')
red=$(printf '\033[31m'); grn=$(printf '\033[32m'); cyn=$(printf '\033[36m')
rule() { printf '%s%s%s\n' "$dim" "────────────────────────────────────────────────────────────────────────" "$off"; }
act()  { printf '\n'; rule; printf '%s%s%s\n' "$b$cyn" "$1" "$off"; printf '%s%s%s\n' "$dim" "$2" "$off"; rule; printf '\n'; }
pause() { [ "${NOPAUSE:-}" = "1" ] || { printf '\n%s[ press enter ]%s' "$dim" "$off"; read -r _ </dev/tty || true; printf '\n'; }; }

act "ACT 1 — the guard today" \
    "15 checks compare the app's code, the dependency manifest, and Scispot's schema."
npx vitest run tests/dependency --reporter=verbose 2>&1 | sed -n '/GUARD-/,$p' | head -30
pause

act "ACT 2 — someone renames a column in Scispot" \
    "'Item Name' becomes 'Chemical Name' on the List of Inventory Items labsheet."
python3 - "$SNAP" <<'PY'
import json, sys
p = sys.argv[1]
d = json.load(open(p))
for col in d["sheets"]["List of Inventory Items"]:
    if col["name"] == "Item Name":
        col["name"] = "Chemical Name"
json.dump(d, open(p, "w"), indent=2)
print("  snapshot updated: List of Inventory Items -> 'Item Name' is now 'Chemical Name'")
PY
printf '\n%sRunning the guard against that change:%s\n\n' "$b" "$off"
npx vitest run tests/dependency --reporter=verbose 2>&1 | sed -n '/GUARD-/,$p' | head -40
printf '\n%s%sThe guard refused it, and named what breaks before anyone opened the app.%s\n' "$b" "$red" "$off"
pause

act "ACT 3 — put it back" \
    "The snapshot is restored, so the repo is exactly as it was."
restore
trap - EXIT INT TERM
npx vitest run tests/dependency 2>&1 | tail -8
printf '\n%s%sBack to the baseline: the same 15 checks, the same 2 known failures.%s\n\n' "$b" "$grn" "$off"
