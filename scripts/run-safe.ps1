# Run a command with hard timeout + closed stdin + pager defang.
# Subagents and ad-hoc scripts call this instead of running raw commands so a
# pager / Read-Host / Get-Credential prompt cannot make the process hang.
#
# Usage:
#   pwsh -File scripts/run-safe.ps1 -Command "git --no-pager log --oneline -- src/foo.ts" -TimeoutSec 30
#   pwsh -File scripts/run-safe.ps1 -Command "git show abc123" -OutputFile raw/diff.txt -TimeoutSec 60
#   pwsh -File scripts/run-safe.ps1 -Command "az account show" -TimeoutSec 15
#
# What it guarantees about the child process:
#   - PowerShell -NonInteractive: any Read-Host / Get-Credential THROWS instead of pending.
#   - GIT_PAGER=cat / PAGER=cat: git/less/more never opens a pager.
#   - GIT_TERMINAL_PROMPT=0: git refuses to prompt for credentials, fails fast.
#   - Hard wall-clock timeout: process is killed if it overruns the budget.
#   - stdout / stderr go to files, never to a TTY (some tools change behavior on TTY detect).
#
# Exit codes:
#   0     success
#   1+    child process exit code
#   124   timeout (Linux convention)
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)] [string] $Command,
  [int]    $TimeoutSec = 60,
  # If $OutputFile is supplied, captured stdout is left there (useful when the caller wants
  # to re-read large output without re-piping it through PowerShell). Otherwise the output is
  # streamed to the host and the temp file is cleaned up.
  [string] $OutputFile,
  [string] $WorkingDir = (Get-Location).Path
)
$ErrorActionPreference = 'Stop'

# Defang interactive surfaces. These are inherited by the child via process env.
$env:GIT_PAGER          = 'cat'
$env:GIT_TERMINAL_PROMPT = '0'
$env:PAGER              = 'cat'
$env:LESS               = '-FRX'

$captured = $false
if (-not $OutputFile) {
  $OutputFile = [System.IO.Path]::GetTempFileName()
  $captured = $true
}
$errFile = "$OutputFile.err"

# -NonInteractive ensures any prompt from PowerShell cmdlets throws instead of pending.
# -NoProfile keeps startup deterministic.
$procArgs = @('-NonInteractive', '-NoProfile', '-NoLogo', '-Command', $Command)

$proc = Start-Process pwsh `
  -ArgumentList $procArgs `
  -WorkingDirectory $WorkingDir `
  -RedirectStandardOutput $OutputFile `
  -RedirectStandardError $errFile `
  -PassThru `
  -NoNewWindow

$exited = $proc.WaitForExit([int]($TimeoutSec * 1000))
if (-not $exited) {
  try { $proc.Kill($true) } catch { }
  $head = if (Test-Path $OutputFile) { (Get-Content $OutputFile -TotalCount 5 -ErrorAction SilentlyContinue) -join "`n" } else { '' }
  $errHead = if (Test-Path $errFile) { (Get-Content $errFile -TotalCount 5 -ErrorAction SilentlyContinue) -join "`n" } else { '' }
  Write-Error @"
TIMEOUT after ${TimeoutSec}s. Likely stuck on an interactive prompt OR genuinely slow.
Command : $Command
WorkDir : $WorkingDir
--- partial stdout (head) ---
$head
--- partial stderr (head) ---
$errHead
"@
  if ($captured) { Remove-Item -Force -ErrorAction SilentlyContinue $OutputFile, $errFile }
  exit 124
}

if ($captured) {
  if (Test-Path $OutputFile) { Get-Content $OutputFile }
  if ((Test-Path $errFile) -and ((Get-Item $errFile).Length -gt 0)) {
    Write-Host '--- stderr ---' -ForegroundColor Yellow
    Get-Content $errFile
  }
  Remove-Item -Force -ErrorAction SilentlyContinue $OutputFile, $errFile
}
exit $proc.ExitCode
