#requires -Version 7
<#
.SYNOPSIS
    Report whether a consumer repo's pinned copilot-toolkit version is behind upstream.

.DESCRIPTION
    Read-only check. Auto-detects which distribution mode the consumer uses
    for the .copilot-toolkit/ mount and prints the currently pinned tag, the
    latest upstream release tag, and any intermediate tags between them.

    Mode detection (in order):
      sync       - $LockFile exists at the consumer root
      submodule  - .gitmodules at the consumer root has a $MountPath entry
      none       - neither marker found (error)

    The script never mutates anything. It does not pull, fetch, sync, update
    submodule pointers, write release notes, or change configuration. It is
    safe to run from any shell at any time.

    Sync mode by design carries no upstream awareness in the consumer's daily
    workflow -- only the operator who already knows the upstream URL should
    run this script. That is why this is a maintainer-side check, not an
    automated gate.

.PARAMETER ConsumerRoot
    Path to the consumer repo root (the directory that contains the mount).
    Defaults to the current directory.

.PARAMETER Repo
    Upstream git URL. Defaults to the canonical copilot-toolkit repo.

.PARAMETER MountPath
    Relative path of the mount directory inside the consumer repo.
    Defaults to '.copilot-toolkit'.

.PARAMETER LockFile
    Relative path of the sync-mode lockfile inside the consumer repo.
    Defaults to '.copilot-toolkit/.sync-lock' (the in-dir dotfile shipped
    by v1.4.0+). If that file is absent, the legacy root location
    '.copilot-toolkit.lock' (pre-v1.4.0) is tried as a fallback.

.EXAMPLE
    pwsh -File scripts/toolkit-check.ps1
        Run from a consumer repo root.

.EXAMPLE
    pwsh -File scripts/toolkit-check.ps1 -ConsumerRoot C:\dev\codeSmith
        Run from anywhere by pointing at a consumer repo.

.NOTES
    Exit codes:
      0    success (report printed; check the output for behind-ness)
      1    error (no consumer mount detected, git failure, malformed lockfile)
      2    bad usage (invalid parameter)
#>
[CmdletBinding()]
param(
    [string] $ConsumerRoot = '.',
    [string] $Repo = 'https://github.com/test3207/copilot-toolkit.git',
    [string] $MountPath = '.copilot-toolkit',
    [string] $LockFile  = '.copilot-toolkit/.sync-lock'
)

$LegacyLockFile = '.copilot-toolkit.lock'  # pre-v1.4.0 root location

$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'

function Write-Info($msg) { Write-Host "[toolkit-check] $msg" -ForegroundColor Cyan }
function Write-Warn2($msg) { Write-Host "[toolkit-check] $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "[toolkit-check] $msg" -ForegroundColor Red }

if (-not (Test-Path $ConsumerRoot -PathType Container)) {
    Write-Err "ConsumerRoot '$ConsumerRoot' is not a directory."
    exit 2
}

$rootFull = (Resolve-Path $ConsumerRoot).Path
$lockFull       = Join-Path $rootFull $LockFile
$legacyLockFull = Join-Path $rootFull $LegacyLockFile
$mountFull  = Join-Path $rootFull $MountPath
$gmFull     = Join-Path $rootFull '.gitmodules'

# --- mode detection ------------------------------------------------------

$mode = $null
$currentTag = $null
$currentCommit = $null
$activeLockPath = $null

if (Test-Path $lockFull -PathType Leaf) {
    $activeLockPath = $lockFull
} elseif (Test-Path $legacyLockFull -PathType Leaf) {
    $activeLockPath = $legacyLockFull
    Write-Warn2 "Found legacy lockfile at $LegacyLockFile -- consumer is pre-v1.4.0. Re-sync with v1.4.0+ to migrate the lockfile inside $MountPath/."
}

if ($activeLockPath) {
    $mode = 'sync'
    foreach ($line in Get-Content -Path $activeLockPath) {
        if ($line -eq '---') { break }
        if ($line -match '^tag=(.+)$')    { $currentTag    = $Matches[1].Trim() }
        if ($line -match '^commit=(.+)$') { $currentCommit = $Matches[1].Trim() }
    }
    if (-not $currentTag) {
        Write-Err "Lockfile '$activeLockPath' has no tag= line. Malformed."
        exit 1
    }
}
elseif ((Test-Path $gmFull -PathType Leaf) -and (Test-Path $mountFull -PathType Container)) {
    $entry = & git config -f $gmFull --get-regexp ('^submodule\.' + [regex]::Escape($MountPath) + '\.path$')
    if ($entry) {
        $mode = 'submodule'
        Push-Location $mountFull
        try {
            $describe = (& git describe --tags --exact-match 2>$null)
            if ($LASTEXITCODE -ne 0 -or -not $describe) {
                $describe = (& git describe --tags 2>$null)
            }
            $currentTag = if ($describe) { $describe.Trim() } else { '<unknown>' }
            $currentCommit = (& git rev-parse --short HEAD 2>$null).Trim()
        } finally {
            Pop-Location
        }
    }
}

if (-not $mode) {
    Write-Err "No copilot-toolkit consumer mount detected at '$rootFull'."
    Write-Err "  Expected either '$LockFile' (sync mode, v1.4.0+) or legacy '$LegacyLockFile' (pre-v1.4.0) or a '$MountPath' entry in .gitmodules (submodule mode)."
    exit 1
}

# --- upstream tag list ---------------------------------------------------

Write-Info "Querying upstream tags ($Repo) ..."
$lsRemote = & git ls-remote --tags --refs $Repo 'refs/tags/v*'
if ($LASTEXITCODE -ne 0) {
    Write-Err "git ls-remote failed (exit $LASTEXITCODE). Check network / repo URL."
    exit 1
}

$upstreamTags = @()
foreach ($line in $lsRemote) {
    if ($line -match '^[0-9a-f]+\s+refs/tags/(v\d+\.\d+\.\d+)$') {
        $upstreamTags += $Matches[1]
    }
}

if ($upstreamTags.Count -eq 0) {
    Write-Err "Upstream has no vX.Y.Z tags. Check the repo URL."
    exit 1
}

$sorted = $upstreamTags | Sort-Object -Property { [version]($_ -replace '^v','') } -Descending
$latest = $sorted[0]

# --- compare + report ----------------------------------------------------

Write-Host ""
Write-Host "Consumer root : $rootFull"
Write-Host "Mode          : $mode"
Write-Host "Pinned tag    : $currentTag ($currentCommit)"
Write-Host "Upstream HEAD : $latest"

if ($currentTag -eq $latest) {
    Write-Host "Status        : UP TO DATE" -ForegroundColor Green
    exit 0
}

# How far behind?
$pinnedIndex = [array]::IndexOf($sorted, $currentTag)
if ($pinnedIndex -lt 0) {
    Write-Host "Status        : DIVERGED -- pinned tag '$currentTag' is not in the upstream tag list." -ForegroundColor Yellow
    Write-Host "                (Possible reasons: tag deleted upstream; consumer pinned to a pre-release / fork tag.)"
    Write-Host ""
    Write-Host "Latest 5 upstream tags:"
    $sorted | Select-Object -First 5 | ForEach-Object { Write-Host "  $_" }
    exit 0
}

$behind = $sorted[0..($pinnedIndex - 1)]
Write-Host "Status        : BEHIND BY $($behind.Count) TAG(S)" -ForegroundColor Yellow
Write-Host ""
Write-Host "Tags between pinned and latest (newest first):"
foreach ($t in $behind) {
    Write-Host "  $t"
}

Write-Host ""
Write-Host "To upgrade:"
switch ($mode) {
    'sync' {
        Write-Host "  pwsh -File $MountPath/install/sync.ps1 -Tag $latest"
        Write-Host "  git add $MountPath"
        Write-Host "  git commit -m `"Sync copilot-toolkit -> $latest`""
    }
    'submodule' {
        Write-Host "  git -C $MountPath fetch --tags"
        Write-Host "  git -C $MountPath checkout $latest"
        Write-Host "  git add $MountPath"
        Write-Host "  git commit -m `"Upgrade copilot-toolkit submodule -> $latest`""
    }
}

exit 0
