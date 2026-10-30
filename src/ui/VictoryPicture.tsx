/** Original stick-figure celebration for the team that finished the game. */
export function VictoryPicture({ won }: { won: boolean }) {
  return (
    <svg
      class="victory-picture"
      viewBox="0 0 320 170"
      role="img"
      aria-label={`Congratulations to ${won ? 'your' : 'the other'} team! Two smiling teammates hold up a banner and celebrate.`}
      focusable="false"
    >
      <g fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        {/* A slightly bowed banner, held by both teammates. */}
        <path d="M48 10 Q160 18 272 10 L270 52 Q160 60 50 52 Z" fill="var(--ivory)" />
        <path d="M48 8 L46 94 M272 8 L274 94" />
        <g fill="currentColor" stroke="none" text-anchor="middle">
          <text x="160" y="40" font-size="23" font-weight="700">Congratulations!</text>
        </g>
        {/* Teammates raise their free hands for a high five. */}
        <circle cx="89" cy="84" r="22" />
        <path d="M89 106 L87 137 L72 162 L61 162 M87 137 L103 162 L114 162
          M89 113 L57 121 L46 86 M89 113 L123 110 L150 76
          M77 89 Q89 102 102 89 M73 63 Q83 53 96 61" />
        <circle cx="231" cy="84" r="22" />
        <path d="M231 106 L233 137 L217 162 L206 162 M233 137 L249 162 L260 162
          M231 113 L263 121 L274 86 M231 113 L197 110 L170 76
          M219 89 Q231 102 244 89" />
        <path d="M214 67 L231 43 L246 67 Z" fill="var(--butterscotch)" />
        <path d="M221 57 L240 57" />
        <g fill="currentColor" stroke="none">
          <ellipse cx="82" cy="81" rx="2" ry="3" />
          <ellipse cx="96" cy="81" rx="2" ry="3" />
          <ellipse cx="224" cy="81" rx="2" ry="3" />
          <ellipse cx="238" cy="81" rx="2" ry="3" />
        </g>
        <path d="M147 74 L146 68 M152 74 L154 69 M168 74 L166 69 M173 74 L174 68" />
        {/* Confetti stays still, including for reduced-motion preferences. */}
        <g stroke="var(--teal-ink)">
          <path d="M21 37 L26 44 M295 35 L291 43 M19 106 Q8 114 19 119
            M299 100 Q309 108 299 114 M134 140 L129 147 M184 142 L190 148" />
        </g>
        <g stroke="var(--brown-9)">
          <path d="M29 68 Q17 62 22 56 M291 64 Q303 58 299 53
            M15 143 L23 138 M296 139 L303 145 M158 118 L163 125" />
        </g>
      </g>
    </svg>
  );
}
