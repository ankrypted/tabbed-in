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

### Flow 1b: the widget appears (added with the on-page timer)

```
popup/main.ts   start(15)  (inside the click handler)
  1. permissions.request({ origins: ['<all_urls>'] })   ← must happen in the click gesture;
                                                           browser shows its dialog once
  2. sendMessage({ type:'start', ... })  ──► background startTimer()
       └─► injectWidget(tabId)   scripting.executeScript('/content-scripts/widget.js')
             ├─ permission granted ─► widget runs:
             │     sendMessage({ type:'widget-state' }) ─► background replies with { end }
             │     widget mounts, counts down, becomes draggable
             └─ not granted yet ──► silently fails (timer still runs, badge only)

User accepts the permission dialog
  background   permissions.onAdded ──► injectWidget() for every timed tab   (works even if
                                                                              the popup closed)
Page navigates / reloads
  background   tabs.onUpdated(status='complete') ──► injectWidget(tabId)    (the old widget
                                                                              died with the page)
Timer cancelled
  background   cancelTimer ──► tabs.sendMessage({ type:'timer-changed', end:null })
  widget       removes itself
```

### Flow 1c: the user tries to leave the timed tab

```
User opens a new tab or clicks another tab (same window as the timed tab)
  browser      tabs.onActivated { tabId: other, windowId }
  background   enforceLock
    1. getTimers(); decideLockAction(timers, activation, now)
    2a. ignore  ─► nothing happens (other window, no timer, lock released)
    2b. release ─► timers[timedTab].lockOff = true; widget says "Tab lock released."
    2c. revert  ─► tabs.get(timedTab)            gone? ─► cancelTimer (drop timer and lock)
                   recordRevert(...)             more than 5 in 3 s? ─► releaseLock (breaker)
                   returnToTimedTab: retry tabs.update(timedTab, { active: true }) every 100 ms
                     (up to 4 s; Chrome rejects it while the mouse is still down on a tab)
                      └─► tabs.onActivated { tabId: timedTab } ─► ignore (no loop)
                   tabs.sendMessage(timedTab, { type: 'lock-blocked' })
  widget       shows "Locked in. Stop the timer to switch tabs." for 3.5 s
Any exception in enforceLock ─► every timer gets lockOff = true (safe mode)
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

### [entrypoints/widget.content/index.ts](entrypoints/widget.content/index.ts)
The on-page timer. It is a content script with `registration: 'runtime'`, so it is **not** in the manifest. The background injects it with `scripting.executeScript` into the timed tab only.
- On load it asks the background `{ type: 'widget-state' }` for its own tab's timer. No timer means it exits.
- Renders a small card inside a **Shadow DOM** (via WXT's `createShadowRootUi`) so site CSS can't affect it. Its CSS is inlined into the script (`?inline`), so no web-accessible resource is needed.
- Counts down locally from the stored end time (one-second interval).
- **Drag:** pointer events with pointer capture. Position is clamped to the viewport, re-clamped on window resize, and saved to `storage.local` (`widgetPos`) when a drag ends.
- Listens for `{ type: 'timer-changed', end }` from the background: updates the end time, or removes itself when `end` is `null`.
- Skips iframes and refuses to mount twice (it checks for an existing `<tabbed-in-widget>`).

### [entrypoints/widget.content/style.css](entrypoints/widget.content/style.css)
The widget's styles: fixed position, maximum z-index, dark card, grab/grabbing cursor, `user-select: none`, `touch-action: none` (needed for pointer-event dragging).

### The tab-switch lock (in [background.ts](entrypoints/background.ts))
- `startTimer` now records the timed tab's `windowId` with the end time, and refuses to start if any timer already exists (it first drops records whose tab is gone).
- `tabs.onActivated` calls `enforceLock`, which loads the timers and asks `decideLockAction` (in `utils/lock.ts`) what to do:
  - **ignore:** no timer, a different window, the timed tab itself (this prevents a revert loop), or a released lock.
  - **revert:** `tabs.update(timedTabId, { active: true })`, then tell the widget to show "Locked in...".
  - **release:** a corrupt or stale record sets `lockOff` on the timer. The timer keeps running, but the lock is gone.
- `tabs.onCreated` calls `closeNewTabIfLocked`, which asks `shouldCloseNewTab`. A tab is **closed** when it opens on the browser's New Tab page (`isNewTabPage`), has no opener, or has an opener other than the timed tab. It is **kept** (in the background) when the timed page itself opened it with a normal URL. After closing, focus goes back to the timed tab and the widget shows "Locked in". This path does not feed the circuit breaker, because `onActivated` already counts the same event.
- **Returning to the timed tab** (`returnToTimedTab`): Chrome fires `onActivated` on mouse-down and rejects `tabs.update` until the click ends, so the revert is retried every 100 ms for up to 4 s (`utils/retry.ts`). Each try re-checks that the timer still exists and the lock is on. If it still fails, it logs and gives up for that switch; it does not release the lock.
- **Safety nets:** a vanished timed tab drops the timer; more than 5 reverts in 3 s trips the circuit breaker (`recordRevert`) and releases the lock; an exception in the lock logic itself releases every lock ("safe mode"). A failed tab switch-back does not.

### [utils/lock.ts](utils/lock.ts)
Pure functions, no browser APIs, 31 unit tests ([lock.test.ts](utils/lock.test.ts)): `decideLockAction` (ignore / revert / release, failing open on anything doubtful), `shouldCloseNewTab` with `isNewTabPage` (which new tabs to close), and `recordRevert` (the circuit breaker). Also defines the `TimerRecord` and `Timers` types shared with the popup.

### [utils/retry.ts](utils/retry.ts)
`retry(action, attempts = 40, delayMs = 100)`: re-runs an async action until it succeeds, rethrowing the last error. Has 4 unit tests ([retry.test.ts](utils/retry.test.ts)). Used for `tabs.update` / `tabs.remove` calls that Chrome rejects while the user's mouse is down on a tab.

### [utils/position.ts](utils/position.ts) and [utils/time.ts](utils/time.ts)
Pure functions with no browser APIs, covered by Vitest ([position.test.ts](utils/position.test.ts), [time.test.ts](utils/time.test.ts)):
- `clampPosition`, `defaultPosition` (top-right), `isPos` (validates saved data).
- `formatRemaining` (`m:ss`, or `h:mm:ss` from one hour). Used by both the popup and the widget.

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
Per the MVP build plan:
- A pure state-machine module with Vitest tests.
- Focus-lock handlers in `background.ts` (`tabs.onActivated`, `tabs.onCreated`).
- A pause/resume UI in the popup.
- **On-page widget, remaining parts:** the drag and remembered position are built (see above). Still to add: minimize to a pill, the Running/Paused/Expired state display, pause/resume controls, and the expiry prompt (Close tab / Add time). The widget currently receives its state through messages from the background rather than reading `storage.session` directly.
- A small fallback page for the expiry prompt on pages where the widget can't show.
