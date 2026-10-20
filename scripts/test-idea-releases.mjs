import {test} from 'node:test';
import assert from 'node:assert/strict';
import {releaseAccepted} from './ideas/releases.mjs';
const sha='a'.repeat(40),merge='b'.repeat(40),id='c'.repeat(32);
const checks=['test','deploy'].map(name=>({name,status:'COMPLETED',conclusion:'SUCCESS'}));
function fixture(options={}) {
 const calls=[],ghCalls=[],job={id,idea_id:'d'.repeat(32),revision:2,pr:74,sha,status:'releasing',...options.job};
 const pr={state:'OPEN',headRefOid:sha,baseRefName:'main',isCrossRepository:false,isDraft:true,mergeable:'MERGEABLE',statusCheckRollup:checks,...options.pr};
 let merged=pr.state==='MERGED',ready=false;
 return {calls,ghCalls,run:()=>releaseAccepted({
  service:async(path,data)=>{calls.push({path,data});if(path==='releases')return[job];if(path.endsWith('/claim'))return job;if(path.endsWith('/authorize')&&options.revoked)throw Error('revoked');return {ok:true};},
  gh:async args=>{ghCalls.push(args);if(args[0]==='pr'&&args[1]==='view')return JSON.stringify(merged?{...pr,state:'MERGED',mergeCommit:{oid:merge}}:ready&&options.afterReady?{...pr,...options.afterReady}:pr);if(args[1]==='ready')ready=true;if(args[1]==='merge'){merged=true;if(options.lostMergeResponse)throw Error('connection lost');}if(args[0]==='api')return JSON.stringify({status:options.descendant?'ahead':'behind'});if(args[0]==='run')return JSON.stringify(options.deployFailed?[{status:'completed',conclusion:'failure'}]:[]);return '';},
  version:async origin=>origin.includes('-pr-')?{build:options.previewSha??sha,preview_pr:74}:{build:options.live??'e'.repeat(40)},
 })};
}
const merged=f=>f.ghCalls.some(args=>args[0]==='pr'&&args[1]==='merge');
const finished=f=>f.calls.filter(c=>c.path.endsWith('/finish')).at(-1)?.data;
test('acceptance publishes exactly the approved head and waits for production',async()=>{
 const f=fixture();await f.run();assert.deepEqual(f.ghCalls.find(a=>a[1]==='merge'),['pr','merge','74','--repo','jasonyandell/plunge','--squash','--match-head-commit',sha]);assert.equal(finished(f).status,'deploying');assert.equal(finished(f).mergeSha,merge);
});
for(const [name,options,status] of [
 ['changed head',{pr:{headRefOid:'f'.repeat(40)}},'blocked'],['wrong base',{pr:{baseRefName:'other'}},'blocked'],['fork',{pr:{isCrossRepository:true}},'blocked'],
 ['closed',{pr:{state:'CLOSED'}},'blocked'],['conflicts',{pr:{mergeable:'CONFLICTING'}},'blocked'],['failed CI',{pr:{statusCheckRollup:[{conclusion:'FAILURE'}]}},'blocked'],
 ['pending CI',{pr:{statusCheckRollup:[]}},'queued'],['changed hosted preview',{previewSha:'f'.repeat(40)},'blocked'],['revoked owner',{revoked:true},'blocked']]) {
 test(`never merges ${name}`,async()=>{const f=fixture(options);await f.run();assert.equal(merged(f),false);assert.equal(finished(f).status,status);});
}
test('lost merge responses are recovered by observing the merged PR, without merging again',async()=>{
 const uncertain=fixture({lostMergeResponse:true});await uncertain.run();assert.equal(finished(uncertain),undefined);
 const retry=fixture({pr:{state:'MERGED'}});await retry.run();assert.equal(merged(retry),false);assert.equal(finished(retry).status,'deploying');
});
for(const [name,options,status] of [['old live build',{},'deploying'],['exact live build',{live:merge},'shipped'],['live descendant',{descendant:true},'shipped'],['failed deployment',{deployFailed:true},'blocked']]) {
 test(`production verification: ${name}`,async()=>{const f=fixture({...options,job:{status:'deploying'},pr:{state:'MERGED'}});await f.run();assert.equal(merged(f),false);assert.equal(finished(f).status,status);});
}

test('accepted draft previews become ready before waiting for GitHub mergeability',async()=>{
 const f=fixture({pr:{mergeable:'UNKNOWN'},afterReady:{mergeable:'MERGEABLE',isDraft:false}});await f.run();assert.equal(merged(f),true);
 const waiting=fixture({pr:{mergeable:'UNKNOWN'}});await waiting.run();assert.equal(merged(waiting),false);assert.equal(finished(waiting).status,'queued');
});
