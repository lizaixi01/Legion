param([switch]$CheckOnly)
$ErrorActionPreference='Stop'
$logPath=Join-Path $PSScriptRoot 'launch.log'
try {
  $config=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'current.json') -Raw | ConvertFrom-Json
  Set-Location -LiteralPath $config.projectRoot
  "$(Get-Date -Format o) Building $($config.projectRoot)" | Set-Content -LiteralPath $logPath -Encoding UTF8
  # Native stderr contains diagnostics too. Judge native commands by exit code.
  $ErrorActionPreference='Continue'
  $buildOutput = & $config.npm run build 2>&1
  $buildCode=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  $buildOutput | Out-String | Add-Content -LiteralPath $logPath -Encoding UTF8
  if($buildCode -ne 0){throw '构建失败，未启动旧的编译版本。'}
  if($CheckOnly){exit 0}
  $ErrorActionPreference='Continue'
  & $config.node (Join-Path $config.projectRoot 'desktop\launch.cjs') 2>&1 | ForEach-Object { $_.ToString() | Add-Content -LiteralPath $logPath -Encoding UTF8 }
  $appCode=$LASTEXITCODE
  $ErrorActionPreference='Stop'
  if($appCode -ne 0){throw '程序未能正常启动。'}
} catch {
  $_ | Out-String | Add-Content -LiteralPath $logPath -Encoding UTF8
  if(!$CheckOnly){Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.MessageBox]::Show("$($_.Exception.Message)`n日志：$logPath",'Proactive Agent') | Out-Null}
  exit 1
}
