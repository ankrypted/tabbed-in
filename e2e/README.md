# Browser (end-to-end) tests

These drive a **real Brave** with the built extension loaded, so they catch problems that unit tests can't: the popup, the on-page widget, the tab lock, and how they work together.

## Run them

```bash
npm run test:e2e              # builds the extension, then runs everything
npm run test:e2e:only         # run against the existing build (skip the build)
node e2e/run.mjs lock         # only files whose name contains "lock"
node e2e/lock.e2e.mjs         # a single file
```

A browser window opens and closes by itself for each file. Don't click around while it runs, because the tests switch tabs and the window focus matters. The exit code is non-zero if any check fails.

On Windows, run these under Node 22 (see the main README); for example `fnm exec --using=22 cmd /c "npm run test:e2e"`.

## Test a different build

Set `E2E_EXTENSION_DIR` to any unpacked extension folder to run the tests against it instead of `.output/chrome-mv3`: for example the folder the installer produced, to prove what friends get really works.

```powershell
$env:E2E_EXTENSION_DIR = "C:\path\to\unzipped\extension"; node e2e/lock.e2e.mjs
```

## Which browser

Set `BROWSER_PATH` to a Brave or Chromium executable. If it's unset, the helper looks for Brave in the usual places on Windows, macOS, and Linux.

**Branded Chrome won't work:** since Chrome 137 it ignores the `--load-extension` flag, so the extension never loads (the service worker never starts).

## What each file covers

| File | Checks | Covers |
|---|---|---|
| `popup.e2e.mjs` | 5 | Clicking Start shows the running view and countdown, stores the timer, no popup errors |
| `popup-closes.e2e.mjs` | 3 | The popup is destroyed at the site-access request (as the browser does); the timer and lock survive |
| `widget.e2e.mjs` | 8 | Widget appears, default position, drag, clamps to the viewport, remembers position across reload, removes itself on stop, no console errors |
| `lock.e2e.mjs` | 20 | Switch-back, explanatory note, new-tab-page tabs closed, link-opened tabs kept, in-tab navigation, one timer at a time, stop, circuit breaker, corrupt record, closing the timed tab |
| `popup-group.e2e.mjs` | 11 | The real popup UI on a tab in a group: option shown and ticked, Start stores a group timer, switching inside the group sticks, outside is reverted, stop from the other group tab (only the active-tab lookup is stubbed) |
| `leisure.e2e.mjs` | 21 | Mode switch in the popup, no lock and no new-tab closing, haze sampled at 16/10/5/1 s (clear, then rising), clicks not blocked, card above the haze, tab closed at zero, other tabs untouched, group ignored. Takes about 40 s (real timer) |
| `group.e2e.mjs` | 36 | Group timer: free switching inside the group, revert to the last group tab, widget on every group tab (also ones added later), New Tab page outside the group closed, new tabs inside it kept (also when attached late), closing the starting tab keeps the timer, group dissolved releases the lock, single-tab fallbacks |
| `drag-error.e2e.mjs` | 5 | Regression test for the "user may be dragging a tab" bug: retries, no self-release, stopping mid-retry |
| `expiry.e2e.mjs` | 14 | When time is up: the tab is **not** closed, the timer stops on its own, the lock lifts, the widget goes away, a notification is shown, and the bell page is created and its audio engine runs. A timer stopped early does not ring |

## How it works

- `helpers.mjs` copies `.output/chrome-mv3` to `.output/e2e-ext-*` (so your real build is untouched) and launches the browser with a throwaway profile.
- **Site access:** the real extension asks for site access through a browser dialog that automation can't click. Tests that need the widget use a copy with `host_permissions` pre-granted (`grantHosts: true`). Tests of the real popup flow use the real manifest.
- Tests call the extension's own message API from a popup page (`chrome.runtime.sendMessage`) instead of clicking the toolbar icon, because Playwright can't see the toolbar popup.
- A tab is "the new-tab button" via `chrome.tabs.create({})`, which opens the browser's own New Tab page.
- Tests use `https://example.com` and `https://example.org`, so they need an internet connection.

## Not covered (needs a human)

- The real site-access dialog and the Deny path.
- Real mouse clicks on the browser's tab strip, the real + button, and Ctrl+T (the browser UI is outside what automation can drive).
- Hearing the bell and seeing the system notification (the tests only check that the bell page ran and a notification was created).
- Firefox and Chrome itself.
- Pause/resume (not built yet).

## Adding a test

Create `e2e/<name>.e2e.mjs`, use `launch()` and `reporter()` from `helpers.mjs`, and call `t.done()` at the end. `run.mjs` picks it up automatically. Keep the `.e2e.mjs` suffix: Vitest runs anything named `*.test.*`, and this keeps the two suites separate.
