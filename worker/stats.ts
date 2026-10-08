/**
 * Finished hands, one shape for solo play and family rooms.
 *
 * A signed-in device uploads its local hands log; a room records its own
 * finished hands (worker/rooms.ts). Both land through `handStatements`: one
 * `hands` row per hand with the facts read from its replay, and one
 * `hand_players` row per seat. First write wins per hand, nothing here ever
 * overwrites, and a repeated upload is acknowledged, never duplicated. The
 * database is the merged view; reading it back is the leaderboard's job.
 */
import { DEVICE_ID, MAX_UPLOAD_BYTES, UPLOAD_BATCH, handSummary, validHandRecord } from '../src/history/hand-record';
import type { HandRecord } from '../src/history/legacy';
import { accountSession, type AccountEnv } from './accounts';
import type { IdeasDatabase } from './ideas';
export interface SeatPlayer {kind:'human'|'walt';account?:string|null;device?:string|null;name?:string|null;player?:string|null}
export interface HandEntry {record:HandRecord;source:'solo'|'room';roomId?:string|null;players:readonly [SeatPlayer,SeatPlayer,SeatPlayer,SeatPlayer]}
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function body(request:Request):Promise<Record<string,unknown>> {
  const reader=request.body?.getReader();const decoder=new TextDecoder();let text='',size=0;
  if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>MAX_UPLOAD_BYTES){await reader.cancel();throw new SyntaxError('Upload is too large.');}text+=decoder.decode(part.value,{stream:true});}
  const data:unknown=JSON.parse(text+decoder.decode()||'{}');
  if(!data||typeof data!=='object'||Array.isArray(data))throw new SyntaxError('Invalid upload.');
  return data as Record<string,unknown>;
}
/** The stored id: a device's hands are its own, a room's hands are the room's. */
export const handId=(entry:Pick<HandEntry,'record'|'source'|'roomId'|'players'>)=>entry.source==='room'?`room:${entry.roomId}:${entry.record.id}`:`${entry.players[0].device}:${entry.record.id}`;
/** Insert statements for finished hands; `INSERT OR IGNORE` keeps the first write of each. */
export function handStatements(db:IdeasDatabase,entries:readonly HandEntry[],now=new Date().toISOString()) {
  const statements=[];
  for(const entry of entries) {
    const {record,game}=validHandRecord(entry.record),facts=handSummary(record,game),id=handId(entry);
    statements.push(db.prepare(`INSERT OR IGNORE INTO hands(id,source,game_id,hand_number,room_id,deal,code,ended_at,received,game_over,thrown_in,practice,
      bidder,bid,contract,declaration,result_team,result_marks,team0_points,team1_points,team0_tricks,team1_tricks,
      marks_before_0,marks_before_1,marks_after_0,marks_after_1,payload) VALUES(${Array(27).fill('?').join(',')})`)
      .bind(id,entry.source,record.gameId,record.handNumber,entry.roomId??null,facts.deal,record.code,record.endedAt,now,record.gameOver?1:0,record.thrownIn?1:0,record.practiceHands?1:0,
        facts.bidder,facts.bid,facts.contract,facts.declaration,facts.resultTeam,facts.resultMarks,facts.points[0],facts.points[1],facts.tricks[0],facts.tricks[1],
        record.marksBefore[0],record.marksBefore[1],record.marksAfter[0],record.marksAfter[1],JSON.stringify(record)));
    entry.players.forEach((p,seat)=>statements.push(db.prepare('INSERT OR IGNORE INTO hand_players(hand_id,seat,kind,account_id,device_id,name,player) VALUES(?,?,?,?,?,?,?)')
      .bind(id,seat,p.kind,p.account??null,p.device??null,p.name??null,p.player??null)));
  }
  return statements;
}
export async function statsRequest(request:Request,env:AccountEnv):Promise<Response> {
  const url=new URL(request.url),path=url.pathname.slice('/api/stats'.length),db:IdeasDatabase|undefined=env.QUESTIONS;
  if(!db)return path===''&&request.method==='GET'?json({available:false,account:null}):json({error:'This preview keeps stats on your device only.',local_only:true},503);
  try {
    const account=await accountSession(request,env);
    if(path===''&&request.method==='GET') {
      if(!account)return json({available:true,account:null});
      const totals=await db.prepare('SELECT COUNT(DISTINCT hand_id) hands, COUNT(DISTINCT device_id) devices FROM hand_players WHERE account_id=?').bind(account.id).first<{hands:number;devices:number}>();
      return json({available:true,account:{id:account.id,name:account.name},hands:totals?.hands??0,devices:totals?.devices??0});
    }
    if(!account)return json({error:'Sign in to connect your stats.'},401);
    if(path==='/hands'&&request.method==='PUT') {
      if(request.headers.get('Origin')!==url.origin)return json({error:'Please use the Plunge app.'},403);
      const data=await body(request);
      if(typeof data.device!=='string'||!DEVICE_ID.test(data.device))return json({error:'Invalid device.'},400);
      if(!Array.isArray(data.hands)||data.hands.length>UPLOAD_BATCH)return json({error:`Send up to ${UPLOAD_BATCH} hands at a time.`},400);
      const device=data.device,entries:HandEntry[]=[],rejected:{id:string;error:string}[]=[];
      for(const value of data.hands) {
        const id=value&&typeof value==='object'&&typeof (value as {id:unknown}).id==='string'?(value as {id:string}).id.slice(0,90):'';
        try {
          const {record}=validHandRecord(value);
          // Solo play: the human at seat 0, this device's Walt in the other three.
          const walt:SeatPlayer={kind:'walt',player:record.player};
          entries.push({record,source:'solo',players:[{kind:'human',account:account.id,device},walt,walt,walt]});
        } catch(error) {rejected.push({id,error:error instanceof Error?error.message:'Invalid hand record.'});}
      }
      if(entries.length)await db.batch(handStatements(db,entries));
      // Acknowledge only hands now connected to this account, whether this upload or an earlier one wrote them.
      // A hand another account connected first stays with that account. (D1 binds at most 100 variables per statement.)
      const owners=new Map<string,string|null>();
      for(let i=0;i<entries.length;i+=90) {
        const chunk=entries.slice(i,i+90).map(handId);
        for(const row of (await db.prepare(`SELECT hand_id,account_id FROM hand_players WHERE seat=0 AND hand_id IN (${chunk.map(()=>'?').join(',')})`).bind(...chunk).all<{hand_id:string;account_id:string|null}>()).results)owners.set(row.hand_id,row.account_id);
      }
      const stored:string[]=[];
      for(const entry of entries) {
        const owner=owners.get(handId(entry));
        if(owner===account.id)stored.push(entry.record.id);
        else if(owner)rejected.push({id:entry.record.id,error:'This hand is already connected to another account.'});
      }
      return json({account:account.id,stored,rejected});
    }
    return json({error:'Not found.'},404);
  } catch(error) {return error instanceof SyntaxError?json({error:error.message||'Invalid stats request.'},400):json({error:'Stats are temporarily unavailable. Your device keeps them and can retry.'},503);}
}
