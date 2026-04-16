// Browser-side card module for 304. Exposes a global `Cards`.
// Mirrors src/engine/cards.js. Ranking high->low: J > 9 > A > 10 > K > Q > 8 > 7
// Internal points: J=30, 9=20, A=11, 10=10, K=3, Q=2, 8=0, 7=0 (total 304).
// Display = internal/10 (J=3, A=1.1, etc).

(function () {
  const SUITS = ['S', 'H', 'D', 'C'];
  const RANKS = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];
  const POINTS = { J: 30, '9': 20, A: 11, '10': 10, K: 3, Q: 2, '8': 0, '7': 0 };
  const RANK_ORDER = { '7': 0, '8': 1, Q: 2, K: 3, '10': 4, A: 5, '9': 6, J: 7 };
  const SUIT_NAMES = { S: 'Spades', H: 'Hearts', D: 'Diamonds', C: 'Clubs' };
  const SUIT_SYMBOLS = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
  const SUIT_IS_RED = { H: true, D: true, S: false, C: false };

  function makeDeck() {
    const d = [];
    for (const s of SUITS) for (const r of RANKS) d.push({ suit: s, rank: r, id: r + s });
    return d;
  }
  function shuffle(deck, rng) {
    rng = rng || Math.random;
    const a = deck.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function cardPoints(c) { return POINTS[c.rank]; }
  function rankValue(c) { return RANK_ORDER[c.rank]; }
  function handPoints(h) { return h.reduce(function (s, c) { return s + cardPoints(c); }, 0); }

  function compareCards(a, b, trump, lead) {
    const aT = !!trump && a.suit === trump, bT = !!trump && b.suit === trump;
    if (aT && !bT) return 1;
    if (!aT && bT) return -1;
    if (aT && bT) return rankValue(a) - rankValue(b);
    const aL = a.suit === lead, bL = b.suit === lead;
    if (aL && !bL) return 1;
    if (!aL && bL) return -1;
    if (aL && bL) return rankValue(a) - rankValue(b);
    return 0;
  }

  // played: [{seat, card, faceDown, isTrumpIndicator}]
  // If faceDownIsHidden is true, face-down non-indicator cards cannot win.
  function winningPlayIndex(played, trump, lead, faceDownIsHidden) {
    let bestIdx = -1;
    for (let i = 0; i < played.length; i++) {
      const p = played[i];
      if (faceDownIsHidden && p.faceDown && !p.isTrumpIndicator) continue;
      if (bestIdx === -1) { bestIdx = i; continue; }
      if (compareCards(p.card, played[bestIdx].card, trump, lead) > 0) bestIdx = i;
    }
    return bestIdx === -1 ? 0 : bestIdx;
  }

  function legalFollow(hand, lead) {
    if (!lead) return hand.slice();
    const same = hand.filter(function (c) { return c.suit === lead; });
    return same.length ? same : hand.slice();
  }

  function sortHand(hand) {
    // Group by suit in fixed order, within suit sort low->high
    const order = { S: 0, H: 1, C: 2, D: 3 };
    return hand.slice().sort(function (a, b) {
      if (a.suit !== b.suit) return order[a.suit] - order[b.suit];
      return rankValue(a) - rankValue(b);
    });
  }

  function rankLabel(c) { return c.rank === '10' ? '10' : c.rank; }
  function displayPoints(internal) { return Math.round(internal) / 10; }

  // Render a card DOM element (face-up).
  function renderCard(c, extraClasses) {
    const el = document.createElement('div');
    el.className = 'card ' + (SUIT_IS_RED[c.suit] ? 'red ' : '') + (extraClasses || '');
    el.dataset.id = c.id;
    const rank = document.createElement('span');
    rank.className = 'rank';
    rank.textContent = rankLabel(c);
    const suit = document.createElement('span');
    suit.className = 'suit';
    suit.textContent = SUIT_SYMBOLS[c.suit];
    const big = document.createElement('span');
    big.className = 'big';
    big.textContent = SUIT_SYMBOLS[c.suit];
    el.appendChild(rank);
    el.appendChild(suit);
    el.appendChild(big);
    return el;
  }

  // Render a face-down card back.
  function renderBack(extraClasses) {
    const el = document.createElement('div');
    el.className = 'card back ' + (extraClasses || '');
    return el;
  }

  // Render a mini card (opponent hand).
  function renderMini() {
    const el = document.createElement('div');
    el.className = 'card mini';
    return el;
  }

  window.Cards = {
    SUITS: SUITS, RANKS: RANKS, POINTS: POINTS, RANK_ORDER: RANK_ORDER,
    SUIT_NAMES: SUIT_NAMES, SUIT_SYMBOLS: SUIT_SYMBOLS, SUIT_IS_RED: SUIT_IS_RED,
    makeDeck: makeDeck, shuffle: shuffle,
    cardPoints: cardPoints, rankValue: rankValue, handPoints: handPoints,
    compareCards: compareCards, winningPlayIndex: winningPlayIndex,
    legalFollow: legalFollow, sortHand: sortHand,
    rankLabel: rankLabel, displayPoints: displayPoints,
    renderCard: renderCard, renderBack: renderBack, renderMini: renderMini
  };
})();
