// Scoring / token transfer tests.
// Most scenarios drive the state machine into PHASES.INSPECT/HAND_END by
// raw-mutating a state so we can isolate scoring logic.

const { ok, assert } = require('./helpers');
const game = require('../src/engine/game');

// Simulate the outcome of a finished hand by setting state fields, then
// calling applyAction with a `continue` from HAND_END to assert post-state.
// Instead, we drive the internal finalizeHand path by setting tricksPlayed=8
// and calling resolveTrick indirectly — but finalizeHand is not exported.
// We construct the last trick and play out of PHASES.PLAY via applyAction.

// Helper to set up a state where only the last trick remains, and the
// outcome can be precisely controlled by what cards are in hands.
function setupFinalTrick({ bidAmount, makerTeamPoints = 0, makerWinsAllEight = false, makerWinsFinal = true }) {
  const s = game.createGame('SC');
  for (let i = 0; i < 4; i++) game.seatPlayer(s, { seat: i, name: 'P' + i, isAI: true });
  s.dealer = 0;
  s.phase = game.PHASES.PLAY;
  s.trumpSuit = 'S';
  s.isOpenTrump = true;
  s.trumpRevealed = true;
  s.trumpMaker = 0;
  s.highBid = { amount: bidAmount, bidder: 0, isCloseCaps: false };
  s.trickPoints = [0, 0];
  s.tricksWon = [0, 0];
  s.tricksPlayed = 7;
  s.currentTrick = [];

  // Team 0 (maker) already has makerTeamPoints internally.
  s.trickPoints[0] = makerTeamPoints;
  if (makerWinsAllEight) {
    s.tricksWon[0] = 7;
  } else {
    s.tricksWon[0] = 3;
    s.tricksWon[1] = 4;
  }

  // The final trick will have 4 low cards (points 0). Leader is seat chosen so
  // that either maker (seat 0) or opp (seat 1) wins based on trump.
  if (makerWinsFinal) {
    // Seat 0 holds a trump; others hold low non-trump.
    s.hands = [
      [{ rank: '7', suit: 'S', id: '7S' }],
      [{ rank: '8', suit: 'H', id: '8H' }],
      [{ rank: 'Q', suit: 'H', id: 'QH' }],
      [{ rank: 'K', suit: 'H', id: 'KH' }],
    ];
    s.trickLeader = 1;
    s.currentPlayer = 1;
  } else {
    // Opp wins: seat 1 holds a trump, others don't.
    s.hands = [
      [{ rank: '7', suit: 'H', id: '7H' }],
      [{ rank: '8', suit: 'S', id: '8S' }],
      [{ rank: 'Q', suit: 'H', id: 'QH' }],
      [{ rank: 'K', suit: 'H', id: 'KH' }],
    ];
    s.trickLeader = 2;
    s.currentPlayer = 2;
  }
  return s;
}

function playFinalTrick(s) {
  const ai = require('../src/engine/ai');
  let guard = 0;
  while (s.phase === game.PHASES.PLAY && guard < 10) {
    guard += 1;
    const actor = s.currentPlayer;
    const action = ai.chooseAction(s, actor);
    const r = game.applyAction(s, actor, action);
    if (!r.ok) throw new Error(`scoring step failed seat ${actor}: ${r.reason}`);
  }
}

ok('bid 160 success → +1 token to maker team', () => {
  // Maker team has >= 160 points after final trick. The trick itself adds 0.
  const s = setupFinalTrick({ bidAmount: 160, makerTeamPoints: 160, makerWinsFinal: true });
  playFinalTrick(s);
  assert.ok(s.phase === game.PHASES.HAND_END || s.phase === game.PHASES.GAME_OVER);
  assert.equal(s.tokens[0], 12);
  assert.equal(s.tokens[1], 10);
});

ok('bid 160 fail → +2 tokens to opponents', () => {
  const s = setupFinalTrick({ bidAmount: 160, makerTeamPoints: 50, makerWinsFinal: false });
  playFinalTrick(s);
  assert.equal(s.tokens[0], 9);
  assert.equal(s.tokens[1], 13);
});

ok('bid 200 success → +2 tokens to maker', () => {
  const s = setupFinalTrick({ bidAmount: 200, makerTeamPoints: 200, makerWinsFinal: true });
  playFinalTrick(s);
  assert.equal(s.tokens[0], 13);
  assert.equal(s.tokens[1], 9);
});

ok('bid 200 fail → +3 to opponents', () => {
  const s = setupFinalTrick({ bidAmount: 200, makerTeamPoints: 50, makerWinsFinal: false });
  playFinalTrick(s);
  assert.equal(s.tokens[0], 8);
  assert.equal(s.tokens[1], 14);
});

ok('bid 250 success → +3 to maker', () => {
  const s = setupFinalTrick({ bidAmount: 250, makerTeamPoints: 250, makerWinsFinal: true });
  playFinalTrick(s);
  assert.equal(s.tokens[0], 14);
  assert.equal(s.tokens[1], 8);
});

ok('bid 250 fail → +4 to opponents', () => {
  const s = setupFinalTrick({ bidAmount: 250, makerTeamPoints: 50, makerWinsFinal: false });
  playFinalTrick(s);
  assert.equal(s.tokens[0], 7);
  assert.equal(s.tokens[1], 15);
});

ok('high court (all 8 tricks by maker) → +5 tokens regardless of bid', () => {
  // Raw setup: final trick also won by maker; maker already has 7 tricks.
  const s = setupFinalTrick({ bidAmount: 160, makerTeamPoints: 290, makerWinsAllEight: true, makerWinsFinal: true });
  playFinalTrick(s);
  assert.equal(s.tricksWon[0], 8, 'all 8 tricks by maker');
  assert.equal(s.tokens[0], 16);
  assert.equal(s.tokens[1], 6);
});

ok('tokens cap at 22 and floor at 0; game_over when 22 reached', () => {
  const s = setupFinalTrick({ bidAmount: 250, makerTeamPoints: 250, makerWinsFinal: true });
  // Start near the cap so the +3 win pushes team 0 to 22.
  s.tokens = [19, 3];
  playFinalTrick(s);
  assert.equal(s.tokens[0], 22);
  assert.equal(s.tokens[1], 0);
  assert.equal(s.phase, game.PHASES.GAME_OVER);
});
