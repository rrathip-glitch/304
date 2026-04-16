// 304 - Sri Lankan card game
// Deck: 32 cards (7,8,9,10,J,Q,K,A of 4 suits)
// Ranking high->low: J > 9 > A > 10 > K > Q > 8 > 7
//
// Display points (per user): J=3, 9=2, A=1.1, 10=1, K=0.3, Q=0.2, 8=0, 7=0
// Total shown to players = 30.4. Internally we store ×10 as integers for
// exact arithmetic (J=30, 9=20, A=11, 10=10, K=3, Q=2; total 304).
// Bids entered in integer units of 10 internally (min 160), displayed /10.

const SUITS = ['S', 'H', 'D', 'C']; // spades, hearts, diamonds, clubs
const RANKS = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J']; // ascending strength

const POINTS = { J: 30, '9': 20, A: 11, '10': 10, K: 3, Q: 2, '8': 0, '7': 0 };
const TOTAL_POINTS = 304;

// Display helper: internal units -> display number (10 -> 1, 11 -> 1.1, etc.)
function displayPoints(internal) { return Math.round(internal) / 10; }
const RANK_ORDER = { '7': 0, '8': 1, Q: 2, K: 3, '10': 4, A: 5, '9': 6, J: 7 };

const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
const SUIT_SYMBOLS = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };

function makeDeck() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ suit: s, rank: r, id: r + s });
  return d;
}

function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cardPoints(c) { return POINTS[c.rank]; }
function rankValue(c) { return RANK_ORDER[c.rank]; }
function handPoints(hand) { return hand.reduce((s, c) => s + cardPoints(c), 0); }

// Compare two cards played to a trick. Returns >0 if a beats b, <0 otherwise.
// trump may be null (no trump / pure lead-suit comparison).
function compareCards(a, b, trump, lead) {
  const aT = trump && a.suit === trump, bT = trump && b.suit === trump;
  if (aT && !bT) return 1;
  if (!aT && bT) return -1;
  if (aT && bT) return rankValue(a) - rankValue(b);
  const aL = a.suit === lead, bL = b.suit === lead;
  if (aL && !bL) return 1;
  if (!aL && bL) return -1;
  if (aL && bL) return rankValue(a) - rankValue(b);
  return 0;
}

// Given an ordered array of played cards, return index of winning card.
// playedCards: [{card, faceDown, isTrumpIndicator}]
// If a card is faceDown and NOT a trump indicator that's been revealed, it
// cannot win a trick — it was a discard.
function winningIndex(played, trump, lead, faceDownIsHidden) {
  const effective = played.map((p, i) => {
    // A face-down discard (not a trump) never wins.
    if (faceDownIsHidden && p.faceDown && !p.isTrumpIndicator) return null;
    return { card: p.card, i };
  }).filter(Boolean);
  if (effective.length === 0) return 0;
  let best = effective[0];
  for (let k = 1; k < effective.length; k++) {
    if (compareCards(effective[k].card, best.card, trump, lead) > 0) best = effective[k];
  }
  return best.i;
}

// Legal cards a player can play. If can follow suit, must. Otherwise any card.
// Does NOT enforce trump-indicator restriction (handled at game layer).
function legalCards(hand, lead) {
  if (!lead) return hand.slice();
  const matches = hand.filter(c => c.suit === lead);
  return matches.length ? matches : hand.slice();
}

module.exports = {
  SUITS, RANKS, POINTS, RANK_ORDER, SUIT_NAMES, SUIT_SYMBOLS, TOTAL_POINTS,
  makeDeck, shuffle, cardPoints, rankValue, handPoints,
  compareCards, winningIndex, legalCards, displayPoints
};
