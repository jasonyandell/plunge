#!/usr/bin/env python3
"""Build the shared player from a research checkout and import a matched asset.

Usage: python3 scripts/update-walt.py /path/to/texas-42 [--receipt /fresh/path]
The external watchdog bounds the build. Commit the asset and manifest together.
"""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

p=argparse.ArgumentParser(description=__doc__)
p.add_argument('research',type=Path)
p.add_argument('--receipt',type=Path)
a=p.parse_args()
source=a.research.resolve()
destination=Path(__file__).resolve().parents[1]/'src/ai/phone'
receipt=a.receipt or Path(tempfile.mkdtemp(prefix='plunge-walt-'))/'build'
subprocess.run(['python3',str(source/'experiments/partnership/packet/texas42-partnership-launch-v0.1/tools/run_capped.py'),
    '--seconds','295','--output-dir',str(receipt),'--','cargo','build','--locked','--release',
    '--manifest-path',str(source/'walt/Cargo.toml'),'-p','walt-player','--lib','--no-default-features','--target','wasm32-unknown-unknown'],check=True)
files=[]
for folder in ('walt/walt/src','walt/walt/gym/queries','walt/walt-player/src'):
    files += [path for path in (source/folder).rglob('*') if path.is_file()]
files += [source/name for name in ('walt/Cargo.toml','walt/Cargo.lock','walt/walt/Cargo.toml','walt/walt-player/Cargo.toml')]
digest=hashlib.sha256()
for path in sorted(files):digest.update(str(path.relative_to(source)).encode()+b'\0'+path.read_bytes()+b'\0')
wasm=source/'walt/target/wasm32-unknown-unknown/release/walt_player.wasm'
manifest=dict(player='walt-table-v2',source_repository='jasonyandell/texas-42',
    source_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip(),
    source_sha256=digest.hexdigest(),wasm_sha256=hashlib.sha256(wasm.read_bytes()).hexdigest(),
        rustc=subprocess.check_output(['rustc','--version'],text=True).strip(),worlds=40,inner_worlds=8,budget_ms=14000,partner_ms=500,
        auction_worlds=160,auction_budget_ms=20000,opening_worlds=160,opening_budget_ms=20000,opening_partner=False)
destination.mkdir(parents=True,exist_ok=True)
shutil.copyfile(wasm,destination/'walt-player.wasm')
(destination/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print('Imported shared Walt:',manifest['wasm_sha256'])
