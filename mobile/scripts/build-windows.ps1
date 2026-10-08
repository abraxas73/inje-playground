$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$versionLine = (Select-String -Path pubspec.yaml -Pattern '^version: (.+)$').Matches[0].Groups[1].Value
$version, $build = $versionLine.Split('+')
flutter pub get --enforce-lockfile
if ($LASTEXITCODE -ne 0) { throw 'Dependency resolution failed' }
flutter build windows --release "--dart-define=APP_VERSION=$version" "--dart-define=APP_BUILD=$build"
if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' }
# Bundle Microsoft's redistributable CRT beside the executable (no admin install needed).
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vsRoot = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
$crt = Get-ChildItem "$vsRoot\VC\Redist\MSVC\*\x64\Microsoft.VC*.CRT" -Directory |
  Sort-Object FullName -Descending | Select-Object -First 1
if (-not $crt) { throw 'MSVC redistributable runtime not found' }
Copy-Item "$($crt.FullName)\*.dll" 'build/windows/x64/runner/Release/' -Force
if (-not (Test-Path 'build/windows/x64/runner/Release/vcruntime140.dll')) { throw 'MSVC runtime was not bundled' }
$iscc = (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source
if (-not $iscc) { $iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" }
& $iscc "/DAppVersion=$version" installer/windows.iss
if ($LASTEXITCODE -ne 0) { throw 'Installer creation failed' }
Get-ChildItem build/windows/distribution/*.exe | ForEach-Object {
  $hash = (Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower()
  "$hash  $($_.Name)" | Set-Content -Encoding ascii "$($_.FullName).sha256"
}
