// Run N matches to completion, verifying engine+AI invariants.
const game = require('../src/engine/game');
const ai = require('../src/engine/ai');

const MATCHES = parseInt(process.argv[2] || '5', 10);
let totalHands = 0;

for (let m = 0; m < MATCHES; m++) {
  process.stdout.write('START match ' + m + '\n');
  const state = game.createGame('M' + m);
  for (let s = 0; s < 4; s++) game.seatPlayer(state, { seat: s, name: 'AI' + s, isAI: true });
  game.startHand(state);
  process.stdout.write('STARTED phase=' + state.phase + '\n');

  let safety = 0;
  let hands = 0;
  let lastPhase = '';
  let sameCount = 0;
  const start = Date.now();
  while (state.phase !== 'game_over' && safety < 50000) {
    safety++;
    if (safety % 2000 === 0) process.stdout.write('m' + m + ' s' + safety + ' ph=' + state.phase + ' tr=' + state.tricksPlayed + ' tok=' + state.tokens.join(',') + '\n');
    if (Date.now() - start > 15000) { console.error('match', m, 'over 15s safety=', safety); break; }
    const phase = state.phase;
    let actor = null;
    if (phase === 'bid4' || phase === 'bid8') actor = state.currentBidder;
    else if (phase === 'trump_pick1' || phase === 'trump_pick2' || phase === 'open_choice') actor = state.trumpMaker;
    else if (phase === 'play' || phase === 'inspect') actor = state.currentPlayer;
    else if (phase === 'hand_end') actor = 0;
    else break;
    if (actor === null || actor === undefined) break;

    const action = phase === 'hand_end' ? { type: 'continue' } : ai.chooseAction(state, actor);
    if (!action) {
      console.error('Match', m, 'hand', hands, 'stalled at phase', phase, 'actor', actor);
      console.error('legal:', game.legalActions(state, actor));
      process.exit(1);
    }
    const res = game.applyAction(state, actor, action);
    if (!res.ok) {
      console.error('Match', m, 'hand', hands, 'action failed:', action, res);
      process.exit(1);
    }
    if (phase === 'hand_end') {
      hands++;
      if (state.tokens[0] + state.tokens[1] !== 22) {
        console.error('token invariant broken after hand', hands, state.tokens);
        process.exit(1);
      }
    }
  }
  if (state.phase !== 'game_over') {
    console.error('match', m, 'did not complete. safety=', safety, 'tokens=', state.tokens, 'hands=', hands, 'phase=', state.phase);
    continue;
  }
  totalHands += hands;
  console.log('Match', m, 'winner=', state.tokens[0] === 22 ? 0 : 1, 'hands=', hands, 'tokens=', state.tokens);
}
console.log('OK', MATCHES, 'matches,', totalHands, 'hands total.');
