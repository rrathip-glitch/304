// Bid4 (four-card) bidding invariants.

const { ok, assert, newGame, makeRng } = require('./helpers');
const game = require('../src/engine/game');

ok('after startHand: phase=bid4, currentBidder=(dealer+3)%4, hand size 4', () => {
  const { state } = newGame();
  assert.equal(state.phase, game.PHASES.BID4);
  assert.equal(state.currentBidder, (state.dealer + 3) % 4);
  for (let s = 0; s < 4; s++) assert.equal(state.hands[s].length, 4, `hand ${s} size`);
});

ok('bid must be a multiple of 10 (165 rejected)', () => {
  const { state } = newGame();
  const res = game.applyAction(state, state.currentBidder, { type: 'bid', amount: 165 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /multiples of 10/);
});

ok('bid must be >= 160 (150 rejected)', () => {
  const { state } = newGame();
  const res = game.applyAction(state, state.currentBidder, { type: 'bid', amount: 150 });
  assert.equal(res.ok, false);
  assert.match(res.reason, /minimum bid is 160|bid floor is 160/);
});

ok('second-turn floor is 200 (after bidding once, next bid must be >=200)', () => {
  const { state } = newGame();
  const first = state.currentBidder;
  // First bidder bids 160.
  assert.equal(game.applyAction(state, first, { type: 'bid', amount: 160 }).ok, true);
  // Second bidder bids 170.
  const second = state.currentBidder;
  assert.equal(game.applyAction(state, second, { type: 'bid', amount: 170 }).ok, true);
  // Third passes. Fourth passes.
  assert.equal(game.applyAction(state, state.currentBidder, { type: 'pass' }).ok, true);
  assert.equal(game.applyAction(state, state.currentBidder, { type: 'pass' }).ok, true);
  // Back to first for a second turn. bidTurns[first] === 1, floor is 200.
  assert.equal(state.currentBidder, first);
  const low = game.applyAction(state, first, { type: 'bid', amount: 180 });
  assert.equal(low.ok, false, 'bid 180 on second turn should be rejected');
  assert.match(low.reason, /floor is 200/);
});

ok('partner-is-high floor is 200', () => {
  const { state } = newGame();
  const first = state.currentBidder; // (dealer+3)%4
  // First bidder bids 160.
  assert.equal(game.applyAction(state, first, { type: 'bid', amount: 160 }).ok, true);
  // Seat to their right bids next — this is the partner of `first` (first+2)%4.
  // No; next(first) = (first+3)%4 which is the opponent of first. Skip.
  const second = state.currentBidder;
  assert.equal(game.applyAction(state, second, { type: 'pass' }).ok, true);
  // Now it's partner of `first`. Their floor should be 200.
  const partner = state.currentBidder;
  assert.equal(partner, (first + 2) % 4, 'partner seat');
  const attempt = game.applyAction(state, partner, { type: 'bid', amount: 170 });
  assert.equal(attempt.ok, false);
  assert.match(attempt.reason, /floor is 200/);
});

ok('askPartner: legal only on first turn; sets both seats to 200 floor', () => {
  const { state } = newGame();
  const first = state.currentBidder;
  const partner = (first + 2) % 4;
  const res = game.applyAction(state, first, { type: 'askPartner' });
  assert.equal(res.ok, true);
  assert.equal(state.askedPartner[first], true);
  assert.equal(state.askedPartner[partner], true);
  assert.equal(state.currentBidder, partner);
  // Partner tries to bid 170 — must be rejected due to 200 floor.
  const fail = game.applyAction(state, partner, { type: 'bid', amount: 170 });
  assert.equal(fail.ok, false);
});

ok('askPartner: rejected on second turn', () => {
  const { state } = newGame();
  const first = state.currentBidder;
  // first bids 160, second bids 170, third and fourth pass → back to first.
  assert.equal(game.applyAction(state, first, { type: 'bid', amount: 160 }).ok, true);
  assert.equal(game.applyAction(state, state.currentBidder, { type: 'bid', amount: 170 }).ok, true);
  assert.equal(game.applyAction(state, state.currentBidder, { type: 'pass' }).ok, true);
  assert.equal(game.applyAction(state, state.currentBidder, { type: 'pass' }).ok, true);
  assert.equal(state.currentBidder, first, 'back to first for second turn');
  const res = game.applyAction(state, first, { type: 'askPartner' });
  assert.equal(res.ok, false);
  assert.match(res.reason, /first turn/);
});

ok('demandRedeal: legal only for dealer\'s right-hand opponent on first turn with <15 points', () => {
  // Seed until we find a deal where the first bidder holds < 15 points.
  let found = false;
  for (let seed = 1; seed < 2000 && !found; seed++) {
    const state = game.createGame('RD');
    for (let s = 0; s < 4; s++) game.seatPlayer(state, { seat: s, name: 'P' + s, isAI: true });
    const rng = makeRng(seed);
    game.startHand(state, rng);
    const first = state.currentBidder;
    const pts = state.hands[first].reduce((s, c) => s + ({ J: 30, '9': 20, A: 11, '10': 10, K: 3, Q: 2, '8': 0, '7': 0 }[c.rank]), 0);
    if (pts < 15) {
      // A non-first seat cannot demand redeal.
      const wrong = game.applyAction(state, (first + 3) % 4, { type: 'demandRedeal' });
      assert.equal(wrong.ok, false);
      // First seat can.
      const ok2 = game.applyAction(state, first, { type: 'demandRedeal' });
      assert.equal(ok2.ok, true, 'redeal from first bidder allowed');
      assert.equal(state.phase, game.PHASES.BID4);
      found = true;
    }
  }
  assert.ok(found, 'seed search found a weak-hand redeal case');
});

ok('all 4 pass → new hand dealt, dealer rotates, handNumber increments', () => {
  const { state } = newGame();
  const startDealer = state.dealer;
  const startHandNo = state.handNumber;
  for (let i = 0; i < 4; i++) {
    const res = game.applyAction(state, state.currentBidder, { type: 'pass' });
    assert.equal(res.ok, true);
  }
  // After all-pass, game.js rotates dealer and restarts the hand.
  assert.equal(state.dealer, (startDealer + 3) % 4, 'dealer rotated counter-clockwise');
  // startHand() increments handNumber, so it goes up by 1.
  assert.equal(state.handNumber, startHandNo + 1, 'handNumber increments on restart');
  assert.equal(state.phase, game.PHASES.BID4);
});

ok('one standing → trump_pick1, trumpMaker = highBid.bidder', () => {
  const { state } = newGame();
  const first = state.currentBidder;
  assert.equal(game.applyAction(state, first, { type: 'bid', amount: 160 }).ok, true);
  // Everyone else passes.
  for (let i = 0; i < 3; i++) {
    assert.equal(game.applyAction(state, state.currentBidder, { type: 'pass' }).ok, true);
  }
  assert.equal(state.phase, game.PHASES.TRUMP_PICK1);
  assert.equal(state.trumpMaker, first);
  assert.equal(state.highBid.bidder, first);
  assert.equal(state.highBid.amount, 160);
});
