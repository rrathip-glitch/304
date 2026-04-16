// 304 game state machine. See docs/RULES.md, docs/ARCHITECTURE.md, docs/API.md.
// All points are internal (x10). Bids are multiples of 10, min 160.
// Counter-clockwise: next(p) = (p + 3) % 4. Teams: 0+2 vs 1+3.

const cards = require('./cards');

const PHASES = {
  WAITING: 'waiting',
  BID4: 'bid4',
  TRUMP_PICK1: 'trump_pick1',
  BID8: 'bid8',
  TRUMP_PICK2: 'trump_pick2',
  OPEN_CHOICE: 'open_choice',
  PLAY: 'play',
  INSPECT: 'inspect',
  HAND_END: 'hand_end',
  GAME_OVER: 'game_over',
};

const next = (p) => (p + 3) % 4;
const teamOf = (seat) => seat % 2;
const partnerOf = (seat) => (seat + 2) % 4;

function log(state, msg) {
  state.log.push(msg);
  if (state.log.length > 50) state.log.shift();
  state.message = msg;
}

function createGame(roomId = '') {
  return {
    roomId,
    phase: PHASES.WAITING,
    seats: [null, null, null, null],
    dealer: 0,
    handNumber: 0,
    tokens: [11, 11],
    message: 'Waiting for players',
    log: [],

    hands: [[], [], [], []],
    bids: [],
    currentBidder: null,
    passedSeats: [],
    bidTurns: [0, 0, 0, 0],
    askedPartner: [false, false, false, false],
    highBid: null,
    trumpMaker: null,
    trumpIndicator: null,
    trumpSuit: null,
    isOpenTrump: false,
    trumpRevealed: false,
    closeCaps: false,
    currentTrick: [],
    trickLeader: null,
    currentPlayer: null,
    tricksWon: [0, 0],
    trickPoints: [0, 0],
    tricksPlayed: 0,
    lastTrick: null,
    pendingSecondBatch: null,
    dealtFirstBatch: false,
  };
}

function seatPlayer(state, { seat, name, isAI }) {
  if (seat < 0 || seat > 3) return { ok: false, reason: 'invalid seat' };
  if (state.seats[seat] && !state.seats[seat].isAI && !isAI) {
    return { ok: false, reason: 'seat occupied' };
  }
  state.seats[seat] = { name: name || (isAI ? 'AI' : 'Player'), isAI: !!isAI };
  log(state, `${state.seats[seat].name} seated at ${seat}`);
  return { ok: true };
}

function removeSeat(state, seat) {
  state.seats[seat] = null;
  return { ok: true };
}

function startHand(state, rng = Math.random) {
  state.handNumber += 1;
  state.hands = [[], [], [], []];
  state.bids = [];
  state.currentBidder = next(state.dealer);
  state.passedSeats = [];
  state.bidTurns = [0, 0, 0, 0];
  state.askedPartner = [false, false, false, false];
  state.highBid = null;
  state.trumpMaker = null;
  state.trumpIndicator = null;
  state.trumpSuit = null;
  state.isOpenTrump = false;
  state.trumpRevealed = false;
  state.closeCaps = false;
  state.currentTrick = [];
  state.trickLeader = null;
  state.currentPlayer = null;
  state.tricksWon = [0, 0];
  state.trickPoints = [0, 0];
  state.tricksPlayed = 0;
  state.lastTrick = null;
  state.dealtFirstBatch = true;

  const deck = cards.shuffle(cards.makeDeck(), rng);
  state.pendingSecondBatch = deck.slice(16);
  for (let i = 0; i < 4; i++) {
    const seat = (state.dealer + 3 * (i + 1)) % 4;
    state.hands[seat] = deck.slice(i * 4, i * 4 + 4);
  }
  state.phase = PHASES.BID4;
  log(state, `Hand ${state.handNumber} dealt. ${state.seats[state.currentBidder]?.name || seatLabel(state.currentBidder)} to bid.`);
  return { ok: true };
}

function seatLabel(seat) { return `Seat ${seat}`; }

function dealSecondBatch(state) {
  const rem = state.pendingSecondBatch || [];
  for (let i = 0; i < 4; i++) {
    const seat = (state.dealer + 3 * (i + 1)) % 4;
    state.hands[seat] = state.hands[seat].concat(rem.slice(i * 4, i * 4 + 4));
  }
  state.pendingSecondBatch = null;
}

function minAllowedBid(state, seat) {
  const priorTurns = state.bidTurns[seat];
  const askedHere = state.askedPartner[seat];
  let floor = 160;
  if (priorTurns >= 1) floor = 200;
  if (askedHere) floor = 200;
  if (state.highBid && partnerOf(seat) === state.highBid.bidder) floor = 200;
  return floor;
}

function bidAmountsLegal(state, seat) {
  const floor = minAllowedBid(state, seat);
  const lower = Math.max(floor, state.highBid ? state.highBid.amount + 10 : 160);
  const upper = 240;
  const out = [];
  for (let a = lower; a <= upper; a += 10) out.push(a);
  return out;
}

function bid8AmountsLegal(state) {
  const lower = Math.max(250, state.highBid ? state.highBid.amount + 10 : 250);
  const upper = 300;
  const out = [];
  for (let a = lower; a <= upper; a += 10) out.push(a);
  return out;
}

function applyAction(state, seat, action) {
  if (state.phase === PHASES.WAITING) return fail('game not started');
  if (state.phase === PHASES.GAME_OVER) return fail('game over');

  const type = action && action.type;
  if (!type) return fail('missing action type');

  switch (state.phase) {
    case PHASES.BID4: return handleBid4(state, seat, action);
    case PHASES.TRUMP_PICK1: return handleTrumpPick(state, seat, action, 1);
    case PHASES.BID8: return handleBid8(state, seat, action);
    case PHASES.TRUMP_PICK2: return handleTrumpPick(state, seat, action, 2);
    case PHASES.OPEN_CHOICE: return handleOpenChoice(state, seat, action);
    case PHASES.PLAY: return handlePlay(state, seat, action);
    case PHASES.INSPECT: return handleInspect(state, seat, action);
    case PHASES.HAND_END: return handleHandEnd(state, seat, action);
    default: return fail('unknown phase');
  }
}

function fail(reason) { return { ok: false, reason }; }

function handleBid4(state, seat, action) {
  if (seat !== state.currentBidder) return fail('not your turn');
  const { type } = action;

  if (type === 'demandRedeal') {
    if (state.bidTurns[seat] > 0) return fail('redeal only on first action');
    if (seat !== next(state.dealer)) return fail('only the first bidder may demand redeal');
    const pts = cards.handPoints(state.hands[seat]);
    if (pts >= 15) return fail('hand too strong for redeal');
    log(state, `${state.seats[seat].name} demanded redeal (${pts}).`);
    startHand(state);
    return { ok: true };
  }

  if (type === 'pass') {
    state.bidTurns[seat] += 1;
    if (!state.passedSeats.includes(seat)) state.passedSeats.push(seat);
    state.bids.push({ seat, type: 'pass' });
    log(state, `${state.seats[seat].name} passed.`);
    return advanceBid4(state);
  }

  if (type === 'bid') {
    const amount = action.amount | 0;
    if (amount % 10 !== 0) return fail('bids must be multiples of 10');
    if (amount < 160) return fail('minimum bid is 160');
    const floor = minAllowedBid(state, seat);
    if (amount < floor) return fail(`your bid floor is ${floor}`);
    if (state.highBid && amount <= state.highBid.amount) return fail('must exceed current high bid');
    state.highBid = { amount, bidder: seat, isCloseCaps: false };
    state.bidTurns[seat] += 1;
    state.passedSeats = state.passedSeats.filter((s) => s !== seat);
    state.bids.push({ seat, type: 'bid', amount });
    log(state, `${state.seats[seat].name} bid ${amount / 10}.`);
    return advanceBid4(state);
  }

  if (type === 'askPartner') {
    const partner = partnerOf(seat);
    if (state.bidTurns[seat] > 0) return fail('askPartner only on your first turn');
    if (!state.seats[partner]) return fail('no partner seated');
    state.bidTurns[seat] += 1;
    state.askedPartner[seat] = true;
    state.askedPartner[partner] = true;
    state.bids.push({ seat, type: 'askPartner' });
    log(state, `${state.seats[seat].name} asked partner to bid.`);
    state.currentBidder = partner;
    return { ok: true };
  }

  return fail('invalid bid action');
}

function advanceBid4(state) {
  const activeBidders = [0, 1, 2, 3].filter((s) => !state.passedSeats.includes(s));
  // High bidder wins if everyone else has passed, even if they themselves later pass.
  if (state.highBid && activeBidders.length <= 1) {
    return enterTrumpPick1(state);
  }
  if (state.passedSeats.length >= 4 && !state.highBid) {
    log(state, 'All passed. Redealing.');
    state.dealer = next(state.dealer);
    startHand(state);
    return { ok: true };
  }
  // Find next unpassed seat. Guard against all-passed by limiting iterations.
  let p = next(state.currentBidder);
  for (let i = 0; i < 4 && state.passedSeats.includes(p); i++) p = next(p);
  if (state.passedSeats.includes(p)) {
    // Defensive: no active bidder found. If highBid exists, award it.
    if (state.highBid) return enterTrumpPick1(state);
    log(state, 'All passed (defensive). Redealing.');
    state.dealer = next(state.dealer);
    startHand(state);
    return { ok: true };
  }
  state.currentBidder = p;
  return { ok: true };
}

function enterTrumpPick1(state) {
  state.trumpMaker = state.highBid.bidder;
  state.phase = PHASES.TRUMP_PICK1;
  state.currentBidder = null;
  log(state, `${state.seats[state.trumpMaker].name} won the bid at ${state.highBid.amount / 10}. Pick trump.`);
  return { ok: true };
}

function handleTrumpPick(state, seat, action, round) {
  if (seat !== state.trumpMaker) return fail('only trump maker picks');
  if (action.type !== 'pickTrump') return fail('expected pickTrump');
  const hand = state.hands[seat];
  const idx = hand.findIndex((c) => c.id === action.cardId);
  if (idx < 0) return fail('card not in hand');
  const card = hand.splice(idx, 1)[0];
  state.trumpIndicator = card;
  state.trumpSuit = card.suit;
  log(state, `${state.seats[seat].name} placed trump indicator face-down.`);

  if (round === 1) {
    dealSecondBatch(state);
    state.phase = PHASES.BID8;
    state.currentBidder = state.trumpMaker;
    state.bid8Turns = 0;
    state.bid8Passes = 0;
    log(state, 'Second batch dealt. 8-card bidding (min 250).');
  } else {
    state.phase = PHASES.OPEN_CHOICE;
    state.currentBidder = null;
  }
  return { ok: true };
}

function handleBid8(state, seat, action) {
  if (seat !== state.currentBidder) return fail('not your turn');
  const { type } = action;
  const partner = partnerOf(seat);

  if (type === 'pass') {
    state.bid8Passes += 1;
    state.bid8Turns += 1;
    log(state, `${state.seats[seat].name} passed in 8-card round.`);
    return advanceBid8(state);
  }

  if (type === 'bid') {
    const amount = action.amount | 0;
    if (amount % 10 !== 0) return fail('bids must be multiples of 10');
    if (amount < 250) return fail('minimum 8-card bid is 250');
    if (state.highBid && amount <= state.highBid.amount) return fail('must exceed current high bid');
    const lastBid = [...state.bids].reverse().find((b) => b.type === 'bid' && b.round === 8);
    if (lastBid && lastBid.seat === partner) return fail('cannot bid after partner');

    const newMaker = seat;
    if (newMaker !== state.trumpMaker) {
      state.hands[state.trumpMaker].push(state.trumpIndicator);
      state.trumpIndicator = null;
      state.trumpSuit = null;
      state.trumpMaker = newMaker;
      state.highBid = { amount, bidder: seat, isCloseCaps: false };
      state.bids.push({ seat, type: 'bid', amount, round: 8 });
      state.bid8Turns += 1;
      log(state, `${state.seats[seat].name} outbid at ${amount / 10}. Pick new trump.`);
      state.phase = PHASES.TRUMP_PICK2;
      state.currentBidder = null;
      return { ok: true };
    }
    state.highBid = { amount, bidder: seat, isCloseCaps: false };
    state.bids.push({ seat, type: 'bid', amount, round: 8 });
    state.bid8Turns += 1;
    log(state, `${state.seats[seat].name} raised own bid to ${amount / 10}.`);
    return advanceBid8(state);
  }

  return fail('invalid bid8 action');
}

function advanceBid8(state) {
  if (state.bid8Turns >= 4) {
    state.phase = PHASES.OPEN_CHOICE;
    state.currentBidder = null;
    log(state, '8-card bidding closed.');
    return { ok: true };
  }
  state.currentBidder = next(state.currentBidder);
  return { ok: true };
}

function handleOpenChoice(state, seat, action) {
  if (seat !== state.trumpMaker) return fail('only trump maker chooses');
  if (action.type === 'declareOpen') {
    state.isOpenTrump = true;
    state.trumpRevealed = true;
    if (state.trumpIndicator) {
      state.hands[state.trumpMaker].push(state.trumpIndicator);
    }
    log(state, `${state.seats[seat].name} declared OPEN. Trump is ${state.trumpSuit}.`);
  } else if (action.type === 'declareClosed') {
    state.isOpenTrump = false;
    log(state, `${state.seats[seat].name} kept the trump closed.`);
  } else {
    return fail('expected declareOpen/declareClosed');
  }
  state.phase = PHASES.PLAY;
  state.trickLeader = next(state.dealer);
  state.currentPlayer = state.trickLeader;
  state.currentTrick = [];
  return { ok: true };
}

function handlePlay(state, seat, action) {
  if (seat !== state.currentPlayer) return fail('not your turn');
  if (action.type !== 'playCard') return fail('expected playCard');
  const hand = state.hands[seat];
  const indicatorHeld = !state.isOpenTrump && state.trumpMaker === seat && state.trumpIndicator;
  const isIndicator = indicatorHeld && state.trumpIndicator.id === action.cardId;

  let card, idx;
  if (isIndicator) {
    card = state.trumpIndicator;
    idx = -1;
  } else {
    idx = hand.findIndex((c) => c.id === action.cardId);
    if (idx < 0) return fail('card not in hand');
    card = hand[idx];
  }

  const leadCard = state.currentTrick[0] && state.currentTrick[0].card;
  const leadSuit = leadCard ? (state.currentTrick[0].faceDown && !state.currentTrick[0].isTrumpIndicator ? null : leadCard.suit) : null;
  const isLead = state.currentTrick.length === 0;
  const lastTrick = state.tricksPlayed === 7;
  const onlyIndicatorLeft = indicatorHeld && hand.length === 0;

  if (isLead) {
    if (isIndicator && !(lastTrick && onlyIndicatorLeft)) {
      return fail('cannot lead the trump indicator');
    }
    if (!state.isOpenTrump && state.tricksPlayed === 0 && seat === state.trumpMaker && seat === next(state.dealer)) {
      if (card.suit === state.trumpSuit && !isIndicator) {
        return fail('first trick lead cannot be trump in closed game');
      }
    }
    if (state.isOpenTrump || state.trumpRevealed) {
      const exhausted = exhaustedTrumpCheck(state, seat, card);
      if (exhausted) return fail(exhausted);
    }
  } else {
    const following = hand.some((c) => c.suit === leadSuit);
    if (isIndicator) {
      if (following) return fail('must follow suit');
      if (!lastTrick && leadSuit === state.trumpSuit) {
        return fail('indicator can only cut non-trump leads');
      }
      action.faceDown = true;
    } else {
      if (following && card.suit !== leadSuit) {
        return fail('must follow suit');
      }
      if (!following && !state.isOpenTrump && !action.faceDown) {
        action.faceDown = true;
      }
    }
  }

  if (isIndicator) {
    state.trumpIndicator = null;
  } else {
    hand.splice(idx, 1);
  }
  const played = {
    seat,
    card,
    faceDown: !!action.faceDown,
    isTrumpIndicator: isIndicator,
  };
  state.currentTrick.push(played);
  log(state, `${state.seats[seat].name} played ${played.faceDown ? 'a card face-down' : card.rank + card.suit}.`);

  if (state.currentTrick.length === 4) {
    return resolveTrick(state);
  }
  state.currentPlayer = next(state.currentPlayer);
  return { ok: true };
}

function exhaustedTrumpCheck(state, seat, card) {
  if (seat !== state.trumpMaker) return null;
  const trumpsInHand = state.hands[seat].filter((c) => c.suit === state.trumpSuit);
  if (trumpsInHand.length === 0) return null;
  if (card.suit !== state.trumpSuit) {
    const othersHaveTrump = [0, 1, 2, 3].some((s) => s !== seat && state.hands[s].some((c) => c.suit === state.trumpSuit));
    if (!othersHaveTrump) return 'exhausted trumps: must lead trump';
  }
  return null;
}

function resolveTrick(state) {
  const inClosed = !state.isOpenTrump && !state.trumpRevealed;
  if (inClosed) {
    const anyFaceDownTrump = state.currentTrick.some((p) => p.faceDown && p.card.suit === state.trumpSuit);
    if (anyFaceDownTrump) {
      state.trumpRevealed = true;
      state.isOpenTrump = true;
      state.currentTrick = state.currentTrick.map((p) => {
        if (p.seat === state.trumpMaker && p.faceDown && p.card.suit !== state.trumpSuit) {
          return p;
        }
        return { ...p, faceDown: false };
      });
      if (state.trumpIndicator) {
        state.hands[state.trumpMaker].push(state.trumpIndicator);
        state.trumpIndicator = null;
      }
      log(state, `Face-down trump revealed. Trump is ${state.trumpSuit}.`);
    }
  }

  const leadSuit = (() => {
    const first = state.currentTrick[0];
    if (first.faceDown && !first.isTrumpIndicator) return null;
    return first.card.suit;
  })();
  const wIdx = cards.winningIndex(state.currentTrick, state.trumpSuit, leadSuit, true);
  const winnerSeat = state.currentTrick[wIdx].seat;
  const teamWinner = teamOf(winnerSeat);
  state.tricksWon[teamWinner] += 1;
  const pts = state.currentTrick.reduce((s, p) => s + cards.cardPoints(p.card), 0);
  state.trickPoints[teamWinner] += pts;
  state.lastTrick = state.currentTrick.slice();
  state.tricksPlayed += 1;
  log(state, `${state.seats[winnerSeat].name} won trick ${state.tricksPlayed} (+${cards.displayPoints(pts)}).`);

  const autoOpen = !state.trumpRevealed && state.tricksPlayed === 1 && state.highBid && state.highBid.amount >= 250;
  if (autoOpen) {
    state.trumpRevealed = true;
    state.isOpenTrump = true;
    if (state.trumpIndicator) {
      state.hands[state.trumpMaker].push(state.trumpIndicator);
      state.trumpIndicator = null;
    }
    log(state, `Bid ≥25 auto-opens trump. Trump is ${state.trumpSuit}.`);
  }

  if (state.tricksPlayed >= 8) {
    state.phase = PHASES.HAND_END;
    state.currentPlayer = null;
    return finalizeHand(state);
  }

  state.trickLeader = winnerSeat;
  state.currentPlayer = winnerSeat;
  state.phase = PHASES.INSPECT;
  return { ok: true };
}

function handleInspect(state, seat, action) {
  if (action.type !== 'continue') return fail('expected continue');
  state.currentTrick = [];
  state.phase = PHASES.PLAY;
  return { ok: true };
}

function finalizeHand(state) {
  const makerTeam = teamOf(state.trumpMaker);
  const makerPts = state.trickPoints[makerTeam];
  const bidAmt = state.highBid.amount;
  const allEight = state.tricksWon[makerTeam] === 8;
  const success = makerPts >= bidAmt;

  let tokens;
  if (allEight) {
    tokens = 5;
  } else if (state.highBid.isCloseCaps) {
    tokens = success ? 4 : 5;
  } else if (bidAmt >= 250) {
    tokens = success ? 3 : 4;
  } else if (bidAmt >= 200) {
    tokens = success ? 2 : 3;
  } else {
    tokens = success ? 1 : 2;
  }

  const winner = success || allEight ? makerTeam : 1 - makerTeam;
  const loser = 1 - winner;
  const transfer = Math.min(tokens, state.tokens[loser]);
  state.tokens[loser] -= transfer;
  state.tokens[winner] += transfer;

  log(state, `Hand end: maker ${cards.displayPoints(makerPts)} vs bid ${bidAmt / 10}. ${success || allEight ? 'Succeeded' : 'Failed'}. ${transfer} tokens → Team ${winner}.`);

  if (state.tokens[0] >= 22 || state.tokens[1] >= 22) {
    state.phase = PHASES.GAME_OVER;
    log(state, `Game over. Team ${state.tokens[0] >= 22 ? 0 : 1} wins.`);
    return { ok: true };
  }
  state.phase = PHASES.HAND_END;
  return { ok: true };
}

function handleHandEnd(state, seat, action) {
  if (action.type !== 'continue') return fail('expected continue');
  state.dealer = next(state.dealer);
  startHand(state);
  return { ok: true };
}

function legalActions(state, seat) {
  if (state.phase === PHASES.BID4 && seat === state.currentBidder) {
    const list = [];
    const amts = bidAmountsLegal(state, seat);
    if (amts.length) list.push({ type: 'bid', amounts: amts });
    list.push({ type: 'pass' });
    if (state.bidTurns[seat] === 0 && state.seats[partnerOf(seat)]) {
      list.push({ type: 'askPartner' });
    }
    if (state.bidTurns[seat] === 0 && seat === next(state.dealer) && cards.handPoints(state.hands[seat]) < 15) {
      list.push({ type: 'demandRedeal' });
    }
    return list;
  }
  if (state.phase === PHASES.TRUMP_PICK1 && seat === state.trumpMaker) {
    return [{ type: 'pickTrump', cardIds: state.hands[seat].map((c) => c.id) }];
  }
  if (state.phase === PHASES.BID8 && seat === state.currentBidder) {
    const list = [];
    const amts = bid8AmountsLegal(state);
    const lastBid = [...state.bids].reverse().find((b) => b.type === 'bid' && b.round === 8);
    const partnerJustBid = lastBid && lastBid.seat === partnerOf(seat);
    if (amts.length && !partnerJustBid) list.push({ type: 'bid', amounts: amts });
    list.push({ type: 'pass' });
    return list;
  }
  if (state.phase === PHASES.TRUMP_PICK2 && seat === state.trumpMaker) {
    return [{ type: 'pickTrump', cardIds: state.hands[seat].map((c) => c.id) }];
  }
  if (state.phase === PHASES.OPEN_CHOICE && seat === state.trumpMaker) {
    return [{ type: 'declareOpen' }, { type: 'declareClosed' }];
  }
  if (state.phase === PHASES.PLAY && seat === state.currentPlayer) {
    return [{ type: 'playCard', cardIds: legalCardIds(state, seat) }];
  }
  if (state.phase === PHASES.INSPECT && seat === state.currentPlayer) {
    return [{ type: 'continue' }];
  }
  if (state.phase === PHASES.HAND_END) {
    return [{ type: 'continue' }];
  }
  return [];
}

function legalCardIds(state, seat) {
  const hand = state.hands[seat];
  const isLead = state.currentTrick.length === 0;
  const indicatorHeld = !state.isOpenTrump && state.trumpMaker === seat && state.trumpIndicator;
  const indicatorId = indicatorHeld ? state.trumpIndicator.id : null;
  const lastTrick = state.tricksPlayed === 7;
  const onlyIndicatorLeft = indicatorHeld && hand.length === 0;

  if (isLead) {
    const out = [];
    for (const c of hand) {
      if (!state.isOpenTrump && state.tricksPlayed === 0 && seat === state.trumpMaker && seat === next(state.dealer) && c.suit === state.trumpSuit) {
        continue;
      }
      if ((state.isOpenTrump || state.trumpRevealed) && exhaustedTrumpCheck(state, seat, c)) {
        continue;
      }
      out.push(c.id);
    }
    if (indicatorHeld && lastTrick && onlyIndicatorLeft) out.push(indicatorId);
    return out;
  }

  const first = state.currentTrick[0];
  const leadSuit = first.faceDown && !first.isTrumpIndicator ? null : first.card.suit;
  const following = hand.some((c) => c.suit === leadSuit);
  if (following) {
    return hand.filter((c) => c.suit === leadSuit).map((c) => c.id);
  }
  const out = hand.map((c) => c.id);
  if (indicatorHeld && (onlyIndicatorLeft || (leadSuit && leadSuit !== state.trumpSuit))) {
    out.push(indicatorId);
  }
  return out;
}

function viewFor(state, seat) {
  const view = {
    roomId: state.roomId,
    phase: state.phase,
    seats: state.seats,
    dealer: state.dealer,
    handNumber: state.handNumber,
    tokens: state.tokens.slice(),
    message: state.message,
    log: state.log.slice(-10),
    yourSeat: seat,
    yourHand: (state.hands[seat] || []).slice(),
    handCounts: state.hands.map((h) => h.length),
    bids: state.bids.slice(),
    currentBidder: state.currentBidder,
    currentPlayer: state.currentPlayer,
    passedSeats: state.passedSeats.slice(),
    highBid: state.highBid,
    trumpMaker: state.trumpMaker,
    trumpSuit: state.trumpRevealed || state.isOpenTrump ? state.trumpSuit : null,
    trumpIndicator: (seat === state.trumpMaker || state.trumpRevealed) ? state.trumpIndicator : null,
    isOpenTrump: state.isOpenTrump,
    trumpRevealed: state.trumpRevealed,
    trickLeader: state.trickLeader,
    tricksWon: state.tricksWon.slice(),
    tricksPlayed: state.tricksPlayed,
    currentTrick: state.currentTrick.map((p) => {
      if (p.faceDown && p.seat !== seat && seat !== state.trumpMaker && !state.trumpRevealed) {
        return { seat: p.seat, faceDown: true, hidden: true };
      }
      return { seat: p.seat, card: p.card, faceDown: p.faceDown, isTrumpIndicator: p.isTrumpIndicator };
    }),
    lastTrick: state.lastTrick ? state.lastTrick.map((p) => ({ seat: p.seat, card: p.card, faceDown: p.faceDown, isTrumpIndicator: p.isTrumpIndicator })) : null,
    legalActions: state.currentPlayer === seat || state.currentBidder === seat || (state.phase === PHASES.TRUMP_PICK1 && seat === state.trumpMaker) || (state.phase === PHASES.TRUMP_PICK2 && seat === state.trumpMaker) || (state.phase === PHASES.OPEN_CHOICE && seat === state.trumpMaker) || state.phase === PHASES.HAND_END ? legalActions(state, seat) : [],
  };
  return view;
}

module.exports = {
  PHASES,
  createGame,
  seatPlayer,
  removeSeat,
  startHand,
  applyAction,
  legalActions,
  viewFor,
  next,
  teamOf,
  partnerOf,
};
