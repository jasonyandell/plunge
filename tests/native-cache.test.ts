import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';

it('the offline worker never intercepts local source or research API responses', () => {
  const source=readFileSync(new URL('../public/sw.js',import.meta.url),'utf8');
  for(const origin of ['http://127.0.0.1:4244','http://localhost:4244','https://plunge.example']) {
    const events:Record<string,(event:unknown)=>void>={};
    const worker={addEventListener:(name:string,handler:(event:unknown)=>void)=>{events[name]=handler;}};
    new Function('self','location',source)(worker,{origin});
    for(const path of ['/api/flags/example/compare/l1','/api/health']) {
      const respondWith=vi.fn();events.fetch!({request:new Request(origin+path),respondWith});
      expect(respondWith).not.toHaveBeenCalled();
    }
    if(origin.startsWith('http:')) {
      const respondWith=vi.fn();events.fetch!({request:new Request(origin+'/src/ui/App.tsx'),respondWith});
      expect(respondWith).not.toHaveBeenCalled();
    }
  }
});
