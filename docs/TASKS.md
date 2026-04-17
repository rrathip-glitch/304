# TASKS — 304 Implementation Tracker

> The single "what's next" document. Update at the end of every session
> so the **Next up** section is actionable from a cold read.

## Where we are

**v2.2.10 is live on Railway.** Engine is feature-complete for the
household variant and now ends hands + rounds the moment their
outcome is decided. UI is responsive across iPhone SE → iPad mini,
with a full flash suite narrating every meaningful event (bid settled,
trump revealed, trick won, hand won, match won). Multiplayer survives
reconnects, closed tabs, and idle rooms. All seven test scripts
green (71 layout + ~80 bid + 34 cut + 16 boundary + smoke + soak
+ e2e).

```
Watched branch: claude/mobile-game-development-GifG7    (Railway auto-deploys)
Current work:   claude/quality-improvement-xvHGJ        (merges into watched)
```

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for the release procedure and
[`DECISIONS.md#index`](DECISIONS.md) for a one-line-per-decision
history.

## Done

### Foundation (v1.0.0, 2026-04-16)
- [x] Project skeleton, docs suite (SOUL, RULES, ARCHITECTURE, API,
      TASKS, DECISIONS, TESTING, DEPLOYMENT, README, COLLABORATION).
- [x] `src/engine/cards.js` — deck, ranks, points (integer ×10), compare,
      winningIndex, legalCards, displayPoints.
- [x] `src/engine/game.js` — full state machine
      (bid4 → trump_pick1 → bid8 → trump_pick2? → open_choice → play →
      inspect → hand_end → game_over).
- [x] `src/engine/ai.js` — bid + pick + open + play heuristics.
- [x] `server.js` — Express + Socket.IO room manager with AI pacing.
- [x] `public/` — vanilla HTML/CSS/JS client (landing, lobby, table).
- [x] `Dockerfile`, `railway.json`, `.dockerignore` — Railway deploy.

### Cutting + responsive layout + semver (v2.0.0, 2026-04-17)
- [x] Cutting mechanic UX (banner prompt, cutter seat tag, maker peek,
      "CUT!" reveal, indicator returns, cutting team leads next).
- [x] Trump indicator selectable when its id is legal.
- [x] Responsive layout (`clamp()`, `100dvh`, `safe-area-inset-*`,
      vertical-stack overflow caps).
- [x] Standard semver (single source of truth = `package.json#version`).
- [x] `scripts/cut-test.js` (24 assertions) + `scripts/layout-smoke.js`
      (22 assertions, now 36).

### Bidding discipline + open-as-commitment (v2.1.0, 2026-04-17)
- [x] No bidding over yourself (bid4 + bid8); chip hidden when high
      bidder = you.
- [x] Open declaration only offered to trick-1 leader; forces leading
      the (former) indicator on trick 1.
- [x] Current-bid strip in the table UI, visible across bidding + play.
- [x] `scripts/bid-test.js` (31 assertions, 5 scenarios).

### Robustness pass (v2.2.0, 2026-04-17)
- [x] Stall fallback: closed-tab actor seat auto-AIs after 25 s.
- [x] Idle room GC: rooms reclaimed after 30 min with no live sockets.
- [x] Boundary input hardening: `src/util/sanitize.js`.
- [x] `scripts/robust-test.js` (24 assertions; live-server boot test).
- [x] Documentation fresh-eye review.

### Bidding + scoping polish (v2.2.1–v2.2.4, 2026-04-17)
- [x] Asker lockout (v2.2.1).
- [x] Token scale regression locked in by bid-test.
- [x] Bid display convention (subtract 100 in `[160, 250)`) — v2.2.2.
- [x] askPartner = asker's pass; once per round — v2.2.3.
- [x] Cut reveal shows only trump-suited face-downs — v2.2.4.

### Maker face-down restriction + UI tidy (v2.2.5, 2026-04-17)
- [x] Maker face-down = non-trump disposal OR indicator only.
- [x] Custom-bid free-form input removed; every legal amount is a chip.

### Early bid + hand resolution + full flash suite (v2.2.10, 2026-04-17)
- [x] Partner auto-pass on bid (v2.2.7 lockout + bid4 rotation skip).
- [x] Pass = locked out for bid4 — explicit engine reject path.
- [x] Early-finalize of hand when outcome is mathematically decided
      (defenders clinch OR maker clinched partial; all-8 still kept alive).
- [x] View exposes `trickPoints` for hand-won flash detail.
- [x] Bid-settled flash (bid4 → trump_pick1).
- [x] Hand-won flash (4 s) with caller + bid + per-team points.
- [x] Match-won flash (4.5 s) when a team reaches 22.
- [x] Tests + docs updated (bid-test early-finalize + partner auto-pass
      coverage; RULES + DECISIONS + README refreshed).

### Indicator inlined + UI strip de-duplication (v2.2.9, 2026-04-17)
- [x] Indicator rendered inline in the maker's hand row with a badge
      + gold ring + flip animation.
- [x] Bid strip trimmed (no more trump/open text — header pill has it).
- [x] Indicator-strip banner removed.
- [x] Trick seat-name tags removed (position + corners are enough).
- [x] .your-trump DOM/CSS removed.

### Hand-row clip (round two) + flashes (v2.2.8, 2026-04-17)
- [x] Trick-card max-height + aspect-ratio safety; indicator-strip
      compacted to reclaim play-area vertical.
- [x] Trump-reveal flash + trick-won flash.

### Partner-bid lockout + indicator visuals (v2.2.7, 2026-04-17)
- [x] Partners cannot bid over each other (hard lockout, both rounds).
- [x] Trump-indicator state widget (closed / in-hand / played).
- [x] Cut log names the cutter.

### Engine quality pass + trump pill + hand clip (v2.2.6, 2026-04-17)
- [x] Dead state cleanup (`closeCaps`, `dealtFirstBatch`, `bid8Passes`,
      `highBid.isCloseCaps`).
- [x] Centralised `whoseTurn` in the engine.
- [x] Hoisted timing constants in `server.js`.
- [x] `touchRoom` added to `setSeat`/`addAI`/`removeAI`.
- [x] `.your-hand` min-height fix (bottom-rank clip).
- [x] Trump status pill in the header (`OPEN ♠` / `CLOSED ♠` / `CLOSED`).
- [x] Docs deep-refresh: glossary in RULES, phase diagram in
      ARCHITECTURE, error-reasons table in API, seven-script parity
      across TESTING/DEPLOYMENT, DECISIONS index.

## Next up

**Start here if you are a fresh instance:**

1. **Visual snapshot harness (Playwright).** `layout-smoke.js` proves
   the *rules* exist; a Playwright suite that snapshots the table at
   the 5 reference viewports would catch *visual* regressions. ~50 LOC
   + one devDependency.
2. **Invite-link flow for 2nd human.** Add a share button on the lobby
   that copies `https://<domain>/?room=ABCDEF&name=Dad`; client
   auto-joins on load.
3. **Animations & sound.** Card deal animation, trick collection,
   sound effects (card play, trick won, token transfer).
4. **PCC (Partner Close Caps).** 3-player mechanics; see
   [`RULES.md#partner-close-caps-pcc`](RULES.md#partner-close-caps-pcc).

## Verification

Run from the repo root (~10 s total):

```bash
node scripts/layout-smoke.js   # 71 structural assertions
node scripts/cut-test.js       # 34 engine assertions (4 scenarios)
node scripts/bid-test.js       # ~80 engine assertions (12 scenarios)
node scripts/robust-test.js    # 16 boundary + live-boot assertions
node scripts/smoke.js          # one full 4-AI match
node scripts/soak.js 5         # 5 matches; token invariant
node scripts/e2e.js            # boots server, drives socket
```

All seven passing as of v2.2.10.

## Release procedure

See `docs/DEPLOYMENT.md`. Summary:

1. All seven test scripts green on your feature branch.
2. Bump `package.json#version` if user-visible. Sync to
   `public/index.html` (build marker + `?v=` queries) and
   `public/client.js` (`BUILD` constant). `layout-smoke.js` enforces
   parity.
3. `git push origin <feature-branch>`.
4. `git checkout claude/mobile-game-development-GifG7 && git merge
   <feature-branch> --no-edit && git push`.
5. `curl https://<domain>/version` → confirm new version live.

## Backlog (not blocking)

- Partner Close Caps full mechanics (bid + 3-player hand).
- Spoilt Trumps auto-detection & declaration UI.
- Caps timing penalties (Wrong Caps −2, Losing after Caps −5). House
  rule "all 8 tricks = 5 tokens automatic" remains the substitute.
- Reconnection persistence across server restart (needs Redis/KV).
- Visual snapshot harness (Playwright).
- Animations: dealing, card flip on reveal, token slide.
- Chat box for humans.
- i18n (Sinhala, Tamil).

## Notes for future sessions

- Don't try to build a React-style UI. Vanilla DOM + CSS is faster and
  more readable for this scope.
- AI decision timing: 600–1200 ms (felt) for in-AI seats; 25 s for
  the stall fallback (real human disconnect).
- The server view filter is the most bug-prone area — always
  double-check that a face-down card doesn't leak its `rank`/`suit` to
  non-privileged seats. The cutting visibility table in `docs/API.md`
  is the spec.
- Bump `package.json#version` whenever you ship a UI- or
  protocol-affecting change. The `?v=` cache-bust in `index.html`
  must always match — `scripts/layout-smoke.js` will fail loudly if
  any of the four version strings drift.
- Every new client → server payload must go through
  `src/util/sanitize.js`. The engine assumes well-formed shapes and
  will throw on a non-string `cardId`.
