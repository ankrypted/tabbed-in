#!/usr/bin/env bash
# Installs (or updates) the Tabbed In extension for Brave, Chrome, Chromium, or
# Edge on Linux and macOS.
#
# Chrome-family browsers do not let any script add or remove an extension
# silently; that is a deliberate security rule (and the browser's preferences
# file is signed, so editing it is not safe either). So this script does
# everything EXCEPT the final clicks:
#   1. replaces the unzipped extension folder (~/TabbedIn/extension) with the
#      new version, so there is never a leftover old copy on disk
#   2. looks (read-only) for OTHER copies of Tabbed In already added to the
#      browser and tells you which one to remove, so two copies never fight over
#      the tab lock
#   3. copies the folder path to the clipboard
#   4. tries to open the browser's Extensions page
#   5. prints the exact clicks to finish
#
# UPDATING: run this script again with the new zip. The folder path stays the
# same, so the browser keeps the same extension: just click the reload icon on
# its card.
#
# The script only writes inside ~/TabbedIn (or --install-dir). It does not
# change browser settings. It works with the bash that ships with macOS (3.2).
#
# Usage: bash install.sh [options]
#   --zip PATH           extension zip (default: tabbed-in-*.zip next to this script)
#   --browser NAME       brave | chrome | chromium | edge (default: ask if several)
#   --install-dir DIR    where to unzip (default: ~/TabbedIn/extension)
#   --no-open            do not open the browser
#   --no-clipboard       do not copy the path to the clipboard
#   --uninstall          delete the unzipped folder (then click Remove in the browser)
#   --user-data-dir DIR  browser profile folder to read (used by the tests)
#   --os linux|macos     override OS detection (used by the tests)
#   -h, --help           show this help

set -u

EXT_NAME="Tabbed In"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ZIP=""
BROWSER=""
INSTALL_DIR="$HOME/TabbedIn/extension"
NO_OPEN=0
NO_CLIPBOARD=0
UNINSTALL=0
USER_DATA_DIR=""
OS_OVERRIDE=""

# ---- output helpers ------------------------------------------------------------
if [ -t 1 ]; then
  RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; CYAN=$'\033[36m'; RESET=$'\033[0m'
else
  RED=""; GREEN=""; YELLOW=""; CYAN=""; RESET=""
fi
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s%s%s\n' "$GREEN" "$*" "$RESET"; }
warn() { printf '%s%s%s\n' "$YELLOW" "$*" "$RESET"; }
info() { printf '%s%s%s\n' "$CYAN" "$*" "$RESET"; }
fail() { printf '\n%sError: %s%s\n' "$RED" "$*" "$RESET" >&2; exit 1; }

# ---- arguments -------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --zip)           ZIP="${2:-}"; shift 2 ;;
    --browser)       BROWSER="${2:-}"; shift 2 ;;
    --install-dir)   INSTALL_DIR="${2:-}"; shift 2 ;;
    --no-open)       NO_OPEN=1; shift ;;
    --no-clipboard)  NO_CLIPBOARD=1; shift ;;
    --uninstall)     UNINSTALL=1; shift ;;
    --user-data-dir) USER_DATA_DIR="${2:-}"; shift 2 ;;
    --os)            OS_OVERRIDE="${2:-}"; shift 2 ;;
    -h|--help)       sed -n '2,/^#   -h, --help/p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)               fail "Unknown option: $1 (try --help)" ;;
  esac
done

if [ -n "$OS_OVERRIDE" ]; then OS="$OS_OVERRIDE"
elif [ "$(uname -s)" = "Darwin" ]; then OS="macos"
else OS="linux"; fi

# ---- safety helpers ----------------------------------------------------------------
manifest_name_is_ours() {   # $1 = path to a manifest.json
  [ -f "$1" ] && grep -Eq '"name"[[:space:]]*:[[:space:]]*"Tabbed In"' "$1"
}
# Only ever delete a folder that is missing, empty, or clearly a Tabbed In install.
safe_to_replace() {
  local dir="$1"
  [ ! -e "$dir" ] && return 0
  [ -d "$dir" ] || return 1
  [ -z "$(ls -A "$dir" 2>/dev/null)" ] && return 0
  manifest_name_is_ours "$dir/manifest.json"
}

# ---- uninstall -----------------------------------------------------------------------
if [ "$UNINSTALL" = 1 ]; then
  [ -e "$INSTALL_DIR" ] || { say "Nothing to remove: $INSTALL_DIR does not exist."; exit 0; }
  safe_to_replace "$INSTALL_DIR" || fail "$INSTALL_DIR does not look like a $EXT_NAME install; not deleting it."
  rm -rf "$INSTALL_DIR"
  ok "Deleted $INSTALL_DIR"
  say "Now open your browser's Extensions page and click Remove on $EXT_NAME."
  exit 0
fi

# ---- browsers ---------------------------------------------------------------------------
# set_browser KEY -> sets B_LABEL, B_URL, B_APP (macOS app name), B_CMDS (Linux commands,
# space separated), B_DATA (profile folders, one per line)
set_browser() {
  case "$1" in
    brave)
      B_LABEL="Brave"; B_URL="brave://extensions"; B_APP="Brave Browser"
      B_CMDS="brave-browser brave brave-browser-stable"
      if [ "$OS" = macos ]; then B_DATA="$HOME/Library/Application Support/BraveSoftware/Brave-Browser"
      else B_DATA="$HOME/.config/BraveSoftware/Brave-Browser
$HOME/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser"; fi ;;
    chrome)
      B_LABEL="Chrome"; B_URL="chrome://extensions"; B_APP="Google Chrome"
      B_CMDS="google-chrome google-chrome-stable"
      if [ "$OS" = macos ]; then B_DATA="$HOME/Library/Application Support/Google/Chrome"
      else B_DATA="$HOME/.config/google-chrome
$HOME/.var/app/com.google.Chrome/config/google-chrome"; fi ;;
    chromium)
      B_LABEL="Chromium"; B_URL="chrome://extensions"; B_APP="Chromium"
      B_CMDS="chromium chromium-browser"
      if [ "$OS" = macos ]; then B_DATA="$HOME/Library/Application Support/Chromium"
      else B_DATA="$HOME/.config/chromium
$HOME/snap/chromium/common/chromium
$HOME/.var/app/org.chromium.Chromium/config/chromium"; fi ;;
    edge)
      B_LABEL="Edge"; B_URL="edge://extensions"; B_APP="Microsoft Edge"
      B_CMDS="microsoft-edge microsoft-edge-stable"
      if [ "$OS" = macos ]; then B_DATA="$HOME/Library/Application Support/Microsoft Edge"
      else B_DATA="$HOME/.config/microsoft-edge"; fi ;;
    *) fail "Unknown browser '$1'. Use brave, chrome, chromium, or edge." ;;
  esac
}

# browser_installed KEY -> 0 if found; sets B_EXE (Linux command) for launching
browser_installed() {
  set_browser "$1"
  B_EXE=""
  if [ "$OS" = macos ]; then
    [ -d "/Applications/$B_APP.app" ] || [ -d "$HOME/Applications/$B_APP.app" ]
    return $?
  fi
  local c
  for c in $B_CMDS; do
    if command -v "$c" >/dev/null 2>&1; then B_EXE="$c"; return 0; fi
  done
  return 1
}

# ---- reading the browser's profile (read-only) ----------------------------------------
# prints "profile<TAB>kind<TAB>path" for each Tabbed In copy; kind = this|other|missing|store
PERL_FIND='
use strict; use warnings; use JSON::PP;
my ($data, $here) = @ARGV;
opendir(my $dh, $data) or exit 0;
for my $p (sort grep { $_ eq "Default" || /^Profile / } readdir $dh) {
  my %seen;
  for my $f ("Secure Preferences", "Preferences") {
    my $file = "$data/$p/$f";
    next unless -f $file;
    open(my $fh, "<", $file) or next;
    local $/; my $text = <$fh>; close $fh;
    my $json = eval { JSON::PP->new->decode($text) } or next;
    my $s = ref $json eq "HASH" && ref $json->{extensions} eq "HASH" ? $json->{extensions}{settings} : undef;
    next unless ref $s eq "HASH";
    for my $id (sort keys %$s) {
      next if $seen{$id};
      my $e = $s->{$id}; next unless ref $e eq "HASH";
      my $path = (defined $e->{path} && !ref $e->{path}) ? $e->{path} : undef;
      my $name = ref $e->{manifest} eq "HASH" ? $e->{manifest}{name} : undef;
      if (!defined $name && defined $path && -f "$path/manifest.json") {
        if (open(my $mf, "<", "$path/manifest.json")) { local $/; my $m = <$mf>; close $mf;
          $name = $1 if $m =~ /"name"\s*:\s*"([^"]*)"/; }
      }
      next unless defined $name && $name eq "Tabbed In";
      $seen{$id} = 1;
      my $kind = "store";
      if (defined $path) { (my $n = $path) =~ s{/+$}{}; $kind = $n eq $here ? "this" : (-e $path ? "other" : "missing"); }
      print "$p\t$kind\t", (defined $path ? $path : ""), "\n";
    }
  }
}'
PY_FIND='
import json, os, re, sys
data, here = sys.argv[1], sys.argv[2]
try: profiles = sorted(d for d in os.listdir(data) if d == "Default" or d.startswith("Profile "))
except OSError: sys.exit(0)
for p in profiles:
    seen = set()
    for f in ("Secure Preferences", "Preferences"):
        fp = os.path.join(data, p, f)
        try: j = json.load(open(fp, encoding="utf-8"))
        except Exception: continue
        s = (j.get("extensions") or {}).get("settings") or {}
        for i in sorted(s):
            if i in seen or not isinstance(s[i], dict): continue
            e = s[i]; path = e.get("path") if isinstance(e.get("path"), str) else None
            m = e.get("manifest"); name = m.get("name") if isinstance(m, dict) else None
            if name is None and path and os.path.isfile(os.path.join(path, "manifest.json")):
                mm = re.search(r"\"name\"\s*:\s*\"([^\"]*)\"", open(os.path.join(path, "manifest.json"), encoding="utf-8").read())
                name = mm.group(1) if mm else None
            if name != "Tabbed In": continue
            seen.add(i)
            kind = "store"
            if path:
                kind = "this" if path.rstrip("/") == here else ("other" if os.path.exists(path) else "missing")
            print("%s\t%s\t%s" % (p, kind, path or ""))'

# find_copies DATA_DIR -> prints lines; returns 3 if no JSON-capable tool is available
find_copies() {
  local data="$1" here="$INSTALL_DIR"
  [ -d "$data" ] || return 0
  here="${here%/}"
  if command -v perl >/dev/null 2>&1 && perl -MJSON::PP -e1 >/dev/null 2>&1; then
    perl -e "$PERL_FIND" "$data" "$here" 2>/dev/null; return 0
  fi
  local py
  for py in python3 python; do
    if command -v "$py" >/dev/null 2>&1 && "$py" -c 'import json' >/dev/null 2>&1; then
      "$py" -c "$PY_FIND" "$data" "$here" 2>/dev/null; return 0
    fi
  done
  return 3
}

# ---- find the zip ----------------------------------------------------------------------
if [ -z "$ZIP" ]; then
  ZIP="$(ls -t "$SCRIPT_DIR"/tabbed-in-*.zip 2>/dev/null | head -n 1)"
  [ -n "$ZIP" ] || fail "No tabbed-in-*.zip found next to this script. Put the zip in the same folder, or use --zip PATH."
fi
[ -f "$ZIP" ] || fail "Zip not found: $ZIP"

# ---- choose a browser ---------------------------------------------------------------------
CHOSEN=""
if [ -n "$BROWSER" ]; then
  browser_installed "$BROWSER" || { [ -n "$USER_DATA_DIR" ] || fail "$(set_browser "$BROWSER"; echo "$B_LABEL") does not seem to be installed."; }
  CHOSEN="$BROWSER"
else
  FOUND=""
  for k in brave chrome chromium edge; do
    browser_installed "$k" && FOUND="$FOUND $k"
  done
  set -- $FOUND
  if [ $# -eq 0 ]; then
    warn "No Brave, Chrome, Chromium, or Edge found; the extension will still be unzipped."
  elif [ $# -eq 1 ]; then
    CHOSEN="$1"
  elif [ -t 0 ]; then
    say "Which browser?"
    i=1; for k in "$@"; do set_browser "$k"; say "  $i) $B_LABEL"; i=$((i + 1)); done
    printf 'Number: '; read -r ANSWER
    case "$ANSWER" in ''|*[!0-9]*) fail "Not a valid choice." ;; esac
    [ "$ANSWER" -ge 1 ] && [ "$ANSWER" -le $# ] || fail "Not a valid choice."
    j=1; for k in "$@"; do [ "$j" = "$ANSWER" ] && CHOSEN="$k"; j=$((j + 1)); done
  else
    CHOSEN="$1"; warn "Several browsers found and no terminal to ask on; using the first one. Use --browser to choose."
  fi
fi
if [ -n "$CHOSEN" ]; then browser_installed "$CHOSEN" >/dev/null 2>&1; set_browser "$CHOSEN"; fi

# ---- unzip and replace the folder ----------------------------------------------------------
extract_zip() {   # $1 zip, $2 destination
  if command -v unzip >/dev/null 2>&1; then unzip -q -o "$1" -d "$2" && return 0; fi
  local py
  for py in python3 python; do
    if command -v "$py" >/dev/null 2>&1 && "$py" -c 'import zipfile' >/dev/null 2>&1; then
      "$py" -m zipfile -e "$1" "$2" && return 0
    fi
  done
  if command -v bsdtar >/dev/null 2>&1; then bsdtar -xf "$1" -C "$2" && return 0; fi
  return 1
}

HAD_FOLDER=0
[ -f "$INSTALL_DIR/manifest.json" ] && HAD_FOLDER=1
safe_to_replace "$INSTALL_DIR" || fail "$INSTALL_DIR already exists and does not look like a $EXT_NAME install. Pick another folder with --install-dir, or empty it."

STAGING="$(mktemp -d "${TMPDIR:-/tmp}/tabbed-in.XXXXXX")" || fail "Could not create a temporary folder."
trap 'rm -rf "$STAGING"' EXIT
extract_zip "$ZIP" "$STAGING" || fail "Could not unzip $ZIP. Install 'unzip' (for example: sudo apt install unzip) and run this again."
[ -f "$STAGING/manifest.json" ] || fail "That zip has no manifest.json at its top level. Is it the right file?"
manifest_name_is_ours "$STAGING/manifest.json" || fail "That zip is not the $EXT_NAME extension."
VERSION="$(grep -Eo '"version"[[:space:]]*:[[:space:]]*"[^"]*"' "$STAGING/manifest.json" | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')"

mkdir -p "$(dirname "$INSTALL_DIR")" || fail "Could not create $(dirname "$INSTALL_DIR")."
if [ -e "$INSTALL_DIR" ]; then
  rm -rf "$INSTALL_DIR" || fail "Could not replace $INSTALL_DIR. Close anything using files in that folder, then run this again."   # old version goes away completely
fi
mv "$STAGING" "$INSTALL_DIR" || fail "Could not move the new files into $INSTALL_DIR."
chmod -R u+rwX,go+rX "$INSTALL_DIR" 2>/dev/null
trap - EXIT

say ""
if [ "$HAD_FOLDER" = 1 ]; then ok "Replaced the old files with $EXT_NAME $VERSION in:"; else ok "Unzipped $EXT_NAME $VERSION in:"; fi
say "  $INSTALL_DIR"

COPIED=0
if [ "$NO_CLIPBOARD" = 0 ]; then
  if [ "$OS" = macos ] && command -v pbcopy >/dev/null 2>&1; then printf '%s' "$INSTALL_DIR" | pbcopy && COPIED=1
  elif [ -n "${WAYLAND_DISPLAY:-}" ] && command -v wl-copy >/dev/null 2>&1; then printf '%s' "$INSTALL_DIR" | wl-copy && COPIED=1
  elif command -v xclip >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then printf '%s' "$INSTALL_DIR" | xclip -selection clipboard && COPIED=1
  elif command -v xsel >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then printf '%s' "$INSTALL_DIR" | xsel --clipboard --input && COPIED=1
  fi
  if [ "$COPIED" = 1 ]; then say "  (that path is now on your clipboard)"; fi
fi

# ---- what is already in the browser? -----------------------------------------------------------
THIS_COUNT=0
OTHERS=""
OTHER_COUNT=0
CHECKED=1
if [ -n "$CHOSEN" ]; then
  if [ -n "$USER_DATA_DIR" ]; then DATA_LIST="$USER_DATA_DIR"; else DATA_LIST="$B_DATA"; fi
  while IFS= read -r DATA; do
    [ -n "$DATA" ] || continue
    OUT="$(find_copies "$DATA")"; RC=$?
    [ $RC -eq 3 ] && CHECKED=0
    while IFS="$(printf '\t')" read -r PROFILE KIND PTH; do
      [ -n "$KIND" ] || continue
      if [ "$KIND" = this ]; then THIS_COUNT=$((THIS_COUNT + 1))
      else
        OTHER_COUNT=$((OTHER_COUNT + 1))
        case "$KIND" in
          missing) WHERE="its folder no longer exists: $PTH" ;;
          store)   WHERE="installed from the Web Store" ;;
          *)       WHERE="loaded from: $PTH" ;;
        esac
        OTHERS="$OTHERS  - profile '$PROFILE', $WHERE
"
      fi
    done <<EOF
$OUT
EOF
  done <<EOF
$DATA_LIST
EOF
fi

LABEL="your browser"; URL="chrome://extensions"
if [ -n "$CHOSEN" ]; then LABEL="$B_LABEL"; URL="$B_URL"; fi

say ""
if [ "$OTHER_COUNT" -gt 0 ]; then
  warn "Another copy of $EXT_NAME is already added to $LABEL. Two copies fight over the tab lock,"
  warn "so remove the older one first (browsers do not let a script do this for you):"
  printf '%s%s%s' "$YELLOW" "$OTHERS" "$RESET"
  warn "  (You will do this in the steps below.)"
  say ""
fi
if [ "$CHECKED" = 0 ] && [ -n "$CHOSEN" ]; then
  warn "Could not check whether $EXT_NAME is already added (no perl or python found)."
  warn "If you added it before, remove the old card first."
  say ""
fi

# ---- open the Extensions page (best effort) ----------------------------------------------------
OPENED=0
if [ -n "$CHOSEN" ] && [ "$NO_OPEN" = 0 ]; then
  if [ "$OS" = macos ] && command -v osascript >/dev/null 2>&1; then
    info "Opening $LABEL and asking it to show $URL. macOS may ask whether Terminal can control $LABEL: click OK."
    if osascript >/dev/null 2>&1 <<APPLESCRIPT
tell application "$B_APP"
  activate
  if (count of windows) = 0 then
    make new window
    set URL of active tab of front window to "$URL"
  else
    tell front window to make new tab with properties {URL:"$URL"}
  end if
end tell
APPLESCRIPT
    then OPENED=1; fi
  elif [ "$OS" = linux ] && [ -n "$B_EXE" ]; then
    # Browsers often ignore chrome:// style addresses given on the command line and just
    # open a New Tab page, so the steps below always say how to get there by hand.
    info "Opening $LABEL..."
    ( nohup "$B_EXE" --new-window "$URL" >/dev/null 2>&1 & ) 2>/dev/null
  fi
fi

# ---- exact steps ----------------------------------------------------------------------------------
LINE="================================================================"
say "$LINE"
info " EXACT STEPS to finish in $LABEL"
say "$LINE"
N=1
if [ "$OPENED" = 1 ]; then
  say " $N. The Extensions page should now be open in $LABEL. (Done for you.)"
  say "    If it isn't: click the address bar at the top, type  $URL  and press Enter."
else
  if [ "$OS" = macos ]; then KEY="Command+L"; else KEY="Ctrl+L"; fi
  say " $N. Open $LABEL (a window may already have opened). Click the address bar at the top"
  say "    (or press $KEY), type  $URL  and press Enter."
fi
N=$((N + 1))
if [ "$THIS_COUNT" -gt 0 ]; then
  say " $N. Find the card named \"Tabbed In\". It is already added from this folder, so nothing needs removing."
  say "    Click the circular-arrow RELOAD icon at the bottom right of that card."
  say "    You're done. (Check the toggle on the card is blue = on.)"
else
  if [ "$OTHER_COUNT" -gt 0 ]; then
    say " $N. REMOVE the older copy first. On each older \"Tabbed In\" card (see the list above),"
    say "    click the \"Remove\" button at the bottom left of the card, then click \"Remove\" again to confirm."
    say "    (Click \"Details\" on a card to see which folder it was loaded from, under \"Source\".)"
    N=$((N + 1))
  fi
  say " $N. Turn on \"Developer mode\": the switch in the top-right corner of the page. It turns blue."
  N=$((N + 1))
  say " $N. Click \"Load unpacked\": a new button at the top-left of the page."
  N=$((N + 1))
  if [ "$OS" = macos ]; then
    say " $N. A file window opens. Press Command+Shift+G (\"Go to the folder\"), then paste this path with"
    PASTE="Command+V"
  else
    say " $N. A file window opens. Press Ctrl+L (to type a location), then paste this path with"
    PASTE="Ctrl+V"
  fi
  if [ "$COPIED" = 1 ]; then say "    $PASTE (it is already on your clipboard):"; else say "    $PASTE (select and copy it from this window first):"; fi
  say ""
  printf '        %s%s%s\n' "$GREEN" "$INSTALL_DIR" "$RESET"
  say ""
  if [ "$OS" = macos ]; then say "    Press Return, then click \"Select\" (or \"Open\")."
  else say "    Press Enter, then click \"Select\" (or \"Open\") to choose that folder."; fi
  N=$((N + 1))
  say " $N. A card named \"Tabbed In $VERSION\" appears with a blue toggle. It's installed."
  N=$((N + 1))
  say " $N. Click the puzzle-piece icon in the browser toolbar (top right), then click the pin icon"
  say "    next to \"Tabbed In\" so its button stays visible."
fi
say "$LINE"
say " To try it: open any normal website (for example example.com), click the Tabbed In button,"
say " pick a time, and click Start. When asked about site access, click Allow."
say "$LINE"
