# Tabbed In: download and install

Tabbed In locks you to one browser tab for a set time. When time is up, a bell rings and a notification appears, and the tab stays open.

Works in **Brave, Chrome, Edge, Opera, and Vivaldi** (any Chromium browser) on Windows, macOS, and Linux.

## Download (version 0.3.0)

| Your system | Download |
|---|---|
| **Windows** (easiest) | [tabbed-in-0.3.0-extension.zip](https://github.com/ankrypted/tabbed-in/raw/dev/releases/tabbed-in-0.3.0-extension.zip) |
| **macOS / Linux** | [tabbed-in-0.3.0-extension.tar.gz](https://github.com/ankrypted/tabbed-in/raw/dev/releases/tabbed-in-0.3.0-extension.tar.gz) |

Both contain exactly the same files.

## Install (about 2 minutes)

1. **Unpack it somewhere permanent**, for example `Documents\TabbedIn` or `~/TabbedIn`. Your browser loads the extension straight from this folder, so **don't delete or move it** afterwards.
   - **Windows:** right-click the zip, then **Extract All...**
   - **macOS:** double-click the `.tar.gz`
   - **Linux:** `tar -xzf tabbed-in-0.3.0-extension.tar.gz`
   - The `.tar.gz` unpacks into a folder named `tabbed-in-0.3.0`. For the zip, choose or create a folder to extract into. Either way, the folder you end up with has a file called `manifest.json` directly inside it.
2. In your browser, open the Extensions page. Click the address bar, type one of these, and press Enter:
   - Brave: `brave://extensions`
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
3. Turn on **Developer mode** (switch in the top-right corner).
4. Click **Load unpacked** (top-left) and choose the folder that has `manifest.json` in it.
5. A card named **Tabbed In 0.3.0** appears. Click the puzzle-piece icon in the toolbar and **pin** Tabbed In.

## Use it

1. Open any normal website (for example example.com).
2. Click the Tabbed In button, choose a mode, pick a time, and click **Start**.
   - **Focus** (default): locks you to the tab (or its whole tab group). A bell rings at the end and the tab stays open.
   - **Leisure**: for watching something. No lock; the screen blurs over the last 15 seconds and then the tab closes, so save first.
3. Your browser asks once for permission to show the timer on pages. Click **Allow**.
4. A small timer card appears on the page. You can drag it anywhere.
5. In Focus mode, until the timer ends you can't switch to other tabs, and new tabs you open are closed. To stop early, type `i am done` in the popup.
6. When time is up, Focus mode rings a bell and shows a notification (the tab stays open); Leisure mode closes the tab.

## Updating

Download the new version and unpack it **over the same folder** (replace the files), then click the circular-arrow reload icon on the Tabbed In card. If you unpack it to a different folder instead, remove the old Tabbed In card first. Two copies fight over the tab lock.

## Notes

- Chrome may show a "Disable developer mode extensions" message when it starts. Keep the extension. It's Chrome's standard warning for extensions that aren't from the Web Store.
- Nothing is collected or sent anywhere. The extension makes no network requests.
- Installers that do some of these steps for you (Windows, macOS, Linux) are described in the [main README](../README.md#share-it-with-friends).
