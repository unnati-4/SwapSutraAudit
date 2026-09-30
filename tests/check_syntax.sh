#!/usr/bin/env bash
#
# Parse every source file the Vercel build will parse, and FAIL LOUDLY.
#
# WHY THIS EXISTS
# ---------------
# A broken JSX tag shipped to production and failed the Vercel build,
# after a local check had reported "0 syntax errors". The check was
# lying. Run from the project root, `tsc <file>` sees tsconfig.json,
# emits TS5112 ("tsconfig.json is present but will not be loaded if
# files are specified on commandline"), and CHECKS NOTHING. The old
# command then counted syntax errors in that non-output and, finding
# none, reported success.
#
# Two lessons are baked in here:
#   1. --ignoreConfig, so the file is actually parsed.
#   2. Never infer success from "no matches in output". A tool that
#      refused to run produces no matches too. This script asserts the
#      tool did the work, and exits non-zero on any structural error.
#
# Type errors (TS2xxx) are EXPECTED and ignored: node_modules is not
# installed in this workspace, so every import is unresolvable. Only
# parse/structure errors matter — those are exactly what breaks a build.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# Everything the build parses — discovered, not hand-listed. A hardcoded
# list silently stops covering whatever gets added next.
mapfile -t FILES < <(
  find src api . -maxdepth 3 \
    \( -name node_modules -o -name dist -o -name .git \) -prune -o \
    \( -name '*.ts' -o -name '*.tsx' \) -print 2>/dev/null \
  | grep -v -E 'node_modules|/dist/|\.d\.ts$' \
  | sed 's|^\./||' | sort -u
)

if [ "${#FILES[@]}" -eq 0 ]; then
  echo "BROKEN CHECK  found no source files to check — the glob is wrong."
  exit 1
fi
echo "Checking ${#FILES[@]} source files."

# Structural failures: unbalanced tags, malformed syntax. TS1xxx is the
# parser's own error range; TS17002/17008 are the JSX tag-matching ones
# that the failed deployment actually hit.
STRUCTURAL='error TS(1[0-9]{3}|17002|17008)[^0-9]'

fail=0

for f in "${FILES[@]}"; do
  if [ ! -f "$f" ]; then
    echo "SKIP  $f (not present)"
    continue
  fi

  out=$(tsc --noEmit --jsx preserve --noResolve --ignoreConfig "$f" 2>&1)

  # The check must prove it ran. TS5112 means tsc bailed before parsing.
  if echo "$out" | grep -q "TS5112"; then
    echo "BROKEN CHECK  $f — tsc refused to run (TS5112). Missing --ignoreConfig?"
    fail=1
    continue
  fi

  errs=$(echo "$out" | grep -E "$STRUCTURAL" || true)
  if [ -n "$errs" ]; then
    echo "FAIL  $f"
    echo "$errs" | sed 's/^/        /'
    fail=1
  else
    echo "ok    $f"
  fi
done

# Apps Script is plain JS; node's own parser is the authority there.
if [ -f appsscript.js ]; then
  if node --check appsscript.js 2>/dev/null; then
    echo "ok    appsscript.js"
  else
    echo "FAIL  appsscript.js"
    node --check appsscript.js 2>&1 | sed 's/^/        /'
    fail=1
  fi
fi

# SELF-TEST — the part that matters.
#
# A checker that silently passes everything is worse than no checker,
# and that is exactly the failure this script was written after. So the
# script proves it can still fail: it takes the real App.tsx, deletes
# one closing </div>, and asserts that the check catches it. If this
# self-test ever stops failing on broken input, the check has gone blind
# again and the script says so instead of reporting "All files parse."
if [ -f src/App.tsx ]; then
  probe="$(mktemp -d)/probe.tsx"
  node -e '
    const fs = require("fs");
    const s = fs.readFileSync("src/App.tsx", "utf8");
    // Remove the first closing </div> that follows a component tag.
    const i = s.indexOf("\n              </div>");
    if (i === -1) { console.error("self-test could not find a </div> to remove"); process.exit(2); }
    fs.writeFileSync(process.argv[1], s.slice(0, i) + s.slice(i + "\n              </div>".length));
  ' "$probe" || { echo "BROKEN CHECK  self-test could not build its probe"; fail=1; }

  if [ -f "$probe" ]; then
    probe_out=$(tsc --noEmit --jsx preserve --noResolve --ignoreConfig "$probe" 2>&1)
    if echo "$probe_out" | grep -qE "$STRUCTURAL"; then
      echo "ok    self-test (a deliberate break IS caught)"
    else
      echo "BROKEN CHECK  self-test: a deliberately broken file passed."
      echo "              This check is blind. Do not trust its 'ok' lines."
      fail=1
    fi
    rm -rf "$(dirname "$probe")"
  fi
fi

if [ "$fail" -ne 0 ]; then
  echo
  echo "SYNTAX CHECK FAILED — this would break the Vercel build."
  exit 1
fi

echo
echo "All files parse."
