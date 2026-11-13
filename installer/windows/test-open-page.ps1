# Checks that install.ps1 really opens the browser's Extensions page (by typing
# the address into a new window). It OPENS A REAL BROWSER WINDOW (a throwaway
# profile, closed afterwards) and types into it, so don't click anything while
# it runs. Needs Brave, Chrome, or Edge installed.
# Run via:  npm run test:installer:open
param([ValidateSet('brave', 'chrome', 'edge')][string]$Browser = 'brave')
$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$bundleZip = Join-Path $root ".output\tabbed-in-windows-$version.zip"
if (-not (Test-Path -LiteralPath $bundleZip)) { throw "Missing $bundleZip. Run 'npm run bundle:windows' first." }

$s = Join-Path ([IO.Path]::GetTempPath()) ('tabbed-in-open-test-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $s | Out-Null
$port = 9371
$profile = "$s\profile"
New-Item -ItemType Directory $profile | Out-Null
New-Item -ItemType Directory "$s\ud" | Out-Null
$ok = $false

try {
  Expand-Archive $bundleZip "$s\bundle"
  $bundle = (Get-ChildItem "$s\bundle" -Directory).FullName
  $extra = "--user-data-dir=$profile|--remote-debugging-port=$port|--no-first-run|--no-default-browser-check"

  $out = & powershell -NoProfile -ExecutionPolicy Bypass -File "$bundle\install.ps1" `
    -Browser $Browser -InstallDir "$s\ext" -UserDataDir "$s\ud" -NoClipboard -BrowserArgs $extra 2>&1 | Out-String
  Start-Sleep -Seconds 2

  $pages = @()
  try { $pages = @((Invoke-RestMethod "http://127.0.0.1:$port/json/list" -TimeoutSec 3) | Where-Object type -eq 'page' | ForEach-Object { $_.url }) } catch {}
  $ok = [bool]($pages | Where-Object { $_ -match '^(chrome|brave|edge)://extensions' })

  Write-Host "pages open in the test window: $($pages -join ' | ')"
  Write-Host ("{0}  the Extensions page was opened" -f $(if ($ok) { 'PASS' } else { 'FAIL' }))
  $steps = ($out -match 'EXACT STEPS') -and ($out -match 'Developer mode') -and ($out -match 'Load unpacked') -and ($out -match 'Select Folder') -and ($out -match [regex]::Escape("$s\ext"))
  Write-Host ("{0}  the exact steps (with the real folder path) were printed" -f $(if ($steps) { 'PASS' } else { 'FAIL' }))
  $ok = $ok -and $steps
} finally {
  Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($profile) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Remove-Item -LiteralPath $s -Recurse -Force -ErrorAction SilentlyContinue
}
exit ([int](-not $ok))
