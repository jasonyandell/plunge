#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["huggingface_hub>=1.0"]
# ///
"""Back up Plunge's D1 database to a private, encrypted Hugging Face dataset.

Usage: uv run scripts/backup.py [--local DIR] [--force]

Reads production with SELECT only, through the D1 query API (a D1: Read token
is enough; `wrangler d1 export` needs D1: Edit and locks the database while it
runs). Rebuilds the rows in a local SQLite file, dumps it as SQL that both
`sqlite3` and `wrangler d1 execute --file` accept, then gzips and encrypts it
with age to a public recipient. Only the holder of the matching identity (in
Jason's Keychain as `plunge-backup-age-key`) can read a backup; this script
never needs it. One backup is one commit: the encrypted dump, its manifest
(row counts, sha256 of every artifact), and LATEST.json. A rerun with nothing
changed uploads nothing.

Environment: CLOUDFLARE_API_TOKEN (D1: Read), HF_TOKEN (write to the repo).
Durable Object rooms are not backed up: they have no read path from outside
the worker, and finished hands already land in D1 (see RESTORE.md).
"""
import argparse
import datetime
import gzip
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import tomllib
import urllib.request

ACCOUNT = 'eb6564e57c2aebe97bbc5d33a0ffe5cb'
REPO = 'jasonyandell/plunge-backups'
# The public half of the Keychain identity `plunge-backup-age-key`. Not a secret.
RECIPIENT = 'age19u76jrrp3spa94q6xtcma4fxqft2ep73qvleaz9nhs65egeydsms7fea9v'
ROOT = Path(__file__).resolve().parent.parent
PAGE = 500
# D1's internal tables; sqlite_sequence is rebuilt by the dump itself.
SKIP = {'_cf_KV', 'sqlite_sequence'}


def database() -> dict:
    config = tomllib.loads((ROOT / 'wrangler.toml').read_text())
    return next(d for d in config['d1_databases'] if d['binding'] == 'QUESTIONS')


def query(db_id: str, sql: str, params: list | None = None) -> dict:
    # Read-only by construction: nothing but a SELECT ever leaves this function.
    if not sql.lstrip().upper().startswith('SELECT'): raise ValueError(f'refusing non-SELECT: {sql}')
    request = urllib.request.Request(
        f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{db_id}/raw',
        data=json.dumps({'sql': sql, 'params': params or []}).encode(), method='POST',
        headers={'Authorization': f'Bearer {os.environ["CLOUDFLARE_API_TOKEN"]}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=60) as response: body = json.load(response)
    if not body['success']: raise RuntimeError(body['errors'])
    return body['result'][0]['results']


def bookmark(db_id: str) -> str | None:
    """The D1 Time Travel bookmark at backup time: a second restore path for 30 days."""
    request = urllib.request.Request(
        f'https://api.cloudflare.com/client/v4/accounts/{ACCOUNT}/d1/database/{db_id}/time_travel/bookmark',
        headers={'Authorization': f'Bearer {os.environ["CLOUDFLARE_API_TOKEN"]}'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response: return json.load(response)['result']['bookmark']
    except Exception: return None


def snapshot(db_id: str, target: Path) -> dict[str, int]:
    """Copy every table into a local SQLite file; returns rows per table, checked both sides."""
    schema = query(db_id, "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid")['rows']
    local = sqlite3.connect(target)
    tables = [(name, sql) for kind, name, sql in schema if kind == 'table' and name not in SKIP]
    for _, sql in tables: local.execute(sql)
    counts = {}
    for name, _ in tables:
        expected = query(db_id, f'SELECT COUNT(*) FROM "{name}"')['rows'][0][0]
        last, copied = None, 0
        while True:
            page = query(db_id, f'SELECT rowid, * FROM "{name}"' + (' WHERE rowid > ?' if last is not None else '') + f' ORDER BY rowid LIMIT {PAGE}',
                                      [last] if last is not None else [])
            rows = page['rows']
            if not rows: break
            if any(isinstance(v, (list, dict)) for row in rows for v in row): raise RuntimeError(f'{name}: unexpected non-scalar value')
            columns = ','.join(f'"{c}"' for c in page['columns'][1:])
            local.executemany(f'INSERT INTO "{name}"({columns}) VALUES({",".join("?" * (len(page["columns"]) - 1))})', [row[1:] for row in rows])
            copied += len(rows); last = rows[-1][0]
        if copied != expected: raise RuntimeError(f'{name}: copied {copied} rows, database reports {expected}')
        counts[name] = copied
    sequence = query(db_id, 'SELECT name, seq FROM sqlite_sequence')['rows'] if any(n == 'sqlite_sequence' for _, n, _ in schema) else []
    if sequence:
        local.execute('DELETE FROM sqlite_sequence')
        local.executemany('INSERT INTO sqlite_sequence(name, seq) VALUES(?, ?)', sequence)
    # Indexes and triggers last, so restored inserts never fire a trigger twice.
    for kind, _, sql in schema:
        if kind in ('index', 'trigger', 'view'): local.execute(sql)
    local.commit(); local.close()
    return counts


def dump(target: Path) -> bytes:
    """SQL for `sqlite3` and `wrangler d1 execute --file`: no BEGIN/COMMIT (D1 rejects them), FKs deferred."""
    local = sqlite3.connect(target)
    lines = ['PRAGMA defer_foreign_keys = true;'] + [line for line in local.iterdump() if line not in ('BEGIN TRANSACTION;', 'COMMIT;')]
    local.close()
    return ('\n'.join(lines) + '\n').encode()


def sha256(data: bytes) -> str: return hashlib.sha256(data).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--local', type=Path, help='write the encrypted backup here instead of uploading')
    parser.add_argument('--force', action='store_true', help='upload even when the data is unchanged')
    args = parser.parse_args()
    db = database()
    stamp = datetime.datetime.now(datetime.UTC).strftime('%Y-%m-%dT%H%M%SZ')
    mark = bookmark(db['database_id'])
    with tempfile.TemporaryDirectory() as scratch:
        counts = snapshot(db['database_id'], Path(scratch) / 'plunge.sqlite')
        sql = dump(Path(scratch) / 'plunge.sqlite')
    packed = gzip.compress(sql, mtime=0)
    sealed = subprocess.run(['age', '-r', RECIPIENT], input=packed, capture_output=True, check=True).stdout
    name = f'd1-{db["database_name"]}.sql.gz.age'
    folder = f'backups/{stamp[:4]}/{stamp[:7]}/{stamp}'
    commit = subprocess.run(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], capture_output=True, text=True).stdout.strip()
    manifest = {
        'created': stamp, 'source': {'account': ACCOUNT, 'database': db['database_name'], 'database_id': db['database_id'],
                                                                  'time_travel_bookmark': mark, 'method': 'D1 query API, SELECT only'},
        'tool': {'script': 'scripts/backup.py', 'commit': commit}, 'recipient': RECIPIENT,
        'tables': counts, 'rows': sum(counts.values()),
        'artifacts': [{'path': f'{folder}/{name}', 'bytes': len(sealed), 'sha256': sha256(sealed),
                                      'contents': 'gzip of SQL dump, age-encrypted', 'gzip_sha256': sha256(packed),
                                      'sql_bytes': len(sql), 'sql_sha256': sha256(sql)}],
        'not_included': {'durable_objects': 'PlungeRoom live-room state (no external read path; finished hands are in D1 `hands`)',
                                          'd1_internal': sorted(SKIP - {'sqlite_sequence'})},
    }
    manifest_bytes = (json.dumps(manifest, indent=2) + '\n').encode()
    print(f'{manifest["rows"]} rows in {len(counts)} tables; sql {len(sql)} B, encrypted {len(sealed)} B')
    if args.local:
        out = args.local / folder; out.mkdir(parents=True, exist_ok=True)
        (out / name).write_bytes(sealed); (out / 'manifest.json').write_bytes(manifest_bytes)
        print(f'wrote {out}'); return
    from huggingface_hub import CommitOperationAdd, HfApi, hf_hub_download
    api = HfApi(token=os.environ['HF_TOKEN'])
    api.create_repo(REPO, repo_type='dataset', private=True, exist_ok=True)
    if not api.repo_info(REPO, repo_type='dataset').private: sys.exit(f'{REPO} is not private; refusing to upload')
    try: latest = json.loads(Path(hf_hub_download(REPO, 'LATEST.json', repo_type='dataset', token=api.token)).read_text())
    except Exception: latest = None
    if latest and latest['artifacts'][0]['sql_sha256'] == sha256(sql) and not args.force:
        print(f'unchanged since {latest["created"]}; nothing uploaded'); return
    operations = [CommitOperationAdd(f'{folder}/{name}', sealed), CommitOperationAdd(f'{folder}/manifest.json', manifest_bytes),
                                CommitOperationAdd('LATEST.json', manifest_bytes),
                                CommitOperationAdd('RESTORE.md', (ROOT / 'scripts/backup-RESTORE.md').read_bytes()),
                                CommitOperationAdd('README.md', b'---\nprivate: true\n---\n# Plunge backups\n\nPrivate, age-encrypted backups of Plunge production data. See RESTORE.md.\n')]
    info = api.create_commit(REPO, operations, repo_type='dataset', commit_message=f'Backup {stamp}: {manifest["rows"]} rows')
    check = Path(hf_hub_download(REPO, f'{folder}/{name}', repo_type='dataset', revision=info.oid, token=api.token)).read_bytes()
    if sha256(check) != sha256(sealed): sys.exit('uploaded file does not match; investigate before trusting this backup')
    print(f'committed {info.oid[:12]} to {REPO}: {folder}/{name} sha256 {sha256(sealed)} verified')


if __name__ == '__main__':
    main()
