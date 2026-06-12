#requires -Version 7
<#
.SYNOPSIS
    Scan files for private/business markers that must not appear in public toolkit content.

.DESCRIPTION
    Walks one or more paths (file or directory) and matches each non-binary line
    against the drift-gate regex from docs/migration/plan.md (Architectural Decision 6).

    Markers flagged:
      - msazure                       (ADO org)
      - microsoft.visualstudio        (legacy ADO host)
      - microsofticm                  (ICM host)
      - microsoft/OS                  (Windows OS repo path)
      - PR 7-8 digit numbers          (internal ADO PR IDs)
      - !N (7-8 digits)               (ADO !PR shorthand)
      - GUIDs (8-4-4-4-12 hex)        (subscription / tenant / resource IDs)
      - @microsoft.com                (corp email domain)
      - .kusto.windows.net            (internal kusto cluster host)
      - .kusto.net                    (internal kusto cluster host, short form)

    Documented-public allowlist:
      Values that MATCH the regex but are explicitly public (in Microsoft's
      published docs) are exempted via the `-AllowValue` switch (one entry per
      value, case-insensitive). The default allowlist carries the publicly
      documented ADO REST API resource GUID `499b84ac-1321-427f-aa17-267ca6975798`
      (Azure DevOps OAuth scope ID, see learn.microsoft.com). Do NOT add
      ANYTHING else without an MS-public-docs URL in the same commit.

    Output format: <file>:<line>: <matched-text>
    Exit code:     0 = clean, 1 = at least one match, 2 = bad usage.

.PARAMETER Path
    One or more files or directories to scan. Directories are walked recursively.
    Defaults to the current directory.

.PARAMETER Extension
    Optional list of file extensions to include (e.g. .md, .ps1, .mjs). When omitted,
    a sensible default set is used (markdown, scripts, config text).

.PARAMETER Exclude
    Glob patterns (matched against full path) to skip. Useful when a path needs
    to be exempted from the gate (e.g. legitimately-private examples).

.PARAMETER AllowValue
    Literal matched-string values to exempt from the gate (case-insensitive,
    string equality — NOT regex). Use sparingly and ONLY for values that are
    publicly documented by Microsoft (cite the public-docs URL in the calling
    commit). The script always exempts the publicly documented ADO REST API
    resource GUID `499b84ac-1321-427f-aa17-267ca6975798`.

.PARAMETER IncludeSelf
    By default this script auto-excludes its own file (the drift-gate regex
    literal triggers every marker on itself). Pass -IncludeSelf to disable
    that exclusion (e.g. when verifying the regex itself).

.EXAMPLE
    pwsh -File scripts/lint-public.ps1 -Path .github,scripts,templates,install,INSTALL.md,README.md

.EXAMPLE
    pwsh -File scripts/lint-public.ps1 -Path dist -Exclude '*examples/private/*'
#>
[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [string[]]$Path = @('.'),

    [string[]]$Extension = @('.md', '.ps1', '.psm1', '.mjs', '.cjs', '.js', '.ts', '.json', '.jsonc', '.yml', '.yaml', '.txt'),

    [string[]]$Exclude = @(),

    [string[]]$AllowValue = @(),

    [switch]$IncludeSelf
)

$ErrorActionPreference = 'Stop'

# Publicly documented values that match the regex but are EXPLICITLY public.
# Do NOT extend without an MS-public-docs URL pinned in the calling commit.
$publicAllowlist = @(
    '499b84ac-1321-427f-aa17-267ca6975798'   # ADO REST API resource GUID (learn.microsoft.com)
) + $AllowValue

$allowlistSet = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($v in $publicAllowlist) { [void]$allowlistSet.Add($v) }

# Single combined regex; case-insensitive at match time.
# Boundaries chosen so 'msazure' inside a longer identifier (e.g. 'msazure-cdn') still hits;
# bare 7-8 digit PR numbers require \b to avoid catching commit SHAs.
$pattern = @(
    'msazure',
    'microsoft\.visualstudio',
    'microsofticm',
    'microsoft/OS',
    '\bPR\s+\d{7,8}\b',
    '![0-9]{7,8}\b',
    '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}',
    '@microsoft\.com',
    '\.kusto\.windows\.net',
    '\.kusto\.net'
) -join '|'

$regex = [System.Text.RegularExpressions.Regex]::new(
    $pattern,
    [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
)

$selfPath = if ($PSCommandPath) { [System.IO.Path]::GetFullPath($PSCommandPath) } else { $null }

function Test-ShouldExclude {
    param([string]$FullPath)
    if (-not $IncludeSelf -and $selfPath -and $FullPath -ieq $selfPath) { return $true }
    foreach ($pat in $Exclude) {
        if ($FullPath -like $pat) { return $true }
    }
    return $false
}

$files = [System.Collections.Generic.List[System.IO.FileInfo]]::new()
foreach ($p in $Path) {
    if (-not (Test-Path -LiteralPath $p)) {
        Write-Error "Path not found: $p"
        exit 2
    }
    $item = Get-Item -LiteralPath $p
    if ($item.PSIsContainer) {
        Get-ChildItem -LiteralPath $p -Recurse -File |
            Where-Object { $Extension -contains $_.Extension.ToLowerInvariant() } |
            Where-Object { -not (Test-ShouldExclude -FullPath $_.FullName) } |
            ForEach-Object { $files.Add($_) }
    }
    else {
        if (-not (Test-ShouldExclude -FullPath $item.FullName)) {
            $files.Add($item)
        }
    }
}

$matchCount = 0
foreach ($f in $files) {
    $lineNo = 0
    foreach ($line in [System.IO.File]::ReadLines($f.FullName)) {
        $lineNo++
        $m = $regex.Match($line)
        while ($m.Success) {
            if (-not $allowlistSet.Contains($m.Value)) {
                Write-Output ("{0}:{1}: {2}" -f $f.FullName, $lineNo, $m.Value)
                $matchCount++
            }
            $m = $m.NextMatch()
        }
    }
}

if ($matchCount -gt 0) { exit 1 } else { exit 0 }
