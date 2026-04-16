// 304 game engine — pure state machine. Server calls createGame / seatPlayer /
// startHand / applyAction / legalActions / viewFor. No I/O here.
//
// Rules source: docs/RULES.md (household variant). When in doubt, read that.
// Turn direction is counter-clockwise: next(p) = (p + 3) % 4.
// Teams: {0,2} vs {1,3}.

const {
  makeDeck, shuffle, cardPoints, handPoints, legalCards,
  compareCards, winningIndex, TOTAL_POINTS
} = require('./cards');

const MIN_BID_4 = 160;
const MIN_BID_8 = 250;
const BID_STEP = 10;
const REDEAL_THRESHOLD = 15;       // internal units
const STARTING_TOKENS = 11;        // per team
const MAX_TOKENS = 22;

const next = (p) => (p + 3) % 4;
const teamOf = (seat) => seat % 2;
const partnerOf = (seat) => (seat + 2) % 4;

// --------------------------------------------------------------------------
// State factories
// --------------------------------------------------------------------------

function createGame(roomId = 'local') {
  return {
    roomId,
    phase: 'waiting',
    seats: [null, null, null, null], // {name, isAI, connected}
    dealer: 0,
    handNumber: 0,
    tokens: [STARTING_TOKENS, STARTING_TOKENS],
    message: 'Waiting for players',
    log: [],

    // per-hand (reset at startHand)
    hands: [[], [], [], []],
    bids: [],
    currentBidder: null,
    passedSeats: [],
    participated: [],             // seats that have taken a bid4 turn
    restrictedTo200: [],          // seats whose next bid must be ≥200
    askedPartnerPair: null,       // [asker, partner] once asked
    highBid: null,                // { amount, bidder, isCloseCaps }
    trumpMaker: null,
    trumpIndicator: null,         // {suit, rank, id} only visible to trumpMaker while closed
    trumpSuit: null,
    isOpenTrump: false,
    trumpRevealed: false,
    closeCaps: false,
    currentTrick: [],             // [{seat, card, faceDown, isTrumpIndicator}]
    trickLeader: null,
    currentPlayer: null,
    tricksWon: [0, 0],
    trickPoints: [0, 0],          // internal units
    tricksPlayed: 0,
    lastTrick: null,
  };
}

function seatPlayer(state, { seat, name, isAI = false }) {
  if (state.phase !== 'waiting') throw new Error('seatPlayer: game already started');
  if (seat < 0 || seat > 3) throw new Error('seatPlayer: seat out of range');
  if (state.seats[seat]) throw new Error(`seatPlayer: seat ${seat} already occupied`);
  const s = structuredClone(state);
  s.seats[seat] = { name, isAI, connected: true };
  s.message = `${name} took seat ${seat}`;
  s.log = appendLog(s.log, s.message);
  return s;
}

// --------------------------------------------------------------------------
// Dealing
// --------------------------------------------------------------------------

function startHand(state, rng = Math.random) {
  if (state.seats.some((s) => s === null)) {
    throw new Error('startHand: all 4 seats must be filled');
  }
  const s = structuredClone(state);
  s.handNumber += 1;
  s.phase = 'bid4';
  s.bids = [];
  s.passedSeats = [];
  s.participated = [];
  s.restrictedTo200 = [];
  s.askedPartnerPair = null;
  s.highBid = null;
  s.trumpMaker = null;
  s.trumpIndicator = null;
  s.trumpSuit = null;
  s.isOpenTrump = false;
  s.trumpRevealed = false;
  s.closeCaps = false;
  s.currentTrick = [];
  s.trickLeader = null;
  s.currentPlayer = null;
  s.tricksWon = [0, 0];
  s.trickPoints = [0, 0];
  s.tricksPlayed = 0;
  s.lastTrick = null;

  // Deal first 4 cards to each seat, CCW starting from dealer's right.
  const deck = shuffle(makeDeck(), rng);
  s._remainingDeck = deck.slice(16); // keep 16 for second batch
  const firstBatch = deck.slice(0, 16);
  const hands = [[], [], [], []];
  let seat = next(s.dealer);
  for (let i = 0; i < 16; i++) {
    hands[seat].push(firstBatch[i]);
    seat = next(seat);
  }
  s.hands = hands;

  s.currentBidder = next(s.dealer);
  s.message = `Hand ${s.handNumber}: seat ${s.currentBidder} opens bidding`;
  s.log = appendLog(s.log, s.message);
  return s;
}

// --------------------------------------------------------------------------
// Legal actions
// --------------------------------------------------------------------------

function legalActions(state, seat) {
  if (seat !== state.currentPlayer && seat !== state.currentBidder) return [];
  switch (state.phase) {
    case 'bid4': return legalBid4Actions(state, seat);
    case 'trump_pick1':
    case 'trump_pick2':
      return legalTrumpPickActions(state, seat);
    case 'bid8': return legalBid8Actions(state, seat);
    default: return [];
  }
}

function legalTrumpPickActions(state, seat) {
  if (seat !== state.currentPlayer) return [];
  if (seat !== state.trumpMaker) return [];
  const cardIds = state.hands[seat].map((c) => c.id);
  return [{ type: 'pickTrump', cardIds }];
}

function legalBid8Actions(state, seat) {
  if (seat !== state.currentBidder) return [];
  const actions = [];
  const partnerOfHigh = state.highBid ? partnerOf(state.highBid.bidder) : null;
  // Forced pass if your partner currently holds the high bid.
  if (partnerOfHigh === seat) {
    return [{ type: 'pass' }];
  }
  actions.push({ type: 'pass' });
  const minRaw = Math.max(MIN_BID_8, (state.highBid?.amount ?? 0) + BID_STEP);
  const amounts = [];
  // Convention rarely above 260 but engine allows 260 / 270 / 280; AI caps.
  for (let a = minRaw; a <= 280; a += BID_STEP) amounts.push(a);
  if (amounts.length) actions.push({ type: 'bid', amounts });
  return actions;
}

function legalBid4Actions(state, seat) {
  if (seat !== state.currentBidder) return [];
  const actions = [];

  // pass is always available.
  actions.push({ type: 'pass' });

  // bid — compute allowed amounts.
  const minRaw = state.highBid ? state.highBid.amount + BID_STEP : MIN_BID_4;
  const floorBecauseRestricted = state.restrictedTo200.includes(seat);
  const partnerIsHigh =
    state.highBid && state.highBid.bidder !== null &&
    partnerOf(state.highBid.bidder) === seat;
  const effectiveMin = Math.max(
    minRaw,
    floorBecauseRestricted || partnerIsHigh ? 200 : MIN_BID_4
  );
  const amounts = [];
  for (let amt = effectiveMin; amt <= 240; amt += BID_STEP) amounts.push(amt);
  if (amounts.length) actions.push({ type: 'bid', amounts });

  // askPartner — first turn only, partner hasn't participated either.
  const partner = partnerOf(seat);
  if (
    !state.participated.includes(seat) &&
    !state.participated.includes(partner) &&
    !state.askedPartnerPair
  ) {
    actions.push({ type: 'askPartner' });
  }

  // demandRedeal — only dealer's right, only on their first turn, only if
  // their 4-card hand has < 15 internal pts.
  if (
    seat === next(state.dealer) &&
    !state.participated.includes(seat) &&
    handPoints(state.hands[seat]) < REDEAL_THRESHOLD
  ) {
    actions.push({ type: 'demandRedeal' });
  }

  return actions;
}

// --------------------------------------------------------------------------
// applyAction
// --------------------------------------------------------------------------

function applyAction(state, seat, action) {
  switch (state.phase) {
    case 'bid4': return applyBid4(state, seat, action);
    case 'trump_pick1': return applyTrumpPick(state, seat, action, /*afterBid8*/ false);
    case 'bid8': return applyBid8(state, seat, action);
    case 'trump_pick2': return applyTrumpPick(state, seat, action, /*afterBid8*/ true);
    default:
      throw new Error(`applyAction: phase ${state.phase} not implemented`);
  }
}

// --- trump_pick1 / trump_pick2 --------------------------------------------

function applyTrumpPick(state, seat, action, afterBid8) {
  if (seat !== state.currentPlayer || seat !== state.trumpMaker) {
    throw new Error('applyTrumpPick: not your turn');
  }
  if (action.type !== 'pickTrump') throw new Error('applyTrumpPick: expected pickTrump');
  const idx = state.hands[seat].findIndex((c) => c.id === action.cardId);
  if (idx < 0) throw new Error('applyTrumpPick: card not in hand');

  const s = structuredClone(state);
  const card = s.hands[seat][idx];
  s.hands[seat].splice(idx, 1);
  s.trumpIndicator = card;
  s.trumpSuit = card.suit;
  s.message = `Seat ${seat} places trump indicator (hidden)`;
  s.log = appendLog(s.log, s.message);

  if (!afterBid8) {
    // First pick: deal second batch, then enter bid8.
    dealSecondBatch(s);
    enterBid8(s);
  } else {
    // Pick after bid8 raise by new maker: proceed to open_choice.
    enterOpenChoice(s);
  }
  return s;
}

function dealSecondBatch(s) {
  if (!s._remainingDeck || s._remainingDeck.length !== 16) {
    throw new Error('dealSecondBatch: expected 16 cards');
  }
  let seat = next(s.dealer);
  for (const card of s._remainingDeck) {
    s.hands[seat].push(card);
    seat = next(seat);
  }
  delete s._remainingDeck;
}

function enterBid8(s) {
  s.phase = 'bid8';
  s.currentPlayer = null;
  s.currentBidder = s.trumpMaker;             // current high bidder opens bid8
  s._bid8Turns = 0;
  s._bid8Queue = [];
  let p = s.trumpMaker;
  for (let i = 0; i < 4; i++) { s._bid8Queue.push(p); p = next(p); }
  s.message = `Second bid round: seat ${s.currentBidder} opens`;
  s.log = appendLog(s.log, s.message);
}

// --- bid8 -----------------------------------------------------------------

function applyBid8(state, seat, action) {
  if (seat !== state.currentBidder) throw new Error('applyBid8: not your turn');
  const s = structuredClone(state);

  switch (action.type) {
    case 'bid': {
      const partnerIsHigh = s.highBid && partnerOf(s.highBid.bidder) === seat;
      if (partnerIsHigh) throw new Error('applyBid8: partner holds high, must pass');
      const amt = action.amount;
      const minRaw = Math.max(MIN_BID_8, (s.highBid?.amount ?? 0) + BID_STEP);
      if (!Number.isInteger(amt) || amt % BID_STEP !== 0) {
        throw new Error('applyBid8: bid must be integer multiple of 10');
      }
      if (amt < minRaw) throw new Error(`applyBid8: bid must be ≥ ${minRaw}`);
      s.highBid = { amount: amt, bidder: seat, isCloseCaps: false };
      s.bids.push({ seat, type: 'bid', amount: amt, round: 8 });
      s.message = `Seat ${seat} bids ${amt} (8-card)`;
      s.log = appendLog(s.log, s.message);
      break;
    }
    case 'pass':
      s.bids.push({ seat, type: 'pass', round: 8 });
      s.message = `Seat ${seat} passes (8-card)`;
      s.log = appendLog(s.log, s.message);
      break;
    default:
      throw new Error(`applyBid8: unknown action ${action.type}`);
  }

  s._bid8Turns += 1;
  if (s._bid8Turns < 4) {
    s.currentBidder = s._bid8Queue[s._bid8Turns];
    return s;
  }
  // All four took their turn; resolve.
  return resolveBid8(s);
}

function resolveBid8(s) {
  delete s._bid8Queue;
  delete s._bid8Turns;
  s.currentBidder = null;
  const newMaker = s.highBid.bidder;
  if (newMaker === s.trumpMaker) {
    // Same trump maker, possibly higher bid; go straight to open_choice.
    enterOpenChoice(s);
    return s;
  }
  // Different player raised: return old indicator, let new maker pick.
  s.hands[s.trumpMaker].push(s.trumpIndicator);
  s.trumpIndicator = null;
  s.trumpSuit = null;
  s.trumpMaker = newMaker;
  s.phase = 'trump_pick2';
  s.currentPlayer = newMaker;
  s.message = `Seat ${newMaker} takes over as trump maker; picks new indicator`;
  s.log = appendLog(s.log, s.message);
  return s;
}

function enterOpenChoice(s) {
  s.phase = 'open_choice';
  s.currentPlayer = s.trumpMaker;
  s.currentBidder = null;
  s.message = `Seat ${s.trumpMaker} chooses Open or Closed`;
  s.log = appendLog(s.log, s.message);
}

function applyBid4(state, seat, action) {
  if (seat !== state.currentBidder) throw new Error('applyBid4: not your turn');
  const s = structuredClone(state);

  switch (action.type) {
    case 'bid': {
      const amt = action.amount;
      if (!Number.isInteger(amt) || amt % BID_STEP !== 0) {
        throw new Error('applyBid4: bid must be integer multiple of 10');
      }
      const minRaw = s.highBid ? s.highBid.amount + BID_STEP : MIN_BID_4;
      if (amt < minRaw) throw new Error(`applyBid4: bid must be ≥ ${minRaw}`);
      if (
        (s.restrictedTo200.includes(seat) ||
          (s.highBid && partnerOf(s.highBid.bidder) === seat)) &&
        amt < 200
      ) {
        throw new Error('applyBid4: restricted to ≥ 200');
      }
      s.bids.push({ seat, type: 'bid', amount: amt });
      s.highBid = { amount: amt, bidder: seat, isCloseCaps: false };
      s.participated.push(seat);
      s.message = `Seat ${seat} bids ${amt}`;
      s.log = appendLog(s.log, s.message);
      break;
    }
    case 'pass': {
      s.bids.push({ seat, type: 'pass' });
      if (!s.passedSeats.includes(seat)) s.passedSeats.push(seat);
      s.participated.push(seat);
      s.message = `Seat ${seat} passes`;
      s.log = appendLog(s.log, s.message);
      break;
    }
    case 'askPartner': {
      if (s.askedPartnerPair) throw new Error('applyBid4: partner already asked');
      const partner = partnerOf(seat);
      if (s.participated.includes(seat) || s.participated.includes(partner)) {
        throw new Error('applyBid4: askPartner only on first turn for both');
      }
      s.askedPartnerPair = [seat, partner];
      s.restrictedTo200.push(seat, partner);
      s.participated.push(seat);
      s.bids.push({ seat, type: 'askPartner' });
      s.message = `Seat ${seat} asks seat ${partner} to bid`;
      s.log = appendLog(s.log, s.message);
      s.currentBidder = partner;
      return s;
    }
    case 'demandRedeal': {
      if (seat !== next(s.dealer)) throw new Error('applyBid4: only dealer-right may demand redeal');
      if (s.participated.includes(seat)) throw new Error('applyBid4: redeal demand must be first turn');
      if (handPoints(s.hands[seat]) >= REDEAL_THRESHOLD) {
        throw new Error('applyBid4: hand ≥ 15 internal pts, cannot demand redeal');
      }
      s.message = `Seat ${seat} demands redeal (hand = ${handPoints(s.hands[seat])} internal)`;
      s.log = appendLog(s.log, s.message);
      // Same dealer redeals — redrive startHand with same dealer.
      const redealt = startHand({ ...s, dealer: s.dealer, handNumber: s.handNumber - 1 });
      return redealt;
    }
    default:
      throw new Error(`applyBid4: unknown action ${action.type}`);
  }

  // advance turn
  s.currentBidder = nextActiveBidder(s, seat);

  // Check for bidding resolution.
  return maybeResolveBid4(s);
}

function nextActiveBidder(state, fromSeat) {
  // CCW, skip seats that have passed.
  let p = next(fromSeat);
  for (let i = 0; i < 4; i++) {
    if (!state.passedSeats.includes(p)) return p;
    p = next(p);
  }
  return null;
}

function maybeResolveBid4(state) {
  const s = state;
  const passes = s.passedSeats.length;

  // All four pass → hand abandoned, same dealer, reshuffle and rotate dealer.
  if (passes === 4) {
    s.message = 'All four pass — hand abandoned';
    s.log = appendLog(s.log, s.message);
    s.dealer = next(s.dealer);
    // Redeal with new dealer. Preserve tokens and game state.
    return startHand({ ...s, handNumber: s.handNumber - 1 });
  }

  // Three passes and a high bid → bidder wins.
  if (passes === 3 && s.highBid) {
    s.phase = 'trump_pick1';
    s.trumpMaker = s.highBid.bidder;
    s.currentBidder = null;
    s.currentPlayer = s.trumpMaker; // the trump maker's turn is to pick an indicator
    s.message = `Seat ${s.trumpMaker} wins bidding at ${s.highBid.amount}`;
    s.log = appendLog(s.log, s.message);
    return s;
  }

  return s;
}

// --------------------------------------------------------------------------
// View filtering
// --------------------------------------------------------------------------

function viewFor(state, seat) {
  const s = state;
  const view = {
    roomId: s.roomId,
    phase: s.phase,
    seats: s.seats.map((p) => (p ? { name: p.name, isAI: p.isAI, connected: p.connected } : null)),
    dealer: s.dealer,
    handNumber: s.handNumber,
    tokens: s.tokens.slice(),
    message: s.message,
    log: s.log.slice(-10),
    yourSeat: seat,
    yourHand: seat != null ? s.hands[seat].slice() : [],
    handCounts: s.hands.map((h) => h.length),
    currentBidder: s.currentBidder,
    currentPlayer: s.currentPlayer,
    highBid: s.highBid,
    tricksWon: s.tricksWon.slice(),
    tricksPlayed: s.tricksPlayed,
    lastTrick: s.lastTrick,
    // Trump indicator + suit visible only to trump maker until revealed.
    trumpIndicator:
      s.trumpRevealed || seat === s.trumpMaker ? s.trumpIndicator : null,
    trumpSuit: s.trumpRevealed ? s.trumpSuit : null,
    trumpRevealed: s.trumpRevealed,
    // Current trick: mask face-down cards for non-trump-maker seats.
    currentTrick: s.currentTrick.map((p) =>
      p.faceDown && !s.trumpRevealed && seat !== s.trumpMaker
        ? { seat: p.seat, hidden: true }
        : p
    ),
    legalActions: legalActions(s, seat),
  };
  return view;
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

function appendLog(log, line) {
  const next = log.slice();
  next.push(line);
  if (next.length > 100) next.shift();
  return next;
}

module.exports = {
  createGame, seatPlayer, startHand,
  applyAction, legalActions, viewFor,
  // exported for tests / AI:
  next, teamOf, partnerOf,
  MIN_BID_4, MIN_BID_8, BID_STEP, STARTING_TOKENS, MAX_TOKENS,
};
