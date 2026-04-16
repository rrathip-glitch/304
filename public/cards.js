/* 304 — card rendering helpers (browser)
 *
 * Exposes a single global `Cards` with:
 *   Cards.SUIT_SYMBOL, Cards.SUIT_NAME, Cards.SUIT_COLOR
 *   Cards.RANK_LABEL, Cards.RANK_POINTS, Cards.RANK_ORDER
 *   Cards.displayPoints(internal)
 *   Cards.element({ suit, rank }, { mini, faceDown, indicator }) -> HTMLElement
 *   Cards.back({ mini }) -> HTMLElement
 *   Cards.facedown({ mini }) -> HTMLElement
 *   Cards.sortHand(cards, trumpSuit?) -> sorted copy
 *
 * No dependencies. No framework. Returns DOM elements you can append.
 * Kept in sync with server-side src/engine/cards.js for rank/point values.
 */
(function (global) {
  const SUIT_SYMBOL = { S: "\u2660", H: "\u2665", D: "\u2666", C: "\u2663" };
  const SUIT_NAME = { S: "Spades", H: "Hearts", D: "Diamonds", C: "Clubs" };
  // Hearts and diamonds render red; spades and clubs render dark.
  const SUIT_COLOR = { S: "black", H: "red", D: "red", C: "black" };

  // Display label shown in corners and center. "10" is a little wider; we
  // keep the label tight so it fits in the 56×80 card face.
  const RANK_LABEL = {
    "7": "7", "8": "8", "9": "9", "10": "10",
    J: "J", Q: "Q", K: "K", A: "A",
  };

  // Internal (×10) point values. Mirrors src/engine/cards.js POINTS.
  const RANK_POINTS = { J: 30, "9": 20, A: 11, "10": 10, K: 3, Q: 2, "8": 0, "7": 0 };

  // Ascending strength: 7 < 8 < Q < K < 10 < A < 9 < J.
  const RANK_ORDER = { "7": 0, "8": 1, Q: 2, K: 3, "10": 4, A: 5, "9": 6, J: 7 };

  function displayPoints(internal) {
    return Math.round(internal) / 10;
  }

  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === "class") node.className = attrs[k];
        else if (k === "dataset") Object.assign(node.dataset, attrs[k]);
        else if (k.startsWith("on") && typeof attrs[k] === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) {
          node.setAttribute(k, attrs[k]);
        }
      }
    }
    if (children) {
      for (const c of children) {
        if (c == null) continue;
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  // Public: build a face-up card element for a {suit, rank} card.
  function element(card, opts = {}) {
    if (!card) return facedown(opts);
    const classes = ["card"];
    if (opts.mini) classes.push("mini");
    if (SUIT_COLOR[card.suit] === "red") classes.push("red");
    if (opts.indicator) classes.push("indicator");
    if (opts.extraClass) classes.push(opts.extraClass);

    const rank = RANK_LABEL[card.rank] || card.rank;
    const suit = SUIT_SYMBOL[card.suit] || "?";

    const node = el(
      "div",
      {
        class: classes.join(" "),
        dataset: { cardId: card.id || rank + card.suit, suit: card.suit, rank: card.rank },
        role: opts.role || "img",
        "aria-label": `${card.rank} of ${SUIT_NAME[card.suit]}`,
      },
      [
        el("span", { class: "corner tl" }, [
          el("span", { class: "rank" }, [rank]),
          el("span", { class: "suit" }, [suit]),
        ]),
        el("span", { class: "center" }, [suit]),
        el("span", { class: "corner br" }, [
          el("span", { class: "rank" }, [rank]),
          el("span", { class: "suit" }, [suit]),
        ]),
      ]
    );
    return node;
  }

  // Public: face-down opponent card (hidden back pattern).
  function back(opts = {}) {
    const classes = ["card", "back"];
    if (opts.mini) classes.push("mini");
    return el("div", { class: classes.join(" "), "aria-label": "Hidden card" });
  }

  // Public: a discarded face-down card on the table (different art to
  // distinguish from opponent backs — signals "can't win this trick").
  function facedown(opts = {}) {
    const classes = ["card", "facedown"];
    if (opts.mini) classes.push("mini");
    if (opts.indicator) classes.push("indicator");
    return el("div", {
      class: classes.join(" "),
      "aria-label": opts.indicator ? "Trump indicator (face-down)" : "Face-down card",
    });
  }

  // Sort a hand for display. Groups by suit (trump last so it's easy to
  // tap on the right of the fan), then by descending rank strength.
  function sortHand(cards, trumpSuit) {
    const order = { S: 0, H: 1, D: 2, C: 3 };
    const withTrump = { ...order };
    if (trumpSuit) {
      // Move trump to highest index so it sits on the right of the fan.
      for (const s in withTrump) withTrump[s] = s === trumpSuit ? 4 : withTrump[s];
    }
    return cards.slice().sort((a, b) => {
      const sa = withTrump[a.suit] ?? 5;
      const sb = withTrump[b.suit] ?? 5;
      if (sa !== sb) return sa - sb;
      return RANK_ORDER[b.rank] - RANK_ORDER[a.rank];
    });
  }

  global.Cards = {
    SUIT_SYMBOL,
    SUIT_NAME,
    SUIT_COLOR,
    RANK_LABEL,
    RANK_POINTS,
    RANK_ORDER,
    displayPoints,
    element,
    back,
    facedown,
    sortHand,
  };
})(window);
