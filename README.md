# Tabbed In

A browser extension that locks you to one tab, or one browser tab group, for a set time. See [REQUIREMENTS.md](REQUIREMENTS.md).

Status: pre-MVP. The code is a baseline port of the original tab timer; the state machine and focus lock are next. Live progress is in [MVP_CHECKLIST.md](MVP_CHECKLIST.md).

## Tech stack

- [WXT](https://wxt.dev) (Manifest V3, Chrome/Brave/Edge/Firefox from one codebase)
- TypeScript, vanilla UI
- Vitest for unit tests

## Development

Requires **Node 20.19+** (`.nvmrc` pins 22).

```bash
npm install
npm run dev            # Chrome with hot reload
npm run dev:firefox    # Firefox with hot reload
npm run compile        # typecheck
npm test               # unit tests (Vitest, 67 tests)
npm run test:e2e       # browser tests in a real Brave (102 checks); see e2e/README.md
npm run build          # -> .output/chrome-mv3
npm run build:firefox  # -> .output/firefox-mv3
npm run zip            # store-ready zip
```

### Share it with friends

**Simplest: just send the extension folder.** The built extension is checked in under [releases/](releases/) as a `.tar.gz` and a `.zip`, with install steps in [releases/README.md](releases/README.md). Direct links:
- Windows: https://github.com/ankrypted/tabbed-in/raw/dev/releases/tabbed-in-0.2.1-extension.zip
- macOS / Linux: https://github.com/ankrypted/tabbed-in/raw/dev/releases/tabbed-in-0.2.1-extension.tar.gz

To rebuild them after a code change: `npm run release:extension` (builds, then writes both into `releases/`; the archive is reproducible, so unchanged code gives identical bytes).

**Or use an installer** that does most of the steps for you:

```bash
npm run bundle:windows       # -> .output/tabbed-in-windows-<version>.zip
npm run bundle:unix          # -> .output/tabbed-in-linux-macos-<version>.tar.gz
npm run test:installer       # Windows installer tests (fake browser profiles; touches nothing real)
npm run test:installer:unix  # Linux/macOS installer tests (needs bash; works in Git Bash)
npm run test:installer:open  # opens a real throwaway Brave window to check the Extensions page opens
```

Send the bundle for their system. **Windows:** unzip and double-click `install.bat`. **macOS / Linux:** unpack and run `bash install.sh` (macOS also has a double-clickable `install.command`). The script unzips the extension to a permanent folder (`%LOCALAPPDATA%\TabbedIn\extension` on Windows, `~/TabbedIn/extension` elsewhere), replacing any older files, copies the path to the clipboard, opens the browser's Extensions page, and prints the exact clicks to finish. Browsers don't allow a script to add an extension silently, so the friend still clicks **Load unpacked** and pastes the path once.

If the browser already has a copy of Tabbed In, the script says so: from the same folder it's just a reload; a copy loaded from somewhere else is listed so they can click Remove on it first (two copies would fight over the tab lock). Friend instructions: [installer/windows/README.txt](installer/windows/README.txt) and [installer/unix/README.txt](installer/unix/README.txt).

**Opening the Extensions page:** Brave and Chrome ignore `brave://` / `chrome://` addresses given on the command line (they just open a New Tab page), so Windows types the address into a freshly opened window; macOS asks the browser through AppleScript; Linux can only try the command line and tells the user what to type if it doesn't work.

### Load the built extension manually

1. `npm run build`
2. Open `chrome://extensions` or `brave://extensions`, enable Developer mode.
3. Click "Load unpacked" and select `.output/chrome-mv3`.

## Project layout

```
entrypoints/
  background.ts      service worker / background script
  popup/             toolbar popup (index.html, main.ts, style.css)
  widget.content/    on-page timer widget (content script)
  offscreen/         hidden page that plays the end-of-timer bell
utils/               pure logic with unit tests (lock, retry, position, time, bell)
scripts/             make-icons.mjs (generates the placeholder icons)
e2e/                 browser tests (Playwright driving Brave); see e2e/README.md
wxt.config.ts        manifest + build config
```
