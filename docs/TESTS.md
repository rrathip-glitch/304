# 304 Test Suite

The test suite lives in `/test` and has zero external dependencies beyond
what is already in `package.json`. All assertions use Node's built-in
`node:assert/strict`. The runner is a plain script.

## Running

```bash
node test/run.js
```

The runner discovers every `*.test.js` file in `/test` (except itself and
`helpers.js`), requires them in alphabetical order, and prints a colored
pass/fail line per assertion. It exits non-zero on any failure.

Example output:

```
▶ cards.test.js
  ✓ deck has 32 unique cards
  ✓ point values sum to 304
  ...
▶ game-bid4.test.js
  ✓ bid floor starts at 160
  ...
SUMMARY: 47 passed, 0 failed in 0.42s
```

## Coverage

### Engine (unit)

- [`test/cards.test.js`](../test/cards.test.js) — deck composition, point
  totals, rank ordering, `compareCards`, `winningIndex`, `legalCards`.
- [`test/game-bid4.test.js`](../test/game-bid4.test.js) — four-card bidding
  phase: rotation, multiples of 10, 160 floor, 200 floor on second turn /
  partner-is-high, `askPartner`, `demandRedeal`, all-pass restart, transition
  into `trump_pick1`.
- [`test/game-play.test.js`](../test/game-play.test.js) — trick-play
  invariants: pickTrump removes indicator, second batch gives maker 7 cards,
  first-trick trump-lead ban in closed, follow-suit enforcement, automatic
  face-down when void in closed games, face-down trump reveal path, auto-open
  at ≥250, trick 8 forced indicator.
- [`test/game-scoring.test.js`](../test/game-scoring.test.js) — token
  transfer per bid range and success/fail, high-court override, token cap
  and game_over phase.

### Privacy (unit)

- [`test/view-leak.test.js`](../test/view-leak.test.js) — `viewFor` must not
  leak hidden state: other seats cannot see the trump indicator until it's
  revealed, `hands` is not in the view, face-down cards in the current trick
  are masked for non-owners/non-maker, indicator surfaces for all seats once
  revealed.

### End-to-end

- [`test/playthrough.test.js`](../test/playthrough.test.js) — 4 AIs play
  to completion with 5 deterministic seeds. Asserts ≥3 of 5 terminate under
  5000 steps, token sum invariant at end, one team ≥22 at game_over,
  no AI action ever returns `{ok:false}`, and random view samples during
  play never expose opponents' hands.

### Server integration

- [`test/server.test.js`](../test/server.test.js) — spins up an in-process
  Socket.IO server on an ephemeral port (`listen(0)`) and exercises
  `createRoom`, `joinRoom`, `startGame`, wrong-seat action errors, and
  disconnect + reconnect resume. Skips gracefully if `socket.io-client`
  is not installed.

### Not covered

- **UI**: `/public/index.html` and its client script are not tested. A
  headless browser harness (e.g. Playwright) is out of scope for this
  suite — add later if desired.
- **Network resilience** beyond a single reconnect. Deep flake tests
  (packet loss, partitions, etc.) are not included.
- **Partner Close Caps (PCC)** bidding path — the full PCC flow is not
  implemented in the engine yet, so no tests exist for it.

## Adding new tests

1. Copy an existing `*.test.js` as a template.
2. At the top, `const { ok, assert } = require('./helpers');` (plus any
   engine modules you need).
3. Add `ok('descriptive label', () => { /* assertions */ });` calls.
4. Save the file in `/test` — `run.js` picks it up automatically.
5. Prefer seeded determinism: `const rng = helpers.makeRng(1234);` and
   pass to `game.startHand(state, rng)`.
6. If your test is asynchronous, export `module.exports = { run: async ()
   => { ... } };` from the file — the runner awaits it.

## CI

- Tests run on **Node 20** (the project's documented target; the engines
  field in `package.json` is `>=18`).
- **No external test framework**. The runner, helpers, and all assertions
  are plain JavaScript files.
- The server test depends on `socket.io-client`; install it in CI with
  `npm install --no-save socket.io-client` (dev-only dependency). If it
  is missing, that file's assertions are skipped with a warning, and the
  rest of the suite still runs.
