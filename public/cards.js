// public/cards.js
// DOM-only card rendering. No deps. Mirrors internal shape in src/engine/cards.js.
// Ranks (ascending): 7, 8, Q, K, 10, A, 9, J.  Suits: S, H, D, C.

(function (global) {
  'use strict';

  const SUIT_SYMBOLS = { S: '\u2660', H: '\u2665', D: '\u2666', C: '\u2663' };
  const SUIT_COLORS  = { S: 'black', C: 'black', H: 'red', D: 'red' };

  function suitSymbol(s) { return SUIT_SYMBOLS[s] || '?'; }
  function suitColor(s)  { return SUIT_COLORS[s] || 'black'; }

  // Display rank matches the card face — '10' stays '10'; others are one char.
  function displayRank(r) {
    if (r === '10') return '10';
    return r; // 'J','9','A','K','Q','8','7'
  }

  function makeCorner(rank, suit, mirrored) {
    const corner = document.createElement('div');
    corner.className = mirrored ? 'card-rank-bl' : 'card-rank';
    const r = document.createElement('span');
    r.className = 'c-rank';
    r.textContent = displayRank(rank);
    const s = document.createElement('span');
    s.className = 'c-suit';
    s.textContent = suitSymbol(suit);
    corner.appendChild(r);
    corner.appendChild(s);
    return corner;
  }

  // Render a face-up card; options:
  //   faceDown:bool, legal:bool, selected:bool, onClick:fn(card, el)
  //   small:bool (for trick display optional)
  function render(card, opts) {
    opts = opts || {};
    const el = document.createElement('div');
    el.className = 'card';
    if (card && card.id) el.dataset.cardId = card.id;

    if (opts.faceDown || !card) {
      el.classList.add('face-down');
      return decorate(el, opts, card);
    }

    el.classList.add('suit-' + card.suit.toLowerCase());
    el.classList.add('color-' + suitColor(card.suit));

    el.appendChild(makeCorner(card.rank, card.suit, false));

    // Big center pip
    const center = document.createElement('div');
    center.className = 'card-center';
    center.textContent = suitSymbol(card.suit);
    el.appendChild(center);

    el.appendChild(makeCorner(card.rank, card.suit, true));

    return decorate(el, opts, card);
  }

  function decorate(el, opts, card) {
    if (opts.legal) el.classList.add('legal');
    if (opts.selected) el.classList.add('selected');
    if (opts.small) el.classList.add('small');
    if (typeof opts.onClick === 'function') {
      el.addEventListener('click', function (ev) {
        ev.stopPropagation();
        opts.onClick(card, el);
      });
    }
    return el;
  }

  function renderBack(opts) {
    return render(null, Object.assign({}, opts || {}, { faceDown: true }));
  }

  global.Cards = {
    render: render,
    renderBack: renderBack,
    suitSymbol: suitSymbol,
    suitColor: suitColor,
    displayRank: displayRank
  };
})(window);
