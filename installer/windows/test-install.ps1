# Tests install.ps1 as a friend would use it: unpack the bundle, run the script.
# Everything happens in a temp folder with FAKE browser profiles; your real
# browser and %LOCALAPPDATA% are not touched.
# Run via:  npm run test:installer   (builds the bundle first)
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$bundleZip = Join-Path $root ".output\tabbed-in-windows-$version.zip"
if (-not (Test-Path -LiteralPath $bundleZip)) { throw "Missing $bundleZip. Run 'npm run bundle:windows' first." }

$s = Join-Path ([IO.Path]::GetTempPath()) ('tabbed-in-installer-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $s | Out-Null
$script:pass = 0
$script:fail = 0
function Check($name, $ok, $extra = '') {
  if ($ok) { $script:pass++; Write-Host "PASS  $name $extra" }
  else { $script:fail++; Write-Host "FAIL  $name $extra" -ForegroundColor Red }
}

try {
  Expand-Archive $bundleZip "$s\bundle"
  $bundle = (Get-ChildItem "$s\bundle" -Directory).FullName
  $install = "$s\LocalAppData\TabbedIn\extension"
  $installJson = $install.Replace('\', '\\')

  function Run($extraArgs) {
    $out = & powershell -NoProfile -ExecutionPolicy Bypass -File "$bundle\install.ps1" -Browser brave -InstallDir $install -NoOpen -NoClipboard @extraArgs 2>&1 | Out-String
    return @{ Out = $out; Code = $LASTEXITCODE }
  }
  function Write-Prefs($dir, $settings) {
    New-Item -ItemType Directory -Force "$dir\Default" | Out-Null
    # Two keys that differ only by case: Windows PowerShell's ConvertFrom-Json chokes on that,
    # and real Chrome preference files contain such keys.
    $json = '{"Foo":1,"foo":2,"extensions":{"settings":' + $settings + '}}'
    Set-Content -LiteralPath "$dir\Default\Secure Preferences" -Value $json -Encoding utf8
  }

  # 0. the double-click entry point itself
  $batBytes = [IO.File]::ReadAllBytes("$bundle\install.bat")
  $crN = @($batBytes | Where-Object { $_ -eq 13 }).Count
  $lfN = @($batBytes | Where-Object { $_ -eq 10 }).Count
  Check 'install.bat has Windows (CRLF) line endings' ($crN -gt 0 -and $crN -eq $lfN) "($crN CR / $lfN LF)"
  $batOut = cmd /c "`"$bundle\install.bat`" -Browser brave -InstallDir `"$s\bat-ext`" -UserDataDir `"$s\ud-bat`" -NoOpen -NoClipboard < nul" 2>&1 | Out-String
  Check 'install.bat runs the installer end to end' ($LASTEXITCODE -eq 0 -and (Test-Path "$s\bat-ext\manifest.json") -and $batOut -match 'EXACT STEPS')

  # 0b. the browser-launch step, with NO extra arguments (what every real run does).
  # A stub program records the arguments it is started with. This is the path that
  # once crashed with "Cannot validate argument on parameter 'ArgumentList'".
  $argsLog = "$s\stub-args.txt"
  Set-Content -LiteralPath "$s\stub-browser.bat" -Value "@echo off`r`necho %* > `"$argsLog`"" -Encoding ascii
  $launchOut = & powershell -NoProfile -ExecutionPolicy Bypass -File "$bundle\install.ps1" -Browser brave -BrowserExe "$s\stub-browser.bat" `
    -InstallDir "$s\launch-ext" -UserDataDir "$s\ud-launch" -NoKeys -NoClipboard 2>&1 | Out-String
  $launchCode = $LASTEXITCODE
  for ($i = 0; $i -lt 20 -and -not (Test-Path $argsLog); $i++) { Start-Sleep -Milliseconds 250 }
  Check 'launching the browser with no extra arguments does not crash' ($launchCode -eq 0 -and $launchOut -notmatch 'Cannot validate|Could not open')
  Check '...it starts the browser with --new-window' ((Test-Path $argsLog) -and ((Get-Content $argsLog -Raw) -match '--new-window'))
  Check '...and the exact steps are still printed' ($launchOut -match 'EXACT STEPS')

  # A browser that can't be started must never cost the user the instructions.
  $badOut = & powershell -NoProfile -ExecutionPolicy Bypass -File "$bundle\install.ps1" -Browser brave -BrowserExe "$s\no-such-browser.exe" `
    -InstallDir "$s\launch-ext2" -UserDataDir "$s\ud-launch" -NoClipboard 2>&1 | Out-String
  Check 'a browser that cannot start still ends with the exact steps' ($LASTEXITCODE -eq 0 -and $badOut -match 'Could not open' -and $badOut -match 'EXACT STEPS' -and $badOut -match 'Load unpacked')

  # 1. clean install
  $empty = "$s\ud-empty"; Write-Prefs $empty '{}'
  $r = Run @('-UserDataDir', $empty)
  Check 'clean install exits 0' ($r.Code -eq 0)
  Check 'unzipped manifest is Tabbed In' ((Get-Content "$install\manifest.json" -Raw | ConvertFrom-Json).name -eq 'Tabbed In')
  Check 'extension files match the build' ((Get-ChildItem "$root\.output\chrome-mv3" -Recurse -File).Count -eq (Get-ChildItem $install -Recurse -File).Count)
  Check 'tells the user to Load unpacked' ($r.Out -match 'Load unpacked')
  Check 'prints exact steps: Developer mode, Load unpacked, Select Folder' ($r.Out -match 'EXACT STEPS' -and $r.Out -match 'Developer mode' -and $r.Out -match 'Select Folder')
  Check 'prints the real folder path to paste' ($r.Out -match [regex]::Escape($install))
  Check 'no warning about other copies' ($r.Out -notmatch 'Another copy')

  # 2. update replaces the old files completely
  Set-Content "$install\leftover-from-old-version.txt" 'old'
  New-Item -ItemType Directory "$install\old-folder" | Out-Null
  $r = Run @('-UserDataDir', $empty)
  Check 'update exits 0' ($r.Code -eq 0)
  Check 'old leftover files are gone' (-not (Test-Path "$install\leftover-from-old-version.txt") -and -not (Test-Path "$install\old-folder"))
  Check 'says it replaced the old files' ($r.Out -match 'Replaced the old files')

  # 3. the same copy is already added to the browser
  $same = "$s\ud-same"
  Write-Prefs $same ('{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa":{"path":"' + $installJson + '","manifest":{"name":"Tabbed In"}}}')
  $r = Run @('-UserDataDir', $same)
  Check 'already added from this folder: just reload' ($r.Out -match 'already added from this folder' -and $r.Out -match 'RELOAD icon' -and $r.Out -notmatch 'Click ""Load unpacked""')
  Check '...with no other-copy warning' ($r.Out -notmatch 'Another copy')
  Check '...and the steps say to click reload, not Load unpacked' ($r.Out -match 'RELOAD' -and $r.Out -notmatch 'Click ""Load unpacked""')

  # 4. other copies are already added
  $otherDir = "$s\dev-build"; New-Item -ItemType Directory $otherDir | Out-Null
  Set-Content "$otherDir\manifest.json" '{"name":"Tabbed In","version":"0.0.1"}'
  $otherJson = $otherDir.Replace('\', '\\')
  $multi = "$s\ud-multi"
  Write-Prefs $multi ('{' +
    '"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb":{"path":"' + $otherJson + '","manifest":{"name":"Tabbed In"}},' +
    '"cccccccccccccccccccccccccccccccc":{"path":"C:\\\\Gone\\\\old-tabbed-in","manifest":{"name":"Tabbed In"}},' +
    '"dddddddddddddddddddddddddddddddd":{"manifest":{"name":"Tabbed In"}},' +
    '"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee":{"path":"' + $otherJson + '","manifest":{"name":"Some Other Extension"}}' +
    '}')
  $r = Run @('-UserDataDir', $multi)
  Check 'warns about other copies' ($r.Out -match 'Another copy of Tabbed In')
  Check '...one loaded from a different folder' ($r.Out -match [regex]::Escape($otherDir))
  Check '...one whose folder no longer exists' ($r.Out -match 'no longer exists')
  Check '...one from the Web Store' ($r.Out -match 'Web Store')
  Check 'does not flag unrelated extensions' (([regex]::Matches($r.Out, "profile 'Default'")).Count -eq 3)
  Check 'still shows the add steps (not registered here)' ($r.Out -match 'Load unpacked')
  Check 'steps tell the user to Remove the older copy first' ($r.Out -match 'REMOVE the older copy first')
  Check 'does not touch the other copy''s folder' (Test-Path "$otherDir\manifest.json")
  Check 'does not modify the browser''s preferences file' ((Get-Content "$multi\Default\Secure Preferences" -Raw) -match '"Foo":1,"foo":2')

  # 5. safety refusals
  $notOurs = "$s\precious"; New-Item -ItemType Directory $notOurs | Out-Null; Set-Content "$notOurs\important.txt" 'keep me'
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File "$bundle\install.ps1" -Browser brave -InstallDir $notOurs -NoOpen -NoClipboard -UserDataDir $empty 2>&1 | Out-String
  Check 'refuses to overwrite a folder that is not a Tabbed In install' ($LASTEXITCODE -ne 0 -and (Test-Path "$notOurs\important.txt") -and $out -match 'does not look like')

  $wrong = "$s\wrong.zip"
  Compress-Archive -Path "$notOurs\important.txt" -DestinationPath $wrong
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File "$bundle\install.ps1" -Zip $wrong -Browser brave -InstallDir "$s\x\ext" -NoOpen -NoClipboard -UserDataDir $empty 2>&1 | Out-String
  Check 'rejects a zip that is not the extension' ($LASTEXITCODE -ne 0 -and $out -match 'no manifest.json')

  # 6. uninstall
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File "$bundle\install.ps1" -InstallDir $install -Uninstall 2>&1 | Out-String
  Check 'uninstall removes the folder' (-not (Test-Path $install) -and $out -match 'Remove on')
  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File "$bundle\install.ps1" -InstallDir $notOurs -Uninstall 2>&1 | Out-String
  Check 'uninstall refuses a folder that is not ours' ($LASTEXITCODE -ne 0 -and (Test-Path "$notOurs\important.txt"))
} finally {
  Remove-Item -LiteralPath $s -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host ''
Write-Host "$script:pass passed, $script:fail failed"
exit ([int]($script:fail -gt 0))
