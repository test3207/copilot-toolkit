#!/usr/bin/env bash
# sync.sh -- populate or update a consumer repo's .copilot-toolkit/ from a
# pinned upstream release tag. Bash equivalent of install/sync.ps1.
#
# Run from the consumer repo root. Creates / replaces:
#   .copilot-toolkit/             full tree from the upstream tag, minus .git
#   .copilot-toolkit/.sync-lock   sha256 manifest + tag metadata (in-dir dotfile)
#
# Usage:
#   bash install/sync.sh --tag v0.1.0
#   bash install/sync.sh --tag v0.1.0 --force
#   bash install/sync.sh --uninstall
#
# Exit codes:
#   0  success
#   1  user-facing failure (bad tag, local edit detected without --force, ...)
#   2  bad usage

set -euo pipefail

DEST_DIR='.copilot-toolkit'
LOCK_FILE="$DEST_DIR/.sync-lock"
REPO_DEFAULT='https://github.com/test3207/copilot-toolkit.git'

TAG=''
REPO="$REPO_DEFAULT"
FORCE=0
UNINSTALL=0

usage() {
    cat <<'EOF'
Usage: bash install/sync.sh --tag vX.Y.Z [--force] [--repo <url>]
       bash install/sync.sh --uninstall

Options:
  --tag <vX.Y.Z>   Upstream release tag (required unless --uninstall).
  --repo <url>     Upstream git URL (default: https://github.com/test3207/copilot-toolkit.git).
  --force          Discard local edits inside .copilot-toolkit/ on re-sync.
  --uninstall      Remove .copilot-toolkit/ and the sync lockfile.
  -h | --help      Show this help.
EOF
}

info() { printf '\033[36m[sync] %s\033[0m\n' "$*"; }
warn() { printf '\033[33m[sync] %s\033[0m\n' "$*" >&2; }
err()  { printf '\033[31m[sync] %s\033[0m\n' "$*" >&2; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --tag)        TAG="${2:-}"; shift 2 ;;
        --repo)       REPO="${2:-}"; shift 2 ;;
        --force)      FORCE=1; shift ;;
        --uninstall)  UNINSTALL=1; shift ;;
        -h|--help)    usage; exit 0 ;;
        *)            err "Unknown option: $1"; usage >&2; exit 2 ;;
    esac
done

sha256_of() {
    # Portable sha256 (Linux: sha256sum; macOS: shasum -a 256).
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    else
        err "Neither sha256sum nor shasum found on PATH."
        exit 1
    fi
}

do_uninstall() {
    if [[ -d "$DEST_DIR" ]]; then
        info "Removing $DEST_DIR"
        rm -rf "$DEST_DIR"
    else
        warn "$DEST_DIR not present; nothing to remove."
    fi
    info "Uninstall complete. Remove the matching keys from .vscode/settings.json by hand."
}

if [[ "$UNINSTALL" -eq 1 ]]; then
    do_uninstall
    exit 0
fi

if [[ -z "$TAG" ]]; then
    err "Missing --tag. Example: bash install/sync.sh --tag v0.1.0"
    usage >&2
    exit 2
fi

if ! [[ "$TAG" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    err "Tag '$TAG' is not in vX.Y.Z form."
    exit 1
fi

# 1. Local-edit detection (only if a previous sync exists).
ACTIVE_LOCK=''
[[ -f "$LOCK_FILE" ]] && ACTIVE_LOCK="$LOCK_FILE"

if [[ -n "$ACTIVE_LOCK" && -d "$DEST_DIR" && "$FORCE" -eq 0 ]]; then
    info "Existing $ACTIVE_LOCK found -- checking for local edits."
    prev_tag=$(grep -E '^tag=' "$ACTIVE_LOCK" | head -n1 | cut -d= -f2- || true)
    modified=()
    missing=()
    # Stream the manifest body (lines after '---' look like "<sha>  <path>").
    awk 'BEGIN{after=0} /^---$/{after=1; next} after==1' "$ACTIVE_LOCK" |
        while IFS= read -r line; do
            sha=$(echo "$line" | awk '{print $1}')
            rel=$(echo "$line" | awk '{print substr($0, length($1)+3)}')
            full="$DEST_DIR/$rel"
            if [[ ! -f "$full" ]]; then
                echo "missing $rel"
            else
                actual=$(sha256_of "$full")
                if [[ "$actual" != "$sha" ]]; then
                    echo "modified $rel"
                fi
            fi
        done >/tmp/copilot-toolkit-drift.$$
    while IFS= read -r drift_line; do
        kind=$(echo "$drift_line" | awk '{print $1}')
        path=$(echo "$drift_line" | awk '{print substr($0, length($1)+2)}')
        case "$kind" in
            modified) modified+=("$path") ;;
            missing)  missing+=("$path")  ;;
        esac
    done </tmp/copilot-toolkit-drift.$$
    rm -f /tmp/copilot-toolkit-drift.$$
    if [[ "${#modified[@]}" -gt 0 ]]; then
        err "Local edits detected inside $DEST_DIR (vs $prev_tag):"
        for p in "${modified[@]}"; do err "  modified: $p"; done
        for p in "${missing[@]}";  do err "  missing : $p"; done
        err "Refusing to overwrite. Use --force to discard local edits."
        exit 1
    fi
    if [[ "${#missing[@]}" -gt 0 ]]; then
        warn "Files missing from $DEST_DIR (vs $prev_tag) -- treating as removed by user, will be re-added:"
        for p in "${missing[@]}"; do warn "  missing: $p"; done
    fi
fi

# 2. Clone upstream into a temp dir.
tmp_root=$(mktemp -d -t copilot-toolkit-sync.XXXXXX)
info "Cloning $REPO at $TAG into $tmp_root"
export GIT_TERMINAL_PROMPT=0
if ! git clone --depth 1 --branch "$TAG" --quiet "$REPO" "$tmp_root"; then
    err "git clone failed. Check that tag $TAG exists at $REPO."
    rm -rf "$tmp_root"
    exit 1
fi

commit_sha=$(git -C "$tmp_root" rev-parse --short HEAD)

# 3. Strip the upstream .git/ -- the synced tree is plain files.
rm -rf "$tmp_root/.git"

# 4. Replace .copilot-toolkit/.
if [[ -d "$DEST_DIR" ]]; then
    info "Removing existing $DEST_DIR"
    rm -rf "$DEST_DIR"
fi
info "Moving cloned tree into $DEST_DIR"
mv "$tmp_root" "$DEST_DIR"

# 5. Build new manifest and write the lockfile.
info "Building SHA256 manifest"
now_iso=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
{
    echo '# .copilot-toolkit/.sync-lock - DO NOT EDIT (managed by install/sync.ps1 / sync.sh)'
    echo '# Sync mode lockfile: records the upstream tag this directory was synced from'
    echo '# plus a SHA256 manifest used to detect local edits before the next sync.'
    echo "tag=$TAG"
    echo "commit=$commit_sha"
    echo "url=$REPO"
    echo "synced_at=$now_iso"
    echo '---'
    # Manifest body: sorted by path; "<sha>  <relative-path>" -- matches `sha256sum` format.
    ( cd "$DEST_DIR" && find . -type f | sed 's|^\./||' | LC_ALL=C sort ) | while IFS= read -r rel; do
        sha=$(sha256_of "$DEST_DIR/$rel")
        echo "$sha  $rel"
    done
} >"$LOCK_FILE"

file_count=$(grep -c '^[0-9a-f]\{64\}  ' "$LOCK_FILE" || true)
info "Sync complete. $file_count files written to $DEST_DIR."
info "Lockfile: $LOCK_FILE ($TAG @ $commit_sha)"
info "Next: reload VS Code window so Copilot Chat picks up the toolkit skills."
exit 0
