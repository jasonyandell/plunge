import { useEffect, useReducer, useState } from 'preact/hooks';
import { legalDominoes } from '../engine';
import { Domino } from './Domino';
import { CHALLENGES, challengeAttempt, challengeReducer } from './challenge-hands';
import './challenges.css';

const NAMES = ['You', 'Left opponent', 'Your partner', 'Right opponent'];

/** Standalone practice: never replaces, saves over, or records the match. */
export function Challenges({ onBack }: { onBack: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  return <main class="challenge-screen">
    <header class="back-bar">
      <button type="button" class="text-btn" onClick={onBack}>← Home</button>
      <h1>Challenge hands</h1>
    </header>
    <div class="challenge-body">
      <p class="challenge-note">Practice only · Your regular game stays saved.</p>
      {selected === null ? <>
        <h2>There is a winning way.</h2>
        <p>Three full hands to practice drawing trump. Each has a strategy that wins all seven tricks, whatever the opponents play.</p>
        <p>You have already won the bid of 42 and called sixes trump. Find the winning order, use a hint, or try the same deal again.</p>
        <p>Practice partners and opponents play automatically. Challenge progress resets when you leave.</p>
        <ol class="challenge-list">
          {CHALLENGES.map((challenge, index) => <li key={challenge.title}>
            <button type="button" class="big-btn" onClick={() => setSelected(index)}>{index + 1}. {challenge.title}</button>
          </li>)}
        </ol>
      </> : <ChallengeHand key={selected} index={selected} onChoose={() => setSelected(null)}
        onNext={selected + 1 < CHALLENGES.length ? () => setSelected(selected + 1) : null} />}
    </div>
  </main>;
}

function ChallengeHand({ index, onChoose, onNext }: { index: number; onChoose: () => void; onNext: (() => void) | null }) {
  const [attempt, dispatch] = useReducer(challengeReducer, index, challengeAttempt);
  const [hint, setHint] = useState(false);
  const { game, hold } = attempt;
  const challenge = CHALLENGES[index]!;
  const finished = game.phase !== 'playing';
  const last = game.tricks.at(-1);
  const plays = hold && last ? last.plays : game.currentTrick;
  const legal = new Set(!hold && !finished && game.turn === 0 ? legalDominoes(game) : []);
  useEffect(() => {
    if (hold || finished || game.turn === 0) return;
    const timer = setTimeout(() => dispatch({ type: 'reply', game }), 550);
    return () => clearTimeout(timer);
  }, [game, hold, finished]);

  return <>
    <h2>{index + 1}. {challenge.title}</h2>
    <p class="challenge-goal"><strong>Bid 42 · Sixes trump</strong><br />Win all seven tricks with your partner.</p>
    <div class="challenge-tools">
      <button type="button" class="text-btn" onClick={onChoose}>Choose a hand</button>
      <button type="button" class="text-btn" disabled={!attempt.checkpoints.length} onClick={() => dispatch({ type: 'undo' })}>Undo your last play</button>
      <button type="button" class="text-btn" onClick={() => { dispatch({ type: 'restart', index }); setHint(false); }}>Try this hand again</button>
    </div>
    <p class="challenge-status" role="status" aria-live="polite">
      {hold && last ? `${NAMES[last.winner]} won trick ${game.tricks.length}.`
        : finished ? game.handResult?.made ? 'Challenge won! You found a winning way.' : 'Set this time. Try another order — this deal can be won.'
          : game.turn === 0 ? game.currentTrick.length ? 'Your turn to play.' : 'Your turn to lead.' : `${NAMES[game.turn!]} is playing…`}
    </p>
    <p>Tricks: Us {game.tricks.filter(trick => trick.winner % 2 === 0).length} · Them {game.tricks.filter(trick => trick.winner % 2 === 1).length}</p>
    <div class="challenge-trick" aria-label="Current trick">
      {[2, 1, 3, 0].map(seat => {
        const play = plays.find(p => p.seat === seat);
        return <div key={seat} class={`challenge-seat challenge-seat-${seat}`}>
          <span>{NAMES[seat]}</span>
          {play ? <Domino id={play.domino} orientation="h" /> : <span class="challenge-placeholder">{game.hands[seat]!.length} left</span>}
        </div>;
      })}
    </div>
    {hold && <button type="button" class="big-btn" onClick={() => dispatch({ type: 'continue', game })}>{finished ? 'See result' : 'Next trick'}</button>}
    {!finished && <section aria-labelledby="challenge-your-hand">
      <h3 id="challenge-your-hand">Your hand</h3>
      <div class="challenge-hand">
        {game.hands[0]!.map(id => <Domino key={id} id={id} orientation="h" state={legal.has(id) ? 'legal' : 'idle'}
          onTap={legal.has(id) ? () => dispatch({ type: 'play', domino: id, game }) : undefined} />)}
      </div>
    </section>}
    {!hold && finished && <div class="challenge-result">
      <p>{game.handResult?.made ? 'Drawing out trump lets your doubles win safely.' : 'A double can lose to a trump. Undo your play or restart to find the winning order.'}</p>
      {onNext && <button type="button" class="big-btn" onClick={onNext}>Next challenge</button>}
    </div>}
    <button type="button" class="text-btn" aria-expanded={hint} aria-controls="challenge-hint" onClick={() => setHint(!hint)}>{hint ? 'Hide hint' : 'Show a hint'}</button>
    {hint && <p id="challenge-hint" class="challenge-hint">{challenge.hint}</p>}
  </>;
}
