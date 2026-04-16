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
  delete s._indicatorPlayed;
  delete s._trumpsPlayed;
  delete s._remainingDeck;

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
    case 'open_choice':
      return seat === state.trumpMaker
        ? [{ type: 'declareOpen' }, { type: 'declareClosed' }]
        : [];
    case 'play': {
      if (seat !== state.currentPlayer) return [];
      const ids = legalPlayIds(state, seat);
      return ids.length ? [{ type: 'playCard', cardIds: ids }] : [];
    }
    case 'inspect':
      return seat === state.trumpMaker ? [{ type: 'continue' }] : [];
    case 'hand_end':
      return [{ type: 'continue' }];
    case 'game_over':
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

function applyAction(state, seat, action, opts = {}) {
  switch (state.phase) {
    case 'bid4': return applyBid4(state, seat, action, opts);
    case 'trump_pick1': return applyTrumpPick(state, seat, action, /*afterBid8*/ false);
    case 'bid8': return applyBid8(state, seat, action);
    case 'trump_pick2': return applyTrumpPick(state, seat, action, /*afterBid8*/ true);
    case 'open_choice': return applyOpenChoice(state, seat, action);
    case 'play': return applyPlay(state, seat, action);
    case 'inspect': return applyInspect(state, seat, action);
    case 'hand_end': return applyHandEnd(state, seat, action, opts);
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

// --- open_choice ----------------------------------------------------------

function applyOpenChoice(state, seat, action) {
  if (seat !== state.trumpMaker) throw new Error('applyOpenChoice: not trump maker');
  const s = structuredClone(state);
  if (action.type === 'declareOpen') {
    s.isOpenTrump = true;
    s.trumpRevealed = true;
    // Indicator joins hand (now 8 cards for maker too).
    s.hands[s.trumpMaker].push(s.trumpIndicator);
    s.message = `Seat ${s.trumpMaker} declares OPEN (${s.trumpSuit})`;
  } else if (action.type === 'declareClosed') {
    s.isOpenTrump = false;
    s.trumpRevealed = false;
    s.message = `Seat ${s.trumpMaker} keeps the trump CLOSED`;
  } else {
    throw new Error('applyOpenChoice: expected declareOpen or declareClosed');
  }
  s.log = appendLog(s.log, s.message);
  enterPlay(s);
  return s;
}

function enterPlay(s) {
  s.phase = 'play';
  s.trickLeader = next(s.dealer);       // dealer's right leads trick 1
  s.currentPlayer = s.trickLeader;
  s.currentTrick = [];
  s.tricksPlayed = 0;
  s.tricksWon = [0, 0];
  s.trickPoints = [0, 0];
  s.lastTrick = null;
}

// --- play -----------------------------------------------------------------

// Returns the array of card IDs the seat may legally play right now.
// The trump indicator is held outside the maker's `hand` while closed and is
// ONLY a legal play when: (a) trick 8, hand empty → forced lead; or
// (b) maker can't follow suit → may be chosen as a face-down cut.
function legalPlayIds(state, seat) {
  const hand = state.hands[seat];
  const isMaker = seat === state.trumpMaker;
  const indicatorAvail =
    isMaker && !state.trumpRevealed && state.trumpIndicator && !state._indicatorPlayed;
  const leading = state.currentTrick.length === 0;

  if (leading) {
    // Forced indicator lead: trick 8, maker's hand empty.
    if (indicatorAvail && state.tricksPlayed === 7 && hand.length === 0) {
      return [state.trumpIndicator.id];
    }
    let candidates = hand.slice();
    // First-trick lead restriction for trump maker in closed: no trump lead.
    if (isMaker && !state.isOpenTrump && !state.trumpRevealed && state.tricksPlayed === 0) {
      const nonTrump = candidates.filter((c) => c.suit !== state.trumpSuit);
      if (nonTrump.length > 0) candidates = nonTrump;
    }
    // Exhausted-trumps rule (only meaningful once trump is revealed).
    if (isMaker && state.trumpRevealed) {
      const played = state._trumpsPlayed || 0;
      const makerTrumps = hand.filter((c) => c.suit === state.trumpSuit).length;
      if (8 - played - makerTrumps === 0 && makerTrumps > 0) {
        candidates = candidates.filter((c) => c.suit === state.trumpSuit);
      }
    }
    return candidates.map((c) => c.id);
  }

  // Following.
  const lead = state.currentTrick[0].card.suit;
  const follow = hand.filter((c) => c.suit === lead);
  if (follow.length > 0) return follow.map((c) => c.id);
  // Can't follow: any non-indicator card; maker may additionally choose
  // the indicator as a face-down cut.
  const pool = hand.slice();
  if (indicatorAvail) pool.push(state.trumpIndicator);
  return pool.map((c) => c.id);
}

function countTrumpsPlayed(state) {
  // Count trump-suit cards visible across all prior tricks' logs.
  // We keep a running count via state._trumpsPlayed so we don't scan on every call.
  return state._trumpsPlayed || 0;
}

function applyPlay(state, seat, action) {
  if (seat !== state.currentPlayer) throw new Error('applyPlay: not your turn');
  if (action.type !== 'playCard') throw new Error('applyPlay: expected playCard');
  const legal = new Set(legalPlayIds(state, seat));
  if (!legal.has(action.cardId)) throw new Error(`applyPlay: illegal card ${action.cardId}`);

  const s = structuredClone(state);
  let card;
  let isIndicator = false;
  const idxH = s.hands[seat].findIndex((c) => c.id === action.cardId);
  if (idxH >= 0) {
    card = s.hands[seat][idxH];
    s.hands[seat].splice(idxH, 1);
  } else if (
    seat === s.trumpMaker && !s.trumpRevealed && s.trumpIndicator &&
    s.trumpIndicator.id === action.cardId
  ) {
    card = s.trumpIndicator;
    isIndicator = true;
    s._indicatorPlayed = true;
  } else {
    throw new Error('applyPlay: card not found');
  }

  const leading = s.currentTrick.length === 0;
  const lead = leading ? null : s.currentTrick[0].card.suit;
  let faceDown = false;
  if (!leading && !s.isOpenTrump && !s.trumpRevealed && card.suit !== lead) {
    // Closed game, can't follow suit → face-down.
    faceDown = true;
  }
  // Trump maker leading the indicator on trick 8 → face-up reveal.
  if (leading && isIndicator) {
    faceDown = false;
    s.trumpRevealed = true;
    s.isOpenTrump = true;
  }

  s.currentTrick.push({ seat, card, faceDown, isTrumpIndicator: isIndicator });
  // Running trump count (only counts face-up trumps we can see).
  if (card.suit === s.trumpSuit && !faceDown) {
    s._trumpsPlayed = (s._trumpsPlayed || 0) + 1;
  }

  s.message = faceDown
    ? `Seat ${seat} plays face-down`
    : `Seat ${seat} plays ${card.rank}${card.suit}`;
  s.log = appendLog(s.log, s.message);

  if (s.currentTrick.length < 4) {
    s.currentPlayer = next(seat);
    return s;
  }
  return endTrick(s);
}

function endTrick(s) {
  const hasFaceDown = s.currentTrick.some((p) => p.faceDown);
  // Open game, or closed with no face-downs → resolve immediately.
  if (s.isOpenTrump || s.trumpRevealed || !hasFaceDown) {
    return finalizeTrick(s, /*revealedNow*/ false);
  }
  // Closed + face-downs present → enter inspect phase for trump maker.
  s.phase = 'inspect';
  s.currentPlayer = s.trumpMaker;
  s.message = `Trump maker inspects face-down cards`;
  s.log = appendLog(s.log, s.message);
  return s;
}

// --- inspect --------------------------------------------------------------

function applyInspect(state, seat, action) {
  if (seat !== state.trumpMaker) throw new Error('applyInspect: only trump maker');
  if (action.type !== 'continue') throw new Error('applyInspect: expected continue');
  const s = structuredClone(state);
  // If any face-down card in the trick is the trump suit (either a normal
  // discard that happens to be a trump, or the indicator itself), reveal
  // trump and treat those as valid trumps. Trump maker's own face-down
  // non-trump discard remains hidden.
  const trumpyFaceDown = s.currentTrick.some(
    (p) => p.faceDown && p.card.suit === s.trumpSuit
  );
  let revealedNow = false;
  if (trumpyFaceDown) {
    s.trumpRevealed = true;
    s.isOpenTrump = true;
    revealedNow = true;
    // Reveal all trumpy face-down cards (flip their faceDown off).
    for (const p of s.currentTrick) {
      if (p.faceDown && p.card.suit === s.trumpSuit) p.faceDown = false;
    }
    // Indicator reveal: if the maker did NOT play the indicator as the cut
    // card, it joins their hand now.
    if (!s._indicatorPlayed) {
      s.hands[s.trumpMaker].push(s.trumpIndicator);
    }
    s.message = `Trump (${s.trumpSuit}) revealed!`;
    s.log = appendLog(s.log, s.message);
  }
  return finalizeTrick(s, revealedNow);
}

// --- trick finalization ---------------------------------------------------

function finalizeTrick(s, revealedNow) {
  s.phase = 'play';
  const trump = s.trumpRevealed || s.isOpenTrump ? s.trumpSuit : null;
  const lead = s.currentTrick[0].card.suit;
  const winnerIdx = winningIndex(s.currentTrick, trump, lead, /*faceDownIsHidden*/ true);
  const winnerSeat = s.currentTrick[winnerIdx].seat;
  const trickPoints = s.currentTrick.reduce((sum, p) => sum + cardPoints(p.card), 0);

  s.tricksWon[teamOf(winnerSeat)] += 1;
  s.trickPoints[teamOf(winnerSeat)] += trickPoints;
  s.tricksPlayed += 1;
  s.lastTrick = s.currentTrick.slice();
  s.currentTrick = [];
  s.trickLeader = winnerSeat;
  s.currentPlayer = winnerSeat;
  s.message = `Seat ${winnerSeat} wins trick ${s.tricksPlayed}` +
    (revealedNow ? ' (trump revealed)' : '');
  s.log = appendLog(s.log, s.message);

  // Auto-open after trick 1 if final bid ≥ 250 and still closed.
  if (
    s.tricksPlayed === 1 && !s.isOpenTrump && !s.trumpRevealed &&
    s.highBid && s.highBid.amount >= 250
  ) {
    s.trumpRevealed = true;
    s.isOpenTrump = true;
    if (!s._indicatorPlayed) s.hands[s.trumpMaker].push(s.trumpIndicator);
    s.message = `Bid ≥ 250: trump (${s.trumpSuit}) auto-revealed`;
    s.log = appendLog(s.log, s.message);
  }

  if (s.tricksPlayed === 8) {
    return enterHandEnd(s);
  }
  return s;
}

function enterHandEnd(s) {
  s.phase = 'hand_end';
  s.currentPlayer = null;
  const makerTeam = teamOf(s.trumpMaker);
  const otherTeam = 1 - makerTeam;
  const bid = s.highBid.amount;
  const makerPoints = s.trickPoints[makerTeam];
  const allTricks = s.tricksWon[makerTeam] === 8;
  let delta;
  let success;
  if (allTricks) {
    // House rule "high court": all 8 tricks → 5 tokens regardless of bid.
    delta = 5;
    success = true;
  } else {
    success = makerPoints >= bid; // ties go to bidder
    if (s.highBid.isCloseCaps) {
      delta = success ? 4 : 5; // PCC
    } else if (bid < 200) {
      delta = success ? 1 : 2;
    } else if (bid < 250) {
      delta = success ? 2 : 3;
    } else {
      delta = success ? 3 : 4; // 250+
    }
  }
  const winnerTeam = success ? makerTeam : otherTeam;
  const loserTeam = 1 - winnerTeam;
  const transfer = Math.min(delta, s.tokens[loserTeam]);
  s.tokens[loserTeam] -= transfer;
  s.tokens[winnerTeam] += transfer;

  const label = allTricks ? 'HIGH COURT (all 8 tricks)' : (success ? 'succeeds' : 'fails');
  s.message =
    `Hand ${s.handNumber}: bid ${bid} ${label}, maker points ${makerPoints}, ` +
    `tokens ${s.tokens.join('/')}`;
  s.log = appendLog(s.log, s.message);

  if (s.tokens[0] === 0 || s.tokens[1] === 0) {
    s.phase = 'game_over';
    const winner = s.tokens[0] === 0 ? 1 : 0;
    s.message = `Team ${winner} wins the match (${s.tokens[winner]}/${MAX_TOKENS} tokens)`;
    s.log = appendLog(s.log, s.message);
  }
  return s;
}

// --- hand_end → next hand -------------------------------------------------

function applyHandEnd(state, seat, action, opts = {}) {
  if (action.type !== 'continue') throw new Error('applyHandEnd: expected continue');
  if (state.phase === 'game_over') throw new Error('applyHandEnd: game over');
  const s = structuredClone(state);
  s.dealer = next(s.dealer);
  return startHand(s, opts.rng);
}

function applyBid4(state, seat, action, opts = {}) {
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
      const redealt = startHand({ ...s, dealer: s.dealer, handNumber: s.handNumber - 1 }, opts.rng);
      return redealt;
    }
    default:
      throw new Error(`applyBid4: unknown action ${action.type}`);
  }

  // advance turn
  s.currentBidder = nextActiveBidder(s, seat);

  // Check for bidding resolution.
  return maybeResolveBid4(s, opts);
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

function maybeResolveBid4(state, opts = {}) {
  const s = state;
  const passes = s.passedSeats.length;

  // All four pass → hand abandoned, same dealer, reshuffle and rotate dealer.
  if (passes === 4) {
    s.message = 'All four pass — hand abandoned';
    s.log = appendLog(s.log, s.message);
    s.dealer = next(s.dealer);
    // Redeal with new dealer. Preserve tokens and game state.
    return startHand({ ...s, handNumber: s.handNumber - 1 }, opts.rng);
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
    trumpSuit:
      s.trumpRevealed || seat === s.trumpMaker ? s.trumpSuit : null,
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
