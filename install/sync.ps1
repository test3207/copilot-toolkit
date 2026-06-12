#requires -Version 7
<#
.SYNOPSIS
    Populate or update a consumer repo's .copilot-toolkit/ directory from a
    pinned upstream release tag (sync mode -- alternative to git submodule).

.DESCRIPTION
    Sync mode mounts copilot-toolkit content into the consumer's working tree
    as a regular directory (NOT a submodule). The script clones the upstream
    repo at the requested tag, copies its tree into .copilot-toolkit/, and
    records a SHA256 manifest in .copilot-toolkit/.sync-lock (a dotfile
    inside the synced tree, self-contained with the dir).

    On re-sync, the script reads the previous manifest and compares each
    tracked file's current SHA256 against the recorded value. If a local edit
    is detected, the script REFUSES the overwrite unless -Force is passed --
    this catches accidental edits inside .copilot-toolkit/ before they get
    silently clobbered by the next sync. The intended workflow is to never
    edit files inside .copilot-toolkit/; propose changes upstream instead.

    Run from the consumer repo root. The script creates / replaces:
      - .copilot-toolkit/             (full tree from the upstream tag, minus .git)
      - .copilot-toolkit/.sync-lock   (sha256 manifest + tag metadata)

.PARAMETER Tag
    Upstream release tag to pin to (e.g. v0.1.0). Required unless -Uninstall.

.PARAMETER Repo
    Upstream git URL. Defaults to https://github.com/test3207/copilot-toolkit.git.

.PARAMETER Force
    Overwrite local edits inside .copilot-toolkit/ without prompting. Use
    sparingly -- the local-edit refusal exists to catch unintended drift.

.PARAMETER Uninstall
    Remove .copilot-toolkit/ and the in-dir .copilot-toolkit/.sync-lock
    from the consumer working tree. Settings.json entries are NOT touched --
    remove those by hand.

.EXAMPLE
    pwsh -File install/sync.ps1 -Tag v0.1.0
        Initial install or upgrade to v0.1.0.

.EXAMPLE
    pwsh -File install/sync.ps1 -Tag v0.1.0 -Force
        Upgrade and discard any local edits inside .copilot-toolkit/.

.EXAMPLE
    pwsh -File install/sync.ps1 -Uninstall
        Remove .copilot-toolkit/ and the lockfile.

.NOTES
    Exit codes:
      0    success
      1    user-facing failure (bad tag, local edit detected without -Force, ...)
      2    bad usage (missing required parameter)
#>
[CmdletBinding()]
param(
    [string] $Tag,
    [string] $Repo = 'https://github.com/test3207/copilot-toolkit.git',
    [switch] $Force,
    [switch] $Uninstall
)

$ErrorActionPreference = 'Stop'

$DestDir         = '.copilot-toolkit'
$LockFile        = Join-Path $DestDir '.sync-lock'

function Write-Info($msg)  { Write-Host "[sync] $msg" -ForegroundColor Cyan }
function Write-Warn2($msg) { Write-Host "[sync] $msg" -ForegroundColor Yellow }
function Write-Err($msg)   { Write-Host "[sync] $msg" -ForegroundColor Red }

function Invoke-Uninstall {
    if (Test-Path $DestDir) {
        Write-Info "Removing $DestDir"
        Remove-Item -Recurse -Force $DestDir
    } else {
        Write-Warn2 "$DestDir not present; nothing to remove."
    }
    Write-Info "Uninstall complete. Remove the matching keys from .vscode/settings.json by hand."
}

function Get-FileSha256 {
    param([string] $Path)
    (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLower()
}

function Read-Manifest {
    param([string] $LockPath)
    $entries = @{}
    $meta = @{}
    $inFiles = $false
    foreach ($line in Get-Content -Path $LockPath) {
        if ($line -eq '---') { $inFiles = $true; continue }
        if (-not $inFiles) {
            if ($line -match '^([a-z_]+)=(.*)$') {
                $meta[$Matches[1]] = $Matches[2]
            }
            continue
        }
        if ($line -match '^([0-9a-f]{64})\s\s(.+)$') {
            $entries[$Matches[2]] = $Matches[1]
        }
    }
    return [pscustomobject]@{ Meta = $meta; Files = $entries }
}

function Test-LocalEdits {
    param([string] $DestRoot, [hashtable] $Expected)
    $modified = New-Object System.Collections.Generic.List[string]
    $missing  = New-Object System.Collections.Generic.List[string]
    foreach ($rel in $Expected.Keys) {
        $full = Join-Path $DestRoot $rel
        if (-not (Test-Path $full -PathType Leaf)) {
            $missing.Add($rel) | Out-Null
            continue
        }
        $actual = Get-FileSha256 -Path $full
        if ($actual -ne $Expected[$rel]) {
            $modified.Add($rel) | Out-Null
        }
    }
    return [pscustomobject]@{ Modified = $modified; Missing = $missing }
}

function Build-Manifest {
    param([string] $DestRoot)
    $entries = @()
    $rootFull = (Resolve-Path $DestRoot).Path
    Get-ChildItem -Path $DestRoot -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($rootFull.Length).TrimStart([char]'\', [char]'/').Replace('\', '/')
        $sha = Get-FileSha256 -Path $_.FullName
        $entries += [pscustomobject]@{ Path = $rel; Sha = $sha }
    }
    return $entries | Sort-Object Path
}

# -- main -----------------------------------------------------------------

if ($Uninstall) {
    Invoke-Uninstall
    exit 0
}

if (-not $Tag) {
    Write-Err "Missing -Tag. Example: pwsh -File install/sync.ps1 -Tag v0.1.0"
    exit 2
}

if ($Tag -notmatch '^v\d+\.\d+\.\d+$') {
    Write-Err "Tag '$Tag' is not in vX.Y.Z form."
    exit 1
}

# 1. Local-edit detection (only if a previous sync exists).
$activeLock = if (Test-Path $LockFile) { $LockFile } else { $null }

if ($activeLock -and (Test-Path $DestDir) -and -not $Force) {
    Write-Info "Existing $activeLock found -- checking for local edits."
    $prev = Read-Manifest -LockPath $activeLock
    $drift = Test-LocalEdits -DestRoot $DestDir -Expected $prev.Files
    if ($drift.Modified.Count -gt 0) {
        Write-Err "Local edits detected inside $DestDir (vs $($prev.Meta.tag)):"
        $drift.Modified | ForEach-Object { Write-Err "  modified: $_" }
        if ($drift.Missing.Count -gt 0) {
            $drift.Missing | ForEach-Object { Write-Err "  missing : $_" }
        }
        Write-Err "Refusing to overwrite. Use -Force to discard local edits."
        exit 1
    }
    if ($drift.Missing.Count -gt 0) {
        Write-Warn2 "Files missing from $DestDir (vs $($prev.Meta.tag)) -- treating as removed by user, will be re-added by the sync:"
        $drift.Missing | ForEach-Object { Write-Warn2 "  missing: $_" }
    }
}

# 2. Clone upstream into a temp dir.
$tempRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("copilot-toolkit-sync-" + [Guid]::NewGuid().ToString('N'))
Write-Info "Cloning $Repo at $Tag into $tempRoot"
$env:GIT_TERMINAL_PROMPT = '0'
& git clone --depth 1 --branch $Tag --quiet $Repo $tempRoot
if ($LASTEXITCODE -ne 0) {
    Write-Err "git clone failed (exit $LASTEXITCODE). Check that tag $Tag exists at $Repo."
    if (Test-Path $tempRoot) { Remove-Item -Recurse -Force $tempRoot }
    exit 1
}

# Record the resolved commit SHA before we strip .git.
$commitSha = (& git -C $tempRoot rev-parse --short HEAD).Trim()

# 3. Strip the upstream .git/ -- the synced tree is plain files.
Remove-Item -Recurse -Force (Join-Path $tempRoot '.git')

# 4. Replace .copilot-toolkit/ atomically (well, as atomically as Windows allows).
if (Test-Path $DestDir) {
    Write-Info "Removing existing $DestDir"
    Remove-Item -Recurse -Force $DestDir
}
Write-Info "Moving cloned tree into $DestDir"
Move-Item -Path $tempRoot -Destination $DestDir

# 5. Build new manifest and write the lockfile.
Write-Info "Building SHA256 manifest"
$manifest = Build-Manifest -DestRoot $DestDir
$nowIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$header = @(
    "# .copilot-toolkit/.sync-lock - DO NOT EDIT (managed by install/sync.ps1 / sync.sh)",
    "# Sync mode lockfile: records the upstream tag this directory was synced from",
    "# plus a SHA256 manifest used to detect local edits before the next sync.",
    "tag=$Tag",
    "commit=$commitSha",
    "url=$Repo",
    "synced_at=$nowIso",
    "---"
)
$body = $manifest | ForEach-Object { "{0}  {1}" -f $_.Sha, $_.Path }
($header + $body) | Set-Content -Path $LockFile -Encoding utf8

Write-Info "Sync complete. $($manifest.Count) files written to $DestDir."
Write-Info "Lockfile: $LockFile ($Tag @ $commitSha)"
Write-Info "Next: reload VS Code window so Copilot Chat picks up the toolkit skills."
exit 0
