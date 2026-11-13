# Tabbed In

A browser extension that locks you to one tab for a set time. See [REQUIREMENTS.md](REQUIREMENTS.md).

Status: pre-MVP. The code is a baseline port of the original tab timer; the state machine and focus lock are next.

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
npm test               # unit tests
npm run build          # -> .output/chrome-mv3
npm run build:firefox  # -> .output/firefox-mv3
npm run zip            # store-ready zip
```

### Load the built extension manually

1. `npm run build`
2. Open `chrome://extensions` or `brave://extensions`, enable Developer mode.
3. Click "Load unpacked" and select `.output/chrome-mv3`.

## Project layout

```
entrypoints/
  background.ts      service worker / background script
  popup/             toolbar popup (index.html, main.ts, style.css)
wxt.config.ts        manifest + build config
```
