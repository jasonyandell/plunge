#!/usr/bin/env python3
"""Read a campaign plan, or copy it after verifying a frozen producer. Never deploys."""
import argparse
import hashlib
import json
import shutil
import sqlite3
import tarfile
from pathlib import Path


def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'))


def inspect(campaign, book, deals):
    published = json.loads(book.read_text())
    if published['schema'] != 'plunge-played-bids-v1' or deals <= 0:
        raise ValueError('Expected a published played book and a positive deal count')
    cfg = json.loads((campaign / 'manifest.json').read_text())
    if cfg['hands'] % 4:
        raise ValueError('Campaign must contain four bidder hands per deal')
    with sqlite3.connect((campaign / 'played.sqlite').resolve().as_uri() + '?mode=ro', uri=True) as db:
        rows = db.execute('SELECT id,seed,seat FROM hands ORDER BY id').fetchall()
        expected = [(i, cfg['seed_start'] + i // 4, i % 4) for i in range(cfg['hands'])]
        if rows != expected:
            raise ValueError('Campaign hand identities do not match manifest')
        games = db.execute('SELECT COUNT(*) FROM games').fetchone()[0]
    seeds = sorted({r[1] for r in rows})
    if seeds != sorted(published['seeds']) or games != published['games']:
        raise ValueError('Source campaign does not match current published catalogue; reconcile first')
    if cfg['profile'] != published['profile']:
        raise ValueError('Published and campaign policy profiles differ')
    fresh = list(range(cfg['seed_start'] + cfg['hands'] // 4,
                       cfg['seed_start'] + cfg['hands'] // 4 + deals))
    if set(fresh) & set(seeds):
        raise ValueError('New seeds overlap existing catalogue')
    return {'existing_deals': len(seeds), 'existing_hands': cfg['hands'],
            'existing_games': games, 'new_seeds': fresh,
            'target_hands': cfg['hands'] + 4 * deals, 'profile': cfg['profile']}


def verify_producer(campaign, producer, research):
    folder = campaign / 'producers' / producer
    info = json.loads((folder / 'producer.json').read_text())
    identity = {k: info[k] for k in ('binary_sha256', 'sources')}
    if info['schema'] != 'kiln-played-producer-v2' or info['bundle_id'] != producer:
        raise ValueError('Expected a frozen v2 producer bundle')
    if hashlib.sha256(canonical(identity).encode()).hexdigest() != producer:
        raise ValueError('Producer identity mismatch')
    if sha(folder / 'kiln-play-worker') != info['binary_sha256'] or sha(folder / 'source.tar.gz') != info['archive_sha256']:
        raise ValueError('Frozen binary/archive hash mismatch')
    with tarfile.open(folder / 'source.tar.gz', 'r:gz') as archive:
        for name, digest in info['sources'].items():
            path = Path(name)
            if path.is_absolute() or '..' in path.parts:
                raise ValueError('Unsafe source path')
            if sha(research / path) != digest or hashlib.sha256(archive.extractfile(name).read()).hexdigest() != digest:
                raise ValueError(f'Frozen source mismatch: {name}')
    return info


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('mode', choices=['inspect', 'copy'])
    p.add_argument('--campaign', type=Path, required=True)
    p.add_argument('--book', type=Path, required=True)
    p.add_argument('--deals', type=int, required=True)
    p.add_argument('--producer')
    p.add_argument('--research', type=Path)
    p.add_argument('--destination', type=Path)
    args = p.parse_args()
    plan = inspect(args.campaign, args.book, args.deals)
    if args.mode == 'copy':
        if not all([args.producer, args.research, args.destination]):
            p.error('copy requires --producer, --research and --destination')
        verify_producer(args.campaign, args.producer, args.research)
        # An existing destination is never overwritten or removed, even on failure.
        args.destination.mkdir(parents=True, exist_ok=False)
        source = sqlite3.connect((args.campaign / 'played.sqlite').resolve().as_uri() + '?mode=ro', uri=True)
        with source, sqlite3.connect(args.destination / 'played.sqlite') as target:
            source.backup(target)
            if target.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
                raise ValueError('Copied SQLite integrity check failed')
        source.close()
        shutil.copy2(args.campaign / 'manifest.json', args.destination / 'manifest.json')
        shutil.copytree(args.campaign / 'producers', args.destination / 'producers')
        if inspect(args.destination, args.book, args.deals) != plan:
            raise ValueError('Source changed during copy; retain copy for inspection, do not extend')
        verify_producer(args.destination, args.producer, args.research)
        plan['copied'] = True
    print(json.dumps(plan, sort_keys=True, indent=2))


if __name__ == '__main__':
    main()
