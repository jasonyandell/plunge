#!/usr/bin/env python3
"""Build the portable optimized player and import a matched, verified asset.

Usage: python3 scripts/update-walt.py /path/to/texas-42 [--receipt /fresh/path]
The source must be committed. Each build gets a fresh target directory and a
watchdog receipt. Commit the imported WASM and manifest together.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

TARGET = 'wasm32-unknown-unknown'
FEATURES = ['cpu-speedups']
PROFILE = {'opt_level': '3', 'lto': 'thin', 'codegen_units': '1',
           'overflow_checks': 'true', 'debug': 'false', 'strip': 'debuginfo',
           'panic': 'unwind', 'incremental': 'false'}
SOURCE_PATHS = ('walt/walt/src', 'walt/gym/queries', 'walt/gym/offer-count.scheme',
                'walt/walt-player/src', 'walt/Cargo.toml', 'walt/Cargo.lock',
                'walt/walt/Cargo.toml', 'walt/walt-player/Cargo.toml',
                'walt/rust-toolchain.toml')


def source_identity(source):
    dirty = subprocess.check_output(
        ['git', 'status', '--porcelain', '--untracked-files=all', '--', 'walt'],
        cwd=source, text=True)
    if dirty:
        raise RuntimeError('Commit or set aside source changes under walt before importing.')
    commit = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=source, text=True).strip()
    files = []
    for name in SOURCE_PATHS:
        path = source / name
        if not path.exists():
            raise RuntimeError(f'Missing source input: {name}')
        if path.is_dir():
            files.extend(p for p in path.rglob('*') if p.is_file())
        else:
            files.append(path)
    digest = hashlib.sha256()
    for path in sorted(files):
        digest.update(str(path.relative_to(source)).encode() + b'\0' + path.read_bytes() + b'\0')
    return commit, digest.hexdigest()


def build_environment(target_dir):
    env = dict(os.environ)
    for key in list(env):
        if (key in ('RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'CARGO_BUILD_RUSTFLAGS',
                    'RUSTC', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'CARGO_BUILD_TARGET',
                    'RUSTUP_TOOLCHAIN')
                or key.startswith('CARGO_PROFILE_RELEASE_')
                or key.startswith('CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_')):
            del env[key]
    env.update(CARGO_TARGET_DIR=str(target_dir), CARGO_INCREMENTAL='0',
               CARGO_ENCODED_RUSTFLAGS='')
    env.update({f'CARGO_PROFILE_RELEASE_{key.upper()}': value for key, value in PROFILE.items()})
    return env


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('research', type=Path)
    p.add_argument('--receipt', type=Path)
    a = p.parse_args()
    source = a.research.resolve()
    destination = Path(__file__).resolve().parents[1] / 'src/ai/phone'
    receipt = (a.receipt or Path(tempfile.mkdtemp(prefix='plunge-walt-')) / 'build').resolve()
    # Fail before building if this would overwrite an earlier evidence directory.
    if receipt.exists():
        p.error('Use a fresh --receipt directory.')
    identity = source_identity(source)
    # No caller target artifacts can accidentally become the release artifact.
    with tempfile.TemporaryDirectory(prefix='plunge-walt-target-') as tmp:
        env = build_environment(Path(tmp))
        cwd = source / 'walt'  # selects the repository-pinned Rust toolchain
        rustc = subprocess.check_output(['rustc', '--version'], cwd=cwd, env=env, text=True).strip()
        command = ['cargo', 'build', '--locked', '--release', '--manifest-path',
                   str(source / 'walt/Cargo.toml'), '-p', 'walt-player', '--lib',
                   '--no-default-features', '--features', ','.join(FEATURES), '--target', TARGET]
        runner = source / 'experiments/partnership/packet/texas42-partnership-launch-v0.1/tools/run_capped.py'
        subprocess.run([sys.executable, str(runner), '--seconds', '295', '--output-dir',
                        str(receipt), '--', *command], cwd=cwd, env=env, check=True)
        if source_identity(source) != identity:
            raise RuntimeError('Source changed during the build; refusing to import.')
        wasm = Path(tmp) / TARGET / 'release/walt_player.wasm'
        # Check imports and ABI before either destination file is changed.
        subprocess.run(['node', '--input-type=module', '-e', '''
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const m=new WebAssembly.Module(readFileSync(process.argv[1]));
assert.deepEqual(WebAssembly.Module.imports(m).map(x=>`${x.module}.${x.name}`).sort(),
                 ['walt_host.checkpoint','walt_host.now_us']);
const exports=new Map(WebAssembly.Module.exports(m).map(x=>[x.name,x.kind]));
for (const name of ['walt_in_prepare','walt_call','walt_out_ptr']) assert.equal(exports.get(name),'function');
assert.equal(exports.get('memory'),'memory');
''', str(wasm)], check=True)
        data = wasm.read_bytes()
    manifest = dict(player='walt-table-v2', source_repository='jasonyandell/texas-42',
                    source_commit=identity[0], source_sha256=identity[1],
                    source_hash_schema='walt-player-source-v2',
                    wasm_sha256=hashlib.sha256(data).hexdigest(), rustc=rustc,
                    build=dict(target=TARGET, default_features=False, features=FEATURES,
                               profile=PROFILE, rustflags=[], locked=True),
                    worlds=40, inner_worlds=8, budget_ms=14000, partner_ms=500,
                    auction_worlds=160, auction_budget_ms=20000,
                    opening_worlds=160, opening_budget_ms=20000, opening_partner=False)
    text = json.dumps(manifest, indent=2) + '\n'
    (receipt / 'manifest.json').write_text(text)
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'walt-player.wasm').write_bytes(data)
    (destination / 'manifest.json').write_text(text)
    print('Imported shared Walt:', manifest['wasm_sha256'])


if __name__ == '__main__':
    main()
