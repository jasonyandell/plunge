/** Only the trusted coordinator consumes authenticated, exact-preview acceptances. */
import { randomBytes } from 'node:crypto';
const REPO='jasonyandell/plunge';
const liveOrigin='https://plunge.texas42.workers.dev';
export async function releaseAccepted({service,gh,version}) {
  for(const queued of await service('releases')) {
    const lease=randomBytes(16).toString('hex'), path=`releases/${queued.id}`;
    try {
      const job=await service(`${path}/claim`,{lease});
      const finish=(status,note,mergeSha)=>service(`${path}/finish`,{lease,status,note,...(mergeSha?{mergeSha}:{})});
      const block=note=>finish('blocked',note);
      let pr=JSON.parse(await gh(['pr','view',String(job.pr),'--repo',REPO,'--json','state,headRefOid,baseRefName,isCrossRepository,isDraft,mergeable,statusCheckRollup,mergeCommit']));
      if(pr.headRefOid!==job.sha || pr.baseRefName!=='main' || pr.isCrossRepository) {await block('The preview changed after acceptance. Review the latest preview before accepting again.');continue;}
      if(pr.state==='CLOSED'){await block('This preview was closed before it could be added.');continue;}
      if(pr.state!=='MERGED') {
        const checks=pr.statusCheckRollup??[];
        if(checks.some(c=>['FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED'].includes(c.conclusion))) {await block('A release check failed. The preview needs attention before it can join the game.');continue;}
        if(pr.mergeable==='CONFLICTING') {await block('This preview needs to be brought up to date with the game. Review the updated preview before accepting it again.');continue;}
        const passed=checks.some(c=>c.name==='test'&&c.conclusion==='SUCCESS') && checks.some(c=>c.name==='deploy'&&c.conclusion==='SUCCESS') && checks.every(c=>c.status==='COMPLETED'&&['SUCCESS','SKIPPED','NEUTRAL'].includes(c.conclusion));
        if(!passed){await finish('queued','Accepted. Waiting for the release checks to finish.');continue;}
        const preview=await version(`https://plunge-pr-${job.pr}.texas42.workers.dev`);
        if(preview.build!==job.sha || preview.preview_pr!==job.pr){await block('The preview changed after acceptance. Review the latest preview before accepting again.');continue;}
        // Recheck the server grant immediately before publishing. Family text is never authorization.
        try {await service(`${path}/authorize`,{lease});}catch {await block('The owner permission or accepted preview changed. Sign in and review the card again.');continue;}
        if(pr.isDraft) {
          await gh(['pr','ready',String(job.pr),'--repo',REPO]);
          pr=JSON.parse(await gh(['pr','view',String(job.pr),'--repo',REPO,'--json','headRefOid,mergeable']));
        }
        if(pr.headRefOid!==job.sha){await block('The preview changed after acceptance. Review the latest preview before accepting again.');continue;}
        if(pr.mergeable==='CONFLICTING'){await block('This preview needs to be brought up to date with the game. Review the updated preview before accepting it again.');continue;}
        if(pr.mergeable!=='MERGEABLE'){await finish('queued','Accepted. Waiting for the final release check.');continue;}
        try {await service(`${path}/authorize`,{lease});}catch {await block('The owner permission or accepted preview changed. Sign in and review the card again.');continue;}
        await gh(['pr','merge',String(job.pr),'--repo',REPO,'--squash','--match-head-commit',job.sha]);
        pr=JSON.parse(await gh(['pr','view',String(job.pr),'--repo',REPO,'--json','state,headRefOid,mergeCommit']));
        if(pr.state!=='MERGED'||pr.headRefOid!==job.sha)throw new Error('Merge outcome is not confirmed; recheck on the next poll.');
      }
      const merged=pr.mergeCommit?.oid;
      if(!/^[a-f0-9]{40}$/.test(merged??''))throw new Error('Missing confirmed merge commit.');
      if(job.status!=='deploying'){await finish('deploying','Accepted. The update is being released to everyone’s game.',merged);continue;}
      const live=await version(liveOrigin);
      let shipped=live.build===merged;
      if(!shipped && /^[a-f0-9]{40}$/.test(live.build??'')) {
        const comparison=JSON.parse(await gh(['api',`repos/${REPO}/compare/${merged}...${live.build}`]));
        shipped=['ahead','identical'].includes(comparison.status);
      }
      if(shipped)await finish('shipped','In the game. Reload Plunge to play the update.',merged);
      else {
        const runs=JSON.parse(await gh(['run','list','--repo',REPO,'--workflow','deploy.yml','--commit',merged,'--json','status,conclusion','--limit','1']));
        const failed=runs[0]?.status==='completed'&&runs[0].conclusion!=='success';
        await finish(failed?'blocked':'deploying',failed?'The change was accepted, but the release needs attention. The live game has not updated yet.':'Accepted. Waiting for the update to reach the live game.',merged);
      }
    } catch(error) {
      // Do not guess whether a timed-out merge succeeded. Lease expiry lets the next poll inspect GitHub first.
      console.error(`Idea release ${queued.id}: ${error.message}`);
    }
  }
}
