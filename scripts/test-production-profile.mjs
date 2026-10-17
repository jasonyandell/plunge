import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
test('core omits future companion and ideas-cache bindings while preserving unrelated KV', () => {
  const extra = config + namespace('IDEAS_CACHE') + namespace('UNRELATED');
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
  assert.match(workflow, /node scripts\/production-profile\.mjs/);
  assert.match(workflow, /if \[ "\$PLUNGE_DEPLOY_PROFILE" = companions \]; then\s+node scripts\/prepare-mcp\.mjs\s+fi/);
});
