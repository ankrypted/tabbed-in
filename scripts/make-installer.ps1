# Builds the Windows installer bundle: .output\tabbed-in-windows-<version>.zip
# containing the extension zip plus install.bat / install.ps1 / README.txt.
# Run via:  npm run bundle:windows   (which builds the extension zip first)
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$extZip = Join-Path $root ".output\tabbed-in-$version-chrome.zip"
if (-not (Test-Path -LiteralPath $extZip)) { throw "Missing $extZip. Run 'npm run zip' first." }

$staging = Join-Path ([IO.Path]::GetTempPath()) ("tabbed-in-bundle-" + [guid]::NewGuid().ToString('N'))
$folder = Join-Path $staging "Tabbed-In-$version-windows"
New-Item -ItemType Directory -Force -Path $folder | Out-Null
try {
  Copy-Item -LiteralPath $extZip -Destination $folder
  foreach ($f in 'install.bat', 'install.ps1', 'README.txt') {
    $src = Join-Path $root "installer\windows\$f"
    if ($f -eq 'install.bat') {
      # Batch files must have Windows (CRLF) line endings or cmd.exe can misparse them.
      $text = [IO.File]::ReadAllText($src) -replace "`r?`n", "`r`n"
      [IO.File]::WriteAllText((Join-Path $folder $f), $text, (New-Object Text.UTF8Encoding($false)))
    } else {
      Copy-Item -LiteralPath $src -Destination $folder
    }
  }
  $out = Join-Path $root ".output\tabbed-in-windows-$version.zip"
  if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
  Compress-Archive -Path $folder -DestinationPath $out
  Write-Host "Created $out"
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
