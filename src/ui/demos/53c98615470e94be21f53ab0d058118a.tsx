/** Demo for the idea "A simpler, prettier Ideas page": the board with a few sample family ideas. */
import { IdeasDemo, seed } from '../../ideas/IdeasDemo';
import type { IdeaStatus, IdeaThread } from '../../ideas/model';

const sample = (number: number, name: string, title: string, status: IdeaStatus): IdeaThread => ({
  card: {...seed.card, id: number.toString(16).padStart(32, '0'), number, name, title, status, context: 'Demo example'},
  messages: [{id: `sample-${number}`, role: 'family', name: `${name} · example`, body: title, created: ''}],
});

export default function SimplerIdeasPage() {
  return <IdeasDemo board storage="plunge:ideas-demo:prettier:v1" seeds={[
    seed,
    sample(24, 'Dad', 'Could the score be easier to read?', 'building'),
    sample(31, 'Grandma', 'Bigger dominoes on my phone please', 'question'),
    sample(9, 'Mom', 'Let us pick who deals first', 'queued'),
  ]}/>;
}
