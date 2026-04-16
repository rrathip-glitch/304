// Smoke test: create a 4-AI game, play a full hand, verify invariants.
// Usage: node scripts/smoke.js
const game = require('../src/engine/game');
const ai = require('../src/engine/ai');

function assert(cond, msg) { if (!cond) { console.error('ASSERT FAIL:', msg); process.exit(1); } }

function summary(state) {
  return {
    phase: state.phase,
    dealer: state.dealer,
    currentBidder: state.currentBidder,
    currentPlayer: state.currentPlayer,
    highBid: state.highBid,
    trumpMaker: state.trumpMaker,
    trumpSuit: state.trumpSuit,
    trumpRevealed: state.trumpRevealed,
    tricksPlayed: state.tricksPlayed,
    trickPoints: state.trickPoints,
    tokens: state.tokens,
    msg: state.message,
  };
}

const state = game.createGame('SMOKE1');
for (let s = 0; s < 4; s++) {
  const res = game.seatPlayer(state, { seat: s, name: 'AI' + s, isAI: true });
  assert(res.ok, 'seatPlayer seat ' + s + ': ' + (res.reason || ''));
}

// Drive hands via AI until someone wins or 30 hands cap
const MAX_HANDS = 40;
let safety = 0;

function stepTurn() {
  safety++;
  if (safety > 50000) { console.error('safety cap hit'); process.exit(1); }
  const phase = state.phase;
  let actor = null;
  if (phase === 'bid4' || phase === 'bid8') actor = state.currentBidder;
  else if (phase === 'trump_pick1' || phase === 'trump_pick2' || phase === 'open_choice') actor = state.trumpMaker;
  else if (phase === 'play' || phase === 'inspect') actor = state.currentPlayer;
  else if (phase === 'hand_end') actor = 0; // any seat can continue
  else return false;

  if (actor === null || actor === undefined) {
    console.error('no actor for phase', phase, summary(state));
    return false;
  }

  const action = phase === 'hand_end' ? { type: 'continue' } : ai.chooseAction(state, actor);
  if (!action) {
    const legal = game.legalActions(state, actor);
    console.error('AI returned null; legal:', legal);
    console.error('phase:', state.phase, 'actor:', actor, 'hand:', state.hands[actor]);
    console.error('trumpMaker:', state.trumpMaker, 'trumpSuit:', state.trumpSuit, 'indicator:', state.trumpIndicator);
    console.error('tricksPlayed:', state.tricksPlayed, 'currentTrick:', state.currentTrick);
    console.error('isOpenTrump:', state.isOpenTrump, 'trumpRevealed:', state.trumpRevealed);
    console.error('dealer:', state.dealer, 'dealerRight:', (state.dealer + 3) % 4);
    return false;
  }
  const res = game.applyAction(state, actor, action);
  if (!res.ok) {
    console.error('applyAction failed', actor, action, res, summary(state));
    return false;
  }
  return true;
}

// Boot first hand
if (typeof game.startMatch === 'function') {
  game.startMatch(state);
} else if (typeof game.startHand === 'function') {
  game.startHand(state);
}

let handsPlayed = 0;
let handStartSteps = 0;
while (state.phase !== 'game_over' && handsPlayed < MAX_HANDS) {
  if (safety - handStartSteps > 500) {
    console.error('HAND STUCK after 500 steps. State:', summary(state));
    console.error('currentTrick:', state.currentTrick);
    console.error('hands:', state.hands.map((h,i) => i + ':' + h.length));
    console.error('indicator:', state.trumpIndicator);
    process.exit(2);
  }
  if (!stepTurn()) break;
  if (state.phase === 'hand_end') {
    const res = game.applyAction(state, 0, { type: 'continue' });
    if (!res.ok) { console.error('continue failed', res); break; }
    handsPlayed++;
    handStartSteps = safety;
    console.log('Hand', handsPlayed, 'complete. tokens=', state.tokens);
  }
}

console.log('Done. Phase:', state.phase, 'tokens:', state.tokens, 'hands:', handsPlayed);
if (state.phase === 'game_over') {
  console.log('MATCH OVER. winner team:', state.tokens[0] === 22 ? 0 : 1);
}

// Invariants
assert(state.tokens[0] + state.tokens[1] === 22, 'tokens sum must equal 22, got ' + state.tokens.join('+'));
assert(state.tokens.every(t => t >= 0 && t <= 22), 'tokens in range');
console.log('OK invariants.');
