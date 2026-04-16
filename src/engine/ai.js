// AI player for 304. See docs/RULES.md "AI Betting Heuristics".
// Exports chooseAction(state, seat) -> action compatible with game.applyAction.

const game = require('./game');
const cards = require('./cards');

const TOP_RANKS = new Set(['J', '9', 'A']);
const MID_RANKS = new Set(['10', 'K', 'Q', '8']);

// --- hand evaluation -------------------------------------------------------

function handStrength(hand) {
  let jacks = 0, nines = 0, aces = 0, tens = 0;
  const topSuits = new Set();
  for (const c of hand) {
    if (c.rank === 'J') { jacks++; topSuits.add(c.suit); }
    else if (c.rank === '9') { nines++; topSuits.add(c.suit); }
    else if (c.rank === 'A') { aces++; topSuits.add(c.suit); }
    else if (c.rank === '10') { tens++; }
  }
  const tops = jacks + nines + aces;
  return {
    jacks, nines, aces, tens,
    tops,
    suits: topSuits.size,
    total: cards.handPoints(hand),
  };
}

function suitCounts(hand) {
  const counts = { S: 0, H: 0, D: 0, C: 0 };
  for (const c of hand) counts[c.suit]++;
  return counts;
}

// --- card helpers ----------------------------------------------------------

function rankOf(c) { return cards.rankValue(c); }

function lowestCard(list) {
  if (!list.length) return null;
  let best = list[0];
  for (let i = 1; i < list.length; i++) {
    if (rankOf(list[i]) < rankOf(best)) best = list[i];
  }
  return best;
}

function highestCard(list) {
  if (!list.length) return null;
  let best = list[0];
  for (let i = 1; i < list.length; i++) {
    if (rankOf(list[i]) > rankOf(best)) best = list[i];
  }
  return best;
}

// lowestBeating: pick the lowest card in `list` that beats `current` given
// trump & lead suits. Returns null if none beats.
function lowestBeating(list, current, trump, lead) {
  const beaters = list.filter((c) => cards.compareCards(c, current, trump, lead) > 0);
  if (!beaters.length) return null;
  return lowestCard(beaters);
}

// --- bidding ---------------------------------------------------------------

function chooseBid(state, seat, legals) {
  const hand = state.hands[seat];
  const s = handStrength(hand);
  const bidEntry = legals.find((a) => a.type === 'bid');
  const amts = (bidEntry && bidEntry.amounts) ? bidEntry.amounts.slice() : [];
  const canPass = legals.some((a) => a.type === 'pass');
  const canAskPartner = legals.some((a) => a.type === 'askPartner');
  const canRedeal = legals.some((a) => a.type === 'demandRedeal');

  // filter 190 from choices
  const filteredAmts = amts.filter((a) => a !== 190);
  const minAllowed = amts.length ? amts[0] : 250;

  // Redeal if offered (game.js already checks handPoints < 15).
  if (canRedeal && s.total < 15) {
    return { type: 'demandRedeal' };
  }

  // Good hand: >= 2 Jacks OR (>= 3 top cards with >= 2 suits among them)
  const good = s.jacks >= 2 || (s.tops >= 3 && s.suits >= 2);
  // Medium hand: 1 top card plus some 10s, or 2 tops
  const medium = !good && (s.tops >= 1 && (s.tops + s.tens) >= 2);
  // else weak

  const askedHere = state.askedPartner && state.askedPartner[seat];
  const bidTurns = (state.bidTurns && state.bidTurns[seat]) || 0;

  // Weak hand: pass if possible.
  if (!good && !medium) {
    if (canPass) return { type: 'pass' };
    // pass should always be legal in bid4 per game.js
  }

  // If asked by partner and must bid >= 200
  if (askedHere && minAllowed >= 200) {
    if (good) {
      // pick 200 if legal else lowest available non-190
      if (filteredAmts.includes(200)) return { type: 'bid', amount: 200 };
      if (filteredAmts.length) return { type: 'bid', amount: filteredAmts[0] };
    }
    // weak/medium and asked: we can still pass
    if (canPass) return { type: 'pass' };
  }

  // 2nd turn with forced floor >= 200 and weak/medium: pass.
  if (bidTurns >= 1 && minAllowed >= 200 && !good) {
    if (canPass) return { type: 'pass' };
  }

  // minAllowed >= 200 and weak: pass.
  if (minAllowed >= 200 && !good && !medium) {
    if (canPass) return { type: 'pass' };
  }

  // askPartner: offer it if first turn, medium (exactly 1 top card), partner present.
  if (canAskPartner && bidTurns === 0 && s.tops === 1 && !good) {
    return { type: 'askPartner' };
  }

  // Good hand: prefer 200 if legal, else 210, else best available non-190.
  if (good && filteredAmts.length) {
    if (filteredAmts.includes(200)) return { type: 'bid', amount: 200 };
    if (filteredAmts.includes(210)) return { type: 'bid', amount: 210 };
    return { type: 'bid', amount: filteredAmts[0] };
  }

  // Medium hand: bid the floor, usually 160-180, not 190.
  if (medium && filteredAmts.length) {
    // cap at 180 for medium
    const capped = filteredAmts.filter((a) => a <= 180);
    if (capped.length) return { type: 'bid', amount: capped[0] };
    // else can't bid low enough; pass
    if (canPass) return { type: 'pass' };
  }

  // fallback
  if (canPass) return { type: 'pass' };
  if (filteredAmts.length) return { type: 'bid', amount: filteredAmts[0] };
  return legals[0];
}

function chooseBid8(state, seat, legals) {
  const hand = state.hands[seat];
  const s = handStrength(hand);
  const bidEntry = legals.find((a) => a.type === 'bid');
  const amts = (bidEntry && bidEntry.amounts) ? bidEntry.amounts.slice() : [];
  const canPass = legals.some((a) => a.type === 'pass');

  // Only bid in 8-card round if >= 5 top cards. Else pass.
  if (s.tops < 5) {
    if (canPass) return { type: 'pass' };
  }

  // 250 only with very strong 8-card hand (5+ tops).
  // Skip 270+ unless 6+ tops.
  const filtered = amts.filter((a) => {
    if (a >= 270 && s.tops < 6) return false;
    return true;
  });

  if (!filtered.length) {
    if (canPass) return { type: 'pass' };
    return legals[0];
  }

  // With 5 tops, bid 250. With 6+ tops, bid 260. With 7+ tops, up to 270.
  let target = 250;
  if (s.tops >= 7) target = 270;
  else if (s.tops >= 6) target = 260;

  // find closest available >= target
  const pick = filtered.find((a) => a >= target) || filtered[0];
  if (pick !== undefined) return { type: 'bid', amount: pick };
  if (canPass) return { type: 'pass' };
  return legals[0];
}

// --- trump pick ------------------------------------------------------------

function choosePickTrump(state, seat, cardIds) {
  const hand = state.hands[seat].filter((c) => cardIds.includes(c.id));
  const counts = suitCounts(hand);

  // sort suits by count desc
  const suitsBy = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  // primary suit: the most frequent non-empty suit
  const primary = suitsBy.find((s) => counts[s] > 0);
  if (!primary) {
    // fallback: pick any card
    return { type: 'pickTrump', cardId: hand[0].id };
  }

  // Among cards of primary suit, prefer a middle-rank indicator so we keep
  // strong trumps in hand. Preference order: 10, K, Q, 8, else lowest.
  const suitCards = hand.filter((c) => c.suit === primary);
  const prefOrder = ['10', 'K', 'Q', '8'];
  for (const r of prefOrder) {
    const found = suitCards.find((c) => c.rank === r);
    if (found) return { type: 'pickTrump', cardId: found.id };
  }
  // else pick lowest in suit (avoid giving up J/9/A)
  const low = lowestCard(suitCards);
  return { type: 'pickTrump', cardId: low.id };
}

// --- open / closed ---------------------------------------------------------

function chooseOpenChoice(state, seat) {
  const hand = state.hands[seat];
  const s = handStrength(hand);
  const bidAmt = state.highBid ? state.highBid.amount : 0;
  if (s.tops >= 6 && bidAmt >= 250) return { type: 'declareOpen' };
  return { type: 'declareClosed' };
}

// --- play ------------------------------------------------------------------

function choosePlayCard(state, seat, cardIds) {
  const pool = state.hands[seat].slice();
  if (state.trumpIndicator && !state.isOpenTrump && seat === state.trumpMaker) {
    pool.push(state.trumpIndicator);
  }
  const hand = pool.filter((c) => cardIds.includes(c.id));
  if (!hand.length) return null;

  const trump = (state.isOpenTrump || state.trumpRevealed) ? state.trumpSuit : null;
  const isLead = state.currentTrick.length === 0;
  const trickLen = state.currentTrick.length;
  const partner = game.partnerOf(seat);

  if (isLead) {
    // Play lowest of longest non-trump suit. If open game and we hold many
    // trumps, lead a high non-trump first to draw out.
    const counts = suitCounts(hand);
    const trumpCount = trump ? counts[trump] : 0;

    const nonTrumpCards = hand.filter((c) => !trump || c.suit !== trump);
    if (nonTrumpCards.length) {
      // find longest non-trump suit
      const byCount = {};
      for (const c of nonTrumpCards) byCount[c.suit] = (byCount[c.suit] || 0) + 1;
      let best = null;
      for (const s of Object.keys(byCount)) {
        if (best === null || byCount[s] > byCount[best]) best = s;
      }
      const suitCards = nonTrumpCards.filter((c) => c.suit === best);

      if (state.isOpenTrump && trumpCount >= 3) {
        // draw out trumps: lead a high non-trump
        const hi = highestCard(suitCards);
        if (hi) return { type: 'playCard', cardId: hi.id };
      }
      const lo = lowestCard(suitCards);
      if (lo) return { type: 'playCard', cardId: lo.id };
    }
    // only trumps left (or forced)
    const lo = lowestCard(hand);
    return { type: 'playCard', cardId: lo.id };
  }

  // Not leading. Determine lead suit and current winner.
  const first = state.currentTrick[0];
  const leadSuit = (first.faceDown && !first.isTrumpIndicator) ? null : first.card.suit;

  // currentWinning: the card currently winning the trick
  let winIdx = 0;
  for (let i = 1; i < state.currentTrick.length; i++) {
    const a = state.currentTrick[i];
    const b = state.currentTrick[winIdx];
    if (a.faceDown && !a.isTrumpIndicator) continue;
    if (b.faceDown && !b.isTrumpIndicator) { winIdx = i; continue; }
    if (cards.compareCards(a.card, b.card, trump, leadSuit) > 0) winIdx = i;
  }
  const winningPlay = state.currentTrick[winIdx];
  const partnerWinning = winningPlay && game.teamOf(winningPlay.seat) === game.teamOf(seat) && winningPlay.seat !== seat;
  const trickPts = state.currentTrick.reduce((s, p) => s + cards.cardPoints(p.card), 0);

  // Check if we're following suit (legalCards only allows leadSuit if any)
  const followingSuit = leadSuit && hand.every((c) => c.suit === leadSuit);

  if (followingSuit) {
    // Must follow suit. Try to beat current winner with the lowest beater.
    // If partner currently winning, dump low.
    if (partnerWinning) {
      const lo = lowestCard(hand);
      return { type: 'playCard', cardId: lo.id };
    }
    const winner = winningPlay.faceDown && !winningPlay.isTrumpIndicator ? null : winningPlay.card;
    if (winner) {
      const beat = lowestBeating(hand, winner, trump, leadSuit);
      if (beat) return { type: 'playCard', cardId: beat.id };
    }
    const lo = lowestCard(hand);
    return { type: 'playCard', cardId: lo.id };
  }

  // Can't follow suit.
  const inClosed = !state.isOpenTrump && !state.trumpRevealed;
  const trumpsInHand = trump ? hand.filter((c) => c.suit === trump) : [];
  const nonTrumps = trump ? hand.filter((c) => c.suit !== trump) : hand.slice();

  if (inClosed) {
    // Closed game. We'll be playing face-down (enforced by game.js).
    // Cut with a low trump only if partner NOT winning AND trick has >= 10 pts.
    if (!partnerWinning && trickPts >= 10 && trumpsInHand.length) {
      // Don't waste a high trump on a face-down cut; pick the lowest trump.
      const lo = lowestCard(trumpsInHand);
      return { type: 'playCard', cardId: lo.id, faceDown: true };
    }
    // Otherwise dump a cheap non-trump face-down.
    if (nonTrumps.length) {
      const lo = lowestCard(nonTrumps);
      return { type: 'playCard', cardId: lo.id, faceDown: true };
    }
    // only trumps left — play lowest trump (face-down if needed)
    const lo = lowestCard(hand);
    return { type: 'playCard', cardId: lo.id, faceDown: true };
  }

  // Open game, can't follow.
  if (partnerWinning) {
    // Dump a low non-trump.
    if (nonTrumps.length) {
      const lo = lowestCard(nonTrumps);
      return { type: 'playCard', cardId: lo.id };
    }
    // only trumps left, play lowest trump
    const lo = lowestCard(trumpsInHand.length ? trumpsInHand : hand);
    return { type: 'playCard', cardId: lo.id };
  }

  // Try to win with a low trump if the trick has value.
  if (trumpsInHand.length && trickPts >= 10) {
    // Prefer a trump that actually beats current winner if it's already a trump.
    const currentCard = winningPlay && !(winningPlay.faceDown && !winningPlay.isTrumpIndicator) ? winningPlay.card : null;
    if (currentCard && currentCard.suit === trump) {
      const beat = lowestBeating(trumpsInHand, currentCard, trump, leadSuit);
      if (beat) return { type: 'playCard', cardId: beat.id };
      // can't beat an existing trump; dump low non-trump instead
      if (nonTrumps.length) return { type: 'playCard', cardId: lowestCard(nonTrumps).id };
      return { type: 'playCard', cardId: lowestCard(hand).id };
    }
    const lo = lowestCard(trumpsInHand);
    return { type: 'playCard', cardId: lo.id };
  }

  // Low-value trick and partner not winning: dump cheapest non-trump.
  if (nonTrumps.length) {
    const lo = lowestCard(nonTrumps);
    return { type: 'playCard', cardId: lo.id };
  }
  const lo = lowestCard(hand);
  return { type: 'playCard', cardId: lo.id };
}

// --- dispatch --------------------------------------------------------------

function chooseAction(state, seat) {
  const legals = game.legalActions(state, seat);
  if (!legals || !legals.length) return null;

  switch (state.phase) {
    case game.PHASES.BID4:
      return chooseBid(state, seat, legals);
    case game.PHASES.BID8:
      return chooseBid8(state, seat, legals);
    case game.PHASES.TRUMP_PICK1:
    case game.PHASES.TRUMP_PICK2: {
      const entry = legals.find((a) => a.type === 'pickTrump');
      if (!entry) return null;
      return choosePickTrump(state, seat, entry.cardIds);
    }
    case game.PHASES.OPEN_CHOICE:
      return chooseOpenChoice(state, seat);
    case game.PHASES.PLAY: {
      const entry = legals.find((a) => a.type === 'playCard');
      if (!entry) return null;
      return choosePlayCard(state, seat, entry.cardIds);
    }
    case game.PHASES.INSPECT:
    case game.PHASES.HAND_END:
      return { type: 'continue' };
    default:
      return legals[0];
  }
}

module.exports = { chooseAction };
