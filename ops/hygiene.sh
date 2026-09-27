#!/usr/bin/env bash
#
# Tripwires for defects this repository has actually had.
#
# Usage: ops/hygiene.sh

set -uo pipefail
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

FAILURES=0
check() {
    local label="$1"; shift
    if "$@"; then
        printf 'ok   %s\n' "$label"
    else
        printf 'FAIL %s\n' "$label"
        FAILURES=$((FAILURES + 1))
    fi
}

# Tracked files plus new ones that are not gitignored. `git ls-files` alone
# sees only what is committed, so a file added in the same change would be
# skipped by every check here.
repo_files() {
    git ls-files --cached --others --exclude-standard
}

# `! cmd | xargs grep | grep .` is unreliable under `set -o pipefail`: xargs
# returns non-zero when a batch has no match, which makes the pipeline non-zero
# and the negation report success while printing the matches it found.
expect_no_matches() {
    local hits
    hits=$(eval "$1" 2>/dev/null)
    [ -z "$hits" ] && return 0
    echo "$hits" | head -20 | sed 's/^/  /'
    return 1
}

# "latest" is not a version. A fresh install can pull a breaking major with no
# change to package.json, so two checkouts of the same commit build different
# applications. Five dependencies were pinned this way.
no_floating_dependency_ranges() {
    node -e '
      const pkg = require("./package.json");
      const bad = [];
      for (const section of ["dependencies", "devDependencies"]) {
        for (const [name, spec] of Object.entries(pkg[section] || {})) {
          if (spec === "latest" || spec === "*" || spec === "") bad.push(`${section}.${name} = ${spec}`);
        }
      }
      if (bad.length) { for (const b of bad) console.log("  " + b); process.exit(1); }
    '
}

# `npm test` must not be watch mode, or CI hangs until it is cancelled.
test_script_is_not_watch_mode() {
    node -e '
      const s = require("./package.json").scripts || {};
      if (!s.test || !/\bvitest\s+run\b/.test(s.test)) {
        console.log(`  scripts.test is ${JSON.stringify(s.test)}; expected "vitest run"`);
        process.exit(1);
      }
    '
}

# The publish route takes a device id from the request body and puts it in an
# MQTT topic. Being signed in was once the only check, so any user could
# command any device.
publish_route_checks_device_ownership() {
    local f=app/api/mqtt/publish/route.ts
    grep -q "from('devices')" "$f" && grep -q "device_not_found" "$f"
}

# ...and the id is constrained, because '/', '+' and '#' are topic separators
# and wildcards.
publish_route_constrains_the_device_id() {
    grep -q 'regex(' app/api/mqtt/publish/route.ts
}

# The old client was abandoned on close rather than ended, so each publish
# during an outage left another one retrying for the life of the process.
mqtt_client_is_ended_not_abandoned() {
    local f=lib/supabase/mqtt-server.ts
    grep -q 'client.end(' "$f" && grep -q 'removeAllListeners' "$f"
}

mqtt_queue_is_bounded() {
    grep -q 'MAX_QUEUE_LENGTH' lib/supabase/mqtt-server.ts
}

# Build and dev artefacts must not be committed. dev-server.log was.
no_build_artefacts_committed() {
    # git ls-files, not repo_files: "committed" is about what is tracked. An
    # artefact that is merely gitignored is already fine, and looking at the
    # untracked set would make this check unable to fail once .gitignore
    # covered the file - which is exactly what happened the first time.
    expect_no_matches "git ls-files | grep -E '(^|/)(dev-server\.log|.*\.log|.*\.tsbuildinfo|next-env\.d\.ts|AGENTS\.md)\$|^\.next/|^node_modules/'"
}

no_env_committed() {
    expect_no_matches "repo_files | grep -E '(^|/)\.env(\..*)?\$' | grep -v '\.env\.example\$'"
}

# House style: no em dashes, en dashes or emoji in anything tracked.
no_decorative_glyphs() {
    expect_no_matches "repo_files | grep -vE '\.(png|jpg|jpeg|gif|svg|ico|woff2?)\$' | xargs grep -nP '[\x{2013}\x{2014}\x{1F000}-\x{1FAFF}\x{2600}-\x{27BF}\x{FE0F}]'"
}

readme_images_resolve() {
    local missing=0 img found=0
    for img in $( { grep -ohE '\]\(([^)]+\.(jpg|jpeg|png|gif))\)' README.md 2>/dev/null | sed -E 's/^\]\(//; s/\)$//';
                    grep -ohE 'src="([^"]+\.(jpg|jpeg|png|gif))"' README.md 2>/dev/null | sed -E 's/^src="//; s/"$//'; } | sort -u ); do
        found=$((found + 1))
        [ -f "$img" ] || { echo "  missing image: $img"; missing=1; }
    done
    # A check that matched nothing is not a check that passed.
    [ "$found" -gt 0 ] || { echo "  no image references found at all"; missing=1; }
    [ "$missing" -eq 0 ]
}

check "no floating 'latest' dependency ranges"   no_floating_dependency_ranges
check "npm test is not watch mode"               test_script_is_not_watch_mode
check "publish route checks device ownership"    publish_route_checks_device_ownership
check "publish route constrains the device id"   publish_route_constrains_the_device_id
check "mqtt client is ended, not abandoned"      mqtt_client_is_ended_not_abandoned
check "mqtt queue is bounded"                    mqtt_queue_is_bounded
check "no build artefacts committed"             no_build_artefacts_committed
check "no .env committed"                        no_env_committed
check "no em dashes, en dashes or emoji"         no_decorative_glyphs
check "README images all resolve"                readme_images_resolve

echo
if [ "$FAILURES" -eq 0 ]; then
    echo "hygiene: all checks passed"
else
    echo "hygiene: ${FAILURES} check(s) failed"
fi
exit "$FAILURES"
