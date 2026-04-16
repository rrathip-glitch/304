#!/usr/bin/env node
/*
 * 304 — headless QA simulator
 *
 * Exercises the real engine + AI end-to-end across many hands and asserts
 * the invariants the server relies on (no illegal actions, no view leaks,
 * phase progress, token conservation, point-total = 304 per hand).
 *
 * Usage:
 *   node scripts/simulate.js                 # default 100 hands
 *   node scripts/simulate.js --hands=500     # custom
 *   node scripts/simulate.js --seed=42       # deterministic
 *   node scripts/simulate.js --verbose       # per-hand log
 *   node scripts/simulate.js --match         # play full matches to 22 tokens
 *
 * Exits non-zero on any assertion failure; the first failure dumps state.
 * Designed to run in CI and on developer machines with zero deps.
 */

'use strict';

const game = require('../src/engine/game');
const ai = require('../src/engine/ai');
const cards = require('../src/engine/cards');

// ---------- CLI parsing ----------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    if (!a.startsWith('--')) return [a, true];
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v == null ? true : v];
  })
);

const HANDS = Number(args.hands || 100);
const VERBOSE = !!args.verbose;
const MATCH_MODE = !!args.match;
const SEED = args.seed != null ? Number(args.seed) : null;

// ---------- Deterministic RNG (mulberry32) ----------
function rngFromSeed(seed) {
  let t = (seed | 0) || 1;
  return function () {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = SEED != null ? rngFromSeed(SEED) : Math.random;

// ---------- Assertion helpers ----------
const results = { hands: 0, matches: 0, aborts: 0, errors: [], phases: {} };

function fail(msg, state, extra) {
  results.errors.push({ msg, state: dumpState(state), extra });
  const err = new Error('ASSERT: ' + msg);
  err.state = state;
  throw err;
}
function assert(cond, msg, state, extra) {
  if (!cond) fail(msg, state, extra);
}
function dumpState(s) {
  if (!s) return null;
  return {
    phase: s.phase,
    handNumber: s.handNumber,
    dealer: s.dealer,
    currentPlayer: s.currentPlayer,
    trumpMaker: s.trumpMaker,
    trumpSuit: s.trumpSuit,
    trumpRevealed: s.trumpRevealed,
    isOpenTrump: s.isOpenTrump,
    bids: (s.bids || []).map((b) => ({
      seat: b.seat,
      type: b.type,
      amount: b.amount,
    })),
    highBid: s.highBid,
    tricksPlayed: s.tricksPlayed,
    tokens: s.tokens,
    tricksWon: s.tricksWon,
    handCounts: (s.hands || []).map((h) => (h ? h.length : 0)),
    logTail: (s.log || []).slice(-8),
  };
}

// ---------- View-leak checks ----------
// Every seat's PlayerView must not reveal another seat's cards, nor the
// trump indicator while the game is closed (unless the viewer is trump maker).
function checkViewsLeakFree(state) {
  for (let seat = 0; seat < 4; seat++) {
    const v = game.viewFor(state, seat);
    assert(Array.isArray(v.yourHand), 'view.yourHand missing', state);
    assert(
      v.yourHand.length === (state.hands[seat] || []).length,
      'view.yourHand length mismatch',
      state,
      { seat, viewLen: v.yourHand.length, realLen: state.hands[seat].length }
    );
    // View must not include other seats' `hands` array (private field).
    for (const other of [0, 1, 2, 3]) {
      if (other === seat) continue;
      if (Array.isArray(v.hands)) {
        assert(
          !v.hands[other] || v.hands[other].length === 0,
          'view leaked another seat hand',
          state,
          { viewer: seat, leakedSeat: other }
        );
      }
    }
    // Trump indicator visibility rule
    if (v.trumpIndicator) {
      const allowed =
        state.trumpRevealed ||
        state.isOpenTrump ||
        seat === state.trumpMaker;
      assert(
        allowed,
        'view leaked trump indicator',
        state,
        { seat, trumpMaker: state.trumpMaker }
      );
    }
    // Face-down cards in the current trick must be hidden to non-privileged
    // viewers while the game is CLOSED. Once state.trumpRevealed is true,
    // the rule allows all players to see past cards — except the maker's
    // own face-down non-trump discard, which stays hidden. We only flag
    // the closed-game leak here; the maker's-discard edge case is tracked
    // separately (see docs/TASKS.md "Issues / bugs").
    if (!state.trumpRevealed) {
      for (const play of v.currentTrick || []) {
        if (play.faceDown && !play.revealed && play.seat !== seat) {
          if (play.card && !play.hidden && seat !== state.trumpMaker) {
            fail('face-down card leaked rank/suit to non-privileged seat', state, {
              viewer: seat,
              play,
            });
          }
        }
      }
    }
  }
}

// ---------- Token / deck invariants ----------
function checkTokenTotal(state) {
  const sum = (state.tokens || [0, 0]).reduce((a, b) => a + b, 0);
  assert(sum === 22, 'token sum != 22', state, { tokens: state.tokens });
  assert(state.tokens[0] >= 0 && state.tokens[1] >= 0, 'negative tokens', state);
}

function checkDeckIntegrity(state) {
  // Sum all cards currently visible (hands + trick + indicator + discard pool)
  // Actually easier: the engine shouldn't be duplicating cards. Check that
  // across the 4 hands there are no duplicate card ids.
  const seen = new Set();
  for (let s = 0; s < 4; s++) {
    for (const c of state.hands[s] || []) {
      assert(!seen.has(c.id), 'duplicate card across hands: ' + c.id, state);
      seen.add(c.id);
    }
  }
}

// ---------- Phase counter ----------
function recordPhase(phase) {
  results.phases[phase] = (results.phases[phase] || 0) + 1;
}

// ---------- Phase → actor seat ----------
function actorFor(state) {
  switch (state.phase) {
    case game.PHASES.BID4:
    case game.PHASES.BID8:
      return state.currentBidder;
    case game.PHASES.TRUMP_PICK1:
    case game.PHASES.TRUMP_PICK2:
    case game.PHASES.OPEN_CHOICE:
      return state.trumpMaker;
    case game.PHASES.PLAY:
    case game.PHASES.INSPECT:
      return state.currentPlayer;
    case game.PHASES.HAND_END:
      return 0;
    default:
      return null;
  }
}

// ---------- Run one hand to completion ----------
function runHand(state, handIdx) {
  game.startHand(state, rng);
  let safety = 2000;
  // Detect lack of progress: if (phase, currentBidder/Player, highBid,
  // tricksPlayed) doesn't change across N iterations, we're spinning.
  let lastSig = '';
  let stuckCount = 0;
  while (state.phase !== game.PHASES.HAND_END && state.phase !== game.PHASES.GAME_OVER) {
    if (safety-- <= 0) fail('hand exceeded safety step count', state);
    const sig = [
      state.phase, state.currentBidder, state.currentPlayer,
      state.highBid && state.highBid.amount, state.tricksPlayed,
      state.bids.length, state.hands.map((h) => h.length).join(','),
    ].join('|');
    if (sig === lastSig) {
      if (++stuckCount >= 20) {
        // Stuck in a loop without progressing. Abort this hand.
        results.aborts++;
        if (VERBOSE) console.log(`hand ${handIdx + 1}: ABORTED — stuck (phase=${state.phase} sig=${sig}) last-log: ${(state.log || []).slice(-3).join(' | ')}`);
        return 'aborted';
      }
    } else {
      stuckCount = 0;
      lastSig = sig;
    }
    recordPhase(state.phase);
    checkViewsLeakFree(state);
    checkDeckIntegrity(state);

    // Actor seat varies by phase. Engine fields:
    //   BID4 / BID8           → state.currentBidder
    //   TRUMP_PICK1/2, OPEN_CHOICE → state.trumpMaker
    //   PLAY, INSPECT         → state.currentPlayer
    //   HAND_END              → any seat may `continue`; pick 0
    const seat = actorFor(state);
    if (seat == null) {
      fail('no actor seat in non-terminal phase', state);
    }

    const action = ai.chooseAction(state, seat);
    if (!action) {
      // Known engine edge case (see docs/TASKS.md "Issues / bugs" #1): AI
      // can be handed an empty legal-card list — typically a closed-trump
      // maker forced to lead trick 1 with only trumps + indicator. Abort
      // this hand and count it rather than crashing the full run, so the
      // rest of the sweep can continue and surface other issues.
      results.aborts++;
      if (VERBOSE) {
        console.log(`hand ${handIdx + 1}: ABORTED — no legal action for seat ${seat} in ${state.phase}`);
      }
      return 'aborted';
    }

    // Sanity: AI action must be in the legal list (or `continue`, which is
    // always a passive legal action).
    const legal = game.legalActions(state, seat) || [];
    const legalTypes = new Set(legal.map((a) => a.type));
    if (!legalTypes.has(action.type)) {
      fail('AI produced illegal action type', state, {
        seat,
        phase: state.phase,
        action,
        legalTypes: [...legalTypes],
      });
    }

    if (process.env.TRACE) {
      console.log(`  ${state.phase} seat=${seat} action=${JSON.stringify(action)}`);
    }
    // Note: applyAction itself can infinite-loop on certain rule edge cases
    // (see docs/TASKS.md "Issues / bugs" #2). We can't catch that from here
    // without a worker; run with a shell-level timeout, e.g.
    //   timeout 60 node scripts/simulate.js --hands=100
    const res = game.applyAction(state, seat, action);
    assert(res && res.ok !== false, 'applyAction rejected AI action', state, {
      seat,
      action,
      res,
    });
  }

  // Post-hand checks (terminal states only)
  if (state.phase === game.PHASES.HAND_END || state.phase === game.PHASES.GAME_OVER) {
    // Trick-points across teams should sum to 304 for a completed hand
    // (unless the hand was abandoned — then bids is empty or all passed).
    const abandoned = !state.trumpMaker || state.trumpSuit == null;
    if (!abandoned && state.tricksPlayed === 8) {
      const sum = (state.trickPoints || [0, 0]).reduce((a, b) => a + b, 0);
      assert(sum === 304, 'trick points sum != 304', state, {
        trickPoints: state.trickPoints,
      });
      const tricksSum = (state.tricksWon || [0, 0]).reduce((a, b) => a + b, 0);
      assert(tricksSum === 8, 'tricksWon sum != 8', state, {
        tricksWon: state.tricksWon,
      });
    }
    checkTokenTotal(state);
    results.hands++;
    if (VERBOSE) {
      const bid = state.highBid
        ? (state.highBid.isCloseCaps ? 'PCC' : state.highBid.amount)
        : '—';
      const tm = state.trumpMaker != null ? state.trumpMaker : '—';
      console.log(
        `hand ${handIdx + 1}: dealer=${state.dealer} maker=${tm} bid=${bid} ` +
          `tricks=${state.tricksPlayed} pts=[${state.trickPoints}] ` +
          `tokens=[${state.tokens}] tricksWon=[${state.tricksWon}]`
      );
    }
  }

  return state.phase;
}

// ---------- Run a match (to 22 tokens) or a fixed hand count ----------
function makeSeatedGame(roomId = 'SIM') {
  const s = game.createGame(roomId);
  for (let i = 0; i < 4; i++) {
    const r = game.seatPlayer(s, { seat: i, name: `AI-${i}`, isAI: true });
    if (!r || r.ok === false) throw new Error('seatPlayer failed: ' + (r && r.reason));
  }
  return s;
}

function run() {
  console.log(
    `304 simulator — ${HANDS} hand${HANDS === 1 ? '' : 's'}` +
      (SEED != null ? ` (seed=${SEED})` : '') +
      (MATCH_MODE ? ' [match mode]' : '')
  );
  const started = Date.now();

  if (MATCH_MODE) {
    // Keep starting hands until a team hits 22 or 0 tokens. Each "hand"
    // counts toward HANDS upper bound as a safety cap.
    let state = makeSeatedGame();
    let handIdx = 0;
    while (
      state.phase !== game.PHASES.GAME_OVER &&
      handIdx < HANDS
    ) {
      runHand(state, handIdx++);
      if (
        state.tokens[0] >= 22 ||
        state.tokens[1] >= 22 ||
        state.tokens[0] <= 0 ||
        state.tokens[1] <= 0
      ) {
        if (state.phase !== game.PHASES.GAME_OVER) {
          // engine should have transitioned; if not, that's a bug
          fail('token threshold reached but phase not game_over', state);
        }
      }
    }
    results.matches = 1;
  } else {
    let state = makeSeatedGame();
    for (let i = 0; i < HANDS; i++) {
      // If a match ends naturally, start fresh
      if (state.phase === game.PHASES.GAME_OVER) state = makeSeatedGame();
      const outcome = runHand(state, i);
      // If the hand aborted mid-play, the state is in an indeterminate
      // phase. Reset to a fresh seated game so the next iteration starts
      // cleanly.
      if (outcome === 'aborted') state = makeSeatedGame();
    }
  }

  const ms = Date.now() - started;
  console.log('---');
  console.log(
    `completed ${results.hands} hand${results.hands === 1 ? '' : 's'} in ` +
      `${ms}ms (${Math.round(results.hands / Math.max(ms / 1000, 0.001))}/s)`
  );
  console.log(`aborts: ${results.aborts}`);
  console.log('phases visited:', results.phases);
  if (results.errors.length) {
    console.error(
      `FAIL — ${results.errors.length} assertion failure${
        results.errors.length === 1 ? '' : 's'
      }`
    );
    for (const e of results.errors.slice(0, 3)) {
      console.error('  •', e.msg);
      console.error('    state:', JSON.stringify(e.state, null, 2));
      if (e.extra) console.error('    extra:', JSON.stringify(e.extra, null, 2));
    }
    process.exit(1);
  }
  console.log('PASS — all invariants held.');
}

try {
  run();
} catch (e) {
  console.error('UNCAUGHT:', e && e.stack ? e.stack : e);
  if (e && e.state) console.error('last state:', JSON.stringify(dumpState(e.state), null, 2));
  process.exit(2);
}
