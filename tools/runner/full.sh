#!/bin/bash
# Every suite, in order. Used by the runner UI.
#
#   WORKERS=n   parallelism, passed to both Playwright configs
#   HEADED=1    open a visible Chrome window for the browser stages
#
# Each stage runs regardless of whether the one before it failed, and the 142
# logic tests run ONCE: the gate re-reads the JSON that stage 3 already wrote.
cd "$(dirname "$0")/../.."
H=""; [ "$HEADED" = "1" ] && H="--headed"
W=""; [ -n "$WORKERS" ] && W="--workers=$WORKERS"
echo "workers: ${WORKERS:-default}   headed: ${HEADED:-0}"

names=(); codes=()
stage(){
  local name="$1"; shift
  echo ""; echo "=== $name ==="
  "$@"; local c=$?
  names+=("$name"); codes+=("$c")
  echo "--- $name finished, exit $c ---"
  return 0
}

stage "typecheck"            npx tsc -p tsconfig.app.json
stage "browser vs stand-in"  npx playwright test --reporter=list $W $H
stage "logic + contract"     npm run test:report
# Reuses reports/vitest.json from the stage above instead of running the 142 again.
stage "commit gate"          npx vite-node scripts/test-gate.ts reports/vitest.json
stage "live vs real Scispot" npx playwright test --config playwright.live.config.ts --reporter=list $W $H

echo ""; echo "=== summary ==="
bad=0
for i in "${!names[@]}"; do
  c="${codes[$i]}"
  if [ "$c" = "0" ]; then printf '  OK    %s\n' "${names[$i]}"
  else printf '  FAIL  %s  (exit %s)\n' "${names[$i]}" "$c"; bad=1; fi
done
echo "  note: 'logic + contract' exits 1 by design while the 8 known defects stand"
exit $bad
