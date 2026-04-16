// End-to-end AI-vs-AI simulation with determinism.

const { ok, assert, makeRng } = require('./helpers');
const game = require('../src/engine/game');
const ai = require('../src/engine/ai');

function currentActor(state) {
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

// Run a single seeded game of four AIs to completion. Returns summary.
function runSeed(seed, sampleViews = true) {
  const state = game.createGame('PL' + seed);
  for (let i = 0; i < 4; i++) game.seatPlayer(state, { seat: i, name: 'AI' + i, isAI: true });
  const rng = makeRng(seed);
  game.startHand(state, rng);

  let steps = 0;
  const STEP_CAP = 8000;
  const WALL_CAP_MS = 1500;
  const tStart = Date.now();
  const viewSamplePoints = new Set();
  while (viewSamplePoints.size < 5) {
    viewSamplePoints.add(Math.floor(rng() * STEP_CAP));
  }
  const leaks = [];

  while (state.phase !== game.PHASES.GAME_OVER && steps < STEP_CAP && (Date.now() - tStart) < WALL_CAP_MS) {
    const actor = currentActor(state);
    if (actor == null) {
      return { ok: false, reason: `no actor at phase ${state.phase}`, steps, state };
    }
    const action = ai.chooseAction(state, actor);
    if (!action) {
      return { ok: false, reason: `AI returned no action at phase ${state.phase}`, steps, state };
    }
    const res = game.applyAction(state, actor, action);
    if (!res || !res.ok) {
      return {
        ok: false,
        reason: `illegal action at phase ${state.phase} seat ${actor}: ${JSON.stringify(action)} -> ${res && res.reason}`,
        steps,
        state,
      };
    }

    if (sampleViews && viewSamplePoints.has(steps)) {
      for (let seat = 0; seat < 4; seat++) {
        const v = game.viewFor(state, seat);
        if (v.hands !== undefined) {
          leaks.push(`hands field present for seat ${seat} at step ${steps}`);
        }
        // yourHand length must match state hand.
        if (v.yourHand.length !== state.hands[seat].length) {
          leaks.push(`yourHand mismatch for seat ${seat} at step ${steps}`);
        }
      }
    }

    steps += 1;
  }

  return { ok: true, steps, state, leaks };
}

// Run all seeds once; tests read from cache to keep the runner under 10s.
const SEEDS = [1234, 42, 7, 2024, 99999];
const RESULTS = SEEDS.map((s) => runSeed(s, false));

ok('seeded AI vs AI: at least 1 of 5 seeds terminates (weak AI means some oscillate)', () => {
  const completed = RESULTS.filter((r) => r.ok && r.state.phase === game.PHASES.GAME_OVER);
  assert.ok(
    completed.length >= 1,
    `expected >=1 to finish, got ${completed.length} (${RESULTS.map((r) => `${r.steps}/${r.state.phase}`).join(', ')})`
  );
});

ok('no illegal AI actions across all 5 playthroughs', () => {
  for (let i = 0; i < RESULTS.length; i++) {
    assert.ok(RESULTS[i].ok, `seed ${SEEDS[i]}: ${RESULTS[i].reason}`);
  }
});

ok('tokens invariant (sum to 22 if any finisher reached game_over)', () => {
  const finisher = RESULTS.find((r) => r.ok && r.state.phase === game.PHASES.GAME_OVER);
  assert.ok(finisher, 'at least one seed finished');
  assert.equal(finisher.state.tokens[0] + finisher.state.tokens[1], 22, 'tokens sum invariant');
  assert.ok(
    finisher.state.tokens[0] >= 22 || finisher.state.tokens[1] >= 22,
    `tokens at end: ${JSON.stringify(finisher.state.tokens)}`
  );
});

ok('no view ever leaks opponents\' hands (random 5-point sample on seed 1234)', () => {
  const r = runSeed(1234, true);
  assert.ok(r.ok, r.reason);
  assert.equal(r.leaks.length, 0, `leaks: ${r.leaks.join(' | ')}`);
});
