# Restoring a Plunge backup

Each folder under `backups/YYYY/YYYY-MM/<stamp>/` holds one backup of the
production D1 database `plunge-questions`:

- `d1-plunge-questions.sql.gz.age`: a SQL dump, gzipped, encrypted with age.
- `manifest.json`: when it was taken, row counts per table, and the sha256 of
  the encrypted file, the gzip and the SQL inside. `LATEST.json` is a copy of
  the newest manifest.

The decryption key is the age identity in the macOS Keychain under
`plunge-backup-age-key` (and in Jason's password manager). Without it the
backups are unreadable, by design.

## 1. Fetch and check

```sh
brew install age   # once
hf download jasonyandell/plunge-backups --repo-type dataset --local-dir plunge-backups \
  --include 'LATEST.json' 'backups/<year>/<month>/<stamp>/*'
shasum -a 256 plunge-backups/backups/.../d1-plunge-questions.sql.gz.age   # must match manifest artifacts[0].sha256
```

## 2. Decrypt to a local SQLite file (read it, query it, nothing touches production)

```sh
security find-generic-password -s plunge-backup-age-key -w > key.txt   # or paste from the password manager
age -d -i key.txt plunge-backups/backups/.../d1-plunge-questions.sql.gz.age | gunzip > plunge.sql
rm key.txt
shasum -a 256 plunge.sql             # must match manifest artifacts[0].sql_sha256
sqlite3 plunge.db < plunge.sql
sqlite3 plunge.db 'SELECT COUNT(*) FROM hands'   # compare with manifest tables
```

`plunge.sql` holds player data and account session/passkey rows. Keep it out
of git and delete it when done.

## 3. Restore into D1 (only on purpose, after deciding to)

Into a **new** database first, never over the live one:

```sh
npx wrangler d1 create plunge-questions-restore
npx wrangler d1 execute plunge-questions-restore --remote --file plunge.sql
```

The dump includes the `d1_migrations` table, so `wrangler d1 migrations apply`
will see every migration as applied. It omits `BEGIN`/`COMMIT` (D1 rejects
them) and starts with `PRAGMA defer_foreign_keys = true`. Point
`wrangler.toml`'s `database_id` at the restored database and deploy once it
checks out.

Inside 30 days there is a second path that needs no backup at all: D1 Time
Travel. Each manifest records `time_travel_bookmark`:

```sh
npx wrangler d1 time-travel restore plunge-questions --bookmark <bookmark>
```

That overwrites the live database in place; use it only for a deliberate rollback.

## What is not in a backup

- **Durable Object room state** (`PlungeRoom`): the live seat, hand and
  proposal of each open table. It has no read path from outside the worker
  and is short-lived (a day for invite rooms, 30 quiet days for a standing
  family table). Finished hands flush from each room into the D1 `hands` and
  `hand_players` tables, which are backed up; a hand in progress is lost.
- **The code and config**: those are this git repository.
- **Devices' local data**: each browser keeps its own hands and questions
  until it uploads them.
