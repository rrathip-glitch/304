// scripts/bid-test.js
//
// Engine unit tests for the v2.1.0 bidding + open-choice rule changes.
//
//  Test 1: a player who is already the high bidder cannot bid again
//          (bid4). Their `legalActions` excludes the `bid` entry.
//  Test 2: same in bid8 — the trump maker entering bid8 cannot raise
//          their own 4-card bid; they can only pass.
//  Test 3: if a player bids in bid4 and everyone else passes, the bid
//          stands and the engine transitions to trump_pick1
//          automatically.
//  Test 4: open/closed choice — the trump maker is offered both options
//          IFF they sit at the dealer's right (trick-1 leader). If the
//          trump maker sits elsewhere, only `declareClosed` is offered.
//  Test 5: an open declaration commits the maker to leading the
//          (former) indicator card on trick 1. legalCardIds returns
//          only that card; any other lead is rejected.
//
// Usage: node scripts/bid-test.js

'use strict';

const game = require('../src/engine/game');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ✓', msg);
}

function fixtureSeated() {
  const s = game.createGame('BID');
  for (let i = 0; i < 4; i++) game.seatPlayer(s, { seat: i, name: 'P' + i, isAI: false });
  return s;
}

console.log('Test 1: cannot self-overbid in bid4');
{
  const s = fixtureSeated();
  // Hand-seed a deterministic deal so this test doesn't depend on RNG.
  game.startHand(s, () => 0.5);
  const firstBidder = s.currentBidder;        // (dealer + 3) % 4
  let r = game.applyAction(s, firstBidder, { type: 'bid', amount: 200 });
  assert(r.ok, 'first bidder bids 200');
  assert(s.highBid && s.highBid.bidder === firstBidder, 'high bid recorded');

  // Walk the table once. After 3 passes, advanceBid4 should auto-resolve
  // to trump_pick1 (Test 3 covers this explicitly).
  // Here, intercept BEFORE the resolution by checking that on the way
  // back around to firstBidder, the engine refuses a second bid.
  // Force the state back to the bidder: they shouldn't be allowed to
  // raise themselves.
  s.currentBidder = firstBidder;
  s.passedSeats = [];                          // pretend nobody passed
  const view = game.viewFor(s, firstBidder);
  const bidEntry = view.legalActions.find((a) => a.type === 'bid');
  assert(!bidEntry, 'legalActions does NOT offer `bid` to the current high bidder');

  // Belt and suspenders: the engine itself rejects the action even if
  // the client tries to bypass the UI gate.
  const r2 = game.applyAction(s, firstBidder, { type: 'bid', amount: 220 });
  assert(!r2.ok && /already the high bidder/.test(r2.reason), 'applyAction rejects self-overbid');
}

console.log('\nTest 2: trump maker cannot self-overbid in bid8');
{
  // Set up a state already in bid8 with the trump maker (= seat 1) as
  // the high bidder. They start the round.
  const s = fixtureSeated();
  s.phase = game.PHASES.BID8;
  s.dealer = 0;
  s.trumpMaker = 1;
  s.trumpSuit = 'S';
  s.trumpIndicator = { rank: '10', suit: 'S', id: '10S' };
  s.highBid = { amount: 220, bidder: 1, isCloseCaps: false };
  s.currentBidder = 1;
  s.bid8Turns = 0;
  s.bid8Passes = 0;
  // Hand contents don't matter for this test.
  for (let i = 0; i < 4; i++) s.hands[i] = [];

  const view = game.viewFor(s, 1);
  const bidEntry = view.legalActions.find((a) => a.type === 'bid');
  assert(!bidEntry, 'bid8 legalActions does NOT offer `bid` to current high bidder');
  const passEntry = view.legalActions.find((a) => a.type === 'pass');
  assert(passEntry, 'bid8 legalActions DOES offer `pass`');

  const r = game.applyAction(s, 1, { type: 'bid', amount: 250 });
  assert(!r.ok && /already the high bidder/.test(r.reason), 'engine rejects bid8 self-overbid');
}

console.log('\nTest 3: bid + 3 passes auto-resolves to trump_pick1');
{
  const s = fixtureSeated();
  game.startHand(s, () => 0.5);
  const order = [];
  let cur = s.currentBidder;
  for (let i = 0; i < 4; i++) { order.push(cur); cur = (cur + 3) % 4; }

  // First seat bids 200.
  let r = game.applyAction(s, order[0], { type: 'bid', amount: 200 });
  assert(r.ok, 'seat ' + order[0] + ' bids 200');

  // Other three pass.
  for (let i = 1; i < 4; i++) {
    r = game.applyAction(s, order[i], { type: 'pass' });
    assert(r.ok, 'seat ' + order[i] + ' passes');
  }

  assert(s.phase === game.PHASES.TRUMP_PICK1, 'phase auto-advanced to trump_pick1 after 3 passes');
  assert(s.trumpMaker === order[0], 'high bidder became trump maker');
  assert(s.highBid.amount === 200, 'high bid stands at 200');
}

console.log('\nTest 4: open choice gated on trick-1 leadership');
{
  // Maker IS the trick-1 leader → both options offered.
  {
    const s = fixtureSeated();
    s.phase = game.PHASES.OPEN_CHOICE;
    s.dealer = 0;                              // next(dealer) === 3
    s.trumpMaker = 3;
    s.trumpIndicator = { rank: 'Q', suit: 'H', id: 'QH' };
    s.trumpSuit = 'H';
    for (let i = 0; i < 4; i++) s.hands[i] = [];
    const view = game.viewFor(s, 3);
    const types = view.legalActions.map((a) => a.type).sort();
    assert(types.includes('declareOpen'), 'open offered when maker leads trick 1');
    assert(types.includes('declareClosed'), 'closed always offered');
  }

  // Maker is NOT the trick-1 leader → only `declareClosed` offered.
  {
    const s = fixtureSeated();
    s.phase = game.PHASES.OPEN_CHOICE;
    s.dealer = 0;                              // next(dealer) === 3
    s.trumpMaker = 1;                          // not the leader
    s.trumpIndicator = { rank: 'Q', suit: 'H', id: 'QH' };
    s.trumpSuit = 'H';
    for (let i = 0; i < 4; i++) s.hands[i] = [];
    const view = game.viewFor(s, 1);
    const types = view.legalActions.map((a) => a.type).sort();
    assert(!types.includes('declareOpen'), 'open NOT offered when maker is not the leader');
    assert(types.includes('declareClosed'), 'closed still offered');

    // Engine rejects the action even if a client tries to fake it.
    const r = game.applyAction(s, 1, { type: 'declareOpen' });
    assert(!r.ok && /trick-1 leader/.test(r.reason), 'engine rejects out-of-spec declareOpen');
  }
}

console.log('\nTest 5: open declaration forces leading the indicator on trick 1');
{
  const s = fixtureSeated();
  s.phase = game.PHASES.OPEN_CHOICE;
  s.dealer = 0;
  s.trumpMaker = 3;                            // = next(0) → trick-1 leader
  s.trumpSuit = 'H';
  s.trumpIndicator = { rank: 'Q', suit: 'H', id: 'QH' };
  // Maker's hand: indicator + a couple of others (post-pick state).
  s.hands[3] = [
    { rank: 'J', suit: 'S', id: 'JS' },
    { rank: '9', suit: 'D', id: '9D' },
  ];
  for (const i of [0, 1, 2]) s.hands[i] = [
    { rank: '7', suit: 'S', id: '7S' + i },
    { rank: '8', suit: 'D', id: '8D' + i },
  ];

  let r = game.applyAction(s, 3, { type: 'declareOpen' });
  assert(r.ok, 'open declared');
  assert(s.isOpenTrump === true, 'isOpenTrump set');
  assert(s.trumpRevealed === true, 'trump revealed publicly');
  assert(s.openIndicatorId === 'QH', 'openIndicatorId remembers the card');
  assert(s.hands[3].some((c) => c.id === 'QH'), 'indicator joined maker\'s hand');
  assert(s.trickLeader === 3, 'trick leader is the maker');
  assert(s.currentPlayer === 3, 'maker is to play');

  // legalCardIds should now contain ONLY the indicator (QH).
  const view = game.viewFor(s, 3);
  const playEntry = view.legalActions.find((a) => a.type === 'playCard');
  assert(playEntry && playEntry.cardIds.length === 1 && playEntry.cardIds[0] === 'QH',
    'only QH is legal as the trick-1 lead');

  // Try leading something else — must fail.
  const bad = game.applyAction(s, 3, { type: 'playCard', cardId: 'JS' });
  assert(!bad.ok && /must lead the trump indicator/.test(bad.reason),
    'engine rejects non-indicator lead under open');

  // Lead the indicator — should succeed AND clear openIndicatorId.
  const good = game.applyAction(s, 3, { type: 'playCard', cardId: 'QH' });
  assert(good.ok, 'leading the indicator is accepted');
  assert(s.openIndicatorId === null, 'openIndicatorId cleared after the indicator was led');
}

console.log('\nAll bid + open-choice tests passed.');
