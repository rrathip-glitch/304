// Single-match, flush-every-step diagnostic
const game = require('../src/engine/game');
const ai = require('../src/engine/ai');
const state = game.createGame('D');
for (let s = 0; s < 4; s++) game.seatPlayer(state, { seat: s, name: 'AI' + s, isAI: true });
game.startHand(state);
let i = 0;
while (state.phase !== 'game_over' && i < 2000) {
  i++;
  const ph = state.phase;
  let actor;
  if (ph === 'bid4' || ph === 'bid8') actor = state.currentBidder;
  else if (ph === 'trump_pick1' || ph === 'trump_pick2' || ph === 'open_choice') actor = state.trumpMaker;
  else if (ph === 'play' || ph === 'inspect') actor = state.currentPlayer;
  else if (ph === 'hand_end') actor = 0;
  else break;
  if (actor == null) { process.stdout.write('no actor ' + ph + '\n'); break; }
  const action = ph === 'hand_end' ? { type: 'continue' } : ai.chooseAction(state, actor);
  process.stdout.write(i + ': ph=' + ph + ' actor=' + actor + ' act=' + JSON.stringify(action) + '\n');
  if (!action) { process.stdout.write('AI returned null\n'); break; }
  const r = game.applyAction(state, actor, action);
  if (!r.ok) { process.stdout.write('action failed: ' + JSON.stringify(r) + '\n'); break; }
}
process.stdout.write('end. phase=' + state.phase + ' tokens=' + state.tokens.join(',') + ' steps=' + i + '\n');
