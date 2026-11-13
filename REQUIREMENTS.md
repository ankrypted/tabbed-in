# Tabbed In — Requirements (Draft v0.3, MVP-focused)

## 1. Overview

**Tabbed In** is a browser extension for focused work on a single tab. The user sets a countdown on a tab and **stays locked to that tab** until the timer ends, is paused, or is stopped. When time runs out, the extension **asks** what to do (close the tab or add more time) instead of closing it automatically.

**Target browsers:** Chrome, Brave, Edge, Opera, Vivaldi (Chromium, MV3). Firefox 115+ follows after the MVP.
**Distribution:** Zip / GitHub (unpacked) for the MVP.

### Changes from v0.1
1. **Expiry no longer auto-closes the tab.** The user is prompted to close it or extend the timer.
2. **Focus lock.** While a timer is running, the user cannot switch to other tabs unless they pause or stop the timer first.

### Changes in v0.3
3. **On-page timer widget.** The countdown stays visible on the page while the user browses. The widget can be dragged anywhere and minimized. It needs a content script, so site access is requested (as an optional permission) when the first timer starts.
4. **Expiry prompt moves into the widget** (Close tab / Add time). A small popup window remains only as a fallback where the widget can't show.

## 2. Concept: Timer States

```
            start                 time hits 0
  (none) ───────────► RUNNING ───────────────► EXPIRED
                       │  ▲                     │    │
                 pause │  │ resume              │    │ "Add time"
                       ▼  │                     │    └──► back to RUNNING
                      PAUSED                    │
                                                │ "Close tab"
  RUNNING / PAUSED ──── stop (cancel phrase) ──►(none) ◄─┘  (tab closes, timer removed)
```

| State | Tab switching | Countdown | Alarm |
|---|---|---|---|
| **None** | Free | n/a | none |
| **Running** | **Locked** to the timed tab | Counting | set for end time |
| **Paused** | Free | Frozen (remaining time kept) | cleared |
| **Expired** | **Locked** until the user answers the prompt | Stopped at 0 | fired |

## 3. MVP Scope

### In the MVP
- Start a timer on the active tab (presets + custom minutes).
- Live countdown in the popup and a badge on the tab.
- **Focus lock** while Running / Expired (same-window tab switching).
- **Pause / Resume** (releases and re-applies the lock).
- **Stop** via the cancel phrase "i am done".
- **Expiry prompt** with "Close tab" and "Add time" actions.
- Remove the timer if the tab is closed manually.
- **Force-exit safeguards** (section 4.9): circuit breaker, safe mode, self-healing checks, watchdog, startup reset.
- **On-page timer widget** (section 4.10): draggable, minimizable, position remembered, pause/resume, hosts the expiry prompt. Site access requested on first start.
- Chromium browsers only (Chrome, Brave, Edge...).

### Deferred (post-MVP)
Firefox manifest, options page, configurable presets/phrase, restart persistence, multi-window lock, dark mode, localization, store listings.

## 4. Functional Requirements

Priority: **MVP** = in the first release, **Later** = after the MVP.

### 4.1 Starting a timer
| ID | Requirement | Pri |
|---|---|---|
| FR-1 | The user can start a timer on the active tab from the toolbar popup. | MVP |
| FR-2 | Presets of 5, 15, 30, 60 minutes start in one click. | MVP |
| FR-3 | Custom duration in minutes. Validated: whole number, >= 1, <= 1440; invalid input shows an error and does not start a timer. | MVP |
| FR-4 | A tab that already has a timer shows its state (running / paused / expired) in the popup instead of the start form. A second timer cannot be started on it. | MVP |
| FR-5 | Only one timer may be active across the browser at a time (needed for a coherent lock). The popup on any other tab explains that a timer is already active and offers to jump to it. | MVP |
| FR-6 | Timers cannot start on restricted pages (`chrome://`, the Web Store, `about:`). The popup says why. | MVP |

### 4.2 Countdown and feedback
| ID | Requirement | Pri |
|---|---|---|
| FR-7 | The popup shows live remaining time (`m:ss`, or `h:mm:ss` over an hour). | MVP |
| FR-8 | The toolbar badge on the timed tab shows minutes remaining (blue; red at <= 1 min; "II" when paused; "!" when expired). | MVP |
| FR-9 | The badge persists across navigations within the tab. | MVP |
| FR-10 | Optional warning before expiry (e.g. at 60 s). | Later |

### 4.3 Focus lock
| ID | Requirement | Pri |
|---|---|---|
| FR-11 | While the timer is **Running** or **Expired**, switching to a different tab in the same window is reverted: the timed tab is re-activated immediately. | MVP |
| FR-12 | While Running, new tabs opened by the user (Ctrl+T, link middle-click) are also reverted to the timed tab. Decision: are these closed or left in the background? See Open Questions. | MVP |
| FR-13 | The lock is released when the timer is **Paused**, **Stopped**, or the expiry prompt is resolved. | MVP |
| FR-14 | Navigation **within** the timed tab (links, back/forward) is allowed. | MVP |
| FR-15 | The user is told why they cannot switch (badge/notice in popup: "Pause or stop the timer to leave this tab"). | MVP |
| FR-16 | Lock across multiple windows (focusing another browser window). | Later |

### 4.4 Pause / Resume
| ID | Requirement | Pri |
|---|---|---|
| FR-17 | The user can **Pause** a running timer from the popup. The remaining time is stored, the alarm is cleared, and the lock is released. | MVP |
| FR-18 | The user can **Resume** a paused timer. A new alarm is set for `now + remaining`, and the lock is re-applied. | MVP |
| FR-19 | A paused timer is dropped if its tab is closed. | MVP |
| FR-20 | Limit on pause count or total pause time, to prevent bypassing the lock. | Later |

### 4.5 Stop (cancel)
| ID | Requirement | Pri |
|---|---|---|
| FR-21 | The user can **Stop** a Running or Paused timer by typing "i am done" (case-insensitive, trimmed) in the popup. Stopping removes the timer and the lock. | MVP |
| FR-22 | Closing the timed tab manually removes its timer. | MVP |
| FR-23 | Configurable phrase; paste disabled in the field. | Later |

### 4.6 Expiry prompt
| ID | Requirement | Pri |
|---|---|---|
| FR-24 | When the timer reaches zero, the tab is **not** closed. The state becomes Expired and a prompt is shown to the user. | MVP |
| FR-25 | The prompt offers **Close tab** (closes the timed tab, removes the timer and lock) and **Add time** (extends by a chosen amount and returns to Running). | MVP |
| FR-26 | "Add time" offers quick options (e.g. +5, +10, +15 min) and a custom value, validated like FR-3. | MVP |
| FR-27 | The prompt is shown in the on-page widget (FR-54). Where the widget can't show (restricted page, site access denied), it is delivered as a small extension-owned popup window and brought to the front when the timer expires. | MVP |
| FR-28 | If the prompt window is dismissed without an answer, the timer stays Expired and the lock remains. Clicking the toolbar icon reopens the same choices. | MVP |
| FR-29 | If the browser was asleep or closed past the end time, the Expired prompt is shown on wake/startup (where feasible). | Later |
| FR-30 | ~~In-page overlay instead of a popup window.~~ Superseded: now part of the MVP via FR-47 to FR-55. | n/a |

### 4.7 State and persistence
| ID | Requirement | Pri |
|---|---|---|
| FR-31 | All timer state (state, end time or remaining time, tab ID, window ID) is stored in `storage.session`, not in worker memory, so it survives service-worker suspension. | MVP |
| FR-32 | Timers do not need to survive a browser restart in the MVP (they are discarded). | MVP |
| FR-33 | Restart persistence by matching URLs. | Later |

### 4.8 Cross-browser
| ID | Requirement | Pri |
|---|---|---|
| FR-34 | Works in Chromium-based browsers via Manifest V3. | MVP |
| FR-35 | Firefox support (dual `background` keys, gecko ID, API shim). | Later |

### 4.9 Force-exit and safety (escape hatches)

The lock must never trap the user. Layers, from user-initiated to automatic:

| ID | Requirement | Pri |
|---|---|---|
| FR-36 | **Stop phrase** always works from the popup while the user is on the timed tab, in any state (Running, Paused, Expired). | MVP |
| FR-37 | **Circuit breaker:** if the lock reverts more than 5 tab switches within 3 seconds, assume a loop or conflict. Release the lock, set the timer to Paused, and show a notice in the popup and badge. | MVP |
| FR-38 | **Safe mode on error:** any exception in lock enforcement or state loading releases the lock and logs the error. It must never leave the lock held. | MVP |
| FR-39 | **Self-healing check:** on every enforcement event, validate the timer record (tab exists, state is valid, end time is sane). If invalid, delete the record and release the lock. | MVP |
| FR-40 | **Expired-prompt timeout:** if an Expired prompt stays unanswered for 30 minutes, release the lock but keep the timer in Expired state with the tab open. The user is no longer trapped; the next toolbar click shows the prompt again. | MVP |
| FR-41 | **Hard cap:** the lock never holds longer than the maximum timer length (1440 min) plus extensions, enforced by a separate watchdog alarm that is independent of the timer's own alarm. | MVP |
| FR-42 | **Startup / install / update reset:** on `onStartup`, `onInstalled`, and extension update, all timer state is cleared and every lock released. | MVP |
| FR-43 | **Unavoidable exits are documented** in the README and in the popup help text: close the tab or window, or disable the extension at `chrome://extensions` / `brave://extensions`. | MVP |
| FR-44 | The lock never blocks navigation **within** the timed tab, so the user can open `brave://extensions` in that tab to disable the extension. | MVP |
| FR-45 | Optional "Emergency release" in the popup that needs a longer phrase or a 10-second hold, for cases where the user wants out but the normal Stop is not appropriate. | Later |
| FR-46 | Optional keyboard shortcut (via `commands`) that pauses the timer from any tab. | Later |

### 4.10 On-page timer widget

A floating widget on the timed page keeps the countdown in view while the user browses.

| ID | Requirement | Pri |
|---|---|---|
| FR-47 | When a timer is Running, Paused, or Expired, a widget is shown on the timed tab with the remaining time and state. | MVP |
| FR-48 | The widget can be dragged anywhere in the viewport and stays within its bounds, including after a window resize. Its position is remembered (in `storage.local`) across pages and sessions. | MVP |
| FR-49 | The widget can be minimized to a compact pill showing only the time, and restored. The minimized state is remembered. | MVP |
| FR-50 | The widget has Pause / Resume controls (same behavior as FR-17, FR-18). Stop stays in the popup behind the phrase (FR-21). | MVP |
| FR-51 | The widget re-appears after page reloads and in-tab navigations. It is shown in the top frame only, never in iframes. | MVP |
| FR-52 | The widget is isolated from the page: rendered in a Shadow DOM, immune to site CSS, high z-index, and does not shift the page layout. It reads no page content. | MVP |
| FR-53 | Site access is requested as an **optional host permission** when the user first clicks Start (a user gesture). If the user denies it, the timer still works with the badge and popup, the popup explains why there is no widget, and the lock still applies. | MVP |
| FR-54 | On expiry, the widget expands into the prompt: **Close tab** or **Add time** (see FR-25, FR-26). | MVP |
| FR-55 | The widget is removed when the timer is stopped or finished, or the tab closes. | MVP |
| FR-56 | The widget counts down locally from the stored end time (no per-second messaging) and updates through `storage.onChanged`. | MVP |
| FR-57 | Widget size options, opacity, snap-to-corner, hide-until-next-pause, and a keyboard shortcut to minimize. | Later |

Not supported (falls back to badge and popup): `chrome://` pages, the Chrome Web Store, `about:` pages, and any page where site access was denied. Fullscreen video may hide the widget.

## 5. Non-Functional Requirements

### 5.1 Reliability
- **NFR-R1:** Timer accuracy is within +/- 5 s.
- **NFR-R2:** Expiry is driven by `chrome.alarms`, not `setTimeout`, so it fires when the worker is suspended. Alarms can be delayed by machine sleep. Document this behavior.
- **NFR-R3:** The lock must **fail open**: if the timer record is missing or corrupt, or the timed tab no longer exists, the lock is released. A bug must never trap the user in a tab.
- **NFR-R4:** No uncaught errors when the timed tab is closed, discarded, or navigated mid-timer, or when `tabs.update` fails during lock enforcement.
- **NFR-R5:** The state machine rejects invalid transitions (e.g. Resume on a Running timer) without corrupting state.
- **NFR-R6:** Lock enforcement must not loop. Re-activating the timed tab must not trigger further re-activations (guard against event feedback).

### 5.2 Performance
- **NFR-P1:** The popup is interactive in < 100 ms.
- **NFR-P2:** The 30 s badge tick runs only while a timer is Running, and is cleared otherwise.
- **NFR-P3:** Tab-switch reversion happens fast enough that the user sees at most a brief flicker (target < 200 ms).
- **NFR-P4:** The widget script is injected only into the timed tab (not every page) and only while a timer exists. It does no work while minimized beyond a 1 s text update, and uses no layout-thrashing animation.
- **NFR-P5:** The widget must never break or block the host page: no global CSS leaks, no capture of page keyboard shortcuts, and pointer events only on its own box.

### 5.3 Security and Privacy
- **NFR-S1:** No network requests, telemetry, or remote code.
- **NFR-S2:** Minimum permissions. Required: `alarms`, `storage`, `scripting`, and `tabs` (keep `tabs` only if the lock needs it; otherwise try `activeTab`). **Host access is optional** (`optional_host_permissions`: `<all_urls>`) and requested on first timer start (FR-53), not at install. The install prompt must not mention access to all websites.
- **NFR-S3:** Only the tab ID, window ID, and title/URL needed for display are held, in session storage only. The widget's position and minimized state are the only data in `storage.local`. The injected script reads nothing from the page.
- **NFR-S4:** No inline scripts and no `eval`.

### 5.4 Usability and Accessibility
- **NFR-U1:** Starting a timer takes <= 2 clicks.
- **NFR-U2:** The popup and the expiry prompt are fully keyboard operable, with visible focus and labelled controls.
- **NFR-U3:** State is never conveyed by color alone (the badge text changes too).
- **NFR-U4:** The expiry prompt has a clear primary action and cannot be mistaken for a notification that can be ignored. Wording makes clear that the tab will **not** close until the user chooses.
- **NFR-U5:** The lock must be explained, not silent. A user blocked from switching tabs should be able to find out why and how to release it.

### 5.5 Compatibility
- **NFR-C1:** Chrome >= 110 (`storage.session`), Brave, Edge, Opera, and Vivaldi. Firefox >= 115 builds from the same codebase but is tested after the MVP.
- **NFR-C2:** Windows, macOS, and Linux.
- **NFR-C3:** Defined behavior with multiple windows (MVP: lock applies within the timed tab's window only).

### 5.6 Maintainability and Testing
- **NFR-M1:** Stack is WXT + TypeScript + Vitest (Node >= 20.19). WXT generates per-browser manifests (MV3 everywhere); the extension loads unpacked from `.output/<browser>-mv3`. No runtime dependencies.
- **NFR-M2:** The timer state machine is a pure function module (no `chrome.*` calls) so it can be unit tested.
- **NFR-Q1:** Unit tests for all state transitions and time math (start, pause, resume, expire, extend, stop).
- **NFR-Q2:** A manual test checklist: start, lock reverts tab switch, new tab, pause then switch, resume, stop phrase, expiry prompt (close / add time / dismiss), manual tab close, multiple windows, restricted pages.
- **NFR-Q3:** Escape-hatch tests, which must pass before any release:
  - Corrupt the stored timer record by hand; the lock must release.
  - Delete the timed tab while Running; no lock remains.
  - Force a rapid tab-switch loop; the circuit breaker trips and pauses the timer.
  - Throw an error inside the enforcement handler; the lock releases.
  - Leave the Expired prompt unanswered past the timeout; the lock releases.
  - Restart the browser and reload the extension; state is clean.
  - Disable the extension mid-timer; the lock ends immediately.

### 5.7 Distribution (post-MVP)
- **NFR-D1:** Icons (16, 48, 128), README with install steps, privacy statement, versioned CHANGELOG.

## 6. Notes on the Current Code (v1.0 baseline)

Changes this proposal requires:
- `alarms.onAlarm` currently calls `tabs.remove`; it must instead set state to Expired and show the prompt.
- Timer records only hold `{ end }`; they need `state`, `remaining`, `tabId`, and `windowId`.
- Add `tabs.onActivated` (and `tabs.onCreated`) handlers for the lock.
- The `tick` alarm is created on every start and never cleared; fix per NFR-P2.
- Add a content script (widget) with a Shadow DOM UI, injected via `scripting` once site access is granted, plus a small fallback page (`expired.html`) for the prompt where the widget can't show. Add Pause/Resume UI in the popup.
- Add `optional_host_permissions` and the permission request in the popup's Start flow.
- Starting a timer on a tab with an existing timer currently overwrites it; fix per FR-4/FR-5.

## 7. MVP Build Plan

1. **State machine module** with unit tests (states, transitions, remaining-time math).
2. **Background:** alarms, lock enforcement, expiry to the Expired state, cleanup on tab close, fail-open guards.
3. **Popup:** start form with validation, running view (pause / stop phrase), paused view (resume), expired view.
4. **On-page widget:** content script with Shadow DOM, drag, minimize, remembered position, pause/resume, and the expiry prompt (Close tab / Add time). Optional site-access request in the Start flow. Fallback prompt window for restricted pages.
5. **Manual test pass** on Chrome and Brave using the checklist in NFR-Q2.
6. **Package:** icons, README, zip.

## 8. Open Questions

1. **Pause abuse:** pause is free in this draft, which means the lock can be bypassed by pausing, switching, then resuming. Is that acceptable for the MVP, or should pause be limited or need its own friction (e.g. a typed phrase, a max pause time)?
2. **New tabs while locked (FR-12):** when the user opens a new tab, should the extension close it, or leave it open in the background and snap back to the timed tab?
3. **Other windows:** if the user focuses a different browser window, is that a lock violation? The MVP ignores it. Is that acceptable?
4. **Stop vs. pause UI:** as drafted, Pause is one click and Stop needs the phrase. Is that the intended split?
5. ~~**Expiry prompt style**~~ Resolved: the prompt lives in the on-page widget, with a popup window as fallback.
5a. **Widget defaults:** starting corner (e.g. top-right), size, and whether the minimized pill is the default state after the first minute.
5b. **Denied site access:** if the user declines the permission, is the timer still allowed to start (as drafted), or should the widget be required?
6. **Extend defaults:** which "Add time" quick options (e.g. +5 / +10 / +15)?
7. **Emergency exit:** should there be a way out if the lock misbehaves, such as disabling the extension? Browsers always allow this, but should the README say so?
