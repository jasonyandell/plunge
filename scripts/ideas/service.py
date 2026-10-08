#!/usr/bin/env python3
"""Manage the ordinary-code macOS scheduler for the family idea coordinator."""
import argparse
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys

LABEL = 'dev.plunge.family-ideas'
PLIST = Path.home() / 'Library/LaunchAgents' / f'{LABEL}.plist'
TARGET = f'gui/{os.getuid()}/{LABEL}'
DOMAIN = f'gui/{os.getuid()}'


def launch(*args):
    return subprocess.run(['launchctl', *args], text=True, capture_output=True)


def require(result):
    if result.returncode:
        raise SystemExit(result.stderr.strip() or 'launchctl failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['install', 'start', 'status', 'stop'])
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    if sys.platform != 'darwin':
        raise SystemExit('This helper manages macOS LaunchAgents only.')
    loaded = launch('print', TARGET)
    if args.action == 'status':
        if loaded.returncode:
            print('Worker scheduler is not loaded.')
            return
        for line in loaded.stdout.splitlines():
            if any(line.strip().startswith(key) for key in ['state =', 'pid =', 'runs =', 'last exit code =', 'run interval =']):
                print(line.strip())
        print('An idle job normally says "not running" between checks. No LLM is used for those checks.')
        return
    if args.action == 'stop':
        if loaded.returncode == 0:
            require(launch('bootout', TARGET))
        print('Scheduler stopped. Active work may have been interrupted; archives are retained.')
        return
    if args.action == 'install':
        if loaded.returncode == 0:
            raise SystemExit('Scheduler is loaded. Stop it before changing its configuration; inspect active work first.')
        repo = args.repo.resolve()
        builder = repo / 'scripts/ideas/builder.mjs'
        if not builder.is_file():
            raise SystemExit('The checkout does not contain the family coordinator.')
        tools = {name: shutil.which(name) for name in ['node', 'codex', 'gh', 'git', 'npm']}
        missing = [name for name, path in tools.items() if not path]
        if missing:
            raise SystemExit('Missing executables: ' + ', '.join(missing))
        state = Path.home() / '.local/share/plunge-ideas'
        state.mkdir(parents=True, exist_ok=True, mode=0o700)
        logs = [state / 'listener.log', state / 'listener-errors.log']
        for path in logs:
            path.touch(mode=0o600, exist_ok=True)
            path.chmod(0o600)
        paths = list(dict.fromkeys(str(Path(path).parent) for path in tools.values()))
        environment = {'HOME': str(Path.home()), 'PATH': ':'.join(paths + ['/usr/bin', '/bin', '/usr/sbin', '/sbin']), 'CI': '1'}
        if os.environ.get('CODEX_HOME'):
            environment['CODEX_HOME'] = os.environ['CODEX_HOME']
        job = {'Label': LABEL, 'ProgramArguments': [tools['node'], str(builder)],
               'WorkingDirectory': str(repo), 'EnvironmentVariables': environment,
               'StartInterval': 15, 'RunAtLoad': True, 'ProcessType': 'Background',
               'ExitTimeOut': 15, 'Umask': 0o077,
               'StandardOutPath': str(logs[0]), 'StandardErrorPath': str(logs[1])}
        PLIST.parent.mkdir(parents=True, exist_ok=True)
        temporary = PLIST.with_suffix('.plist.tmp')
        with temporary.open('xb') as file:
            os.chmod(temporary, 0o600)
            plistlib.dump(job, file)
        temporary.replace(PLIST)
        print(f'Installed {PLIST}; use start to load it. It will also load at future logins.')
        return
    if not PLIST.is_file():
        raise SystemExit('Install the scheduler first.')
    if loaded.returncode:
        require(launch('bootstrap', DOMAIN, str(PLIST)))
    else:
        # No -k: starting an already active job must not kill a build.
        require(launch('kickstart', TARGET))
    print('Scheduler enabled; ordinary checks every 15 seconds while awake and logged in.')


if __name__ == '__main__':
    main()
