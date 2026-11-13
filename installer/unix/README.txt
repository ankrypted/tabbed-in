TABBED IN - install on Linux or macOS (Brave, Chrome, Chromium, or Edge)
========================================================================

You need a terminal (Terminal on macOS). It takes about a minute.

1. Unpack this bundle (double-click the .tar.gz, or: tar -xzf <file>).
2. Run the installer:

   macOS:   open Terminal, type   bash    (with a space after it), drag the
            file install.sh from Finder into the Terminal window, press Enter.
            (Or double-click install.command. The first time, right-click it,
            choose Open, then Open again: macOS blocks files from the internet.)
   Linux:   open a terminal in the unpacked folder and run:   bash install.sh

3. It unzips the extension into  ~/TabbedIn/extension  (replacing any older
   files), copies that path to your clipboard (if it can), and tries to open
   your browser's Extensions page. On macOS it may ask "Terminal wants to
   control Brave/Chrome": click OK.
4. It then prints the EXACT clicks to finish. In short: turn on "Developer
   mode", click "Load unpacked", paste the path, choose the folder. Browsers do
   not let any program do this silently, on purpose.

If you ALREADY have Tabbed In in that browser, the script says so:
  - same folder as before: it just replaced the files. Click the reload icon on
    the Tabbed In card and you're done (nothing to remove or add).
  - a copy from somewhere else (e.g. an older download): it lists where that
    copy is loaded from. Click Remove on that older card FIRST. Two copies fight
    over the tab lock, so only keep one. (A script can't remove it for you:
    browsers don't allow that.)

First use: open any normal website, click Tabbed In, pick a time, and click
Start. Your browser will ask once for permission to show the timer on pages.
Allow it. You'll also see a notification and hear a bell when time is up.

Do not delete ~/TabbedIn/extension while you use the extension: the browser
loads it from there.

UPDATING
  Unpack the new bundle, run the installer again, then click the reload icon on
  the Tabbed In card on the Extensions page.

UNINSTALLING
  1. On the Extensions page, click Remove on Tabbed In.
  2. Run:   bash install.sh --uninstall      (or just delete ~/TabbedIn)

NOTES
  - The script is plain text. Open install.sh in any editor to read exactly
    what it does. It only writes inside ~/TabbedIn.
  - Snap-packaged Chromium cannot read hidden folders, which is why the folder is
    ~/TabbedIn and not ~/.something. Flatpak browsers may need access to your
    home folder.
  - If a browser installed in an unusual place isn't found, pass its name:
        bash install.sh --browser brave      (brave, chrome, chromium, edge)
  - Chrome may show a "Disable developer mode extensions" message when it
    starts. Keep the extension. It's Chrome's standard warning for extensions
    that are not from the Web Store.
  - Nothing is collected or sent anywhere. The extension makes no network
    requests.
