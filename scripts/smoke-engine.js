#!/usr/bin/env node
// Deterministic smoke test for the 304 engine. Drives the state machine end
// to end with a trivial bot strategy (first bidder in a known rotation wins
// with a fixed amount; pickTrump picks hand[0]; playCard picks legal[0]).
// Usage: node scripts/smoke-engine.js [seed] [amount] [maxHands]
//
// Exits 0 on success; exits 1 if any hand dead-ends.

const path = require('path');
const G = require(path.join(__dirname, '..', 'src', 'engine', 'game'));

const seed = Number(process.argv[2] || 42);
const amount = Number(process.argv[3] || 200);
const maxHands = Number(process.argv[4] || 200);

function lcg(s) {
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const rng = lcg(seed);

function driveBid(st, bidderSeat, amt) {
  let bidsTaken = 0;
  while (st.phase === 'bid4') {
    if (!bidsTaken && st.currentBidder === bidderSeat) {
      st = G.applyAction(st, st.currentBidder, { type: 'bid', amount: amt }, { rng });
      bidsTaken = 1;
    } else {
      st = G.applyAction(st, st.currentBidder, { type: 'pass' }, { rng });
    }
  }
  return st;
}

let s = G.createGame('smoke');
for (let i = 0; i < 4; i++) {
  s = G.seatPlayer(s, { seat: i, name: `P${i}`, isAI: false });
}
s = G.startHand(s, rng);

let hand = 0;
let totals = { completed: 0, abandoned: 0, inspects: 0, reveals: 0, tricks: 0 };
const rotation = [3, 2, 1, 0];

while (s.phase !== 'game_over' && hand < maxHands) {
  hand++;
  const bidder = rotation[hand % 4];
  s = driveBid(s, bidder, amount);
  if (s.phase !== 'trump_pick1') { totals.abandoned++; continue; }

  s = G.applyAction(s, s.trumpMaker, {
    type: 'pickTrump', cardId: s.hands[s.trumpMaker][0].id,
  });
  while (s.phase === 'bid8') {
    s = G.applyAction(s, s.currentBidder, { type: 'pass' });
  }
  s = G.applyAction(s, s.trumpMaker, { type: 'declareClosed' });

  while (s.phase !== 'hand_end' && s.phase !== 'game_over') {
    if (s.phase === 'inspect') {
      totals.inspects++;
      const before = s.trumpRevealed;
      s = G.applyAction(s, s.trumpMaker, { type: 'continue' });
      if (!before && s.trumpRevealed) totals.reveals++;
      continue;
    }
    if (s.phase !== 'play') {
      console.error(`unexpected phase ${s.phase} at hand ${hand}`);
      process.exit(1);
    }
    const legal = G.legalActions(s, s.currentPlayer);
    const ids = legal[0] && legal[0].cardIds || [];
    if (!ids.length) {
      console.error(
        `DEAD END hand=${hand} phase=${s.phase} player=${s.currentPlayer} ` +
        `hand=${JSON.stringify(s.hands[s.currentPlayer].map(c => c.id))} ` +
        `indicator=${s.trumpIndicator?.id} indicatorPlayed=${!!s._indicatorPlayed} ` +
        `trumpRevealed=${s.trumpRevealed}`
      );
      process.exit(1);
    }
    s = G.applyAction(s, s.currentPlayer, { type: 'playCard', cardId: ids[0] });
  }

  totals.completed++;
  totals.tricks += s.tricksPlayed;
  const sum = s.trickPoints[0] + s.trickPoints[1];
  if (sum !== 304) {
    console.error(`points sum=${sum} (expected 304) at hand ${hand}`);
    process.exit(1);
  }

  if (s.phase !== 'game_over') {
    s = G.applyAction(s, 0, { type: 'continue' }, { rng });
  }
}

console.log(JSON.stringify({
  final: s.phase,
  tokens: s.tokens,
  handsPlayed: s.handNumber,
  ...totals,
}, null, 2));
process.exit(0);
