import { expect,it } from 'vitest';
import { ideaAccountReturn } from '../src/ideas/account-return';
it('retains the exact idea through sign-in without carrying secrets or redirects',()=>{
  const id='1'.repeat(32);
  expect(ideaAccountReturn(`?account=1&ideaReturn=${id}&invite=secret`)).toBe(`/?ideas=1#idea=${id}`);
  for(const value of ['', '?ideaReturn=https://other.test', '?ideaReturn=//other.test', '?ideaReturn=bad'])
    expect(ideaAccountReturn(value)).toBeNull();
});

it('returns board visitors to the board after sign-in',()=>{
  expect(ideaAccountReturn('?account=1&ideasReturn=1')).toBe('/?ideas=1');
  expect(ideaAccountReturn('?ideasReturn=https://other.test')).toBeNull();
});
