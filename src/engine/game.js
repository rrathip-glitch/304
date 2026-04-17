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
    // Per-seat "I am the one who called askPartner this round." The
    // asker's only action for the rest of the round is pass — they've
    // delegated the bid to their partner. Distinct from askedPartner[]
    // (which is symmetric and only controls the ≥200 floor).
    isAsker: [false, false, false, false],
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
    cutResolved: false,
    openIndicatorId: null,
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
  state.isAsker = [false, false, false, false];
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
  state.cutResolved = false;
  state.openIndicatorId = null;

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
    // House rule (v2.1.0): you cannot bid over yourself.
    if (state.highBid && state.highBid.bidder === seat) return fail('you are already the high bidder');
    // House rule (v2.2.1): once you've asked your partner to bid, you've
    // delegated the call — you can only pass for the rest of this round.
    // The partner can bid freely (subject to the ≥200 floor from the
    // askedPartner[] flag). Without this rule, a player could ask partner
    // to bid and then outbid the partner's own raise on their next turn,
    // which breaks the "I pass the call" social contract of askPartner.
    if (state.isAsker[seat]) return fail('you asked partner to bid — you can only pass this round');
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
    // v2.2.3: once per round. If you or your partner was already part
    // of an ask (askedPartner[] is symmetric), you can't ask again.
    if (state.askedPartner[seat]) return fail('ask-partner already used this round');
    state.bidTurns[seat] += 1;
    state.askedPartner[seat] = true;
    state.askedPartner[partner] = true;
    state.isAsker[seat] = true;  // v2.2.1: asker is locked out of bidding
    // v2.2.3: askPartner counts as the asker's pass for the round.
    // They don't get routed back on later rotations — the rest of the
    // table plays it out without them.
    if (!state.passedSeats.includes(seat)) state.passedSeats.push(seat);
    state.bids.push({ seat, type: 'askPartner' });
    log(state, `${state.seats[seat].name} asked partner to bid (counts as pass).`);
    state.currentBidder = partner;
    return { ok: true };
  }

  return fail('invalid bid action');
}

function advanceBid4(state) {
  const activeBidders = [0, 1, 2, 3].filter((s) => !state.passedSeats.includes(s));
  // If a high bid exists and no other active bidders could raise, the bid wins.
  if (state.highBid) {
    const contenders = activeBidders.filter((s) => s !== state.highBid.bidder);
    if (contenders.length === 0) return enterTrumpPick1(state);
  }
  // All four passed without any bid → redeal.
  if (!state.highBid && state.passedSeats.length === 4) {
    log(state, 'All passed. Redealing.');
    state.dealer = next(state.dealer);
    startHand(state);
    return { ok: true };
  }
  // Advance to next seat not yet passed; if high bidder themselves passed,
  // the loop above already transitioned. Defensive cap prevents any accidental
  // infinite loop.
  let p = next(state.currentBidder);
  for (let i = 0; i < 4 && state.passedSeats.includes(p); i++) p = next(p);
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
    // No bidding over yourself in the 8-card round either. The current
    // high bidder (typically the trump maker entering the round) has no
    // self-raise path — they can only pass, or wait to be outbid.
    if (state.highBid && state.highBid.bidder === seat) return fail('you are already the high bidder');
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
    // House rule (v2.1.0): you can only declare open if you also lead
    // trick 1 (i.e., you sit at the dealer's right). The "open" itself
    // is committed by leading the (former) indicator card on trick 1 —
    // see legalCardIds + handlePlay below.
    if (state.trumpMaker !== next(state.dealer)) return fail('only the trick-1 leader may declare open');
    if (!state.trumpIndicator) return fail('no indicator to reveal');
    state.isOpenTrump = true;
    state.trumpRevealed = true;
    state.openIndicatorId = state.trumpIndicator.id;
    state.hands[state.trumpMaker].push(state.trumpIndicator);
    state.trumpIndicator = null;
    log(state, `${state.seats[seat].name} declared OPEN. Trump is ${state.trumpSuit}. Must lead the indicator on trick 1.`);
  } else if (action.type === 'declareClosed') {
    state.isOpenTrump = false;
    state.openIndicatorId = null;
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

  // Support playing the trump indicator even when it's held outside the hand.
  const hasIndicator = !state.isOpenTrump && state.trumpMaker === seat && !!state.trumpIndicator;
  let idx = hand.findIndex((c) => c.id === action.cardId);
  let card;
  let isIndicator = false;
  if (idx < 0) {
    if (hasIndicator && state.trumpIndicator.id === action.cardId) {
      card = state.trumpIndicator;
      isIndicator = true;
      idx = -1;
    } else {
      return fail('card not in hand');
    }
  } else {
    card = hand[idx];
    isIndicator = hasIndicator && state.trumpIndicator.id === card.id;
  }
  const leadCard = state.currentTrick[0] && state.currentTrick[0].card;
  const leadSuit = leadCard ? (state.currentTrick[0].faceDown && !state.currentTrick[0].isTrumpIndicator ? null : leadCard.suit) : null;
  const isLead = state.currentTrick.length === 0;

  if (isLead) {
    // Indicator is held outside hand; legal to lead it only in trick 8 when
    // it is the player's only remaining card.
    const onlyCardIsIndicator = hand.length === 0 && hasIndicator;
    const traditionalSoloCase = hand.length === 1 && isIndicator;
    if (isIndicator && !(state.tricksPlayed === 7 && (onlyCardIsIndicator || traditionalSoloCase))) {
      return fail('cannot lead the trump indicator');
    }
    if (!state.isOpenTrump && state.tricksPlayed === 0 && seat === state.trumpMaker && seat === next(state.dealer)) {
      if (card.suit === state.trumpSuit && !isIndicator) {
        return fail('first trick lead cannot be trump in closed game');
      }
    }
    // Open-round commitment (v2.1.0): on trick 1 the trump caller MUST
    // lead the (former) indicator — the act of laying it on the table
    // reveals the suit to everyone and crystallises the "open" call.
    if (state.isOpenTrump && state.tricksPlayed === 0 && seat === state.trumpMaker && state.openIndicatorId) {
      if (card.id !== state.openIndicatorId) {
        return fail('open declaration: must lead the trump indicator on trick 1');
      }
    }
    if (state.isOpenTrump || state.trumpRevealed) {
      const exhausted = exhaustedTrumpCheck(state, seat, card);
      if (exhausted) return fail(exhausted);
    }
  } else {
    const following = hand.some((c) => c.suit === leadSuit && !(!state.isOpenTrump && c === state.trumpIndicator));
    if (following && card.suit !== leadSuit) {
      return fail('must follow suit');
    }
    if (!following && !state.isOpenTrump) {
      // House rule (v2.2.5): the trump maker's face-down play in a
      // closed game is either a DISPOSAL (a non-trump card thrown
      // away) or a CUT using the indicator itself. A non-indicator
      // trump can never be played face-down by the maker — if they
      // want to play a hand-trump, the game has to be open first.
      // This keeps cuts predictable: whenever the maker cuts, the
      // card flipped face-up is necessarily the preselected indicator.
      if (state.trumpMaker === seat && !isIndicator && card.suit === state.trumpSuit) {
        return fail('trump maker cannot play a non-indicator trump face-down — use the indicator to cut, or play a non-trump as a disposal');
      }
      if (!isIndicator) {
        // Anyone can't-follow-suit in a closed game must play face-down.
        if (!action.faceDown) action.faceDown = true;
      }
    }
  }

  if (idx >= 0) hand.splice(idx, 1);
  if (isIndicator) {
    state.trumpIndicator = null;
  }
  // Once the open-mode indicator has been led, the constraint is satisfied
  // and any future trump-suit card is a normal play.
  if (state.openIndicatorId && card.id === state.openIndicatorId) {
    state.openIndicatorId = null;
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
  // Reset the per-trick cut flag — only set if THIS trick's resolution
  // exposed a cut. (The previous trick's flag would otherwise linger.)
  state.cutResolved = false;
  const inClosed = !state.isOpenTrump && !state.trumpRevealed;
  if (inClosed) {
    const anyFaceDownTrump = state.currentTrick.some((p) => p.faceDown && p.card.suit === state.trumpSuit);
    if (anyFaceDownTrump) {
      state.trumpRevealed = true;
      state.isOpenTrump = true;
      state.cutResolved = true;
      // House rule (v2.2.4, user rule Q1=B): when a cut succeeds,
      // reveal ONLY the trump-suited face-down cards. Non-trump
      // face-downs — whether from the trump holder's defensive
      // discard OR from another player's bluff cut attempt — stay
      // hidden permanently. Every player's discard privacy is
      // preserved; only the trump that actually cut gets exposed.
      state.currentTrick = state.currentTrick.map((p) => {
        if (p.faceDown && p.card.suit === state.trumpSuit) {
          return { ...p, faceDown: false };
        }
        return p;
      });
      if (state.trumpIndicator) {
        state.hands[state.trumpMaker].push(state.trumpIndicator);
        state.trumpIndicator = null;
      }
      log(state, `Cut! Trump suit (${state.trumpSuit}) revealed.`);
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
  state.cutResolved = false;
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
    // Two paths that lock a seat out of bidding for the rest of the round:
    //   1. No self-overbid (v2.1.0): once you're the current high bidder,
    //      you can only pass.
    //   2. Asker lockout (v2.2.1): once you've asked partner to bid, you
    //      can only pass — you've delegated the call to your partner.
    // In both cases we return an empty `amts` so the UI doesn't even
    // render bid chips for the seat.
    const isHighBidder = state.highBid && state.highBid.bidder === seat;
    const isAsker = state.isAsker[seat];
    const amts = (isHighBidder || isAsker) ? [] : bidAmountsLegal(state, seat);
    if (amts.length) list.push({ type: 'bid', amounts: amts });
    list.push({ type: 'pass' });
    // askPartner is available only once per round (v2.2.3). If you
    // already asked, or you were already asked by your partner, the
    // chip is hidden — the symmetric `askedPartner[seat]` flag tracks
    // both sides of an ask.
    if (state.bidTurns[seat] === 0 && state.seats[partnerOf(seat)] && !state.askedPartner[seat]) {
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
    // Same no-self-overbid rule applies in the 8-card round. The trump
    // maker enters bid8 as the high bidder by definition; their only
    // option is to pass (waiting to see if anyone outbids them).
    const isHighBidder = state.highBid && state.highBid.bidder === seat;
    const amts = isHighBidder ? [] : bid8AmountsLegal(state);
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
    // House rule (v2.1.0): only offer the "Declare open" choice if the
    // trump maker is also the trick-1 leader (dealer's right). If
    // someone else leads, the maker has no opportunity to declare open
    // before the first card hits the table — the engine fast-paths
    // through this phase (see handleTrumpPick / handleBid8 advance).
    const makerLeadsFirstTrick = state.trumpMaker === next(state.dealer);
    if (makerLeadsFirstTrick) return [{ type: 'declareOpen' }, { type: 'declareClosed' }];
    return [{ type: 'declareClosed' }];
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
  const hasIndicator = !state.isOpenTrump && state.trumpMaker === seat && !!state.trumpIndicator;
  const indicatorId = hasIndicator ? state.trumpIndicator.id : null;
  // If hand is empty and we are the trump maker with only the indicator left,
  // the indicator is the only legal card (this is the 8th trick case).
  if ((!hand || hand.length === 0) && hasIndicator) return [indicatorId];
  if (!hand || hand.length === 0) return [];

  if (isLead) {
    // Open-round trick 1: the trump maker must lead the (former)
    // indicator card. Single legal card.
    if (state.isOpenTrump && state.tricksPlayed === 0 && seat === state.trumpMaker && state.openIndicatorId) {
      const ind = hand.find((c) => c.id === state.openIndicatorId);
      if (ind) return [ind.id];
      // Defensive: indicator missing from hand (should never happen in a
      // legitimate open declaration). Fall through to the standard rules.
    }
    // Primary filter: indicator restriction + first-trick no-trump + exhausted-trump
    const strict = [];
    for (const c of hand) {
      if (c.id === indicatorId) {
        if (state.tricksPlayed === 7 && hand.length === 1) strict.push(c.id);
        continue;
      }
      if (!state.isOpenTrump && state.tricksPlayed === 0 && seat === state.trumpMaker && seat === next(state.dealer) && c.suit === state.trumpSuit) {
        continue;
      }
      if ((state.isOpenTrump || state.trumpRevealed) && exhaustedTrumpCheck(state, seat, c)) {
        continue;
      }
      strict.push(c.id);
    }
    if (strict.length > 0) return strict;
    // Fallback 1: relax first-trick-no-trump (trump maker's hand is all trumps —
    // edge case; allow a trump lead rather than deadlock).
    const relaxed1 = hand.filter((c) => c.id !== indicatorId).map((c) => c.id);
    if (relaxed1.length > 0) return relaxed1;
    // Fallback 2: only the indicator remains — allow it (typical at trick 8).
    return hand.map((c) => c.id);
  }
  const first = state.currentTrick[0];
  const leadSuit = first.faceDown && !first.isTrumpIndicator ? null : first.card.suit;
  const following = hand.some((c) => c.suit === leadSuit && c.id !== indicatorId);
  if (following) {
    return hand.filter((c) => c.suit === leadSuit && c.id !== indicatorId).map((c) => c.id);
  }
  // Can't follow suit. Any non-indicator hand card is legal. The maker
  // may also cut with the indicator (so we include its id). BUT (v2.2.5)
  // non-indicator trumps in the trump maker's hand are NOT legal in a
  // closed game — they can't be played face-down, and a face-up play
  // isn't allowed when can't-follow either. The non-indicator trumps
  // stay in hand until the game opens (via an indicator cut or the
  // bid≥250 auto-open rule).
  let handIds;
  if (state.trumpMaker === seat && !state.isOpenTrump && !state.trumpRevealed) {
    handIds = hand
      .filter((c) => c.id !== indicatorId && c.suit !== state.trumpSuit)
      .map((c) => c.id);
  } else {
    handIds = hand.filter((c) => c.id !== indicatorId).map((c) => c.id);
  }
  const ids = handIds.slice();
  if (hasIndicator) ids.push(indicatorId);
  if (ids.length > 0) return ids;
  // Degenerate: nothing left but non-indicator trumps and no indicator.
  // This shouldn't happen in a closed game (see ADR); defensively fall
  // back to the full hand so the engine never deadlocks.
  return hand.map((c) => c.id);
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
      // Visibility rules (v2.2.4):
      //  • You always see your own card (including your own face-down
      //    plays — you tapped them).
      //  • Anyone can see a card that's face-up (either never face-down
      //    or revealed as a trump cut).
      //  • A face-down card from another seat is visible privately to
      //    the trump maker (with `makerPeek: true` so the UI can render
      //    the "others see a back" affordance). Everyone else sees a
      //    faceless back (no `card` field at all — no way to leak rank
      //    or suit via devtools).
      //  • This holds even after state.trumpRevealed is true: a
      //    non-trump face-down (a discard, or a bluff cut) stays
      //    hidden from non-makers for the rest of the hand.
      if (p.seat === seat) {
        return { seat: p.seat, card: p.card, faceDown: p.faceDown, isTrumpIndicator: p.isTrumpIndicator };
      }
      if (!p.faceDown) {
        return { seat: p.seat, card: p.card, faceDown: false, isTrumpIndicator: p.isTrumpIndicator };
      }
      if (seat === state.trumpMaker) {
        return { seat: p.seat, card: p.card, faceDown: true, isTrumpIndicator: p.isTrumpIndicator, makerPeek: true };
      }
      return { seat: p.seat, faceDown: true, hidden: true };
    }),
    // True iff a face-down trump was just resolved this trick (informs the
    // client to play a "Cut!" reveal animation and add the suit announcement
    // to the banner). Cleared on the next trick's first play.
    cutResolved: !!state.cutResolved,
    cutWinnerSeat: state.cutResolved ? state.trickLeader : null,
    // Same per-card hiding as currentTrick: a non-trump face-down
    // from another seat is hidden (no `card` field) even in the
    // post-trick record. Prevents leaking rank/suit via view.lastTrick.
    lastTrick: state.lastTrick ? state.lastTrick.map((p) => {
      if (p.seat === seat) return { seat: p.seat, card: p.card, faceDown: p.faceDown, isTrumpIndicator: p.isTrumpIndicator };
      if (!p.faceDown) return { seat: p.seat, card: p.card, faceDown: false, isTrumpIndicator: p.isTrumpIndicator };
      if (seat === state.trumpMaker) return { seat: p.seat, card: p.card, faceDown: true, isTrumpIndicator: p.isTrumpIndicator, makerPeek: true };
      return { seat: p.seat, faceDown: true, hidden: true };
    }) : null,
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
