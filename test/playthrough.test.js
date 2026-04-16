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
  const STEP_CAP = 5000;
  const viewSamplePoints = new Set();
  while (viewSamplePoints.size < 5) {
    viewSamplePoints.add(Math.floor(rng() * STEP_CAP));
  }
  const leaks = [];

  while (state.phase !== game.PHASES.GAME_OVER && steps < STEP_CAP) {
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

ok('seeded AI vs AI: at least 3 of 5 seeds terminate in under 5000 steps', () => {
  const seeds = [1234, 42, 7, 2024, 99999];
  const results = seeds.map((s) => runSeed(s, false));
  const completed = results.filter((r) => r.ok && r.state.phase === game.PHASES.GAME_OVER);
  assert.ok(
    completed.length >= 3,
    `expected >=3 to finish under 5000 steps, got ${completed.length} (${results.map((r) => `${r.steps}/${r.state.phase}`).join(', ')})`
  );
});

ok('no illegal AI actions across all 5 playthroughs', () => {
  const seeds = [1234, 42, 7, 2024, 99999];
  for (const s of seeds) {
    const r = runSeed(s, false);
    assert.ok(r.ok, `seed ${s}: ${r.reason}`);
  }
});

ok('at end of game: tokens sum to 22', () => {
  // Use the default seed which we expect to finish; fall back to any finisher.
  const seeds = [1234, 42, 7, 2024, 99999];
  let finisher = null;
  for (const s of seeds) {
    const r = runSeed(s, false);
    if (r.ok && r.state.phase === game.PHASES.GAME_OVER) { finisher = r; break; }
  }
  assert.ok(finisher, 'at least one seed finished');
  assert.equal(finisher.state.tokens[0] + finisher.state.tokens[1], 22, 'tokens sum invariant');
});

ok('at end of game: one team has >= 22 tokens', () => {
  const seeds = [1234, 42, 7, 2024, 99999];
  let finisher = null;
  for (const s of seeds) {
    const r = runSeed(s, false);
    if (r.ok && r.state.phase === game.PHASES.GAME_OVER) { finisher = r; break; }
  }
  assert.ok(finisher, 'at least one seed finished');
  assert.ok(
    finisher.state.tokens[0] >= 22 || finisher.state.tokens[1] >= 22,
    `tokens at end: ${JSON.stringify(finisher.state.tokens)}`
  );
});

ok('no view ever leaks opponents\' hands (random 5-point sample)', () => {
  const r = runSeed(1234, true);
  assert.ok(r.ok, r.reason);
  assert.equal(r.leaks.length, 0, `leaks: ${r.leaks.join(' | ')}`);
});
