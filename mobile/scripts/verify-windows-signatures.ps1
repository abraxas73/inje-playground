param(
  [Parameter(Mandatory)][string]$Path,
  [Parameter(Mandatory)][string]$PrimaryFile,
  [string]$ExpectedSubject = $env:WINDOWS_SIGNING_SUBJECT
)
$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($ExpectedSubject)) { throw 'WINDOWS_SIGNING_SUBJECT is required' }
$files = @(Get-ChildItem -LiteralPath $Path -File -Recurse | Where-Object { $_.Extension -in '.exe', '.dll' })
if (-not $files.Count) { throw 'No PE files to verify' }
$primary = @($files | Where-Object { $_.Name -eq $PrimaryFile })
if ($primary.Count -ne 1) { throw "Expected exactly one primary file: $PrimaryFile" }
foreach ($file in $files) {
  $signature = Get-AuthenticodeSignature -LiteralPath $file.FullName
  if ($signature.Status -ne 'Valid') { throw "Invalid signature: $($file.Name) ($($signature.Status))" }
  if ($file.FullName -eq $primary[0].FullName) {
    if ($signature.SignerCertificate.Subject -ne $ExpectedSubject) { throw "Unexpected publisher: $($file.Name)" }
    if (-not $signature.TimeStamperCertificate) { throw "Missing timestamp: $($file.Name)" }
  }
}
Write-Host "Verified $($files.Count) signed PE files; publisher and timestamp verified for $PrimaryFile"
