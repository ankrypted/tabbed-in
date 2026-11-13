# Issue Log

Every problem hit while building **Tabbed In**, with its cause and resolution.

**Status key:** ✅ resolved · 🟡 workaround / partly resolved · ⬜ open · ➖ not a problem

New entries go at the bottom of the matching section. When something changes status, update its row and add the date.

## Tooling and environment

| ID | Date | Issue | Cause | Resolution | Status |
|---|---|---|---|---|---|
| L-01 | 2026-11-13 | `wxt` fails: `SyntaxError: ... 'node:util' does not provide an export named 'parseEnv'` | WXT 0.21 needs Node >= 20.19; the system Node is 18.20.4 | Installed Node 22 via `fnm` and ran project commands under it: `fnm exec --using=22 cmd /c "npm run dev"`. Added `engines` to package.json and `.nvmrc` (22). | 🟡 |
| L-02 | 2026-11-13 | `node -v` still prints v18.20.4 in the user's terminal after installing Node 22 | fnm's default is 22, but PowerShell has no profile, so fnm is never loaded and `node` resolves to `C:\Program Files\nodejs` | Needs a one-line PowerShell profile (`fnm env --use-on-cd \| Out-String \| Invoke-Expression`). Claude was blocked from creating the file, so the user must add it. Until then, use the `fnm exec` form. | ⬜ |
| L-03 | 2026-11-13 | `fnm exec --using=22 npx ...` fails with "Can't spawn program: program not found" in Git Bash | `npx` / `npm` are `.cmd` batch files that `fnm exec` can't launch directly | Run through PowerShell with `cmd /c "..."` | ✅ |
| L-04 | 2026-11-13 | `npm install` reports 7 vulnerabilities (2 critical) | Transitive dev dependencies (tooling, not shipped code) | Not investigated yet. Run `npm audit` to see the packages. | ⬜ |
| L-05 | 2026-11-13 | Git author name is stored as `‘ankrypted’` (curly quotes) | User's global `git config user.name` contains typographic quote characters | Fix with `git config --global user.name "ankrypted"`. Left unchanged because it's a global setting. | ⬜ |

## Build and manifest

| ID | Date | Issue | Cause | Resolution | Status |
|---|---|---|---|---|---|
| L-06 | 2026-11-13 | Firefox build came out as MV2 | WXT defaults Firefox to MV2; we need MV3 for `storage.session` | Set `manifestVersion: 3` in `wxt.config.ts` | ✅ |
| L-07 | 2026-11-13 | Firefox warnings: missing extension ID, missing `data_collection_permissions` | AMO requires both for new extensions | Added `browser_specific_settings.gecko.id` (`tabbed-in@ankrypted`, a placeholder) and `data_collection_permissions: { required: ['none'] }` | ✅ |
| L-08 | 2026-11-13 | `TS2578: Unused '@ts-expect-error' directive` in `wxt.config.ts` | The manifest type already supports `data_collection_permissions` | Removed the directive | ✅ |
| L-09 | 2026-11-13 | Built manifest contained `"host_permissions": ["<all_urls>"]`, which would add "read all your data on all websites" to the install prompt | WXT auto-adds host permissions for runtime-registered content scripts | Added a `build:manifestGenerated` hook that deletes `host_permissions`. Site access is now `optional_host_permissions`, requested on first Start. Verified in the built manifest. | ✅ |
| L-10 | 2026-11-13 | Built manifest exposed `content-scripts/widget.css` as a web-accessible resource to all sites | WXT's `cssInjectionMode: 'ui'` loads the CSS by fetching an extension file | Inlined the CSS (`import css from './style.css?inline'`) and removed `cssInjectionMode`. No web-accessible resources remain. | ✅ |

## Dev workflow and runtime

| ID | Date | Issue | Cause | Resolution | Status |
|---|---|---|---|---|---|
| L-11 | 2026-11-13 | Dev Chrome shows "You are using an unsupported command-line flag: --disable-blink-features=AutomationControlled" | WXT launches Chrome with automation flags so it can load and reload the extension | Harmless. Dismiss the banner. | ➖ |
| L-12 | 2026-11-13 | Dev Chrome opens on `about:blank` with no sign-ins | WXT uses a clean dev profile | Expected. Open a normal site to test. | ➖ |
| L-13 | 2026-11-13 | "Start not working" / "no buttons are working" in the popup | Not the extension code: the production build works (see L-25). The dev setup was unreliable for two reasons: (a) two `wxt` dev servers ran at once (ports 3000 and 3001) and overwrote each other's popup and manifest in `.output/chrome-mv3-dev`, so the popup's scripts came from a server the manifest's CSP didn't allow; (b) see L-24. | Stopped the extra server. Use the production build (`npm run build`, then Load unpacked `.output/chrome-mv3` in Brave) or the Brave-based dev launch from L-24. | 🟡 |
| L-24 | 2026-11-13 | WXT's auto-launched Chrome doesn't load the extension | Chrome 156 (branded) ignores `--load-extension`, even with the `DisableLoadExtensionCommandLineSwitch` workaround (confirmed: the service worker never started). Brave still honours the flag. | Added a git-ignored `web-ext.config.ts` pointing WXT's dev browser at Brave, with `https://example.com` as the start page. Needs a restart of `npm run dev` to take effect; not yet tried by the user. | 🟡 |
| L-25 | 2026-11-13 | Needed proof of whether the code itself works | n/a | Wrote automated browser tests (Playwright driving Brave, in the scratchpad, not in the repo). **Popup:** click 5m shows the running view, "4:58 left", timer stored, no errors. **Widget:** appears with the countdown, default top-right, drags, clamps when dragged off-screen, keeps its position across a page reload, removes itself on cancel, no console errors. The permission dialog itself isn't automatable, so host access was pre-granted in a test copy of the manifest. | ✅ |
| L-14 | 2026-11-13 | DevTools Issues panel shows "A form field element should have an id or name attribute" and "Content Security Policy blocks inline execution of scripts and stylesheets" | Unclear. Our popup inputs all have ids and the widget inlines nothing into the page, so these are probably from the website page, not the extension. | Awaiting the popup's own Console output (right-click in the popup, Inspect) and the service-worker console. | ⬜ |
| L-15 | 2026-11-13 | Claude could not confirm the dev browser opened with the extension loaded | The process check found no Chrome started with the extension flags; recent branded Chrome may ignore the load flag | The dev log later reported "Opened browser"; the user then showed the window. Fallback is Load unpacked on `.output/chrome-mv3-dev`. | ✅ |
| L-16 | 2026-11-13 | Claude was blocked from creating the PowerShell profile (`$PROFILE`) | Auto-mode permission classifier denied writing to the user's Documents folder | Not worked around. Gave the user the two commands to run themselves (see L-02). | 🟡 |

## Code (baseline v1.0 problems, to fix in the MVP)

| ID | Date | Issue | Cause | Resolution | Status |
|---|---|---|---|---|---|
| L-17 | 2026-11-13 | The 30-second `tick` alarm is created on every Start and never cleared | `startTimer` always creates it; nothing clears it when the last timer ends | Planned: clear it when no timers remain (NFR-P2) | ⬜ |
| L-18 | 2026-11-13 | Starting a timer on a tab that already has one silently overwrites it; timers can run on several tabs | No guard in `startTimer` | Fixed: `startTimer` refuses when any timer exists (after pruning records whose tab is gone) and returns `{ ok: false, error }`; the popup shows "A timer is already running in another tab" instead of the start form. Verified by automated test. | ✅ |
| L-19 | 2026-11-13 | Custom minutes only checked for `> 0` (no whole-number check, no 1440 cap, no error message) | Minimal validation in the popup | Planned: FR-3 | ⬜ |
| L-20 | 2026-11-13 | Read-modify-write race: two handlers (e.g. `tick` and `cancel`) can overwrite each other's change to `timers` | Every handler loads, edits, and saves the whole record with no locking | Planned: serialize storage updates in the state-machine work | ⬜ |
| L-21 | 2026-11-13 | At zero the tab is closed automatically | Original design | Planned: Expired state with a Close tab / Add time prompt (FR-24 to FR-28, FR-54) | ⬜ |
| L-22 | 2026-11-13 | No timer lock: the user can freely switch tabs | Not built yet | Built (FR-11 to FR-15): `tabs.onActivated` reverts any switch to another tab in the timed tab's window; the widget shows "Locked in. Stop the timer to switch tabs." Safety nets: circuit breaker (more than 5 reverts in 3 s releases the lock), safe mode on errors, self-healing on corrupt or stale records. Decision logic is in `utils/lock.ts` (15 unit tests). Verified end to end in Brave (15/15 checks, see L-26). | ✅ |
| L-23 | 2026-11-13 | Widget could be offset on pages that put a `transform` on `<body>` (fixed positioning is relative to it) | Known limitation of `position: fixed` | Not handled yet | ⬜ |
| L-26 | 2026-11-13 | Needed proof that the lock works and never traps the user | n/a | Automated test in Brave, 15/15 passing: opening a new tab snaps back to the timed tab (and leaves the new tab open); switching to an existing tab is reverted; the widget explains why; navigating inside the timed tab is allowed; a second timer is refused; Stop releases the lock; rapid switching trips the circuit breaker, the timer keeps running, and switching then sticks; a corrupt record releases the lock; closing the timed tab removes its timer. | ✅ |
| L-27 | 2026-11-13 | Design choice: what happens to a new tab opened while locked | Open question in REQUIREMENTS.md (FR-12) | Chose to leave the new tab open in the background and snap focus back (less destructive than closing it). Revisit if the user prefers closing it. | ➖ |
| L-28 | 2026-11-13 | The lock only covers the timed tab's own window: focusing a different browser window, or dragging the tab out into a new window, is not blocked | Deliberate MVP scope (FR-16 is "Later") | Not handled yet | ⬜ |
| L-29 | 2026-11-13 | Still missing from the safety design: expired-prompt timeout, watchdog alarm, explicit startup/install reset (FR-40 to FR-42) | Depend on the Expired state and the state-machine work | Planned | ⬜ |
| L-30 | 2026-11-13 | IDE hint "'Timers' is declared but its value is never read" in `popup/main.ts` | Stale diagnostic from before the edit that uses it | `tsc` passes and the type is used in `render()`. | ➖ |

## Process notes
- **2026-11-13:** "Done" originally meant the code compiled and built. Since L-25, the popup Start flow and the widget (show, drag, clamp, persist, remove) are verified end to end in Brave by an automated test. Still untested in a browser: the real permission dialog and its denial path, and Firefox.
