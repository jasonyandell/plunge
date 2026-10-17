#!/usr/bin/env python3
"""Bootstrap Plunge's KV-only GitHub secret from a local Cloudflare admin key.

Default: read-only plan. --apply creates the token and namespaces and installs
the token via gh stdin. No credential is printed, put in argv, or saved to disk.
"""
import argparse
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request

REPO = 'jasonyandell/plunge'
SECRET = 'CLOUDFLARE_KV_API_TOKEN'
DATABASE = '98730843-94b0-4507-b3c1-91fb12f0702a'
NAMESPACES = ('plunge-oauth', 'plunge-ideas-cache')


class SetupError(Exception):
    pass


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Cloudflare:
    def __init__(self, headers):
        self.headers = headers
        self.opener = urllib.request.build_opener(NoRedirect)

    def __call__(self, path, method='GET', body=None):
        request = urllib.request.Request('https://api.cloudflare.com/client/v4' + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers={**self.headers, 'Content-Type': 'application/json'}, method=method)
        try:
            with self.opener.open(request, timeout=30) as response:
                data = json.load(response)
        except urllib.error.HTTPError as error:
            # API error bodies may contain sensitive data. Print status only.
            raise SetupError(f'Cloudflare {method} {path} failed (HTTP {error.code}).') from None
        except (OSError, ValueError):
            raise SetupError(f'Cloudflare {method} {path} did not return a valid response.') from None
        if not data.get('success'):
            raise SetupError(f'Cloudflare {method} {path} was rejected.')
        return data.get('result')


def run(args, value=None):
    try:
        result = subprocess.run(args, input=value, text=True, capture_output=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        raise SetupError(f'{args[0]} did not complete; no command output was displayed.') from None
    if result.returncode:
        raise SetupError(f'{args[0]} failed (exit {result.returncode}); no command output was displayed.')
    return result.stdout


def keychain_admin(service):
    metadata = run(['security', 'find-generic-password', '-s', service])
    match = re.search(r'"acct"<blob>="([^"\r\n]+)"', metadata)
    if not match:
        raise SetupError('The Keychain item needs the Cloudflare account email as its account name.')
    email = match[1]
    try:
        key = run(['security', 'find-generic-password', '-s', service, '-a', email, '-w']).strip()
    except SetupError:
        raise SetupError('Keychain refused access. Run this script in Terminal and approve the Keychain prompt. No Cloudflare request was sent.') from None
    if not key:
        raise SetupError('The Keychain item is empty.')
    return Cloudflare({'X-Auth-Key': key, 'X-Auth-Email': email})


def list_all(api, path):
    items = []
    for page in range(1, 101):
        batch = api(f'{path}?per_page=100&page={page}')
        items.extend(batch)
        if len(batch) < 100:
            return items
    raise SetupError('Cloudflare listing exceeded the pagination limit.')


def plan(admin):
    candidates = []
    for account in list_all(admin, '/accounts'):
        account_id = account['id']
        if not re.fullmatch('[a-f0-9]{32}', account_id):
            raise SetupError('Unexpected Cloudflare account identifier.')
        if admin(f'/accounts/{account_id}/workers/subdomain').get('subdomain') == 'texas42':
            database = admin(f'/accounts/{account_id}/d1/database/{DATABASE}')
            if database.get('uuid') != DATABASE or database.get('name') != 'plunge-questions':
                raise SetupError('The production database identity did not match.')
            candidates.append(account_id)
    if len(candidates) != 1:
        raise SetupError('Could not identify exactly one account containing Plunge and its production database.')
    groups = admin('/user/tokens/permission_groups')
    matches = [g for g in groups if g.get('name') == 'Workers KV Storage Write'
        and 'com.cloudflare.api.account' in g.get('scopes', [])]
    if len(matches) != 1:
        raise SetupError('Could not resolve the account-scoped Workers KV Storage Write permission.')
    account_id = candidates[0]
    policy = {'effect': 'allow', 'resources': {f'com.cloudflare.api.account.{account_id}': '*'},
        'permission_groups': [{'id': matches[0]['id']}]}
    return account_id, policy


def provision(admin, account_id, policy, install, make_client=Cloudflare):
    # The token has KV write access on this account only; no token-creation,
    # DNS, D1, or Worker deployment authority is granted.
    created = admin('/user/tokens', 'POST', {'name': 'plunge-kv-github', 'policies': [policy]})
    token_id, token = created.get('id'), created.get('value')
    if not isinstance(token_id, str) or not re.fullmatch('[a-f0-9]{32}', token_id):
        raise SetupError('Token creation returned an unexpected identifier. Inspect Cloudflare before retrying.')
    try:
        if not isinstance(token, str) or not token:
            raise SetupError('Token creation did not return a usable secret.')
        kv = make_client({'Authorization': f'Bearer {token}'})
        verified = kv('/user/tokens/verify')
        if verified.get('status') != 'active' or verified.get('id') != token_id:
            raise SetupError('The new KV token did not verify.')
        path = f'/accounts/{account_id}/storage/kv/namespaces'
        existing = list_all(kv, path)
        ids = set()
        for title in NAMESPACES:
            matches = [n for n in existing if n.get('title') == title]
            if len(matches) > 1:
                raise SetupError('Ambiguous KV namespace; existing storage was preserved.')
            namespace = matches[0] if matches else kv(path, 'POST', {'title': title})
            if namespace.get('title') != title or not re.fullmatch('[a-f0-9]{32}', namespace.get('id', '')) or namespace['id'] in ids:
                raise SetupError('Unexpected or shared KV namespace identity.')
            ids.add(namespace['id'])
        install(token)
    except Exception as error:
        # Only this newly-created token is revoked. Never delete storage or old tokens.
        try:
            admin(f'/user/tokens/{token_id}', 'DELETE')
        except Exception:
            raise SetupError(f'Setup failed and new token {token_id} could not be revoked. Inspect it in Cloudflare before retrying.') from None
        reason = str(error) if isinstance(error, SetupError) else 'Unexpected setup error.'
        raise SetupError(f'{reason} Setup failed; the newly-created token was revoked. Existing namespaces and deployment credentials were preserved.') from None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true', help='Create KV namespaces and install their scoped GitHub token')
    parser.add_argument('--deploy', action='store_true', help='After verified setup, enable companions and dispatch production deployment')
    parser.add_argument('--keychain-service', default='cloudflare-global-key')
    args = parser.parse_args()
    if args.deploy and not args.apply:
        parser.error('--deploy requires --apply')
    run(['gh', 'auth', 'status', '--active'])
    run(['gh', 'api', f'repos/{REPO}/actions/secrets/public-key'])
    secrets = json.loads(run(['gh', 'secret', 'list', '--repo', REPO, '--json', 'name']))
    if any(s['name'] == SECRET for s in secrets):
        raise SetupError(f'{SECRET} already exists. No credential was replaced; inspect it before rotating.')
    if args.deploy:
        # Do not queue a release that cannot use the new binding/secret yet.
        workflow = run(['gh', 'api', f'repos/{REPO}/contents/.github/workflows/deploy.yml?ref=main',
            '--header', 'Accept: application/vnd.github.raw+json'])
        if SECRET not in workflow or 'scripts/prepare-kv.mjs' not in workflow or 'PLUNGE_DEPLOY_PROFILE' not in workflow:
            raise SetupError('Merge the KV setup change before deploying.')
    admin = keychain_admin(args.keychain_service)
    account_id, policy = plan(admin)
    print('Verified Plunge account and database. Planned: KV write on that account only; two separate namespaces.')
    if not args.apply:
        print('Read-only check complete. Use --apply to create the token and install the GitHub secret.')
        return
    provision(admin, account_id, policy,
        lambda token: run(['gh', 'secret', 'set', SECRET, '--repo', REPO], value=token))
    print('Both KV namespaces are ready. The scoped token is installed in GitHub; no secret was displayed or saved locally.')
    if args.deploy:
        run(['gh', 'variable', 'set', 'PLUNGE_DEPLOY_PROFILE', '--body', 'companions', '--repo', REPO])
        run(['gh', 'workflow', 'run', 'deploy.yml', '--repo', REPO, '--ref', 'main'])
        print('Companion profile enabled and production deployment requested. Check GitHub Actions for the result.')


if __name__ == '__main__':
    try:
        main()
    except SetupError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print('Setup stopped unexpectedly. No exception details were displayed to protect credentials.', file=sys.stderr)
        sys.exit(1)
