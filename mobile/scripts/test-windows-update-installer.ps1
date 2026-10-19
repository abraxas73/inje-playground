param([string]$FixtureDirectory = 'mobile/build/updater-tests/Release')
$ErrorActionPreference = 'Stop'
$fixture = (Resolve-Path $FixtureDirectory).Path
$script = (Resolve-Path (Join-Path $PSScriptRoot '../installer/windows.iss')).Path
$iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
if (-not (Test-Path $iscc)) { $iscc = (Get-Command ISCC.exe).Source }
$root = Join-Path ([IO.Path]::GetTempPath()) ('innocrew-updater-' + [guid]::NewGuid().ToString('N'))
$owned = [Collections.Generic.List[Diagnostics.Process]]::new()
function Wait-Until([scriptblock]$Condition, [string]$Label, [int]$Seconds = 15) {
  $deadline = [DateTime]::UtcNow.AddSeconds($Seconds)
  do { if (& $Condition) { return }; Start-Sleep -Milliseconds 100 } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for updater fixture: $Label"
}
try {
  foreach ($scenario in @('success', 'busy')) {
    $caseRoot = Join-Path $root "$scenario 한글 path"
    $install = Join-Path $caseRoot 'App'
    $state = Join-Path $caseRoot 'state'
    $payload = Join-Path $caseRoot 'payload'
    $output = Join-Path $caseRoot 'output'
    foreach ($dir in @($install, $state, $payload, $output)) { [void](New-Item -ItemType Directory -Path $dir -Force) }
    Copy-Item (Join-Path $fixture 'updater_fixture_1.exe') (Join-Path $install 'INNOGRID.exe')
    Copy-Item (Join-Path $fixture 'updater_fixture_2.exe') (Join-Path $payload 'INNOGRID.exe')
    'test-session-and-settings' | Set-Content (Join-Path $state 'preserved.txt')
    if ($scenario -eq 'busy') { [void](New-Item (Join-Path $state 'ignore-close')) }
    & $iscc '/Q' '/DAppVersion=9.0.2' '/DUpdaterTest=1' "/DTestPayload=$payload" "/DTestOutput=$output" $script
    if ($LASTEXITCODE -ne 0) { throw 'Fixture installer compilation failed' }
    $old = Start-Process (Join-Path $install 'INNOGRID.exe') -PassThru
    $owned.Add($old)
    Wait-Until { $old.Refresh(); $old.MainWindowHandle -ne 0 } 'old process window'
    # Another app with the same executable name must remain untouched.
    $other = Join-Path $caseRoot 'unrelated/App'
    [void](New-Item -ItemType Directory -Path $other -Force)
    Copy-Item (Join-Path $fixture 'updater_fixture_1.exe') (Join-Path $other 'INNOGRID.exe')
    $unrelated = Start-Process (Join-Path $other 'INNOGRID.exe') -PassThru
    $owned.Add($unrelated)
    $arguments = "/SP- /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /NOCLOSEAPPLICATIONS /NORESTARTAPPLICATIONS /INNOCREWAUTOUPDATE=1 /INNOCREWPID=$($old.Id) /DIR=`"$install`" /LOG=`"$caseRoot/setup.log`""
    $setup = Start-Process (Join-Path $output 'INNOGRID-Windows-9.0.2-Setup.exe') -ArgumentList $arguments -PassThru
    $owned.Add($setup)
    # Mirror the adapter's successful installer launch -> WM_CLOSE ordering.
    if (-not $old.CloseMainWindow()) { throw 'Could not request graceful fixture shutdown' }
    if (-not $setup.WaitForExit(45000)) { throw 'Installer did not finish in time' }
    $unrelated.Refresh()
    if ($unrelated.HasExited) { throw 'Unrelated process was terminated' }
    if ((Get-Content (Join-Path $state 'preserved.txt') -Raw).Trim() -ne 'test-session-and-settings') { throw 'Persistent data changed' }
    if ($scenario -eq 'success') {
      if ($setup.ExitCode -ne 0) { throw "Installer failed: $($setup.ExitCode)" }
      Write-Host 'Installer succeeded; waiting for automatic relaunch'
      Wait-Until { (Get-Content (Join-Path $state 'launches.log')) -match '^2 ' } 'new version automatic relaunch'
      $starts = @(Get-Content (Join-Path $state 'launches.log') | Where-Object { $_ -match '^2 ' })
      if ($starts.Count -ne 1 -or -not $old.HasExited) { throw 'Expected one new process after old process exit' }
      $new = Get-Process -Id ([int]($starts[0].Split(' ')[1]))
      $owned.Add($new)
      if ($new.Path -ne (Join-Path $install 'INNOGRID.exe')) { throw 'Relaunch used unexpected path' }
      if ((Get-FileHash (Join-Path $install 'INNOGRID.exe')).Hash -ne (Get-FileHash (Join-Path $payload 'INNOGRID.exe')).Hash) { throw 'Installed binary mismatch' }
      Start-Sleep -Milliseconds 500
      if (@(Get-Content (Join-Path $state 'launches.log') | Where-Object { $_ -match '^2 ' }).Count -ne 1) { throw 'Duplicate relaunch' }
    } else {
      $old.Refresh()
      if ($setup.ExitCode -eq 0 -or $old.HasExited) { throw 'Busy application was not preserved safely' }
      if ((Get-Content (Join-Path $state 'launches.log')) -match '^2 ') { throw 'Busy update relaunched unexpectedly' }
    }
    Write-Host "PASS: $scenario; Unicode path, persistent data and unrelated process preserved"
  }
} finally {
  foreach ($process in $owned) {
    $process.Refresh()
    # Cleanup only processes created by this isolated harness, never by name.
    if (-not $process.HasExited) { $process.Kill(); [void]$process.WaitForExit(5000) }
  }
  Write-Host "Installer harness evidence: $root"
}
