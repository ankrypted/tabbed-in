# MVP Checklist

Minimum functional requirements for **Tabbed In**, with live status. Full detail is in [REQUIREMENTS.md](REQUIREMENTS.md).

**Key:** ✅ done · 🟡 partial · ⬜ not started

"Done" means the code exists and compiles. Nothing has been verified end to end in a browser yet.

**Progress: 4 done · 3 partial · 7 not started (of 14)**

## Timer
| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | Start a timer on the current tab from the popup (presets 5/15/30/60 min, or custom minutes) | ✅ | Baseline code |
| 2 | Custom input validated (whole number, 1 to 1440); bad input does not start a timer | 🟡 | Only checks value > 0; no cap, no error message |
| 3 | Only one timer active at a time; a tab with a timer cannot get a second | ⬜ | Currently overwrites, and allows timers on several tabs |
| 4 | Popup shows live time remaining; badge shows minutes left | ✅ | Baseline code |

## Focus lock
| # | Requirement | Status | Notes |
|---|---|---|---|
| 5 | While running, switching to another tab in the same window is reverted, and the user is told why | ⬜ | |
| 6 | Navigation within the timed tab is still allowed | ⬜ | Nothing blocks it today, but there is no lock yet |

## Pause and stop
| # | Requirement | Status | Notes |
|---|---|---|---|
| 7 | Pause (releases the lock) and resume (re-applies the lock with remaining time) | ⬜ | |
| 8 | Stop by typing "i am done" | ✅ | Baseline code |

## Expiry
| # | Requirement | Status | Notes |
|---|---|---|---|
| 9 | At zero the tab does not close; user is prompted to close it or add time | ⬜ | Currently auto-closes, the opposite of the goal |
| 10 | The lock stays on until the prompt is answered | ⬜ | |

## Cleanup and safety
| # | Requirement | Status | Notes |
|---|---|---|---|
| 11 | Closing the timed tab removes its timer | ✅ | Baseline code |
| 12 | The lock can never trap the user (corrupt or missing record, vanished tab, error, tab-switch loop all release it) | ⬜ | See REQUIREMENTS.md section 4.9 |
| 13 | No timers kept across a browser restart; all state cleared on startup | 🟡 | Session storage clears on restart, but no explicit startup reset and not verified |
| 14 | Works in Chromium browsers (Chrome, Brave) | 🟡 | Builds as MV3; not yet run in Brave |

## Supporting work
| Item | Status |
|---|---|
| Requirements and MVP scope | ✅ |
| Repo, WXT, TypeScript, Vitest setup | ✅ |
| Docs (README, CODE_GUIDE) | ✅ |
| State machine module with unit tests | ⬜ |
| Background rewrite (lock, expiry state, serialized storage writes) | ⬜ |
| Popup rewrite (pause/resume, validation, expired view) | ⬜ |
| Expiry prompt window | ⬜ |
| Manual test pass (NFR-Q2) and escape-hatch tests (NFR-Q3) | ⬜ |
| Real icons | ⬜ |
| License | ⬜ |

## Open decisions
- Is pause free, or limited?
- New tabs while locked: close them, or leave them open in the background?
- Does focusing another browser window count as leaving the tab?
- Safety numbers: circuit breaker at 5 switches in 3 seconds; expired-prompt timeout of 30 minutes.
