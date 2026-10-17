import importlib.util
import contextlib
import io
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('setup', Path(__file__).with_name('setup-kv-token.py'))
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)
ACCOUNT = 'a' * 32
TOKEN = 'c' * 32
POLICY = {'effect': 'allow', 'resources': {f'com.cloudflare.api.account.{ACCOUNT}': '*'}, 'permission_groups': [{'id': 'kv-write'}]}


class SetupTests(unittest.TestCase):
    def fixture(self, fail_install=False, active=True):
        calls, installed = [], []
        def admin(path, method='GET', body=None):
            calls.append(('admin', path, method, body))
            if method == 'DELETE': return None
            if path == '/user/tokens': return {'id': TOKEN, 'value': 'secret-never-log'}
            if path.startswith('/accounts?'): return [{'id': ACCOUNT}]
            if path.endswith('/workers/subdomain'): return {'subdomain': 'texas42'}
            if '/d1/database/' in path: return {'uuid': setup.DATABASE, 'name': 'plunge-questions'}
            if path.endswith('/permission_groups'): return [{'id': 'kv-write', 'name': 'Workers KV Storage Write', 'scopes': ['com.cloudflare.api.account']}]
            raise AssertionError(path)
        def client(headers):
            self.assertEqual(headers, {'Authorization': 'Bearer secret-never-log'})
            def api(path, method='GET', body=None):
                calls.append(('kv', path, method, body))
                if path == '/user/tokens/verify': return {'id': TOKEN, 'status': 'active' if active else 'disabled'}
                if method == 'GET': return [{'id': 'd' * 32, 'title': 'plunge-oauth'}]
                return {'id': 'e' * 32, 'title': body['title']}
            return api
        def install(token):
            if fail_install: raise setup.SetupError('GitHub failed')
            installed.append(token)
        return admin, client, install, calls, installed

    def test_plan_verifies_worker_and_database_and_scopes_to_one_account(self):
        admin, _, _, calls, _ = self.fixture()
        self.assertEqual(setup.plan(admin), (ACCOUNT, POLICY))
        self.assertTrue(all(call[2] == 'GET' for call in calls))

    def test_token_is_verified_and_existing_oauth_storage_is_preserved(self):
        admin, client, install, calls, installed = self.fixture()
        setup.provision(admin, ACCOUNT, POLICY, install, client)
        self.assertEqual(installed, ['secret-never-log'])
        writes = [c for c in calls if c[2] == 'POST']
        self.assertEqual(writes[0][3]['policies'], [POLICY])
        self.assertEqual(writes[1][3], {'title': 'plunge-ideas-cache'})
        self.assertEqual(len(writes), 2)
        self.assertFalse(any(c[2] == 'DELETE' for c in calls))

    def test_failed_install_revokes_only_new_token_never_storage(self):
        admin, client, install, calls, installed = self.fixture(fail_install=True)
        with self.assertRaisesRegex(setup.SetupError, 'newly-created token was revoked'):
            setup.provision(admin, ACCOUNT, POLICY, install, client)
        self.assertEqual(installed, [])
        self.assertEqual([c[1] for c in calls if c[2] == 'DELETE'], ['/user/tokens/' + TOKEN])

    def test_invalid_token_never_installs_or_provisions_namespaces(self):
        admin, client, install, calls, installed = self.fixture(active=False)
        with self.assertRaises(setup.SetupError):
            setup.provision(admin, ACCOUNT, POLICY, install, client)
        self.assertEqual(installed, [])
        self.assertFalse(any('/storage/kv' in c[1] for c in calls))

    def test_secret_is_passed_to_gh_by_stdin_and_output_is_captured(self):
        with patch.object(setup.subprocess, 'run') as run:
            run.return_value.returncode = 0
            run.return_value.stdout = ''
            args = ['gh', 'secret', 'set', setup.SECRET, '--repo', setup.REPO]
            setup.run(args, value='secret-never-log')
            self.assertNotIn('secret-never-log', run.call_args.args[0])
            self.assertEqual(run.call_args.kwargs['input'], 'secret-never-log')
            self.assertTrue(run.call_args.kwargs['capture_output'])

    def test_keychain_denial_does_not_create_an_api_client_or_echo_error(self):
        with patch.object(setup, 'run', side_effect=['"acct"<blob>="test@example.com"', setup.SetupError('sensitive diagnostic')]), patch.object(setup, 'Cloudflare') as client:
            with self.assertRaisesRegex(setup.SetupError, 'Keychain refused access') as error:
                setup.keychain_admin('test')
            self.assertNotIn('sensitive', str(error.exception))
            client.assert_not_called()

    def test_companion_profile_is_enabled_only_after_successful_setup_and_only_when_requested(self):
        for deploy, fail in [(True, False), (True, True), (False, False)]:
            with self.subTest(deploy=deploy, fail=fail):
                events = []
                def run(args, value=None):
                    if args[1:3] == ['secret', 'list']: return '[]'
                    if args[1] == 'api' and '/contents/' in args[2]:
                        return setup.SECRET + ' scripts/prepare-kv.mjs PLUNGE_DEPLOY_PROFILE'
                    if args[1:3] == ['secret', 'set']: events.append('installed')
                    if args[1:3] == ['variable', 'set']:
                        self.assertEqual(args[3:6], ['PLUNGE_DEPLOY_PROFILE', '--body', 'companions'])
                        events.append('enabled')
                    if args[1:3] == ['workflow', 'run']: events.append('deployed')
                    return ''
                def provision(_admin, _account, _policy, install):
                    if fail: raise setup.SetupError('verification failed')
                    events.append('verified')
                    install('secret-never-log')
                    events.append('setup-complete')
                argv = ['setup-kv-token.py', '--apply'] + (['--deploy'] if deploy else [])
                with patch.object(setup.sys, 'argv', argv), patch.object(setup, 'run', side_effect=run), \
                     patch.object(setup, 'keychain_admin'), patch.object(setup, 'plan', return_value=(ACCOUNT, POLICY)), \
                     patch.object(setup, 'provision', side_effect=provision), contextlib.redirect_stdout(io.StringIO()):
                    if fail:
                        with self.assertRaises(setup.SetupError): setup.main()
                        self.assertEqual(events, [])
                    else:
                        setup.main()
                        self.assertEqual(events, ['verified', 'installed', 'setup-complete'] + (['enabled', 'deployed'] if deploy else []))


if __name__ == '__main__':
    unittest.main()
