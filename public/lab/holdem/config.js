// Walt's live settings (shared by the page and the h2h harness).
// Level 1 = the card's live player: best response to level-0 minds, which are
// best responses to random play. Horizon 1 = this street and the next with
// minds; then the hand is checked down to showdown.
export const LIVE_LEVEL = 1;
export const LIVE_CFG = { n: 128, horizon: 1, branch: 8, n0: 32, horizon0: 0, branch0: 1 };
