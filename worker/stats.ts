/**
 * Finished-hand stats connected to an account. A signed-in device uploads its
 * local hands log; every device of the account reads the merged log back.
 * First write wins per (account, device, hand): nothing here ever overwrites,
 * and a repeated upload is acknowledged, never duplicated.
 */
import { DEVICE_ID, MAX_UPLOAD_BYTES, UPLOAD_BATCH, validHandRecord } from '../src/history/hand-record';
import type { HandRecord } from '../src/history/legacy';
import { accountSession, type AccountEnv } from './accounts';
import type { IdeasDatabase } from './ideas';
interface Row {device_id:string;hand_id:string;payload:string;received:string}
export interface RemoteHand {device:string;record:HandRecord;received:string}
const PAGE=200;
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function body(request:Request):Promise<Record<string,unknown>> {
  const reader=request.body?.getReader();const decoder=new TextDecoder();let text='',size=0;
  if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>MAX_UPLOAD_BYTES){await reader.cancel();throw new SyntaxError('Upload is too large.');}text+=decoder.decode(part.value,{stream:true});}
  const data:unknown=JSON.parse(text+decoder.decode()||'{}');
  if(!data||typeof data!=='object'||Array.isArray(data))throw new SyntaxError('Invalid upload.');
  return data as Record<string,unknown>;
}
const remote=(r:Row):RemoteHand=>({device:r.device_id,record:JSON.parse(r.payload) as HandRecord,received:r.received});
/** Opaque page cursor: the last row's (received, device, hand) in order. */
const cursor=(r:Row)=>`${r.received}|${r.device_id}|${r.hand_id}`;
function parseCursor(value:string|null):[string,string,string]|null|undefined {
  if(value===null)return null;
  const parts=value.split('|');
  if(parts.length!==3||!DEVICE_ID.test(parts[1]!)||parts[0]!.length>40||parts[2]!.length>90)return undefined;
  return parts as [string,string,string];
}
export async function statsRequest(request:Request,env:AccountEnv):Promise<Response> {
  const url=new URL(request.url),path=url.pathname.slice('/api/stats'.length),db:IdeasDatabase|undefined=env.QUESTIONS;
  if(!db)return path===''&&request.method==='GET'?json({available:false,account:null}):json({error:'This preview keeps stats on your device only.',local_only:true},503);
  try {
    const account=await accountSession(request,env);
    if(path===''&&request.method==='GET') {
      if(!account)return json({available:true,account:null});
      const totals=await db.prepare('SELECT COUNT(*) hands, COUNT(DISTINCT device_id) devices FROM account_hands WHERE account_id=?').bind(account.id).first<{hands:number;devices:number}>();
      return json({available:true,account:{id:account.id,name:account.name},hands:totals?.hands??0,devices:totals?.devices??0});
    }
    if(!account)return json({error:'Sign in to connect your stats.'},401);
    if(path==='/hands'&&request.method==='GET') {
      const after=parseCursor(url.searchParams.get('after'));
      if(after===undefined)return json({error:'Invalid page.'},400);
      const {results}=await (after
        ? db.prepare(`SELECT device_id,hand_id,payload,received FROM account_hands WHERE account_id=? AND (received,device_id,hand_id)>(?,?,?)
            ORDER BY received,device_id,hand_id LIMIT ${PAGE+1}`).bind(account.id,...after)
        : db.prepare(`SELECT device_id,hand_id,payload,received FROM account_hands WHERE account_id=? ORDER BY received,device_id,hand_id LIMIT ${PAGE+1}`).bind(account.id)
      ).all<Row>();
      const page=results.slice(0,PAGE);
      return json({items:page.map(remote),next:results.length>PAGE?cursor(page[PAGE-1]!):null});
    }
    if(path==='/hands'&&request.method==='PUT') {
      if(request.headers.get('Origin')!==url.origin)return json({error:'Please use the Plunge app.'},403);
      const data=await body(request);
      if(typeof data.device!=='string'||!DEVICE_ID.test(data.device))return json({error:'Invalid device.'},400);
      if(!Array.isArray(data.hands)||data.hands.length>UPLOAD_BATCH)return json({error:`Send up to ${UPLOAD_BATCH} hands at a time.`},400);
      const now=new Date().toISOString(),stored:string[]=[],rejected:{id:string;error:string}[]=[],statements=[];
      for(const value of data.hands) {
        const id=value&&typeof value==='object'&&typeof (value as {id:unknown}).id==='string'?(value as {id:string}).id.slice(0,90):'';
        try {
          const record=validHandRecord(value);
          statements.push(db.prepare(`INSERT OR IGNORE INTO account_hands(account_id,device_id,hand_id,game_id,hand_number,ended_at,game_over,thrown_in,player,payload,received)
            VALUES(?,?,?,?,?,?,?,?,?,?,?)`).bind(account.id,data.device,record.id,record.gameId,record.handNumber,record.endedAt,record.gameOver?1:0,record.thrownIn?1:0,record.player,JSON.stringify(record),now));
          stored.push(record.id);
        } catch(error) {rejected.push({id,error:error instanceof Error?error.message:'Invalid hand record.'});}
      }
      if(statements.length)await db.batch(statements);
      // Acknowledge only ids now present for this device, whether this upload or an earlier one wrote them.
      // (D1 binds at most 100 variables per statement.)
      const present=new Set<string>();
      for(let i=0;i<stored.length;i+=90) {
        const chunk=stored.slice(i,i+90);
        for(const row of (await db.prepare(`SELECT hand_id FROM account_hands WHERE account_id=? AND device_id=? AND hand_id IN (${chunk.map(()=>'?').join(',')})`)
          .bind(account.id,data.device,...chunk).all<{hand_id:string}>()).results)present.add(row.hand_id);
      }
      return json({stored:stored.filter(id=>present.has(id)),rejected});
    }
    return json({error:'Not found.'},404);
  } catch(error) {return error instanceof SyntaxError?json({error:error.message||'Invalid stats request.'},400):json({error:'Stats are temporarily unavailable. Your device keeps them and can retry.'},503);}
}
