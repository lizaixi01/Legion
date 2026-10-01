param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$logDirectory = Join-Path $projectRoot '.gui-profile'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$logName = if ($CheckOnly) { 'beta-check.log' } else { 'beta-launch.log' }
$logPath = Join-Path $logDirectory $logName
try {
  Set-Location -LiteralPath $projectRoot
  $nodePath = (Get-Command node.exe -ErrorAction Stop).Source
  "$(Get-Date -Format o) Building Legion Beta from $projectRoot" | Set-Content -LiteralPath $logPath -Encoding UTF8
  $ErrorActionPreference = 'Continue'
  & $nodePath (Join-Path $projectRoot 'node_modules\typescript\bin\tsc') --project $projectRoot 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding UTF8
  $buildCode = $LASTEXITCODE
  if ($buildCode -eq 0) {
    & $nodePath (Join-Path $PSScriptRoot 'build-renderer.cjs') 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding UTF8
    $buildCode = $LASTEXITCODE
  }
  $ErrorActionPreference = 'Stop'
  if ($buildCode -ne 0) { throw 'Build failed. Legion Beta was not started; no older build was opened.' }
  if ($CheckOnly) { exit 0 }
  $env:PROACTIVE_NODE = $nodePath
  Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
  $ErrorActionPreference = 'Continue'
  & $nodePath (Join-Path $PSScriptRoot 'launch.cjs') 2>&1 | Out-File -LiteralPath $logPath -Append -Encoding UTF8
  $appCode = $LASTEXITCODE
  $ErrorActionPreference = 'Stop'
  if ($appCode -ne 0) { throw "Legion Beta exited with code $appCode." }
} catch {
  $_ | Out-String | Add-Content -LiteralPath $logPath -Encoding UTF8
  if (!$CheckOnly) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("$($_.Exception.Message)`nLog: $logPath", 'Legion Beta') | Out-Null
  }
  exit 1
}
