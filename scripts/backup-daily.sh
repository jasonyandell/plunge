#!/bin/sh
# Daily Plunge backup for launchd: Keychain credentials live only in this process.
# Install with scripts/backup-launchd.plist (see the header there).
set -eu
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
CLOUDFLARE_API_TOKEN=$(security find-generic-password -s "${PLUNGE_BACKUP_CF_KEYCHAIN:-cloudflare-d1-rpt-card}" -w)
HF_TOKEN=$(security find-generic-password -s huggingface-token -w)
export CLOUDFLARE_API_TOKEN HF_TOKEN
echo "== $(date -u +%FT%TZ)"
exec uv run -q scripts/backup.py
