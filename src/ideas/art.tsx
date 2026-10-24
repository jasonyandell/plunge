import type { IdeaStatus } from './model';

// Pip spots on a unit square, the way dominoes are dotted.
const SPOTS: [number, number][][] = [
  [], [[.5,.5]], [[.25,.25],[.75,.75]], [[.25,.25],[.5,.5],[.75,.75]],
  [[.25,.25],[.75,.25],[.25,.75],[.75,.75]], [[.25,.25],[.75,.25],[.5,.5],[.25,.75],[.75,.75]],
  [[.25,.22],[.75,.22],[.25,.5],[.75,.5],[.25,.78],[.75,.78]],
];
function Pips({n, x, y, size, r, fill}: {n:number; x:number; y:number; size:number; r:number; fill:string}) {
  return <>{(SPOTS[n] ?? []).map(([px,py],i)=><circle key={i} cx={x+px*size} cy={y+py*size} r={r} fill={fill}/>)}</>;
}

/** Every idea gets its own domino: idea 24 is the 3–3, idea 1 the blank–1. */
export function ideaPips(number: number): [number, number] {
  const n = Math.max(0, Math.floor(number));
  return [Math.floor(n / 7) % 7, n % 7];
}
export type IdeaTone = 'waiting' | 'active' | 'done' | 'ask' | 'muted';
export function ideaTone(status: IdeaStatus): IdeaTone {
  return status==='ready'||status==='shipped' ? 'done' : status==='building'||status==='checking' ? 'active'
    : status==='question'||status==='failed' ? 'ask' : status==='closed' ? 'muted' : 'waiting';
}
export function IdeaDomino({number, status}: {number:number; status:IdeaStatus}) {
  const [a,b] = ideaPips(number);
  return <svg class={`idea-domino ${ideaTone(status)}`} viewBox="0 0 64 34" aria-hidden="true" focusable="false">
    <rect x="1.5" y="1.5" width="61" height="31" rx="7" class="idea-domino-face"/>
    <line x1="32" y1="6" x2="32" y2="28" class="idea-domino-bar"/>
    <Pips n={a} x={5} y={4} size={26} r={2.6} fill="currentColor"/>
    <Pips n={b} x={33} y={4} size={26} r={2.6} fill="currentColor"/>
  </svg>;
}

/** The hero: the family around the table, one domino lighting up like an idea. */
export function FamilyTableArt() {
  const behind = [{x:160,y:52,color:'#e0a84f',s:1}, {x:34,y:110,color:'#c4afe3',s:1.05}, {x:286,y:110,color:'#a4d9c9',s:1.05}];
  return <svg class="family-table-art" viewBox="0 0 320 236" role="img" aria-label="A family around a domino table, one domino glowing like a new idea">
    <defs>
      <radialGradient id="ft-felt" cx="50%" cy="42%" r="65%"><stop offset="0" stop-color="#3d8f74"/><stop offset="1" stop-color="#1b5143"/></radialGradient>
      <radialGradient id="ft-glow"><stop offset="0" stop-color="#ffe3a3" stop-opacity=".95"/><stop offset=".45" stop-color="#f2c46b" stop-opacity=".35"/><stop offset="1" stop-color="#f2c46b" stop-opacity="0"/></radialGradient>
    </defs>
    {behind.map((p,i)=><Person key={i} x={p.x} y={p.y} color={p.color} scale={p.s}/>)}
    <rect x="52" y="56" width="216" height="124" rx="40" fill="#6b4126"/>
    <rect x="60" y="64" width="200" height="108" rx="33" fill="url(#ft-felt)"/>
    <g class="ft-tile" transform="translate(84 92) rotate(-12)"><Tile a={5} b={3}/></g>
    <g class="ft-tile" transform="translate(196 84) rotate(10)"><Tile a={6} b={2}/></g>
    <g class="ft-tile" transform="translate(92 140) rotate(6)"><Tile a={4} b={4}/></g>
    <g class="ft-tile" transform="translate(194 138) rotate(-8)"><Tile a={1} b={6}/></g>
    <circle class="ft-glow" cx="160" cy="112" r="52" fill="url(#ft-glow)"/>
    <g class="ft-rays" stroke="#ffe3a3" stroke-width="3" stroke-linecap="round">
      {[0,45,90,135,180,225,270,315].map(t=><line key={t} x1="0" y1="-33" x2="0" y2="-41" transform={`translate(160 112) rotate(${t})`}/>)}
    </g>
    <g transform="translate(149 92)">
      <rect width="22" height="40" rx="5" fill="#fff7e7" stroke="#f2c46b" stroke-width="2"/>
      <line x1="4" y1="20" x2="18" y2="20" stroke="#c9a14e" stroke-width="1.5"/>
      <Pips n={4} x={2} y={1} size={18} r={2} fill="#286f65"/>
      <Pips n={2} x={2} y={21} size={18} r={2} fill="#286f65"/>
    </g>
    <Person x={160} y={202} color="#e58b74" scale={1.25}/>
  </svg>;
}
function Person({x, y, color, scale}: {x:number; y:number; color:string; scale:number}) {
  return <g transform={`translate(${x} ${y}) scale(${scale})`}>
    <path d="M-22 22 Q-22 0 0 0 Q22 0 22 22 Z" fill={color} opacity=".9"/>
    <circle cx="0" cy="-12" r="11" fill={color}/>
  </g>;
}
function Tile({a, b}: {a:number; b:number}) {
  return <>
    <rect width="34" height="18" rx="4" fill="#f4ead4"/>
    <line x1="17" y1="3" x2="17" y2="15" stroke="#b9a37a" stroke-width="1"/>
    <Pips n={a} x={1} y={1} size={16} r={1.5} fill="#2b1d12"/>
    <Pips n={b} x={17} y={1} size={16} r={1.5} fill="#2b1d12"/>
  </>;
}

const STEPS = ['Shared', 'Building', 'Try it', 'In the game'];
function stepFor(status: IdeaStatus) {
  return status==='shipped' ? 3 : status==='ready' ? 2 : status==='building'||status==='checking'||status==='failed'||status==='question' ? 1 : 0;
}
/** Where an idea is on its way from the table into everyone's game. */
export function IdeaJourney({status}: {status:IdeaStatus}) {
  if (status === 'closed') return null;
  const at = stepFor(status), x = (i:number) => 20 + i * 93.3;
  return <figure class="idea-journey" aria-label={`Progress: ${STEPS[at]}`}>
    <svg viewBox="0 0 320 58" aria-hidden="true" focusable="false">
      <line x1={x(0)} y1="18" x2={x(3)} y2="18" class="journey-track"/>
      <line x1={x(0)} y1="18" x2={x(at)} y2="18" class="journey-fill"/>
      {STEPS.map((step,i)=><g key={step} class={i<at?'journey-step done':i===at?`journey-step now ${ideaTone(status)}`:'journey-step'}>
        <circle cx={x(i)} cy="18" r={i===at?11:8}/>
        {i<at && <path d={`M${x(i)-4} 18 l3 3 l5 -6`} class="journey-check"/>}
        {i===at && <circle cx={x(i)} cy="18" r="3.5" class="journey-pip"/>}
        <text x={x(i)} y="50" text-anchor={i===0?'start':i===3?'end':'middle'} dx={i===0?-8:i===3?8:0}>{step}</text>
      </g>)}
    </svg>
  </figure>;
}

export function SearchIcon() {
  return <svg class="ideas-search-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/>
    <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>
  </svg>;
}
/** A standing domino with a spark, for the "share an idea" box. */
export function SparkTile() {
  return <svg class="spark-tile" viewBox="0 0 48 56" aria-hidden="true" focusable="false">
    <g stroke="#e0a84f" stroke-width="2.6" stroke-linecap="round">
      <line x1="24" y1="3" x2="24" y2="9"/><line x1="8" y1="10" x2="12" y2="14"/><line x1="40" y1="10" x2="36" y2="14"/>
    </g>
    <rect x="13" y="16" width="22" height="38" rx="5" fill="#286f65"/>
    <line x1="17" y1="35" x2="31" y2="35" stroke="#a4d9c9" stroke-width="1.4"/>
    <Pips n={1} x={15} y={17} size={18} r={2.2} fill="#fff2d8"/>
    <Pips n={3} x={15} y={36} size={18} r={2.2} fill="#fff2d8"/>
  </svg>;
}
