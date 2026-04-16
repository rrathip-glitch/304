// Pure-function tests for src/engine/cards.js.

const { ok, assert } = require('./helpers');
const cards = require('../src/engine/cards');

ok('deck has 32 unique cards', () => {
  const d = cards.makeDeck();
  assert.equal(d.length, 32, 'deck size');
  const ids = new Set(d.map((c) => c.id));
  assert.equal(ids.size, 32, 'ids unique');
});

ok('point values sum to 304', () => {
  const d = cards.makeDeck();
  const sum = d.reduce((s, c) => s + cards.cardPoints(c), 0);
  assert.equal(sum, 304);
  assert.equal(cards.TOTAL_POINTS, 304);
});

ok('displayPoints(304) === 30.4, (11) === 1.1, (30) === 3', () => {
  assert.equal(cards.displayPoints(304), 30.4);
  assert.equal(cards.displayPoints(11), 1.1);
  assert.equal(cards.displayPoints(30), 3);
});

ok('rankValue order J>9>A>10>K>Q>8>7 (strictly increasing from 7 up)', () => {
  const mkC = (r) => ({ rank: r, suit: 'S', id: r + 'S' });
  const order = ['7', '8', 'Q', 'K', '10', 'A', '9', 'J'];
  for (let i = 1; i < order.length; i++) {
    const a = cards.rankValue(mkC(order[i - 1]));
    const b = cards.rankValue(mkC(order[i]));
    assert.ok(b > a, `rank ${order[i]} should outrank ${order[i - 1]} (got ${a} vs ${b})`);
  }
});

ok('compareCards: trump beats non-trump', () => {
  const trump = 'S';
  const lead = 'H';
  const a = { rank: '7', suit: 'S', id: '7S' }; // tiny trump
  const b = { rank: 'J', suit: 'H', id: 'JH' }; // big non-trump (leads)
  assert.ok(cards.compareCards(a, b, trump, lead) > 0, 'trump must beat lead');
});

ok('compareCards: two trumps compare by rank', () => {
  const t = 'S';
  const high = { rank: 'J', suit: 'S', id: 'JS' };
  const low = { rank: '7', suit: 'S', id: '7S' };
  assert.ok(cards.compareCards(high, low, t, 'H') > 0);
  assert.ok(cards.compareCards(low, high, t, 'H') < 0);
});

ok('compareCards: two lead-suit cards compare by rank', () => {
  const lead = 'H';
  const high = { rank: '9', suit: 'H', id: '9H' };
  const low = { rank: 'Q', suit: 'H', id: 'QH' };
  assert.ok(cards.compareCards(high, low, 'S', lead) > 0);
});

ok('compareCards: off-suit non-trump returns 0', () => {
  const a = { rank: 'J', suit: 'D', id: 'JD' };
  const b = { rank: 'J', suit: 'C', id: 'JC' };
  assert.equal(cards.compareCards(a, b, 'S', 'H'), 0);
});

ok('winningIndex: trump J wins over lead 7S & 8S with trump=S', () => {
  const played = [
    { card: { rank: '7', suit: 'S', id: '7S' }, faceDown: false, isTrumpIndicator: false },
    { card: { rank: '8', suit: 'S', id: '8S' }, faceDown: false, isTrumpIndicator: false },
    { card: { rank: 'J', suit: 'S', id: 'JS' }, faceDown: false, isTrumpIndicator: false },
  ];
  const wi = cards.winningIndex(played, 'S', 'S', true);
  assert.equal(wi, 2, 'J of trump suit wins');
});

ok('winningIndex: face-down non-trump discard never wins', () => {
  const played = [
    { card: { rank: '7', suit: 'H', id: '7H' }, faceDown: false, isTrumpIndicator: false },
    // A face-down non-trump card. Even though J>7, it's a discard and cannot win.
    { card: { rank: 'J', suit: 'D', id: 'JD' }, faceDown: true, isTrumpIndicator: false },
  ];
  const wi = cards.winningIndex(played, 'S', 'H', true);
  assert.equal(wi, 0, 'discarded J does not win');
});

ok('legalCards: if has lead suit, only lead-suit cards', () => {
  const hand = [
    { rank: '7', suit: 'H', id: '7H' },
    { rank: 'K', suit: 'H', id: 'KH' },
    { rank: 'A', suit: 'S', id: 'AS' },
  ];
  const legal = cards.legalCards(hand, 'H');
  assert.equal(legal.length, 2);
  assert.ok(legal.every((c) => c.suit === 'H'));
});

ok('legalCards: if void, all cards', () => {
  const hand = [
    { rank: '7', suit: 'D', id: '7D' },
    { rank: 'J', suit: 'S', id: 'JS' },
  ];
  const legal = cards.legalCards(hand, 'H');
  assert.equal(legal.length, 2);
});
