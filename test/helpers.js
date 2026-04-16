// Shared helpers for the 304 test suite. Zero external deps.
// Uses Node's built-in strict assert. Each test file prints OK/FAIL lines.

const assert = require('node:assert/strict');
const game = require('../src/engine/game');

let _passed = 0;
let _failed = 0;
const _failures = [];

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

function ok(label, fn) {
  try {
    fn();
    _passed += 1;
    process.stdout.write(`  ${GREEN}\u2713${RESET} ${label}\n`);
  } catch (err) {
    _failed += 1;
    _failures.push({ label, err });
    process.stdout.write(`  ${RED}\u2717${RESET} ${label}\n`);
    const stack = (err && err.stack) || String(err);
    // Indent the stack for readability.
    for (const line of String(stack).split('\n')) {
      process.stdout.write(`      ${line}\n`);
    }
  }
}

function summary() {
  return { passed: _passed, failed: _failed, failures: _failures.slice() };
}

function resetCounts() {
  _passed = 0;
  _failed = 0;
  _failures.length = 0;
}

// --- deterministic RNG (LCG) ----------------------------------------------
// Numerical Recipes LCG — deterministic and sufficient for shuffle seeding.
function makeRng(seed) {
  let s = (seed >>> 0) || 1;
  return function next() {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

// Seat 4 players and start a hand with a deterministic RNG.
function newGame(names = ['A', 'B', 'C', 'D'], allAI = true) {
  const state = game.createGame('TESTRM');
  for (let s = 0; s < 4; s++) {
    game.seatPlayer(state, { seat: s, name: names[s], isAI: !!allAI });
  }
  const rng = makeRng(1234);
  game.startHand(state, rng);
  return { state, rng };
}

// Pick the current actor per the current phase. Returns -1 if no actor.
function currentActor(state) {
  switch (state.phase) {
    case game.PHASES.BID4:
    case game.PHASES.BID8:
      return state.currentBidder != null ? state.currentBidder : -1;
    case game.PHASES.TRUMP_PICK1:
    case game.PHASES.TRUMP_PICK2:
    case game.PHASES.OPEN_CHOICE:
      return state.trumpMaker != null ? state.trumpMaker : -1;
    case game.PHASES.PLAY:
    case game.PHASES.INSPECT:
      return state.currentPlayer != null ? state.currentPlayer : -1;
    case game.PHASES.HAND_END:
      return 0; // any seat may continue
    default:
      return -1;
  }
}

// Drive the state machine using the AI until predicate is true or cap hit.
function playUntil(state, predicate, rng, stepCap = 3000) {
  const ai = require('../src/engine/ai');
  let steps = 0;
  while (steps < stepCap) {
    if (predicate(state)) return { state, steps, ok: true };
    const actor = currentActor(state);
    if (actor < 0) return { state, steps, ok: false, reason: 'no actor' };
    const action = ai.chooseAction(state, actor);
    if (!action) return { state, steps, ok: false, reason: 'no action' };
    const res = game.applyAction(state, actor, action);
    if (!res || !res.ok) {
      return {
        state,
        steps,
        ok: false,
        reason: `illegal action by AI at seat ${actor} phase=${state.phase}: ${JSON.stringify(action)} -> ${res && res.reason}`,
      };
    }
    steps += 1;
  }
  return { state, steps, ok: predicate(state), reason: 'step cap hit' };
}

module.exports = { ok, summary, resetCounts, makeRng, newGame, currentActor, playUntil, assert };
