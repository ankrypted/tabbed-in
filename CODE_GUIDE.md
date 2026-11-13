# Code Guide

What each file in **Tabbed In** does, and how they fit together. This describes the current baseline (a port of the original tab timer); the state machine and focus lock described in [REQUIREMENTS.md](REQUIREMENTS.md) are not built yet.

## How it fits together

```
popup/main.ts ──sendMessage({start|cancel})──► background.ts
      ▲                                              │
      └────── reads storage.session("timers") ◄──────┘
                                    alarms fire ─► close tab / update badge
```

The popup and the background script never share memory. They communicate through messages and shared session storage, because the background worker can be shut down by the browser at any time and must not rely on in-memory state.

## Interactions between components

There are no classes in the codebase. The code is plain functions grouped in two modules that run in different browser contexts:

| Component | Context | Lifetime |
|---|---|---|
| **Popup** (`popup/main.ts`) | Popup page | Exists only while the popup is open |
| **Background** (`background.ts`) | Service worker / background script | Woken by events, may be shut down when idle |
| **`storage.session`** | Browser-provided store | Survives worker shutdowns, cleared on browser restart |
| **`alarms`** | Browser-provided scheduler | Fires events even when the worker is asleep |
| **Browser tabs** | `browser.tabs` / `browser.action` APIs | The thing being timed, closed, and badged |

### Who talks to whom

```
┌────────────┐  sendMessage(start|cancel)   ┌──────────────────┐
│   Popup    │ ───────────────────────────► │    Background    │
│ (main.ts)  │ ◄─── { ok: true } ────────── │  (background.ts) │
└─────┬──────┘                              └───┬───┬───┬───┬──┘
      │ read only                          write│   │   │   │
      ▼                                         ▼   │   │   │
┌───────────────────────────────┐   ┌─────────────┐ │   │   │
│ storage.session  ("timers")   │◄──┤ get/setTimers│ │   │   │
└───────────────────────────────┘   └─────────────┘ │   │   │
                                  alarms.create/clear   │   │
                                        ┌───────────────▼┐  │
                                        │     alarms     │  │
                                        └───────┬────────┘  │
                                   onAlarm event│           │
                                                ▼           ▼
                                     tabs.remove(tabId)   action.setBadge*
```

Rules of the design:
- **The popup writes nothing itself.** It only sends messages. All state changes happen in the background.
- **The popup reads storage directly** (once per second) to draw the countdown, so it doesn't need to message the background for state.
- **The background keeps no state in memory.** Every handler loads from `storage.session`, changes it, and saves it back, so it works after a worker restart.
- **Alarms are the timer.** Neither the popup nor the background counts down with `setTimeout`.

### Flow 1: starting a timer

```
User clicks "15m" in popup
  popup/main.ts   start(15)
    └─► runtime.sendMessage({ type:'start', tabId, minutes:15 })
          background.ts   onMessage  ──► startTimer(tabId, 15)
            1. getTimers()                 (read storage.session)
            2. timers[tabId] = { end }     (end = now + 15 min)
            3. setTimers(timers)           (write storage.session)
            4. alarms.create('tab-<id>', { when: end })
            5. alarms.create('tick', { every 30 s })
            6. updateBadges()              (set "15" on the tab's badge)
          ◄── respond({ ok: true })
    └─► render()   (reads storage.session, switches to the running view)
```

### Flow 2: every 30 seconds (badge refresh)

```
alarms 'tick' fires  (wakes the worker if it was asleep)
  background.ts   onAlarm ──► updateBadges()
    for each timer in storage.session:
      action.setBadgeText / setBadgeBackgroundColor
      if the tab no longer exists ──► delete the timer and save
```

### Flow 3: time runs out (current baseline behaviour)

```
alarms 'tab-<id>' fires at the end time
  background.ts   onAlarm
    1. getTimers(); delete timers[tabId]; setTimers()
    2. tabs.remove(tabId)
         └─► tabs.onRemoved fires ──► cancelTimer(tabId)   (idempotent cleanup)
```
This flow changes in the MVP: instead of closing the tab, the timer moves to an Expired state and the user gets a Close tab / Add time prompt.

### Flow 4: cancelling with the phrase

```
User types "i am done" in popup
  popup/main.ts   input handler (trim + lowercase matches)
    └─► runtime.sendMessage({ type:'cancel', tabId })
          background.ts   onMessage ──► cancelTimer(tabId)
            1. delete timers[tabId]; setTimers()
            2. alarms.clear('tab-<id>')
            3. action.setBadgeText({ text: '' })
    └─► render()   (back to the setup view)
```

### Flow 5: tab closed or navigated

```
Tab closed by the user
  tabs.onRemoved ──► cancelTimer(tabId)       (same cleanup as Flow 4)

Tab navigates (status = 'loading')
  tabs.onUpdated ──► updateBadges()           (badges reset on navigation, so reapply)
```

### Function dependency map (background.ts)

```
onMessage ───► startTimer ───► getTimers, setTimers, alarms.create, updateBadges
          └──► cancelTimer ──► getTimers, setTimers, alarms.clear, action.setBadgeText

onAlarm('tick')    ───► updateBadges ───► getTimers, setTimers, action.setBadge*
onAlarm('tab-<id>') ──► getTimers, setTimers, tabs.remove
tabs.onRemoved     ───► cancelTimer
tabs.onUpdated     ───► updateBadges
```
`getTimers` / `setTimers` are the only functions that touch storage, which makes them the single place to change when the data shape grows (state, remaining time, window ID) for the MVP.

### Known weak points in these interactions
- **Read-modify-write races:** two handlers running close together (e.g. `tick` and a `cancel`) can each load the same `timers` record and overwrite each other's change. The state machine work should serialize storage updates.
- **The `tick` alarm is created on every start and never cleared**, so it keeps firing after the last timer ends.
- **The popup polls storage each second.** That's fine at this size, but storage change events (`storage.onChanged`) would be cleaner.

## Application code

### [entrypoints/background.ts](entrypoints/background.ts)
The engine. WXT builds it into a service worker (Chrome/Brave/Edge) or a background script (Firefox).

| Piece | What it does |
|---|---|
| `getTimers` / `setTimers` | Read and write the `timers` record (`{ [tabId]: { end } }`) in `browser.storage.session`. |
| `startTimer(tabId, minutes)` | Saves the end time, creates a one-shot alarm `tab-<id>` for that moment, creates the repeating `tick` alarm, and refreshes badges. |
| `cancelTimer(tabId)` | Deletes the timer, clears its alarm, and clears the badge. |
| `updateBadges()` | For each timer, shows the minutes left on that tab's badge (blue, red at 1 minute or less). Drops timers whose tab no longer exists. |
| `runtime.onMessage` | Receives `start` and `cancel` messages from the popup and runs the matching function. |
| `alarms.onAlarm` | `tick` refreshes badges every 30 s. `tab-<id>` fires when time is up and closes that tab. |
| `tabs.onRemoved` | Removes the timer when its tab is closed. |
| `tabs.onUpdated` | Re-applies the badge when a tab starts loading, because per-tab badges reset on navigation. |

All listeners are registered inside `defineBackground(...)`, so they exist every time the worker wakes up.

### [entrypoints/popup/index.html](entrypoints/popup/index.html)
The popup's markup, shown when the toolbar icon is clicked. WXT detects it as the toolbar popup.
- `#setup`: preset buttons (`data-m` = minutes), the custom-minutes input, and the Start button.
- `#running`: the remaining-time display and the "i am done" cancel input.
- Loads `main.ts` as a module and `style.css`.

### [entrypoints/popup/main.ts](entrypoints/popup/main.ts)
The popup's logic.
- Finds the active tab and shows its title.
- Preset and Start buttons send `{ type: 'start', tabId, minutes }` to the background.
- The cancel input sends `{ type: 'cancel', tabId }` when the text, trimmed and lowercased, equals `i am done`.
- `render()` reads the timers from session storage, switches between the setup and running views, and formats the countdown as `m:ss`. It runs on load and then every second.

### [entrypoints/popup/style.css](entrypoints/popup/style.css)
Popup styling: 260 px wide, a single-line truncated tab title, button/input layout, and the `.hidden` class used to toggle views.

## Configuration

### [wxt.config.ts](wxt.config.ts)
Replaces a hand-written `manifest.json`. WXT generates the real manifest per browser from this:
- Name, description, toolbar title.
- Permissions: `tabs`, `alarms`, `storage`.
- `manifestVersion: 3` for every browser (WXT would otherwise build Firefox as MV2).
- Firefox extension ID and the "no data collected" declaration.

### [package.json](package.json)
- Scripts: `dev`, `dev:firefox`, `build`, `build:firefox`, `zip`, `compile` (typecheck), `test`.
- Dev dependencies: WXT, Vite, TypeScript, Vitest, web-ext.
- `engines`: Node 20.19 or newer.

### [tsconfig.json](tsconfig.json)
Extends the TypeScript config that WXT generates in `.wxt/`, which provides the types and auto-imports (`defineBackground`, `browser`).

### [.nvmrc](.nvmrc)
Pins Node 22 for fnm and nvm.

### [.gitignore](.gitignore)
Ignores `node_modules/`, `.output/` (build output), and `.wxt/` (generated types).

## Docs
- [README.md](README.md): setup and dev commands.
- [REQUIREMENTS.md](REQUIREMENTS.md): functional and non-functional requirements, the MVP scope, and the build plan.
- [CODE_GUIDE.md](CODE_GUIDE.md): this file.

## Generated, do not edit
- `.output/`: built extensions (`chrome-mv3`, `chrome-mv3-dev`, `firefox-mv3`).
- `.wxt/`: generated TypeScript config and types.
- `node_modules/`: dependencies.

## Planned additions
Per the MVP build plan: a pure state-machine module with Vitest tests, focus-lock handlers in `background.ts` (`tabs.onActivated`, `tabs.onCreated`), a pause/resume UI in the popup, and an expiry-prompt page for the Close tab / Add time choice.
