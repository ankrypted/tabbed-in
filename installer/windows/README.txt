TABBED IN - install on Windows (Brave, Chrome, or Edge)
=======================================================

1. Unzip this bundle somewhere (for example your Downloads folder).
2. Double-click  install.bat
   (If Windows says "Windows protected your PC", click "More info" then
   "Run anyway". The script is plain text: open install.ps1 in Notepad to read
   exactly what it does.)
3. Pick your browser if it asks. It unzips the extension to
   %LOCALAPPDATA%\TabbedIn\extension, copies that path to your clipboard, opens
   a new browser window, and types the Extensions page address into it for you.
   Please don't click or type for a few seconds while it does that. (Browsers
   ignore that address on the command line, so the script types it like a
   person would. It only types into the window it just opened. If anything looks
   off it leaves it to you and says what to type.)
   If you ALREADY have Tabbed In in that browser, the script says so:
     - same folder as before: it just replaced the files. Click the reload
       icon on the Tabbed In card and you're done (nothing to remove or add).
     - a copy from somewhere else (e.g. an older download): it lists where
       that copy is loaded from. Click Remove on that older card FIRST. Two
       copies fight over the tab lock, so only keep one. (A script can't
       remove it for you: browsers don't allow that.)
4. The black window then prints the EXACT steps, with your real folder path
   in them. In short, you do the last step yourself (browsers do not let any
   program do this silently, on purpose):
     a. Turn on "Developer mode" (top right)
     b. Click "Load unpacked"
     c. In the folder window, click the "Folder:" box at the bottom, press
        Ctrl+V to paste the path, then click "Select Folder"
     d. Click the puzzle-piece icon in the toolbar and pin Tabbed In

   On a Mac or Linux? Use the other bundle (tabbed-in-linux-macos-*.tar.gz).

First use: open any normal website, click Tabbed In, pick a time, and click
Start. Your browser will ask once for permission to show the timer on pages.
Allow it. You'll also see notifications and hear a bell when time is up.

Do not delete the folder %LOCALAPPDATA%\TabbedIn\extension while you are using
the extension: the browser loads it from there.

UPDATING
  Download the new bundle, double-click install.bat again, then click the
  reload icon on the Tabbed In card on the Extensions page.

UNINSTALLING
  1. On the Extensions page, click Remove on Tabbed In.
  2. Run:  powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall
     (or just delete %LOCALAPPDATA%\TabbedIn)

NOTES
  - Chrome may show a "Disable developer mode extensions" message when it
    starts. Choose "Cancel" / keep it. This is Chrome's standard warning for
    extensions that are not from the Web Store.
  - Nothing is collected or sent anywhere. The extension makes no network
    requests.
