import type { IdeasDatabase } from './ideas';
import { IDEA_ID, previewFor, type IdeaRelease } from '../src/ideas/model';
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const active="status IN ('queued','releasing','deploying')";
const ownerExists=`EXISTS(SELECT 1 FROM accounts a JOIN idea_members m ON m.id=a.member_id WHERE a.id=idea_releases.account_id AND a.owner=1 AND m.revoked=0)`;
const currentPreview=`EXISTS(SELECT 1 FROM ideas i WHERE i.id=idea_releases.idea_id AND i.revision=idea_releases.revision AND i.preview_revision=i.revision AND i.pr=idea_releases.pr AND i.sha=idea_releases.sha AND i.status='ready')`;
export async function currentRelease(db:IdeasDatabase,idea:string):Promise<IdeaRelease|null> {
  return db.prepare('SELECT id,revision,pr,sha,status,note FROM idea_releases WHERE idea_id=? ORDER BY updated DESC,rowid DESC LIMIT 1').bind(idea).first<IdeaRelease>();
}
export async function activeRelease(db:IdeasDatabase,idea:string) {
  return db.prepare(`SELECT id FROM idea_releases WHERE idea_id=? AND ${active}`).bind(idea).first();
}
export async function acceptIdea(db:IdeasDatabase,idea:string,account:string,data:Record<string,unknown>):Promise<Response|null> {
  if(!Number.isSafeInteger(data.revision)||!Number.isSafeInteger(data.pr)||Number(data.pr)<1||typeof data.sha!=='string'||!/^[a-f0-9]{40}$/.test(data.sha))return json({error:'Refresh the idea and review its latest preview.'},400);
  const prior=await db.prepare('SELECT status FROM idea_releases WHERE idea_id=? AND revision=? AND pr=? AND sha=?').bind(idea,data.revision,data.pr,data.sha).first<{status:string}>();
  if(prior && prior.status!=='blocked')return null; // A lost response must not publish twice.
  const card=await db.prepare("SELECT id FROM ideas WHERE id=? AND revision=? AND preview_revision=revision AND pr=? AND sha=? AND status='ready'").bind(idea,data.revision,data.pr,data.sha).first();
  if(!card)return json({error:'This preview changed or is not ready. Refresh the card and try the latest version.'},409);
  const response=await fetch(`${previewFor(Number(data.pr))}/version.json`,{cache:'no-store',signal:AbortSignal.timeout(8000)});
  const version=await response.json() as {build?:string;preview_pr?:number};
  if(!response.ok||version.build!==data.sha||version.preview_pr!==data.pr)return json({error:'This preview changed. Refresh the card before accepting it.'},409);
  const now=new Date().toISOString(),releaseId=crypto.randomUUID().replaceAll('-','');
  // The exact revision and owner are checked again in the atomic write after the network check.
  await db.prepare(`INSERT INTO idea_releases(id,idea_id,revision,pr,sha,account_id,status,note,created,updated)
    SELECT ?,id,revision,pr,sha,?,'queued','Accepted. Waiting for the release check.',?,? FROM ideas
    WHERE id=? AND revision=? AND preview_revision=revision AND pr=? AND sha=? AND status='ready'
    AND EXISTS(SELECT 1 FROM accounts a JOIN idea_members m ON m.id=a.member_id WHERE a.id=? AND a.owner=1 AND m.revoked=0)
    AND NOT EXISTS(SELECT 1 FROM idea_releases WHERE idea_id=ideas.id AND ${active})
    ON CONFLICT(idea_id,revision,pr,sha) DO UPDATE SET account_id=excluded.account_id,status='queued',note=excluded.note,lease=NULL,lease_until=NULL,updated=excluded.updated
    WHERE idea_releases.status='blocked'`)
    .bind(releaseId,account,now,now,idea,data.revision,data.pr,data.sha,account).run();
  const saved=await currentRelease(db,idea);
  return saved && saved.revision===data.revision&&saved.sha===data.sha&&saved.pr===data.pr&&['queued','releasing','deploying','shipped'].includes(saved.status) ? null : json({error:'The idea changed while you accepted it. Refresh and review it again.'},409);
}
interface ReleaseRow extends IdeaRelease {idea_id:string;account_id:string;lease:string|null;lease_until:number|null;merge_sha:string|null}
export async function releaseAdmin(db:IdeasDatabase,path:string,method:string,data:Record<string,unknown>):Promise<Response> {
  if(path==='/admin/releases'&&method==='GET')return json((await db.prepare(`SELECT id,idea_id,revision,pr,sha,status,merge_sha FROM idea_releases WHERE ${active} ORDER BY created`).all()).results);
  const match=/^\/admin\/releases\/([a-f0-9]{32})\/(claim|authorize|finish)$/.exec(path);
  if(!match||method!=='POST')return json({error:'Not found.'},404);
  const releaseId=match[1]!,action=match[2];
  if(typeof data.lease!=='string'||!IDEA_ID.test(data.lease))return json({error:'Invalid release lease.'},400);
  const now=new Date().toISOString();
  if(action==='claim') {
    // Rechecking after a crash is safe: the coordinator first asks GitHub whether this exact head already merged.
    await db.prepare(`UPDATE idea_releases SET lease=?,lease_until=?,status=CASE WHEN status='queued' THEN 'releasing' ELSE status END,
      note=CASE WHEN status='queued' THEN 'Accepted. Checking the release.' ELSE note END,updated=?
      WHERE id=? AND ${active} AND (lease IS NULL OR lease=? OR lease_until<?)`)
      .bind(data.lease,Date.now()+180000,now,releaseId,data.lease,Date.now()).run();
  }
  const row=await db.prepare(`SELECT * FROM idea_releases WHERE id=? AND lease=? AND lease_until>? AND ${active}`).bind(releaseId,data.lease,Date.now()).first<ReleaseRow>();
  if(!row)return json({error:'Release lease changed.'},409);
  if(action==='claim')return json(row);
  if(action==='authorize') {
    const valid=await db.prepare(`UPDATE idea_releases SET lease_until=? WHERE id=? AND lease=? AND lease_until>? AND ${ownerExists} AND ${currentPreview} RETURNING id`).bind(Date.now()+180000,releaseId,data.lease,Date.now()).first();
    if(!valid)return json({error:'The owner permission or accepted preview changed.'},409);
    return json({ok:true});
  }
  const status=data.status;
  if(!['queued','blocked','deploying','shipped'].includes(String(status))||typeof data.note!=='string'||data.note.length>500)return json({error:'Invalid release result.'},400);
  const mergeSha=data.mergeSha??row.merge_sha;
  if(['deploying','shipped'].includes(String(status))&&(typeof mergeSha!=='string'||!/^[a-f0-9]{40}$/.test(mergeSha)))return json({error:'Missing merge identity.'},400);
  if(status==='shipped'&&row.status!=='deploying')return json({error:'Release has not deployed yet.'},409);
  await db.batch([
    db.prepare(`UPDATE idea_releases SET status=?,note=?,merge_sha=?,lease=NULL,lease_until=NULL,updated=? WHERE id=? AND lease=?`)
      .bind(status,data.note,mergeSha??null,now,releaseId,data.lease),
    db.prepare(`UPDATE ideas SET status='shipped',preview=NULL,updated=? WHERE id=? AND revision=? AND pr=? AND sha=?
      AND EXISTS(SELECT 1 FROM idea_releases WHERE id=? AND status='shipped')`)
      .bind(now,row.idea_id,row.revision,row.pr,row.sha,releaseId),
  ]);
  return json({ok:true});
}
