// Trick-play invariants.

const { ok, assert, newGame } = require('./helpers');
const game = require('../src/engine/game');
const cards = require('../src/engine/cards');

// Helper: drive bid4 so a specific seat wins the bid at a specific amount.
function bidTo(state, winnerSeat, amount = 160) {
  // The winnerSeat bids, everyone else passes.
  // Rotation order starts at (dealer+3)%4 counter-clockwise.
  // We step through until the winner has bid and others have passed.
  let guard = 0;
  while (state.phase === game.PHASES.BID4 && guard < 20) {
    guard += 1;
    const actor = state.currentBidder;
    if (actor === winnerSeat && !state.highBid) {
      const r = game.applyAction(state, actor, { type: 'bid', amount });
      assert.equal(r.ok, true, `seed bid must succeed (got ${r.reason})`);
    } else {
      const r = game.applyAction(state, actor, { type: 'pass' });
      assert.equal(r.ok, true, `seed pass must succeed (got ${r.reason})`);
    }
  }
}

ok('after pickTrump (closed): trumpIndicator set in state, not in trumpMaker hand; 7 cards after second deal', () => {
  const { state } = newGame();
  const winner = state.currentBidder;
  bidTo(state, winner, 160);
  assert.equal(state.phase, game.PHASES.TRUMP_PICK1);
  const pick = state.hands[winner][0];
  const res = game.applyAction(state, winner, { type: 'pickTrump', cardId: pick.id });
  assert.equal(res.ok, true);
  assert.equal(state.trumpIndicator.id, pick.id);
  assert.ok(!state.hands[winner].some((c) => c.id === pick.id), 'indicator removed from hand');
  assert.equal(state.hands[winner].length, 7, 'trump maker has 7 cards after second batch');
  for (let s = 0; s < 4; s++) {
    if (s === winner) continue;
    assert.equal(state.hands[s].length, 8, `non-maker seat ${s} has 8 cards`);
  }
});

ok('first-trick lead restriction: trumpMaker at next(dealer) cannot lead trump in closed game', () => {
  // We need trumpMaker to sit at next(dealer), i.e. the first bidder also
  // wins the bid. newGame() has dealer=0 → first bidder = seat 3.
  const { state } = newGame();
  const winner = state.currentBidder; // seat 3
  bidTo(state, winner, 160);
  const pick = state.hands[winner][0];
  game.applyAction(state, winner, { type: 'pickTrump', cardId: pick.id });
  // Skip bid8: winner passes, rotation passes all.
  let guard = 0;
  while (state.phase === game.PHASES.BID8 && guard < 10) {
    guard += 1;
    game.applyAction(state, state.currentBidder, { type: 'pass' });
  }
  assert.equal(state.phase, game.PHASES.OPEN_CHOICE);
  game.applyAction(state, winner, { type: 'declareClosed' });
  assert.equal(state.phase, game.PHASES.PLAY);
  // Leader is next(dealer) which equals winner in this scenario.
  assert.equal(state.currentPlayer, winner);
  const legal = game.legalActions(state, winner);
  const playEntry = legal.find((a) => a.type === 'playCard');
  assert.ok(playEntry);
  const trumpCards = state.hands[winner].filter((c) => c.suit === state.trumpSuit);
  for (const c of trumpCards) {
    assert.ok(!playEntry.cardIds.includes(c.id), `trump card ${c.id} must not be legal lead`);
  }
});

ok('follow-suit enforcement: if void, can play any; if not, must play lead suit', () => {
  // Synthesize a mid-play state by calling startHand and then manually
  // arranging a scenario. Use a raw state to skip bidding.
  const s = game.createGame('PLAY');
  for (let i = 0; i < 4; i++) game.seatPlayer(s, { seat: i, name: 'P' + i, isAI: true });
  // Skip into play by raw-setting state.
  s.phase = game.PHASES.PLAY;
  s.trumpSuit = 'S';
  s.isOpenTrump = true;
  s.trumpRevealed = true;
  s.trumpMaker = 0;
  s.dealer = 0;
  s.currentTrick = [];
  s.trickLeader = 1;
  s.currentPlayer = 1;
  s.hands = [
    [{ rank: 'J', suit: 'S', id: 'JS' }],
    [{ rank: 'A', suit: 'H', id: 'AH' }], // seat 1 leads H
    [
      { rank: '7', suit: 'H', id: '7H' },
      { rank: 'A', suit: 'S', id: 'AS' },
    ],
    [{ rank: 'K', suit: 'D', id: 'KD' }],
  ];
  // Seat 1 leads the A of hearts.
  assert.equal(game.applyAction(s, 1, { type: 'playCard', cardId: 'AH' }).ok, true);
  // Seat 0 would be next but must follow suit; only AS — void in H so any.
  assert.equal(s.currentPlayer, (1 + 3) % 4); // seat 0
  // Seat 0 plays JS (void in H, so any card allowed).
  assert.equal(game.applyAction(s, 0, { type: 'playCard', cardId: 'JS' }).ok, true);
  // Seat 3 must follow H → has KD, void → any card. Plays KD.
  assert.equal(game.applyAction(s, 3, { type: 'playCard', cardId: 'KD' }).ok, true);
  // Seat 2 has 7H — must follow. Attempt to play AS should fail.
  const bad = game.applyAction(s, 2, { type: 'playCard', cardId: 'AS' });
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /follow suit/);
  // Playing 7H succeeds.
  assert.equal(game.applyAction(s, 2, { type: 'playCard', cardId: '7H' }).ok, true);
});

ok('face-down discard in closed game sets faceDown=true automatically', () => {
  const s = game.createGame('FD');
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
    [{ rank: 'K', suit: 'S', id: 'KS' }], // trump maker
    [{ rank: '7', suit: 'H', id: '7H' }],
    [{ rank: 'A', suit: 'D', id: 'AD' }], // void of hearts
    [{ rank: 'K', suit: 'H', id: 'KH' }],
  ];
  // Seat 1 leads 7H.
  assert.equal(game.applyAction(s, 1, { type: 'playCard', cardId: '7H' }).ok, true);
  // Seat 0 void → plays KS face-down (auto). We don't pass faceDown.
  assert.equal(game.applyAction(s, 0, { type: 'playCard', cardId: 'KS' }).ok, true);
  const zeroPlay = s.currentTrick.find((p) => p.seat === 0);
  assert.equal(zeroPlay.faceDown, true, 'trump maker void in H: forced face-down');
  // Seat 3 plays KH (follows suit).
  assert.equal(game.applyAction(s, 3, { type: 'playCard', cardId: 'KH' }).ok, true);
  // Seat 2 void in H → any card, face-down.
  assert.equal(game.applyAction(s, 2, { type: 'playCard', cardId: 'AD' }).ok, true);
});

ok('face-down trump reveals indicator at end of trick', () => {
  const s = game.createGame('RV');
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
    [{ rank: 'K', suit: 'H', id: 'KH' }],
    [{ rank: '7', suit: 'H', id: '7H' }],
    // Seat 2 is void of hearts → plays trump face-down.
    [{ rank: 'J', suit: 'S', id: 'JS' }],
    [{ rank: 'A', suit: 'H', id: 'AH' }],
  ];
  // Need a play order that gets us to the end of the trick with the void seat
  // playing a face-down trump. Rotation: 1 → 0 → 3 → 2.
  assert.equal(game.applyAction(s, 1, { type: 'playCard', cardId: '7H' }).ok, true);
  assert.equal(game.applyAction(s, 0, { type: 'playCard', cardId: 'KH' }).ok, true);
  assert.equal(game.applyAction(s, 3, { type: 'playCard', cardId: 'AH' }).ok, true);
  // Seat 2 void → plays JS face-down (auto). After resolve, reveal.
  assert.equal(game.applyAction(s, 2, { type: 'playCard', cardId: 'JS' }).ok, true);
  assert.equal(s.trumpRevealed, true, 'trump is now revealed');
  assert.equal(s.isOpenTrump, true, 'game becomes open');
  // Indicator returned to trump maker's hand.
  assert.ok(s.hands[0].some((c) => c.id === 'QS'), 'indicator in maker hand');
});

ok('auto-open after trick 1 when highBid.amount >= 250', () => {
  // Drive bidding: seat 3 bids 160, others pass; then manually force highBid
  // amount = 250 by raw mutation after trump pick.
  const { state } = newGame();
  const winner = state.currentBidder;
  bidTo(state, winner, 160);
  const pick = state.hands[winner][0];
  game.applyAction(state, winner, { type: 'pickTrump', cardId: pick.id });
  // All pass bid8, then open_choice → declareClosed.
  while (state.phase === game.PHASES.BID8) {
    game.applyAction(state, state.currentBidder, { type: 'pass' });
  }
  // Raw mutate: set highBid to 250 to trigger auto-open on trick 1 end.
  state.highBid.amount = 250;
  assert.equal(game.applyAction(state, winner, { type: 'declareClosed' }).ok, true);
  // Play out trick 1 with AI (helpers.playUntil is fine but we just run steps).
  const ai = require('../src/engine/ai');
  let guard = 0;
  while (state.tricksPlayed < 1 && guard < 20) {
    guard += 1;
    const actor = state.currentPlayer;
    if (actor == null) break;
    const action = ai.chooseAction(state, actor);
    const r = game.applyAction(state, actor, action);
    assert.equal(r.ok, true, `AI action ok (${r && r.reason})`);
  }
  assert.equal(state.trumpRevealed, true, 'auto-open on trick 1 end');
});

ok('trick 8 forced indicator: with empty hand + only indicator, indicator is legal to play', () => {
  const s = game.createGame('T8');
  for (let i = 0; i < 4; i++) game.seatPlayer(s, { seat: i, name: 'P' + i, isAI: true });
  s.phase = game.PHASES.PLAY;
  s.trumpSuit = 'S';
  s.isOpenTrump = false;
  s.trumpRevealed = false;
  s.trumpMaker = 0;
  s.trumpIndicator = { rank: 'Q', suit: 'S', id: 'QS' };
  s.dealer = 0;
  s.currentTrick = [];
  s.trickLeader = 0;
  s.currentPlayer = 0;
  s.tricksPlayed = 7;
  s.hands = [[], [{ rank: '7', suit: 'H', id: '7H' }], [{ rank: '8', suit: 'H', id: '8H' }], [{ rank: '9', suit: 'H', id: '9H' }]];
  const legal = game.legalActions(s, 0);
  const entry = legal.find((a) => a.type === 'playCard');
  assert.ok(entry, 'legal actions returns playCard');
  assert.ok(entry.cardIds.includes('QS'), 'indicator is in legalCardIds for trick 8');
});
