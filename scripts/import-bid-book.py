#!/usr/bin/env python3
"""Install an audited actual-play export; no campaign or model-survey access."""
import argparse,hashlib,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('book',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
b=json.loads(a.book.read_text());identity=b.pop('id');canonical=lambda v:json.dumps(v,sort_keys=True,separators=(',',':'))
assert hashlib.sha256(canonical(b).encode()).hexdigest()==identity,'Book identity mismatch'
assert b['schema']=='kiln-played-book-v1' and b['complete'] is True
assert b['manifest']['play_bid']==30 and b['manifest']['recommendation']==[4,5]
assert b['manifest']['profile']=='walt-table-v2-opening160-ordinary40-partner-bid30-v1'
rows={}
for x in b['panels']:
 n=x['games'];h=x['histogram'];tails=[sum(h[t:]) for t in range(30,43)]
 assert len(h)==43 and n==sum(h) and n>=8 and all(type(v) is int and v>=0 for v in h)
 assert tails==x['tails30_42']
 bid=max((i+30 for i,k in enumerate(tails) if 5*k>=4*n),default=None);assert bid==x['recommended_bid']
 key=x['hand_id'];r=rows.setdefault(key,{'seed':x['deal_seed'],'seat':x['seat'],'hand':x['hand'],'panels':[]})
 assert r['hand']==x['hand'] and r['seat']==x['seat'] and r['seed']==x['deal_seed']
 r['panels'].append({'decl':x['decl'],'games':n,'tails':tails,'allocation':x['allocation_state'],'uncertain':x['uncertain_thresholds'],'audit':x['audited']})
for r in rows.values():
 r['panels'].sort(key=lambda p:p['decl']);assert [x['decl'] for x in r['panels']]==[0,1,2,3,4,5,6,7,9]
assert len(rows)==b['manifest']['hands'];seeds=sorted({r['seed'] for r in rows.values()})
assert all(sorted(r['seat'] for r in rows.values() if r['seed']==s)==list(range(4)) for s in seeds)
out={'schema':'plunge-played-bids-v1','source_book':identity,'profile':b['manifest']['profile'],'policy_bid':30,'threshold':[4,5],
 'games':sum(x['games'] for x in b['panels']),'seeds':seeds,'hands':list(rows.values())}
a.output.parent.mkdir(parents=True,exist_ok=True);a.output.write_text(canonical(out)+'\n');print(json.dumps({'book':identity,'hands':len(rows),'games':out['games'],'bytes':a.output.stat().st_size}))
