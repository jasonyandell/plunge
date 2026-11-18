import { IDEA_ID } from './model';

/** Carry only a card identity through sign-in, never an arbitrary redirect or invite. */
export function ideaAccountReturn(search: string): string | null {
  const params=new URLSearchParams(search), id=params.get('ideaReturn');
  if (id && IDEA_ID.test(id)) return `/?ideas=1#idea=${id}`;
  return params.get('ideasReturn')==='1' ? '/?ideas=1' : null;
}
