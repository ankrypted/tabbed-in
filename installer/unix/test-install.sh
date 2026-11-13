#!/usr/bin/env bash
# Tests install.sh as a friend would use it: unpack the bundle, run the script.
# Everything happens in a temp folder with FAKE browser profiles; your real
# browsers and home folder are not touched. Works on Linux, macOS, and Git Bash.
# Run via:  npm run test:installer:unix   (builds the bundle first)
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="$(grep -Eo '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$ROOT/package.json" | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')"
BUNDLE_TGZ="$ROOT/.output/tabbed-in-linux-macos-$VERSION.tar.gz"
[ -f "$BUNDLE_TGZ" ] || { echo "Missing $BUNDLE_TGZ. Run 'npm run bundle:unix' first." >&2; exit 2; }

S="$(mktemp -d "${TMPDIR:-/tmp}/tabbed-in-unix-test.XXXXXX")"
trap 'rm -rf "$S"' EXIT
PASS=0; FAIL=0
check() {  # check "name" <exit-code-of-test>  [extra]
  if [ "$2" -eq 0 ]; then PASS=$((PASS + 1)); echo "PASS  $1 ${3:-}"; else FAIL=$((FAIL + 1)); echo "FAIL  $1 ${3:-}"; fi
}
has()  { printf '%s' "$1" | grep -Eq -- "$2"; }
hasnt(){ ! printf '%s' "$1" | grep -Eq -- "$2"; }

# ---- unpack the bundle like a friend would -----------------------------------
mkdir "$S/bundle" && tar -xzf "$BUNDLE_TGZ" -C "$S/bundle"
B="$(echo "$S"/bundle/*)"
INSTALL="$S/home/TabbedIn/extension"
mkdir -p "$S/home"

check "bundle has the scripts, README and extension zip" "$([ -f "$B/install.sh" ] && [ -f "$B/install.command" ] && [ -f "$B/README.txt" ] && ls "$B"/tabbed-in-*-chrome.zip >/dev/null 2>&1; echo $?)"
check "install.sh and install.command are executable" "$([ -x "$B/install.sh" ] && [ -x "$B/install.command" ]; echo $?)"
CR_COUNT="$(cat "$B/install.sh" "$B/install.command" "$B/README.txt" | tr -cd '\r' | wc -c | tr -d ' ')"
check "scripts have Unix line endings (no carriage returns)" "$([ "$CR_COUNT" = 0 ]; echo $?)" "(CR bytes: $CR_COUNT)"
check "install.sh parses (bash -n)" "$(bash -n "$B/install.sh"; echo $?)"

run() {  # run <os> [extra args...]  -> sets OUT and RC
  local os="$1"; shift
  OUT="$(HOME="$S/home" bash "$B/install.sh" --browser brave --os "$os" --install-dir "$INSTALL" --no-open --no-clipboard "$@" 2>&1)"; RC=$?
}
prefs() {  # prefs <dir> <settings-json>
  mkdir -p "$1/Default"
  # two keys that differ only by case, like real Chrome preference files
  printf '{"Foo":1,"foo":2,"extensions":{"settings":%s}}' "$2" > "$1/Default/Secure Preferences"
}

# ---- 1. clean install (Linux, then macOS wording) --------------------------------
EMPTY="$S/ud-empty"; prefs "$EMPTY" '{}'
run linux --user-data-dir "$EMPTY"
check "clean install exits 0" "$([ $RC -eq 0 ]; echo $?)"
check "unzipped manifest is Tabbed In" "$(grep -Eq '"name"[[:space:]]*:[[:space:]]*"Tabbed In"' "$INSTALL/manifest.json"; echo $?)"
SRC_COUNT="$(find "$ROOT/.output/chrome-mv3" -type f | wc -l | tr -d ' ')"
DST_COUNT="$(find "$INSTALL" -type f | wc -l | tr -d ' ')"
check "extension files match the build" "$([ "$SRC_COUNT" = "$DST_COUNT" ]; echo $?)" "($DST_COUNT files)"
check "prints exact steps (Developer mode, Load unpacked, Ctrl+L)" "$(has "$OUT" 'EXACT STEPS' && has "$OUT" 'Developer mode' && has "$OUT" 'Load unpacked' && has "$OUT" 'Ctrl\+L'; echo $?)"
check "prints the real folder path to paste" "$(has "$OUT" "$INSTALL"; echo $?)"
check "no warning about other copies" "$(hasnt "$OUT" 'Another copy'; echo $?)"
run macos --user-data-dir "$EMPTY"
check "macOS wording: Command+Shift+G" "$(has "$OUT" 'Command\+Shift\+G' && hasnt "$OUT" 'Ctrl\+L'; echo $?)"

# ---- 2. update replaces the old files completely ----------------------------------
echo old > "$INSTALL/leftover-from-old-version.txt"; mkdir "$INSTALL/old-folder"
run linux --user-data-dir "$EMPTY"
check "update exits 0" "$([ $RC -eq 0 ]; echo $?)"
check "old leftover files are gone" "$([ ! -e "$INSTALL/leftover-from-old-version.txt" ] && [ ! -e "$INSTALL/old-folder" ]; echo $?)"
check "says it replaced the old files" "$(has "$OUT" 'Replaced the old files'; echo $?)"

# ---- 3. the same copy is already added -----------------------------------------------
SAME="$S/ud-same"
prefs "$SAME" "{\"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\":{\"path\":\"$INSTALL\",\"manifest\":{\"name\":\"Tabbed In\"}}}"
run linux --user-data-dir "$SAME"
check "already added from this folder: just reload" "$(has "$OUT" 'already added from this folder' && has "$OUT" 'RELOAD icon' && hasnt "$OUT" 'Click "Load unpacked"'; echo $?)"
check "...with no other-copy warning" "$(hasnt "$OUT" 'Another copy'; echo $?)"

# ---- 4. other copies are already added ------------------------------------------------
OTHERDIR="$S/dev-build"; mkdir "$OTHERDIR"; echo '{"name":"Tabbed In","version":"0.0.1"}' > "$OTHERDIR/manifest.json"
MULTI="$S/ud-multi"
prefs "$MULTI" "{\"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\":{\"path\":\"$OTHERDIR\",\"manifest\":{\"name\":\"Tabbed In\"}},\"cccccccccccccccccccccccccccccccc\":{\"path\":\"/gone/old-tabbed-in\",\"manifest\":{\"name\":\"Tabbed In\"}},\"dddddddddddddddddddddddddddddddd\":{\"manifest\":{\"name\":\"Tabbed In\"}},\"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee\":{\"path\":\"$OTHERDIR\",\"manifest\":{\"name\":\"Some Other Extension\"}}}"
BEFORE_SUM="$(cksum < "$MULTI/Default/Secure Preferences")"
run linux --user-data-dir "$MULTI"
check "warns about other copies" "$(has "$OUT" 'Another copy of Tabbed In'; echo $?)"
check "...one loaded from a different folder" "$(has "$OUT" "loaded from: $OTHERDIR"; echo $?)"
check "...one whose folder no longer exists" "$(has "$OUT" 'no longer exists'; echo $?)"
check "...one from the Web Store" "$(has "$OUT" 'Web Store'; echo $?)"
check "does not flag unrelated extensions" "$([ "$(printf '%s\n' "$OUT" | grep -c "profile 'Default'")" = 3 ]; echo $?)"
check "still shows the add steps (not registered here)" "$(has "$OUT" 'Load unpacked'; echo $?)"
check "steps tell the user to Remove the older copy first" "$(has "$OUT" 'REMOVE the older copy first'; echo $?)"
check "does not touch the other copy's folder" "$([ -f "$OTHERDIR/manifest.json" ]; echo $?)"
check "does not modify the browser's preferences file" "$([ "$(cksum < "$MULTI/Default/Secure Preferences")" = "$BEFORE_SUM" ]; echo $?)"

# ---- 5. safety refusals -----------------------------------------------------------------
NOTOURS="$S/precious"; mkdir "$NOTOURS"; echo 'keep me' > "$NOTOURS/important.txt"
OUT="$(HOME="$S/home" bash "$B/install.sh" --browser brave --install-dir "$NOTOURS" --no-open --no-clipboard --user-data-dir "$EMPTY" 2>&1)"; RC=$?
check "refuses to overwrite a folder that is not a Tabbed In install" "$([ $RC -ne 0 ] && [ -f "$NOTOURS/important.txt" ] && has "$OUT" 'does not look like'; echo $?)"

echo 'not an extension' > "$S/wrong.txt"
( cd "$S" && python -c "import zipfile; z=zipfile.ZipFile('wrong.zip','w'); z.write('wrong.txt'); z.close()" 2>/dev/null || zip -q wrong.zip wrong.txt 2>/dev/null )
if [ -f "$S/wrong.zip" ]; then
  OUT="$(HOME="$S/home" bash "$B/install.sh" --zip "$S/wrong.zip" --browser brave --install-dir "$S/x/ext" --no-open --no-clipboard --user-data-dir "$EMPTY" 2>&1)"; RC=$?
  check "rejects a zip that is not the extension" "$([ $RC -ne 0 ] && has "$OUT" 'no manifest.json'; echo $?)"
fi

OUT="$(bash "$B/install.sh" --browser brave --install-dir "$INSTALL" --no-open --user-data-dir "$EMPTY" --zip "$S/does-not-exist.zip" 2>&1)"; RC=$?
check "a missing zip is reported clearly" "$([ $RC -ne 0 ] && has "$OUT" 'Zip not found'; echo $?)"

# ---- 6. uninstall ------------------------------------------------------------------------
OUT="$(bash "$B/install.sh" --install-dir "$INSTALL" --uninstall 2>&1)"; RC=$?
check "uninstall removes the folder" "$([ ! -e "$INSTALL" ] && has "$OUT" 'Remove on'; echo $?)"
OUT="$(bash "$B/install.sh" --install-dir "$NOTOURS" --uninstall 2>&1)"; RC=$?
check "uninstall refuses a folder that is not ours" "$([ $RC -ne 0 ] && [ -f "$NOTOURS/important.txt" ]; echo $?)"

# ---- 7. the Python fallback for reading profiles ---------------------------------------------
# Put a perl stub that always fails first on PATH, so the script must use python instead.
if command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
  NOPERL="$S/noperl"; mkdir "$NOPERL"
  printf '#!/bin/sh\nexit 1\n' > "$NOPERL/perl"; chmod +x "$NOPERL/perl"
  OUT="$(PATH="$NOPERL:$PATH" HOME="$S/home" bash "$B/install.sh" --browser brave --os linux --install-dir "$INSTALL" --no-open --no-clipboard --user-data-dir "$MULTI" 2>&1)"; RC=$?
  # (Only count the copies: on Git Bash, Windows Python can't see /tmp-style paths, so it
  # can't tell "other folder" from "missing". On Linux/macOS it can.)
  check "without perl, python reads the profile instead" "$(has "$OUT" 'Another copy of Tabbed In' && [ "$(printf '%s\n' "$OUT" | grep -c "profile 'Default'")" = 3 ]; echo $?)"

  # And with neither perl nor python: it must say it could not check, not crash.
  printf '#!/bin/sh\nexit 1\n' > "$NOPERL/python"; printf '#!/bin/sh\nexit 1\n' > "$NOPERL/python3"; chmod +x "$NOPERL/python" "$NOPERL/python3"
  OUT="$(PATH="$NOPERL:$PATH" HOME="$S/home" bash "$B/install.sh" --browser brave --os linux --install-dir "$INSTALL" --no-open --no-clipboard --user-data-dir "$MULTI" 2>&1)"; RC=$?
  check "with neither perl nor python, it says it couldn't check (and still installs)" "$([ $RC -eq 0 ] && has "$OUT" 'Could not check whether'; echo $?)"
fi

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
