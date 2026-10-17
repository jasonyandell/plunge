import { VictoryPicture } from './VictoryPicture';
import './sheets.css';

/** A direct look at the celebration, independent of any saved or shared game. */
export function VictoryPreview({ onClose }: { onClose: () => void }) {
  return (
    <main class="overlay">
      <div class="card game-over-card card-win">
        <p class="eyebrow">Winning team · Preview</p>
        <h1 class="card-title">Congratulations!</h1>
        <VictoryPicture won={true} />
        <p class="card-detail">This picture appears when either team wins. Your game stays saved while you take a look.</p>
        <button type="button" class="big-btn" onClick={onClose}>Back to Plunge</button>
      </div>
    </main>
  );
}
