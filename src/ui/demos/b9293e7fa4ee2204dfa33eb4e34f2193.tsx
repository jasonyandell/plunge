/** Demo for the idea "Try opens straight on your change": this file is that demo. */
import '../../ideas/ideas.css';

export default function TryOpensOnYourChange() {
  return <main class="ideas-page" style={{ display: 'grid', gap: '16px', alignContent: 'start' }}>
    <aside class="demo-banner"><strong>Sample: the preview opened right here</strong>
      <p>This screen is the idea’s own demo. When you press Try on an idea, the preview will open straight on a sample of that change, like a hand dealt up to the exact bid or trick the idea is about, instead of a fresh game you have to play into. A normal game is always one tap away.</p></aside>
    <button class="big-btn" onClick={() => location.assign('/')}>Play a normal game →</button>
  </main>;
}
