import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { productionProfile } from './production-profile.mjs';
const config = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
const namespace = binding => `[[kv_namespaces]]\nbinding = "${binding}"\nid = "${'0'.repeat(32)}"\n\n`;

test('core release preserves the authenticated entrypoint, database and room bindings without OAuth KV', () => {
  const core = productionProfile(config, 'core');
  assert.match(core, /main = "worker\/mcp-entry.ts"/);
  assert.match(core, /binding = "QUESTIONS"/);
  assert.match(core, /class_name = "PlungeRoom"/);
  assert.match(core, /new_sqlite_classes = \["PlungeRoom"\]/);
  assert.doesNotMatch(core, /\[\[kv_namespaces\]\]/);
});
test('core omits both configured KV bindings while preserving unrelated KV', () => {
  const extra = config + namespace('UNRELATED');
  const core = productionProfile(extra, 'core');
  assert.doesNotMatch(core, /binding = "(?:OAUTH_KV|IDEAS_CACHE)"/);
  assert.ok(core.endsWith(namespace('UNRELATED')));
});
test('companion profile keeps the entire configuration and rejects unknown or drifting core configuration', () => {
  assert.equal(productionProfile(config, 'companions'), config);
  assert.throws(() => productionProfile(config, 'automatic'), /must be/);
  assert.throws(() => productionProfile(config, undefined), /must be/);
  assert.throws(() => productionProfile('main = "worker/index.ts"', 'core'), /exactly one/);
  assert.throws(() => productionProfile(config + namespace('OAUTH_KV'), 'core'), /exactly one/);
});
test('deployment explicitly chooses a profile and requires provisioning for companion releases', () => {
  const workflow = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  assert.match(workflow, /PLUNGE_DEPLOY_PROFILE: \$\{\{ vars\.PLUNGE_DEPLOY_PROFILE \|\| 'core' \}\}/);
  const select = workflow.indexOf('run: node scripts/production-profile.mjs');
  const provision = workflow.indexOf('      - name: Prepare OAuth and ideas KV');
  const deploy = workflow.indexOf('      - name: Prepare question database and deploy');
  assert.ok(select > 0 && select < provision && provision < deploy);
  const kvStep = workflow.slice(provision, deploy);
  assert.match(kvStep, /if: env.PLUNGE_DEPLOY_PROFILE == 'companions'/);
  assert.match(kvStep, /run: node scripts\/prepare-kv\.mjs/);
  assert.doesNotMatch(kvStep, /continue-on-error|\|\|/);
  assert.equal(workflow.match(/run: node scripts\/prepare-kv\.mjs/g)?.length, 1);
});
test('profile CLI prepares core without credentials and accurately marks both release profiles', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'plunge-profile-'));
  try {
    mkdirSync(join(cwd, 'dist'));
    for (const profile of ['core', 'companions']) {
      writeFileSync(join(cwd, 'wrangler.toml'), config);
      writeFileSync(join(cwd, 'dist/version.json'), JSON.stringify({build:'test-sha'}));
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./production-profile.mjs', import.meta.url))],
        {cwd, env:{PLUNGE_DEPLOY_PROFILE:profile}, encoding:'utf8'});
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'dist/version.json'), 'utf8')),
        {build:'test-sha', companions:profile === 'companions'});
      const written = readFileSync(join(cwd, 'wrangler.toml'), 'utf8');
      if (profile === 'core') assert.doesNotMatch(written, /\[\[kv_namespaces\]\]/);
      else assert.equal(written, config);
    }
  } finally { rmSync(cwd, {recursive:true, force:true}); }
});
