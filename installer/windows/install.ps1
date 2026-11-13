<#
.SYNOPSIS
  Installs (or updates) the Tabbed In extension for Brave, Chrome, or Edge on Windows.

.DESCRIPTION
  Chrome-family browsers do not let any script add or remove an extension
  silently; that is a deliberate security rule (and the browser's preferences
  file is signed, so editing it is not safe either). So this script does
  everything EXCEPT the final clicks:
    1. replaces the unzipped extension folder (%LOCALAPPDATA%\TabbedIn\extension)
       with the new version, so there is never a leftover old copy on disk
    2. looks (read-only) for OTHER copies of Tabbed In already added to the
       browser, e.g. one loaded from a different folder, and tells you exactly
       which one to remove so two copies never fight over the tab lock
    3. copies the folder path to the clipboard
    4. opens a new browser window and types the Extensions page address into it
       (browsers ignore that address on the command line, so this is done the way
       a person would: Ctrl+L, type, Enter; it only types into a window it just
       opened, and falls back to telling you what to type)
    5. prints the exact clicks to finish

  UPDATING: run this script again with the new zip. The folder path stays the
  same, so the browser keeps the same extension: just click the reload icon on
  its card. No need to remove or re-add anything.

  The script only writes inside %LOCALAPPDATA%\TabbedIn (or -InstallDir). It does
  not change browser settings or the registry.

.PARAMETER Zip         Path to the extension zip. Default: tabbed-in-*.zip next to this script.
.PARAMETER Browser     brave, chrome, or edge. Default: ask if more than one is installed.
.PARAMETER InstallDir  Where to unzip. Default: %LOCALAPPDATA%\TabbedIn\extension
.PARAMETER NoOpen      Do not open the browser at all.
.PARAMETER NoKeys      Open the browser window but do not type the address for you.
.PARAMETER NoClipboard Do not copy the path to the clipboard.
.PARAMETER Uninstall   Delete the unzipped folder (then click Remove in the browser).
.PARAMETER UserDataDir Override the browser's "User Data" folder to read (used by the tests).
.PARAMETER BrowserArgs Extra browser arguments separated by | (used by the tests).
.PARAMETER BrowserExe  Use this program instead of the detected browser (used by the tests).
#>
param(
  [string]$Zip,
  [ValidateSet('brave', 'chrome', 'edge')][string]$Browser,
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'TabbedIn\extension'),
  [switch]$NoOpen,
  [switch]$NoKeys,
  [switch]$NoClipboard,
  [switch]$Uninstall,
  [string]$UserDataDir,
  [string]$BrowserArgs = '',
  [string]$BrowserExe
)

$ErrorActionPreference = 'Stop'
$ExtensionName = 'Tabbed In'

function Fail($message) {
  Write-Host ''
  Write-Host "Error: $message" -ForegroundColor Red
  exit 1
}

# Only ever delete a folder that is empty, missing, or clearly a Tabbed In install.
function Test-SafeToReplace($dir) {
  if (-not (Test-Path -LiteralPath $dir)) { return $true }
  if (-not (Get-ChildItem -LiteralPath $dir -Force | Select-Object -First 1)) { return $true }
  $manifest = Join-Path $dir 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifest)) { return $false }
  try { return ((Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).name -eq $ExtensionName) }
  catch { return $false }
}

function Get-FullPath($path) {
  try { return [IO.Path]::GetFullPath($path).TrimEnd('\') } catch { return "$path".TrimEnd('\') }
}

# --- known browsers -----------------------------------------------------------
$browsers = [ordered]@{
  brave  = @{ Label = 'Brave';  Url = 'brave://extensions';  Data = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\User Data"; Paths = @(
      "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe",
      "${env:ProgramFiles(x86)}\BraveSoftware\Brave-Browser\Application\brave.exe",
      "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe") }
  chrome = @{ Label = 'Chrome'; Url = 'chrome://extensions'; Data = "$env:LOCALAPPDATA\Google\Chrome\User Data"; Paths = @(
      "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
      "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
      "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe") }
  edge   = @{ Label = 'Edge';   Url = 'edge://extensions';   Data = "$env:LOCALAPPDATA\Microsoft\Edge\User Data"; Paths = @(
      "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
      "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") }
}

# --- read-only look at which Tabbed In copies a browser already has -----------
# Reads each profile's Preferences / Secure Preferences. Never writes to them.
function Read-JsonShared($file) {
  # Open with sharing so it works while the browser is running.
  $stream = [IO.File]::Open($file, 'Open', 'Read', 'ReadWrite')
  try { $text = (New-Object IO.StreamReader($stream)).ReadToEnd() } finally { $stream.Dispose() }
  Add-Type -AssemblyName System.Web.Extensions
  $serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
  $serializer.MaxJsonLength = [int]::MaxValue
  return $serializer.DeserializeObject($text)  # case-sensitive dictionaries (Chrome's files have case-clashing keys)
}

function Find-TabbedInCopies($userData, $installDir) {
  $found = @()
  if (-not $userData -or -not (Test-Path -LiteralPath $userData)) { return $found }
  $here = Get-FullPath $installDir
  $profiles = Get-ChildItem -LiteralPath $userData -Directory -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -eq 'Default' -or $_.Name -like 'Profile *' }
  foreach ($profile in $profiles) {
    $seen = @{}
    foreach ($fileName in 'Secure Preferences', 'Preferences') {
      $file = Join-Path $profile.FullName $fileName
      if (-not (Test-Path -LiteralPath $file)) { continue }
      try {
        $json = Read-JsonShared $file
        $settings = $json['extensions']['settings']
      } catch { continue }
      if (-not $settings) { continue }
      foreach ($id in $settings.Keys) {
        if ($seen.ContainsKey($id)) { continue }
        $entry = $settings[$id]
        if ($entry -isnot [System.Collections.IDictionary]) { continue }
        $path = $entry['path']
        $name = $null
        if ($entry['manifest'] -is [System.Collections.IDictionary]) { $name = $entry['manifest']['name'] }
        if (-not $name -and $path -is [string] -and (Test-Path -LiteralPath (Join-Path $path 'manifest.json'))) {
          try { $name = (Get-Content -LiteralPath (Join-Path $path 'manifest.json') -Raw | ConvertFrom-Json).name } catch {}
        }
        if ($name -ne $ExtensionName) { continue }
        $seen[$id] = $true
        $kind = 'other'
        if ($path -is [string] -and (Get-FullPath $path) -ieq $here) { $kind = 'this' }
        elseif ($path -is [string] -and -not (Test-Path -LiteralPath $path)) { $kind = 'missing' }
        elseif ($path -isnot [string]) { $kind = 'store' }
        $found += [pscustomobject]@{ Profile = $profile.Name; Id = $id; Path = $path; Kind = $kind }
      }
    }
  }
  return $found
}

# --- open the Extensions page ----------------------------------------------------
# Browsers ignore chrome://, brave:// and edge:// addresses given on the command
# line (they just open a New Tab page), so type the address into a window we just
# opened, like a person would. How it stays safe and reliable:
#   * it lists the browser's visible windows before and after launching, so it knows
#     exactly WHICH window is the new one (it does not depend on what has focus, which
#     other apps can steal while we wait);
#   * it brings that one window to the front, and only types after confirming that
#     window really is in the foreground, and again right before typing;
#   * if any of that fails it types nothing and the user is told what to type.
# Set TABBEDIN_DEBUG=1 to print what it sees.
# Returns $true if the address was typed.
function Open-ExtensionsPage($choice, [string[]]$extraArgs, [bool]$typeAddress) {
  if (-not ('TabbedInWin' -as [type])) {
    Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TabbedInWin {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder t, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder t, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();

  // Visible, titled top-level browser windows (Chromium's window class) as "hwnd|pid" strings.
  public static List<string> BrowserWindows() {
    var list = new List<string>();
    EnumWindows((h, l) => {
      if (!IsWindowVisible(h)) return true;
      var cls = new StringBuilder(128); GetClassName(h, cls, 128);
      if (cls.ToString() != "Chrome_WidgetWin_1") return true;
      var title = new StringBuilder(256); GetWindowText(h, title, 256);
      if (title.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      list.Add(h.ToInt64() + "|" + pid);
      return true;
    }, IntPtr.Zero);
    return list;
  }

  public static uint OwnerPid(IntPtr h) { uint pid; GetWindowThreadProcessId(h, out pid); return pid; }
  public static string Title(IntPtr h) { var t = new StringBuilder(256); GetWindowText(h, t, 256); return t.ToString(); }

  // Bring a window to the front (Windows restricts this, hence the thread-attach trick).
  public static bool Focus(IntPtr h) {
    uint pid;
    IntPtr fg = GetForegroundWindow();
    uint fgThread = GetWindowThreadProcessId(fg, out pid);
    uint me = GetCurrentThreadId();
    if (IsIconic(h)) ShowWindow(h, 9); // restore only if minimized
    bool attached = fgThread != 0 && fgThread != me && AttachThreadInput(me, fgThread, true);
    SetForegroundWindow(h);
    if (attached) AttachThreadInput(me, fgThread, false);
    return GetForegroundWindow() == h;
  }
}
'@
  }
  Add-Type -AssemblyName System.Windows.Forms
  $debug = [bool]$env:TABBEDIN_DEBUG
  $processName = [IO.Path]::GetFileNameWithoutExtension($choice.Exe)

  # Windows of this browser that already exist (hwnd values), so the new one can be told apart.
  function Get-OwnWindows($name) {
    $pids = @(Get-Process -Name $name -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
    @([TabbedInWin]::BrowserWindows() | Where-Object { $pids -contains [int]($_.Split('|')[1]) } | ForEach-Object { [long]($_.Split('|')[0]) })
  }
  $existing = @(Get-OwnWindows $processName)

  # Build the list explicitly: adding a $null (an "empty" optional value) to it makes
  # Start-Process refuse the whole call.
  $launchArgs = @('--new-window')
  foreach ($a in @($extraArgs)) { if ($a) { $launchArgs += $a } }
  Start-Process -FilePath $choice.Exe -ArgumentList $launchArgs | Out-Null
  if (-not $typeAddress) { return $false }

  # Wait for the new window to appear.
  $target = [IntPtr]::Zero
  for ($i = 0; $i -lt 60 -and $target -eq [IntPtr]::Zero; $i++) {
    Start-Sleep -Milliseconds 250
    $fresh = @(Get-OwnWindows $processName | Where-Object { $existing -notcontains $_ })
    if ($debug) { Write-Host ("  [debug] try {0}: {1} existing windows, {2} new" -f $i, $existing.Count, $fresh.Count) }
    if ($fresh.Count -gt 0) { $target = [IntPtr][long]($fresh | Select-Object -Last 1) }
  }
  if ($target -eq [IntPtr]::Zero) { if ($debug) { Write-Host '  [debug] no new browser window appeared' }; return $false }
  if ($debug) { Write-Host ("  [debug] new window {0} '{1}'" -f $target, [TabbedInWin]::Title($target)) }

  Start-Sleep -Milliseconds 1200            # let the window finish drawing

  # Bring that window to the front and make sure it really is there before typing.
  $focused = $false
  for ($i = 0; $i -lt 8 -and -not $focused; $i++) {
    $focused = [TabbedInWin]::Focus($target)
    if ($debug) { Write-Host ("  [debug] focus attempt {0}: {1}" -f $i, $focused) }
    if (-not $focused) { Start-Sleep -Milliseconds 400 }
  }
  if (-not $focused) { return $false }
  Start-Sleep -Milliseconds 400
  if ([TabbedInWin]::GetForegroundWindow() -ne $target) { return $false }   # focus moved: do not type

  [System.Windows.Forms.SendKeys]::SendWait('^l')       # Ctrl+L = address bar
  Start-Sleep -Milliseconds 300
  if ([TabbedInWin]::GetForegroundWindow() -ne $target) { return $false }   # re-check right before typing
  [System.Windows.Forms.SendKeys]::SendWait($choice.Url)
  Start-Sleep -Milliseconds 300
  [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
  return $true
}

# --- uninstall ----------------------------------------------------------------
if ($Uninstall) {
  if (-not (Test-Path -LiteralPath $InstallDir)) { Write-Host "Nothing to remove: $InstallDir does not exist."; exit 0 }
  if (-not (Test-SafeToReplace $InstallDir)) { Fail "$InstallDir does not look like a $ExtensionName install; not deleting it." }
  Remove-Item -LiteralPath $InstallDir -Recurse -Force
  Write-Host "Deleted $InstallDir" -ForegroundColor Green
  Write-Host "Now open your browser's Extensions page and click Remove on $ExtensionName."
  exit 0
}

# --- find the zip -------------------------------------------------------------
if (-not $Zip) {
  $found = Get-ChildItem -LiteralPath $PSScriptRoot -Filter 'tabbed-in-*.zip' -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $found) { Fail "No tabbed-in-*.zip found next to this script. Put the zip in the same folder, or pass -Zip <path>." }
  $Zip = $found.FullName
}
if (-not (Test-Path -LiteralPath $Zip)) { Fail "Zip not found: $Zip" }

# --- choose a browser ---------------------------------------------------------
$installed = @()
foreach ($key in $browsers.Keys) {
  $exe = $browsers[$key].Paths | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
  if ($exe) {
    $installed += [pscustomobject]@{ Key = $key; Label = $browsers[$key].Label; Exe = $exe; Url = $browsers[$key].Url; Data = $browsers[$key].Data }
  }
}
if ($Browser) {
  $choice = $installed | Where-Object Key -eq $Browser
  if (-not $choice) {
    if ($UserDataDir) {  # test mode: pretend the browser exists
      $choice = [pscustomobject]@{ Key = $Browser; Label = $browsers[$Browser].Label; Exe = $null; Url = $browsers[$Browser].Url; Data = $browsers[$Browser].Data }
    } else { Fail "$($browsers[$Browser].Label) does not seem to be installed." }
  }
} elseif ($installed.Count -eq 0) {
  $choice = $null
  Write-Host 'No Brave, Chrome, or Edge found; the extension will still be unzipped.' -ForegroundColor Yellow
} elseif ($installed.Count -eq 1) {
  $choice = $installed[0]
} else {
  Write-Host 'Which browser?'
  for ($i = 0; $i -lt $installed.Count; $i++) { Write-Host ("  {0}) {1}" -f ($i + 1), $installed[$i].Label) }
  $answer = Read-Host 'Number'
  $index = 0
  if (-not [int]::TryParse($answer, [ref]$index) -or $index -lt 1 -or $index -gt $installed.Count) { Fail 'Not a valid choice.' }
  $choice = $installed[$index - 1]
}
if ($choice -and $BrowserExe) { $choice.Exe = $BrowserExe }   # tests only

# --- replace the unzipped folder ----------------------------------------------
$hadFolder = Test-Path -LiteralPath (Join-Path $InstallDir 'manifest.json')
if (-not (Test-SafeToReplace $InstallDir)) {
  Fail "$InstallDir already exists and does not look like a $ExtensionName install. Pick another folder with -InstallDir, or empty it."
}

$staging = Join-Path ([IO.Path]::GetTempPath()) ("tabbed-in-" + [guid]::NewGuid().ToString('N'))
try {
  Expand-Archive -LiteralPath $Zip -DestinationPath $staging -Force
  $manifestPath = Join-Path $staging 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath)) { Fail 'That zip has no manifest.json at its top level. Is it the right file?' }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.name -ne $ExtensionName) { Fail "That zip is for '$($manifest.name)', not '$ExtensionName'." }

  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallDir) | Out-Null
  try {
    if (Test-Path -LiteralPath $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }  # old version goes away completely
    Move-Item -LiteralPath $staging -Destination $InstallDir
  } catch {
    Fail "Could not replace $InstallDir ($($_.Exception.Message)). Close any window using files in that folder, then run this again."
  }
} finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Host ''
Write-Host ("{0} {1} {2} in:" -f $(if ($hadFolder) { 'Replaced the old files with' } else { 'Unzipped' }), $ExtensionName, $manifest.version) -ForegroundColor Green
Write-Host "  $InstallDir"

$copied = $false
if (-not $NoClipboard) {
  Set-Clipboard -Value $InstallDir
  $copied = $true
  Write-Host '  (that path is now on your clipboard)'
}

# --- what is already in the browser? -------------------------------------------
$copies = @()
if ($choice) {
  $data = if ($UserDataDir) { $UserDataDir } else { $choice.Data }
  $copies = @(Find-TabbedInCopies $data $InstallDir)
}
$sameFolder = @($copies | Where-Object Kind -eq 'this')
$others = @($copies | Where-Object Kind -ne 'this')
$label = if ($choice) { $choice.Label } else { 'your browser' }
$url = if ($choice) { $choice.Url } else { 'chrome://extensions' }

Write-Host ''
if ($others.Count -gt 0) {
  Write-Host "Another copy of $ExtensionName is already added to $label. Two copies fight over the tab lock," -ForegroundColor Yellow
  Write-Host 'so remove the older one first (browsers do not let a script do this for you):' -ForegroundColor Yellow
  foreach ($c in $others) {
    $where = switch ($c.Kind) {
      'missing' { "its folder no longer exists: $($c.Path)" }
      'store'   { 'installed from the Web Store' }
      default   { "loaded from: $($c.Path)" }
    }
    Write-Host ("  - profile '{0}', {1}" -f $c.Profile, $where) -ForegroundColor Yellow
  }
  Write-Host '  (You will do this in step 3 below.)' -ForegroundColor Yellow
  Write-Host ''
}

# --- open the Extensions page (best effort) -----------------------------------
$opened = $false
if ($choice -and $choice.Exe -and -not $NoOpen) {
  if (-not $NoKeys) {
    Write-Host "Opening a new $label window and typing $url into it. Please don't click anything for a few seconds..." -ForegroundColor Cyan
  }
  $extraArgs = @()
  if ($BrowserArgs) { $extraArgs = @($BrowserArgs -split '\|') }
  # Opening the page is a convenience. If anything goes wrong, never lose the instructions:
  # fall through and print the steps so the user can do it by hand.
  try {
    $opened = Open-ExtensionsPage $choice $extraArgs (-not $NoKeys)
  } catch {
    $opened = $false
    Write-Host "Could not open $label automatically ($($_.Exception.Message))." -ForegroundColor Yellow
    Write-Host 'No problem: the steps below tell you how to open the page yourself.' -ForegroundColor Yellow
  }
}

# --- exact steps ----------------------------------------------------------------
$line = ('=' * 64)
Write-Host $line
Write-Host " EXACT STEPS to finish in $label" -ForegroundColor Cyan
Write-Host $line
$n = 1
if ($opened) {
  Write-Host " $n. The Extensions page should now be open in the new $label window. (Done for you.)"
  Write-Host "    If you see a New Tab page instead: click the address bar at the top (or press Ctrl+L),"
  Write-Host "    type  $url  and press Enter."
} else {
  Write-Host " $n. Open $label. Click the address bar at the top (or press Ctrl+L), type"
  Write-Host "    $url  and press Enter."
}
$n++
if ($sameFolder.Count -gt 0) {
  Write-Host " $n. Find the card named ""Tabbed In"". It is already added from this folder, so nothing needs removing."
  Write-Host "    Click the circular-arrow RELOAD icon at the bottom right of that card."
  Write-Host "    You're done. (Check the toggle on the card is blue = on.)"
} else {
  if ($others.Count -gt 0) {
    Write-Host " $n. REMOVE the older copy first. On each older ""Tabbed In"" card (see the list above),"
    Write-Host "    click the ""Remove"" button at the bottom left of the card, then click ""Remove"" again to confirm."
    Write-Host "    (Click ""Details"" on a card to see which folder it was loaded from, under ""Source"".)"
    $n++
  }
  Write-Host " $n. Turn on ""Developer mode"": the switch in the top-right corner of the page. It turns blue."
  $n++
  Write-Host " $n. Click ""Load unpacked"": a new button at the top-left of the page."
  $n++
  Write-Host " $n. A folder window opens. Click in the ""Folder:"" box at the bottom of it and press Ctrl+V"
  Write-Host "    to paste this path$(if ($copied) { ' (it is already on your clipboard)' } else { ' (select and copy it from this window)' }):"
  Write-Host ""
  Write-Host "        $InstallDir" -ForegroundColor Green
  Write-Host ""
  Write-Host "    Then click ""Select Folder""."
  $n++
  Write-Host " $n. A card named ""Tabbed In $($manifest.version)"" appears with a blue toggle. It's installed."
  $n++
  Write-Host " $n. Click the puzzle-piece icon in the browser toolbar (top right), then click the pin icon"
  Write-Host "    next to ""Tabbed In"" so its button stays visible."
}
Write-Host $line
Write-Host " To try it: open any normal website (for example example.com), click the Tabbed In button,"
Write-Host " pick a time, and click Start. When asked about site access, click Allow."
Write-Host $line
