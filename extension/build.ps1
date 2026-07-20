# Build both browser variants from the single shared codebase.
# Usage: powershell -File build.ps1  ->  dist/chromium and dist/firefox
$root = $PSScriptRoot
$dist = Join-Path $root "dist"
if (Test-Path $dist) { Remove-Item $dist -Recurse -Force }

foreach ($target in @("chromium", "firefox")) {
    $out = Join-Path $dist $target
    New-Item -ItemType Directory -Force $out | Out-Null
    Copy-Item (Join-Path $root "src") (Join-Path $out "src") -Recurse
    Copy-Item (Join-Path $root "assets") (Join-Path $out "assets") -Recurse
    if ($target -eq "firefox") {
        Copy-Item (Join-Path $root "manifest.firefox.json") (Join-Path $out "manifest.json")
    } else {
        Copy-Item (Join-Path $root "manifest.json") (Join-Path $out "manifest.json")
    }
    Write-Host "built dist/$target"
}
