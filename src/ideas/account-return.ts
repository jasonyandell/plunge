import { IDEA_ID } from './model';

/** Carry only a card identity through sign-in, never an arbitrary redirect or invite. */
export function ideaAccountReturn(search: string): string | null {
  const id=new URLSearchParams(search).get('ideaReturn');
  return id && IDEA_ID.test(id) ? `/?ideas=1#idea=${id}` : null;
}
