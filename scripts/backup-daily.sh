#!/bin/sh
# Daily Plunge backup for launchd: Keychain credentials live only in this process.
# Install with scripts/backup-launchd.plist (see the header there).
set -eu
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
# Narrow keys: Cloudflare D1 Read only, and an HF token that can write only jasonyandell/plunge-backups.
CLOUDFLARE_API_TOKEN=$(security find-generic-password -s "${PLUNGE_BACKUP_CF_KEYCHAIN:-cloudflare-plunge-backup}" -w)
HF_TOKEN=$(security find-generic-password -s "${PLUNGE_BACKUP_HF_KEYCHAIN:-huggingface-plunge-backup}" -w)
export CLOUDFLARE_API_TOKEN HF_TOKEN
echo "== $(date -u +%FT%TZ)"
exec uv run -q scripts/backup.py
