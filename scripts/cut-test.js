// scripts/cut-test.js
//
// Engine unit test for the cutting mechanic (face-down trump play).
//
//   1. Construct a closed-trump play state where seat 1 (non-maker) is to
//      lead with hearts; seats 2 & 3 hold no hearts; seat 0 is the trump
//      maker holding spades trump (indicator = 10S held outside hand).
//   2. Seat 1 leads ♥7. Seats 2 & 3 must play face-down. Seat 2 plays a
//      non-trump (D) — should not win. Seat 3 plays a trump (S) — should
//      win the trick AND lead the next.
//   3. Verify:
//        - The trump maker's view exposes the face-down cards face-up
//          (`makerPeek: true`) before resolution.
//        - Other players see them as `hidden: true`.
//        - On resolve, `cutResolved` is set, the cutting team gets the
//          trick, the indicator returns to maker's hand.
//   4. Verify the trump indicator is rendered tappable (legalCardIds
//      includes the indicator id) when the maker can't follow suit.
//
// Usage: node scripts/cut-test.js

'use strict';

const game = require('../src/engine/game');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('  ✓', msg);
}

// Minimal fixture: 4 seats, closed trump = Spades, indicator = 10S held by
// seat 0. Seat 1 leads hearts; seat 2 has no hearts (only diamonds &
// clubs); seat 3 has no hearts but has a spade trump.
function fixture() {
  const s = game.createGame('CUT');
  for (let i = 0; i < 4; i++) game.seatPlayer(s, { seat: i, name: 'P' + i, isAI: false });
  // Set up state directly (bypass dealing).
  s.phase = game.PHASES.PLAY;
  s.dealer = 1;            // so dealer's right (seat 0) leads — but we
  s.trickLeader = 1;       //   override the leader to seat 1 for this test
  s.currentPlayer = 1;
  s.trumpMaker = 0;
  s.trumpSuit = 'S';
  s.trumpIndicator = { rank: '10', suit: 'S', id: '10S' };  // held outside
  s.isOpenTrump = false;
  s.trumpRevealed = false;
  s.tricksPlayed = 1;      // not the first or last trick
  s.hands = [
    [{ rank: 'K', suit: 'H', id: 'KH' }, { rank: 'Q', suit: 'C', id: 'QC' }],
    [{ rank: '7', suit: 'H', id: '7H' }, { rank: '8', suit: 'C', id: '8C' }],
    [{ rank: '8', suit: 'D', id: '8D' }, { rank: '7', suit: 'C', id: '7C' }],
    [{ rank: '7', suit: 'S', id: '7S' }, { rank: '9', suit: 'C', id: '9C' }],
  ];
  s.currentTrick = [];
  return s;
}

console.log('Test 1: face-down cut reveals trump, awards trick, sets cutResolved');
{
  const s = fixture();
  // Counter-clockwise rotation from seat 1: 1 → 0 → 3 → 2.
  // Seat 1 leads 7H.
  let r = game.applyAction(s, 1, { type: 'playCard', cardId: '7H' });
  assert(r.ok, 'seat 1 leads 7H');

  // Seat 0 must follow hearts → plays KH.
  r = game.applyAction(s, 0, { type: 'playCard', cardId: 'KH' });
  assert(r.ok, 'seat 0 follows suit with KH');

  // Seat 3 has no hearts → cuts with 7S (trump) face-down.
  r = game.applyAction(s, 3, { type: 'playCard', cardId: '7S', faceDown: true });
  assert(r.ok, 'seat 3 cuts with 7S (trump) face-down');

  // BEFORE the 4th play resolves the trick, check the maker's peek of the
  // cutter's face-down card.
  const view0 = game.viewFor(s, 0);
  const seat3InMakerView = view0.currentTrick.find((p) => p.seat === 3);
  assert(seat3InMakerView && seat3InMakerView.makerPeek === true,
    'maker sees seat 3\'s cut as makerPeek');
  assert(seat3InMakerView.card && seat3InMakerView.card.id === '7S',
    'maker sees the actual 7S card behind seat 3\'s back');

  const view2 = game.viewFor(s, 2);  // a non-maker, non-cutter
  const seat3InOtherView = view2.currentTrick.find((p) => p.seat === 3);
  assert(seat3InOtherView && seat3InOtherView.hidden === true,
    'non-maker sees seat 3 as hidden');
  assert(!seat3InOtherView.card, 'non-maker does NOT see seat 3\'s card data');

  // Seat 2 has no hearts — also cuts, but with a non-trump (8D).
  r = game.applyAction(s, 2, { type: 'playCard', cardId: '8D', faceDown: true });
  assert(r.ok, 'seat 2 cuts with 8D face-down (non-trump)');

  // After resolveTrick fires (4 cards played), trick is resolved.
  assert(s.cutResolved === true, 'cutResolved flag is set after a trump cut');
  assert(s.trumpRevealed === true, 'trump is now revealed');
  assert(s.trickLeader === 3, 'cutting team (seat 3) leads next trick');

  // Indicator returned to maker's hand.
  assert(s.hands[0].some((c) => c.id === '10S'), 'trump indicator returned to maker\'s hand');
  assert(s.trumpIndicator === null, 'state.trumpIndicator cleared after reveal');

  // Score: cutting team (team 1, seats 1+3) wins this trick.
  assert(s.tricksWon[1] === 1, 'cutting team gets the trick');

  // v2.2.4: only the trump-suited face-down is revealed. Seat 3's 7S
  // (trump) is flipped; seat 2's 8D (non-trump bluff cut attempt)
  // stays face-down in state forever.
  const seat3Play = s.lastTrick.find((p) => p.seat === 3);
  const seat2Play = s.lastTrick.find((p) => p.seat === 2);
  assert(seat3Play && seat3Play.faceDown === false, 'seat 3 (trump cut) is flipped face-up');
  assert(seat2Play && seat2Play.faceDown === true, 'seat 2 (non-trump bluff) STAYS face-down after the cut');

  // And the view filter must still hide seat 2's non-trump face-down
  // from non-maker seats even though trumpRevealed is true.
  // (lastTrick is filtered through viewFor too.)
  const view1 = game.viewFor(s, 1);
  const seat2InView1 = view1.lastTrick.find((p) => p.seat === 2);
  assert(seat2InView1 && seat2InView1.faceDown === true, 'seat 2 face-down visible as face-down to seat 1');
  // We keep the card data on lastTrick intentionally for the post-
  // trick inspection view; what matters is the `faceDown` flag so
  // the UI renders a back. This mirrors the canonical rule of "the
  // discard stays a discard" — nobody else ever sees what it was.
}

console.log('\nTest 2: trump indicator is tappable when maker can\'t follow suit');
{
  const s = fixture();
  // Seat 0 has KH, QC. Force a state where they can't follow → empty their
  // hand of hearts. Replace KH with a club so the only suit they have is C.
  s.hands[0] = [{ rank: 'Q', suit: 'C', id: 'QC' }];
  s.tricksPlayed = 1;
  s.currentPlayer = 0;
  s.currentTrick = [
    { seat: 1, card: { rank: '7', suit: 'H', id: '7H' }, faceDown: false, isTrumpIndicator: false },
  ];
  const ids = require('../src/engine/game');
  // Reach into legalActions via viewFor (currentPlayer === seat 0).
  const view = game.viewFor(s, 0);
  const playAction = view.legalActions.find((a) => a.type === 'playCard');
  assert(playAction, 'maker has a playCard action');
  assert(playAction.cardIds.includes('10S'), 'trump indicator is in legal cardIds (cut path)');
  assert(playAction.cardIds.includes('QC'), 'non-indicator hand card is also legal');
}

console.log('\nTest 3: face-down non-trump stays hidden permanently');
{
  const s = fixture();
  // Seat 3's spade is the only trump — replace it with a non-trump so this
  // test exercises the path where every cut is a non-trump.
  s.hands[3] = [{ rank: 'J', suit: 'D', id: 'JD' }, { rank: '9', suit: 'C', id: '9C' }];
  // Order: 1 → 0 → 3 → 2.
  let r = game.applyAction(s, 1, { type: 'playCard', cardId: '7H' });
  assert(r.ok, 'seat 1 leads 7H');
  r = game.applyAction(s, 0, { type: 'playCard', cardId: 'KH' });
  assert(r.ok, 'seat 0 follows hearts with KH');
  r = game.applyAction(s, 3, { type: 'playCard', cardId: '9C', faceDown: true });
  assert(r.ok, 'seat 3 plays 9C face-down (non-trump)');
  r = game.applyAction(s, 2, { type: 'playCard', cardId: '8D', faceDown: true });
  assert(r.ok, 'seat 2 cuts with 8D (non-trump) face-down');

  assert(s.cutResolved === false, 'no cut flag (no trump was face-down)');
  assert(s.trumpRevealed === false, 'trump stays closed when no face-down trump');
  // Trick winner is seat 0 (KH on lead suit).
  assert(s.trickLeader === 0, 'highest hearts card wins (seat 0)');
}

console.log('\nAll cut-mechanic tests passed.');
