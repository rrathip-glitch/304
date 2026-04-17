# 304 — Mobile Multiplayer Card Game

[![version](https://img.shields.io/badge/version-2.2.10-blue.svg)](#release-notes)

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

### v2.2.10 — 2026-04-17

- **Early bid resolution.** When a bid lands, the bidder's partner is
  auto-passed (v2.2.7 already forbade them from bidding over each
  other); rotation skips their turn so bid4 resolves at the earliest
  point. Once a seat passes in bid4 they're locked out for the rest
  of the round — `"you have already passed this round"` is the reject
  if anything tries to revive them.
- **Early hand resolution.** A hand now ends the moment its outcome
  is mathematically decided: when defenders have denied the bid, or
  the maker has met it with no all-8 left. Play skips to `hand_end`
  with the correct token math. The log records the trigger reason.
- **Four new flash overlays** (centered, pointer-events off):
    • **Bid won** (2.4 s) — bid4 → trump_pick1. "Caller · <bid>".
    • **Hand won / lost** (4.0 s) — tokens change. Shows "+N tokens"
      in big type plus a detail line with caller, bid size, and
      per-team display points (e.g. "US 18.5 · THEM 11.9").
    • **Match won / lost** (4.5 s) — a team reaches 22 tokens. Takes
      precedence over the hand flash on the same frame.
    • The existing Trump-reveal and Trick-won flashes round out the set.
- **New view field `trickPoints`** — `[team0, team1]` in internal
  units — lets the hand-won flash surface the exact totals each team
  brought home.

### v2.2.9 — 2026-04-17

- **Indicator card is now inline with the maker's hand.** The old
  standalone indicator-strip banner and the `#your-trump` row above
  the hand are both gone. The indicator now sits IN the hand row
  itself, wrapped in a labeled `.indicator-slot`: a gold "Indicator"
  badge above the card, a gold ring around the card, and a 24 px
  gap from neighbouring cards so they obviously shift around it.
  When the trump opens, the card plays a flip animation from face-
  down to face-up. Still tappable per the legal-action rules.
- **Bid strip trimmed.** The `· trump <suit> · <open/closed>` tail
  was removed — that information is carried by the TRUMP pill in the
  header and (for the maker) by the labeled indicator card itself.
- **Trick seat-name tags removed.** Player position at the table is
  unambiguous from the trick-slot layout (partner top, opponents
  left/right, you bottom). The corner rank/suit on the card already
  conveys the play. Cut plays are still visually distinct (face-down
  back) and narrated via the CUT! flash + log.

### v2.2.8 — 2026-04-17

- **Trick-card bottom-clip fix (round two).** The v2.2.7 indicator
  strip pushed the play-area into a tighter vertical budget, and
  `.play-area { overflow: hidden }` was clipping the slot-bottom
  trick card's mirrored corner. `.trick-card` now caps at 100% of
  its cell and the card inside carries `aspect-ratio: 1 / 1.4` so it
  downscales gracefully instead of clipping. The indicator strip
  itself was also compacted (smaller padding + card thumb) to give
  the trick cells ~24 px more room.
- **Trump-reveal flash.** When trump is revealed (cut-reveal, auto-
  open after trick 1 on a 250+ bid, or an explicit open declaration),
  a centered banner flashes for ~2 s with the big suit glyph and
  "Trump is ♠ Spades". Pointer-events off so it never blocks a tap.
- **Trick-won flash.** A shorter 1.3 s flash after each trick resolves,
  green "Won by us" or red "Won by them" from the viewer's
  perspective. Suppressed on the same frame as a trump reveal so the
  two don't collide.

### v2.2.7 — 2026-04-17

- **Partners cannot bid over each other.** Previously the partner-is-high
  rule raised the bid floor to 200; now it's a hard lockout — the bid
  chips disappear and the engine rejects the action with
  `"cannot bid over your partner"`. Applies to both the 4-card and
  8-card rounds.
- **Trump-indicator status widget.** A new row under the bid strip
  shows the indicator card plus its location: *held (closed)*,
  *in maker's hand (open)*, or *played*. Closed games show a face-down
  back with the maker's name; open games show the card face-up; after
  the indicator has been played it's shown dimmed with a "played"
  label. Visible to every seat.
- **Clearer cut log.** When a face-down trump opens the game, the log
  now names the cutter explicitly:
  `"Cut! AI 2's face-down was a ♠ (trump) — game is now open."`

### v2.2.6 — 2026-04-17

- **Hand row no longer clips the bottom rank.** `.your-hand` had an
  off-by-4 between its `min-height` and its padding, so with
  `overflow-y: hidden` the mirrored bottom-right corner of every card
  was getting shaved. Fix: bump the min-height buffer to cover the
  full padding + card height in both the default and short-screen
  media queries.
- **Trump status pill in the status bar.** The table header now
  surfaces trump as a compact pill: "TRUMP ♠ OPEN" when revealed,
  "TRUMP ♠ CLOSED" to the trump maker (who knows the suit), and
  "TRUMP CLOSED" to everyone else during a closed game. The suit
  glyph is rendered on a cream disc in its native red/black colour
  so hearts/diamonds stay legible on the dark felt header.
- **Server quality pass.** Dead state fields (`closeCaps`,
  `dealtFirstBatch`, `bid8Passes`, `highBid.isCloseCaps`) removed;
  `whoseTurn` centralised in the engine; timing constants hoisted;
  lobby handlers (`setSeat`/`addAI`/`removeAI`) consistently reset
  the idle-GC timer.

### v2.2.5 — 2026-04-17

- **Trump caller's face-down is restricted.** The caller's only
  legal face-down plays are a non-trump (disposal) OR the trump
  indicator itself (cut). Non-indicator trumps from the caller's
  hand can never go face-down — they stay in hand until the game
  opens.
- **Custom-bid input removed.** Every legal bid amount is now a
  tappable chip; no free-form numeric entry.

### v2.2.4 — 2026-04-17

- **Cut reveal scope tightened.** When a cut succeeds, only the
  trump-suited face-down cards are flipped face-up. Non-trump
  face-downs — whether a defensive discard or a bluff cut attempt —
  stay hidden permanently. Everyone's discard privacy is protected.
- View filter hardened to honor per-card `faceDown` regardless of
  `trumpRevealed`, so no rank/suit leaks via DevTools.

### v2.2.3 — 2026-04-17

- **Ask partner = your pass.** Calling `askPartner` now counts as the
  asker's pass for the round — they never get routed back. The chip
  label now reads "Ask partner (counts as pass)" so the commitment
  is visible at the button itself.
- **Ask partner is once per round.** A partner who was asked cannot
  ask back; the symmetric `askedPartner[]` flag blocks it.
- **No stale bid UI during play.** The per-seat `pass` / `bid N`
  labels cleared the moment bidding is settled. The bid-strip at
  the top carries the winning bid + bidder during play.
- Defensive client-side guard: `bid` / `pass` / `askPartner` chips
  are only rendered in bidding phases even if a stale view somehow
  carried them (belt-and-suspenders for the server-side filter).

### v2.2.2 — 2026-04-17

- **Bid display convention.** Bid chips, seat labels, and the current-bid
  strip now follow the household mapping: 160→60, 170→70, 180→80,
  190→90, 200→100, 210→110, 220→120, 230→130, 240→140, 250→250 (the
  system switches to full three-digit form at the 8-card threshold),
  260→260, 270→270, 280→280, 290→290, 300→300.
- Engine math is unchanged; this is purely a UI relabel.
- Full ladder is pinned by 15 assertions in `scripts/bid-test.js`.

### v2.2.1 — 2026-04-17

- **Asker lockout.** If you ask your partner to bid, you're locked out
  of bidding for the rest of that round — your only action is pass.
  Your partner can bid freely (subject to the standard ≥200 floor).
- **Token table locked in with tests.** The household variant's scoring
  (160–199 = 1/2, 200–249 = 2/3, 250+ = 3/4, all-8 = 5) now has
  regression assertions pinning it in `scripts/bid-test.js`.

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

Railway watches **`claude/mobile-game-development-GifG7`** and auto-builds
via Dockerfile. To ship: merge your feature branch into the watched
branch and push; `curl /version` to confirm. Full procedure,
troubleshooting, and rollback in [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Tests

All seven scripts must be green before pushing to the watched branch:

```bash
node scripts/layout-smoke.js   # 45 structural assertions
node scripts/cut-test.js       # 34 engine assertions, 4 cut scenarios
node scripts/bid-test.js       # 58 engine assertions, 8 bid + open scenarios
node scripts/robust-test.js    # 16 boundary + live-boot assertions
node scripts/smoke.js          # one full 4-AI match
node scripts/soak.js 5         # 5 matches; token invariant
node scripts/e2e.js            # boots server, drives socket
```

Full test scenarios (including manual mobile-UX checks and the
"how to add a test" pattern) are in
[`docs/TESTING.md`](docs/TESTING.md).

## Documentation map (audience-first)

Pick your entry point:

- **Playing the game** → [`docs/RULES.md`](docs/RULES.md) (starts with a
  glossary; no programming needed).
- **Operating / deploying** → [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)
  (release procedure, troubleshooting, rollback).
- **Contributing code** → [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
  (file map, phase diagram, state shape) → then
  [`docs/API.md`](docs/API.md) (Socket.IO protocol + error reasons) →
  then [`docs/TESTING.md`](docs/TESTING.md).
- **Understanding a past choice** →
  [`docs/DECISIONS.md`](docs/DECISIONS.md) (scan the index at the top,
  then jump to the entry).
- **Starting a new AI session** → [`docs/SOUL.md`](docs/SOUL.md) (boot
  sequence, principles, anti-patterns) → then
  [`COLLABORATION.md`](COLLABORATION.md) (branch model, current
  status) → then [`docs/TASKS.md`](docs/TASKS.md) ("what's next").

Every cross-link between docs is relative. If you update one file,
scan the others for stale references — broken cross-links are a signal
that the docs have drifted from reality.
