// Privacy invariants: verify that viewFor does not leak hidden state to
// non-privileged seats.

const { ok, assert, newGame } = require('./helpers');
const game = require('../src/engine/game');

function bidTo(state, winnerSeat, amount = 160) {
  while (state.phase === game.PHASES.BID4) {
    const actor = state.currentBidder;
    if (actor === winnerSeat && !state.highBid) {
      const r = game.applyAction(state, actor, { type: 'bid', amount });
      assert.equal(r.ok, true);
    } else {
      const r = game.applyAction(state, actor, { type: 'pass' });
      assert.equal(r.ok, true);
    }
  }
}

ok('after pickTrump (closed): non-maker seats do not see trumpIndicator', () => {
  const { state } = newGame();
  const winner = state.currentBidder;
  bidTo(state, winner, 160);
  const pick = state.hands[winner][0];
  game.applyAction(state, winner, { type: 'pickTrump', cardId: pick.id });

  for (let s = 0; s < 4; s++) {
    const v = game.viewFor(state, s);
    if (s === winner) {
      assert.ok(v.trumpIndicator && v.trumpIndicator.id === pick.id, 'maker sees indicator');
    } else {
      assert.equal(v.trumpIndicator, null, `seat ${s} must not see indicator`);
    }
    // trumpSuit only visible when revealed/open.
    assert.equal(v.trumpSuit, null, `seat ${s} trumpSuit should be null in closed`);
  }
});

ok('viewFor does not expose other players\' hands; only yourHand + handCounts', () => {
  const { state } = newGame();
  for (let s = 0; s < 4; s++) {
    const v = game.viewFor(state, s);
    assert.equal(v.hands, undefined, 'hands should not be in view');
    assert.ok(Array.isArray(v.yourHand), 'yourHand is an array');
    assert.equal(v.yourHand.length, state.hands[s].length, 'yourHand size matches');
    assert.ok(Array.isArray(v.handCounts));
    assert.equal(v.handCounts.length, 4);
    for (let i = 0; i < 4; i++) {
      assert.equal(v.handCounts[i], state.hands[i].length, `handCounts[${i}]`);
    }
  }
});

ok('face-down card in currentTrick: non-maker non-owner sees masked entry', () => {
  const s = game.createGame('VL');
  for (let i = 0; i < 4; i++) game.seatPlayer(s, { seat: i, name: 'P' + i, isAI: true });
  s.phase = game.PHASES.PLAY;
  s.trumpSuit = 'S';
  s.isOpenTrump = false;
  s.trumpRevealed = false;
  s.trumpMaker = 0;
  s.trumpIndicator = { rank: 'Q', suit: 'S', id: 'QS' };
  s.dealer = 0;
  s.currentTrick = [];
  s.trickLeader = 1;
  s.currentPlayer = 1;
  s.hands = [
    [{ rank: 'K', suit: 'S', id: 'KS' }],
    [{ rank: '7', suit: 'H', id: '7H' }],
    [{ rank: 'A', suit: 'D', id: 'AD' }], // seat 2 void of hearts
    [{ rank: 'K', suit: 'H', id: 'KH' }],
  ];
  game.applyAction(s, 1, { type: 'playCard', cardId: '7H' });
  game.applyAction(s, 0, { type: 'playCard', cardId: 'KS' });
  // Seat 0 trump maker played face-down. Inspect view from seat 3 (non-maker,
  // non-owner).
  const v3 = game.viewFor(s, 3);
  const play = v3.currentTrick.find((p) => p.seat === 0);
  assert.ok(play, 'play recorded');
  assert.equal(play.hidden, true, 'hidden flag on face-down card');
  assert.equal(play.faceDown, true);
  assert.equal(play.card, undefined, 'card must not leak');

  // Owner (seat 0) sees their own card in view.
  const v0 = game.viewFor(s, 0);
  const own = v0.currentTrick.find((p) => p.seat === 0);
  assert.ok(own.card && own.card.id === 'KS', 'owner sees their own face-down card');
});

ok('once trumpRevealed, indicator appears in every seat\'s view', () => {
  const s = game.createGame('RV');
  for (let i = 0; i < 4; i++) game.seatPlayer(s, { seat: i, name: 'P' + i, isAI: true });
  s.phase = game.PHASES.PLAY;
  s.trumpSuit = 'S';
  s.isOpenTrump = true;
  s.trumpRevealed = true;
  s.trumpMaker = 0;
  s.trumpIndicator = { rank: 'Q', suit: 'S', id: 'QS' };
  s.dealer = 0;
  s.currentTrick = [];
  s.hands = [[], [], [], []];
  for (let i = 0; i < 4; i++) {
    const v = game.viewFor(s, i);
    assert.ok(v.trumpIndicator && v.trumpIndicator.id === 'QS', `seat ${i} sees indicator once revealed`);
    assert.equal(v.trumpSuit, 'S');
  }
});
