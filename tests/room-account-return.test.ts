import { expect, it } from 'vitest';
import { roomAccountReturn, roomSignIn } from '../src/room/account-return';
it('keeps the invited room through sign-in without accepting redirect URLs or secrets', () => {
  const id = 'a'.repeat(32);
  expect(roomAccountReturn(new URL(roomSignIn(id), 'https://plunge.test').search)).toBe(`/?rooms=1#room=${id}`);
  for (const value of ['', '?roomReturn=https://other.test', '?roomReturn=//other.test', '?roomReturn=' + 'a'.repeat(64)])
    expect(roomAccountReturn(value)).toBeNull();
});
