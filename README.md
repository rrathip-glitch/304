# 304 — Mobile Multiplayer Card Game

[![version](https://img.shields.io/badge/version-2.2.0-blue.svg)](#release-notes)

A web-based implementation of **304**, a Sri Lankan trick-taking card game.
Built mobile-first for seamless play between two humans (e.g. you and your
dad) with AI partners/opponents filling empty seats.

## Quick Start

```bash
npm install
npm start
# -> http://localhost:3000
```

Open the URL on your phone. Create a room. Share the join link with your dad.
Any empty seats are filled by the AI.

## How to Play (30-second version)

- 4 players in 2 teams of 2, partners sit opposite.
- You are dealt 8 cards (in two batches of 4, with bidding between).
- One team **bids** a target point total (min 160) they promise to win in
  tricks. Highest bidder picks a **trump** suit (secretly: one card face-down).
- Play 8 tricks, counter-clockwise. Must follow suit; if you can't, you may
  **cut** by tapping any card — it's played face-down. If your face-down
  card matches the (still-secret) trump suit, your team wins the trick AND
  leads the next one. The trump caller is the only one who sees what you
  played until reveal.
- Bidders win tokens if they meet their bid; otherwise opponents win tokens.
- First team to hold all **22 tokens** wins the match.

Full rules are in [`docs/RULES.md`](docs/RULES.md).

## Release Notes

### v2.2.0 — 2026-04-17

- **Stall fallback.** If the player whose turn it is loses connection
  (closed tab, lost signal), the AI auto-plays for them after 25 s so
  the table doesn't freeze. The AI step is cancelled instantly if the
  human reconnects in time.
- **Idle room garbage collection.** Rooms with no live sockets and 30+
  minutes of inactivity are reclaimed automatically. Memory stays
  bounded across long uptimes.
- **Boundary input hardening.** All client → server payloads pass
  through `src/util/sanitize.js` (`sanitizeAction`, `sanitizeName`).
  Malformed actions, oversized names, and control characters are
  rejected at the edge.
- New test: `node scripts/robust-test.js` (24 assertions; live-server
  boot test included).

### v2.1.0 — 2026-04-17

- **No bidding over yourself.** Once you're the high bidder, the bid
  chips disappear from your action bar; you can only pass or wait to be
  outbid. Applies to both 4-card and 8-card rounds.
- **Open declaration is now committal.** You may only declare open if
  you also lead trick 1 (i.e., sit at the dealer's right). Doing so
  forces you to lead the (former) trump indicator card on trick 1 — the
  act of laying it on the table is what reveals the suit.
- **Current-bid strip** above the table — visible across bidding AND
  gameplay so the stake is always one glance away. Shows amount,
  bidder, trump suit + open/closed status.
- **Auto-resolve** on bid + 3 passes (was already the engine behavior;
  now explicitly documented and tested).
- New tests: `node scripts/bid-test.js` (31 assertions across 5
  scenarios). `layout-smoke.js` extended to 30 assertions covering the
  new rules.

### v2.0.0 — 2026-04-17

- **Cutting mechanic with full UX.** When you can't follow suit the
  banner prompts you to cut; the trump maker secretly sees what you
  played; if it's a trump, the table flips to "open" and your team wins
  the trick.
- **Trump indicator is selectable** — fixes the dead-screen bug where the
  trump maker had only the indicator left and no card was tappable.
- **Responsive layout overhaul** — `clamp()` card sizes, `100dvh`,
  iOS/Android safe-area support, vertical-stack overflow caps. Looks
  right on every viewport from iPhone SE to iPad mini.
- **Standard semver** versioning across all surfaces.
- **Regression suite**: `node scripts/layout-smoke.js` + `node
  scripts/cut-test.js` lock these fixes in.

### v1.0.0 — 2026-04-16

- Initial Railway-deployable build with full bidding, trick play, AI,
  reconnect handling.

## Deployment (Railway)

Railway watches **`claude/mobile-game-development-GifG7`**. Pushing to
that branch triggers an auto-build via `Dockerfile`; Railway sets `PORT`
itself. To ship a release:

```bash
# from a feature branch, after running the test suite below:
git checkout claude/mobile-game-development-GifG7
git merge <feature-branch> --no-edit
git push origin claude/mobile-game-development-GifG7
# wait ~60s, then:
curl https://<your-app>.up.railway.app/version
# → {"version":"2.2.0","startedAt":"..."}
```

If `version` matches `package.json#version`, you're live. Full procedure,
troubleshooting, and rollback steps are in
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Tests

```bash
node scripts/layout-smoke.js   # 36 structural assertions
node scripts/cut-test.js       # 24 engine assertions, 3 cut scenarios
node scripts/bid-test.js       # 31 engine assertions, 5 bid + open scenarios
node scripts/robust-test.js    # 24 boundary + live-boot assertions
node scripts/smoke.js          # one full 4-AI match
node scripts/soak.js 5         # 5 matches; token invariant
node scripts/e2e.js            # boots server, drives socket
```

All five must be green before pushing to the watched branch. Full
test scenarios (including manual mobile-UX checks) are in
[`docs/TESTING.md`](docs/TESTING.md).

## Documentation for Future Contributors (Human or AI)

**If you are a new AI instance continuing this project, read
[`docs/SOUL.md`](docs/SOUL.md) first.** It is the orientation file.

- [`docs/SOUL.md`](docs/SOUL.md) — Identity, principles, and self-improvement
  protocol for any agent working on this codebase.
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — File map, data flow,
  state shape.
- [`docs/RULES.md`](docs/RULES.md) — Canonical 304 rules as implemented here.
- [`docs/API.md`](docs/API.md) — Socket.IO event protocol.
- [`docs/TASKS.md`](docs/TASKS.md) — What's done, what's pending, priorities.
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — Why we made key design choices.
- [`docs/TESTING.md`](docs/TESTING.md) — Test scenarios and how to verify.
