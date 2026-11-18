/** Share a hand-built change with the family in one step: push this branch, open (or reuse)
 * its PR, put it on the Ideas board, and print the one link to try it inside the real app.
 *
 *   npm run share -- --title "A cleaner front page" --body "What changed, in family words" [--note TEXT] [--wait]
 *
 * Run again after more commits: it pushes, finds the existing card, and prints the same link.
 * --wait follows the PR's checks, then waits for the card to turn ready to try. */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { loadConfig, service } from './ideas/builder.mjs';

const REPO = 'jasonyandell/plunge';
const sh = (command, args, inherit = false) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', inherit ? 'inherit' : 'pipe', 'inherit'] })?.trim() ?? '';
const options = {}, argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const flag = /^--(title|body|note|wait)$/.exec(argv[i]);
  if (!flag) throw new Error(`Unknown argument ${argv[i]}. Use --title TEXT --body TEXT [--note TEXT] [--wait].`);
  options[flag[1]] = flag[1] === 'wait' ? true : argv[++i];
}

const branch = sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
if (branch === 'main' || branch === 'HEAD') throw new Error('Share from a feature branch, not main.');
if (sh('git', ['status', '--porcelain', '--untracked-files=no'])) throw new Error('Commit your changes first; share pushes what is committed.');
sh('git', ['push', '-u', 'origin', branch], true);

const open = (() => {
  try { const pr = JSON.parse(sh('gh', ['pr', 'view', branch, '--repo', REPO, '--json', 'number,state'])); return pr.state === 'OPEN' ? pr.number : null; }
  catch { return null; }
})();
const pr = open ?? Number(/\/pull\/(\d+)/.exec(sh('gh', ['pr', 'create', '--repo', REPO, '--base', 'main', '--head', branch, '--fill']))?.[1]);
if (!pr) throw new Error('Could not open a pull request for this branch.');

const config = await loadConfig();
let card = (await service(config, 'cards')).find(c => c.pr === pr);
if (!card) {
  if (!options.title || !options.body) throw new Error(`PR #${pr} has no idea card yet; pass --title and --body in family words.`);
  const sha = sh('git', ['rev-parse', 'HEAD']);
  const result = await service(config, 'adopt', { pr, sha, newId: randomBytes(16).toString('hex'), title: options.title, body: options.body,
    ...(options.note ? { message: options.note } : {}) });
  card = { id: result.id, status: 'building' };
}
const link = `${config.origin}/?ideas=1#idea=${card.id}`;

if (options.wait) {
  try { sh('gh', ['pr', 'checks', String(pr), '--repo', REPO, '--watch'], true); }
  catch { console.error(`\nPR #${pr} has a failing check. The card won't be ready to try until it passes.`); process.exit(1); }
  for (const end = Date.now() + 600000; card.status !== 'ready' && Date.now() < end;) {
    await new Promise(r => setTimeout(r, 15000));
    card = (await service(config, 'cards')).find(c => c.id === card.id) ?? card;
  }
}

console.log(`\nTry it:  ${link}&try=1`);
console.log(`Card:    ${link}  (${card.status})`);
console.log(`PR:      https://github.com/${REPO}/pull/${pr}`);
