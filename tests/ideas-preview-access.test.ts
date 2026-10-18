import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {clearPreviewSession,previewSession,previewSignInLink} from '../src/ideas/preview-access';

const origin='https://plunge-pr-58.texas42.workers.dev';
const storage=()=>{const values=new Map<string,string>();return {
  getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key),
};};
let location:{origin:string;pathname:string;search:string;hash:string};
beforeEach(()=>{
  location={origin,pathname:'/',search:'?ideas=1',hash:''};
  vi.stubGlobal('location',location);vi.stubGlobal('localStorage',storage());vi.stubGlobal('sessionStorage',storage());
  vi.stubGlobal('history',{replaceState:vi.fn((_state:unknown, _unused:string, url:string)=>{location.hash=new URL(url,origin).hash;})});
});
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
function returnFromSignIn(state:string,target=origin) {
  const payload=btoa(JSON.stringify({state,origin:target})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const token=`${payload}.signature`;
  location.hash=`#preview-session=${token}&preview-state=${state}`;
  return token;
}
it('uses the real account page and only accepts a return initiated by this preview',()=>{
  const link=new URL(previewSignInLink()),state=link.searchParams.get('preview-state')!;
  expect(link.origin).toBe('https://plunge.texas42.workers.dev');
  expect(link.searchParams.get('account')).toBe('1');expect(link.searchParams.get('ideas-preview')).toBe('58');
  const token=returnFromSignIn(state);
  expect(previewSession()).toBe(token);expect(location.hash).toBe('');
  expect(previewSession()).toBe(token); // Reload keeps this tab's grant.
  clearPreviewSession();expect(previewSession()).toBe('');
  returnFromSignIn(state);expect(previewSession()).toBe(''); // Nonce cannot be reused.
});
it('removes unsolicited or mismatched credentials from the address without saving them',()=>{
  returnFromSignIn('f'.repeat(32));expect(previewSession()).toBe('');expect(location.hash).toBe('');
  const state=new URL(previewSignInLink()).searchParams.get('preview-state')!;
  returnFromSignIn(state,'https://plunge-pr-59.texas42.workers.dev');expect(previewSession()).toBe('');
});
it('rejects expired handoffs and has no preview authentication on arbitrary sites',()=>{
  const state=new URL(previewSignInLink()).searchParams.get('preview-state')!;
  returnFromSignIn(state);
  vi.spyOn(Date,'now').mockReturnValue(Date.now()+16*60*1000);
  expect(previewSession()).toBe('');
  location.origin='https://example.com';
  expect(previewSignInLink()).toBe('https://plunge.texas42.workers.dev/?account=1');
  expect(previewSession()).toBe('');
});

it('returns to the same idea and demo without carrying unrelated fragments',()=>{
  const id='a'.repeat(32); location.hash=`#idea=${id}&try=1&invite=private`;
  const state=new URL(previewSignInLink()).searchParams.get('preview-state')!;
  const token=returnFromSignIn(state);
  expect(previewSession()).toBe(token);
  expect(location.hash).toBe(`#idea=${id}&try=1`);
});
