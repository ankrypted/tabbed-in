# MVP Checklist

Minimum functional requirements for **Tabbed In**, with live status. Full detail is in [REQUIREMENTS.md](REQUIREMENTS.md).

**Key:** ✅ done · 🟡 partial · ⬜ not started

"Done" means built and, where noted, verified. The popup Start flow and the widget were verified end to end in Brave by an automated test (see log.md L-25). Items 1, 4, 8, and 11 come from the original baseline code; items 1 and the timer display in 4 were also confirmed by that test.

**Progress: 8 done · 6 partial · 4 not started (of 18)**

## Timer
| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Start a timer on the current tab from the popup (presets 5/15/30/60 min, or custom minutes) | ✅ | Baseline code |
| 2 | Custom input validated (whole number, 1 to 1440); bad input does not start a timer | 🟡 | Only checks value > 0; no cap, no error message |
| 3 | Only one timer active at a time; a tab with a timer cannot get a second | ✅ | Verified: a second start is refused, and the popup says why |
| 4 | Popup shows live time remaining; badge shows minutes left | ✅ | Baseline code |

## Focus lock
| # | Requirement | Status | Notes |
|---|---|---|---|
| 5 | While running, switching to another tab in the same window is reverted, and the user is told why | ✅ | Verified in Brave. Tabs opened with the new-tab button / Ctrl+T are closed automatically; tabs opened by a link on the timed page are kept in the background. Focus always returns to the timed tab |
| 6 | Navigation within the timed tab is still allowed | ✅ | Verified; the widget also re-appears after the navigation |

## Pause and stop
| # | Requirement | Status | Notes |
|---|---|---|---|
| 7 | Pause (releases the lock) and resume (re-applies the lock with remaining time) | ⬜ | |
| 8 | Stop by typing "i am done" | ✅ | Baseline code |

## Expiry
| # | Requirement | Status | Notes |
|---|---|---|---|
| 9 | At zero the tab does not close; user is prompted to close it or add time (in the widget, popup window as fallback) | ⬜ | Currently auto-closes, the opposite of the goal |
| 10 | The lock stays on until the prompt is answered | ⬜ | |

## On-screen timer widget
| # | Requirement | Status | Notes |
|---|---|---|---|
| 15 | A floating widget on the timed page shows the countdown and state, and survives reloads and navigation | 🟡 | Countdown and survival across reload verified in Brave; state display (paused/expired) pending |
| 16 | The widget can be dragged anywhere in the viewport, with its position remembered | ✅ | Verified in Brave by automated test: drag, clamp at edges, position kept across reload |
| 17 | The widget can be minimized to a small pill and restored | ⬜ | Next |
| 18 | Site access is requested on first Start (optional permission); if denied, the timer still works via badge and popup | 🟡 | Built; install prompt confirmed light (no host permission in manifest); denial path untested |

## Cleanup and safety
| # | Requirement | Status | Notes |
|---|---|---|---|
| 11 | Closing the timed tab removes its timer | ✅ | Baseline code |
| 12 | The lock can never trap the user (corrupt or missing record, vanished tab, error, tab-switch loop all release it) | 🟡 | Built and verified: circuit breaker, corrupt-record release, vanished tab, safe mode. Pending: expired-prompt timeout, watchdog alarm, startup reset (REQUIREMENTS.md 4.9) |
| 13 | No timers kept across a browser restart; all state cleared on startup | 🟡 | Session storage clears on restart, but no explicit startup reset and not verified |
| 14 | Works in Chromium browsers (Chrome, Brave) | 🟡 | Runs in Brave (automated test passes). Not yet tried in Chrome: Chrome 156 can't load unpacked from the command line, so it needs a manual Load unpacked |

## Supporting work
| Item | Status |
|---|---|
| Requirements and MVP scope | ✅ |
| Repo, WXT, TypeScript, Vitest setup | ✅ |
| Docs (README, CODE_GUIDE) | ✅ |
| State machine module with unit tests | ⬜ |
| Background rewrite (lock, expiry state, serialized storage writes) | ⬜ |
| Popup rewrite (pause/resume, validation, expired view) | ⬜ |
| On-page widget (content script, Shadow DOM, drag, minimize, expiry prompt) | 🟡 drag + remembered position built; minimize, pause/resume, expiry prompt pending |
| Unit tests (position clamping, time formatting, lock decisions, circuit breaker) | ✅ 55 tests passing |
| Tab-switch lock with safety nets | ✅ verified in Brave (20/20 checks, plus 5/5 for the click-during-mouse-down failure). Real mouse clicks on the tab strip can't be automated, so please confirm by hand |
| Fallback prompt window for restricted pages | ⬜ |
| Manual test pass (NFR-Q2) and escape-hatch tests (NFR-Q3) | ⬜ |
| Real icons | ⬜ |
| License | ⬜ |

## Open decisions
- Is pause free, or limited?
- New tabs while locked: close them, or leave them open in the background?
- Does focusing another browser window count as leaving the tab?
- Safety numbers: circuit breaker at 5 switches in 3 seconds; expired-prompt timeout of 30 minutes.
- Widget defaults: starting corner, size, and whether it auto-minimizes.
- Resolved: new tabs opened while locked are closed (links on the timed page excepted).
- If the user denies site access, may the timer still start (as drafted)?
