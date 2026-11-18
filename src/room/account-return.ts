/** Only a room id can cross sign-in; never accept arbitrary redirect destinations. */
export function roomAccountReturn(search: string): string | null {
  const id = new URLSearchParams(search).get('roomReturn');
  return id && /^[a-f0-9]{32}$/.test(id) ? `/?rooms=1#room=${id}` : null;
}
export function roomSignIn(roomId: string | null): string {
  return roomId ? `/?account=1&roomReturn=${roomId}` : '/?account=1';
}
