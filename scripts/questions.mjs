#!/usr/bin/env node
/** Private research inbox, authenticated by Wrangler. No public admin endpoint. */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const args=process.argv.slice(2),local=args.includes('--local');
const [command,id,file]=args.filter(a=>a!=='--local');
const quote=s=>`'${s.replaceAll("'","''")}'`;
const validId=()=>{if(!/^[a-f0-9]{32}$/.test(id ?? ''))throw new Error('Supply a question id.');};
function query(sql) {
  const dir=mkdtempSync(join(tmpdir(),'plunge-questions-'));
  try {
    const path=join(dir,'query.sql');writeFileSync(path,sql,{mode:0o600});
    const run=spawnSync('npx',['--no-install','wrangler','d1','execute','QUESTIONS',local?'--local':'--remote','--file',path,'--json'],{encoding:'utf8'});
    if(run.status!==0)throw new Error(run.stderr || run.stdout || 'Question query failed.');
    return JSON.parse(run.stdout).flatMap(x=>x.results ?? []);
  } finally {rmSync(dir,{recursive:true,force:true});}
}
try {
  if(command==='list') {
    console.log(JSON.stringify(query(`SELECT id,created,json_extract(payload,'$.ply') AS ply,json_extract(payload,'$.note') AS note,COALESCE(json_extract(payload,'$.hint.kind'),'play') AS kind,
      CASE WHEN answer IS NULL THEN 'waiting' ELSE 'answered' END AS status FROM questions ORDER BY created DESC LIMIT 100;`),null,2));
  } else if(command==='get' || command==='export') {
    validId();const row=query(`SELECT payload,answer,answered_at FROM questions WHERE id=${quote(id)};`)[0];
    if(!row)throw new Error('Question not found.');
    const question=JSON.parse(row.payload);
    if(command==='get') console.log(JSON.stringify({question,answer:row.answer,answered_at:row.answered_at},null,2));
    else {
      if(!file)throw new Error('Supply an output JSON file.');
      const q=question;
      const hint=q.schema==='plunge-question-v2';
      const exported=hint ? {schema:'plunge-hint-observation-v1',question:q}
        : {v:2,hand:q.replay,ply:q.ply,seed:q.seed,note:q.note,alternative:q.alternative,receipt:q.receipt,build:q.build};
      writeFileSync(file,JSON.stringify(exported,null,2)+'\n',{flag:'wx'});
      console.log(`Exported ${id} to ${file}. ${hint ? 'Hint capture includes original advice and replay; it is not a played-move observation.' : 'A complete hand can be imported as a portable observation.'}`);
    }
  } else if(command==='reply') {
    validId();if(!file)throw new Error('Supply a plain text explanation file.');
    const answer=readFileSync(file,'utf8').trim();
    if(!answer || answer.length>20000)throw new Error('Explanation must contain 1–20,000 characters.');
    if(!query(`SELECT id FROM questions WHERE id=${quote(id)};`).length)throw new Error('Question not found.');
    query(`UPDATE questions SET answer=${quote(answer)},answered_at=${quote(new Date().toISOString())} WHERE id=${quote(id)};`);
    console.log(`Explanation attached to ${id}.`);
  } else throw new Error('Usage: npm run questions -- list|get ID|export ID FILE|reply ID FILE [--local]');
} catch(error) {console.error(error.message);process.exitCode=1;}
