# COLLABORATION.md

> The single entry point for any agent or human collaborating on this project.
> If you are a new AI instance, read this, then `docs/SOUL.md`.

## Repository

- Repo: `rrathip-glitch/304`
- **Watched branch (auto-deploys to Railway):**
  `claude/mobile-game-development-GifG7`
- **Feature branch:** whatever the system prompt pins to this session
  (most recently `claude/quality-improvement-xvHGJ`). Work happens here
  and is merged into the watched branch to ship.

## Two-branch model

```
       <your feature branch>                      (feature work — push freely)
                              │
                              │  merge --no-edit / ff-only
                              ▼
       claude/mobile-game-development-GifG7       (Railway watches this)
                              │
                              │  push
                              ▼
                   Railway auto-build (Dockerfile)
                              │
                              ▼
                   curl /version → confirm
```

Feature work happens on the feature branch. Production deploys happen
when you merge into the watched branch and push. See
[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) for the full procedure.

## Project in One Paragraph

A mobile-first, web-hosted multiplayer implementation of the Sri Lankan card
game **304**. Two humans + two AI by default (you and your dad vs AI).
Server-authoritative Node.js + Socket.IO; vanilla HTML/CSS/JS client.
Deployed on Railway via Dockerfile. See `README.md` for user-facing intro.

## Quick Links

- **Orientation for AI agents:** [`docs/SOUL.md`](docs/SOUL.md) ← read first
- **Rules:** [`docs/RULES.md`](docs/RULES.md)
- **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **API:** [`docs/API.md`](docs/API.md)
- **Tasks / what's next:** [`docs/TASKS.md`](docs/TASKS.md)
- **Decisions log:** [`docs/DECISIONS.md`](docs/DECISIONS.md)
- **Testing:** [`docs/TESTING.md`](docs/TESTING.md)
- **Deployment:** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## How Agents Coordinate

We operate under an **orchestrator + worker** model:

- **Orchestrator agent**: the coordinator. Reads `docs/TASKS.md` and
  `COLLABORATION.md`, decomposes work, assigns tasks to workers, reviews
  shipped commits, resolves conflicts, keeps the task list crisp.
- **Worker agent(s)**: execute one assigned task at a time end-to-end,
  ship a commit, then report back.

Protocol for every session (orchestrator or worker):

1. **Sync first**: `git fetch origin && git pull origin <branch>`. Read the
   "Current Status" section below *and* the last 20 lines of `git log`.
2. **Claim**: edit `docs/TASKS.md`. Under "Next up", mark the item you're
   taking with `[CLAIMED: <agent-id> <timestamp>]`. Push immediately so
   other agents see the claim.
3. **Scope**: one module per claim. Do not silently expand scope.
4. **Ship often**: commit and push after each module compiles or renders.
   Do NOT batch multiple modules in one commit.
5. **Check out**: after your commit, update "Current Status" here, tick
   the task in `docs/TASKS.md`, append to `docs/DECISIONS.md` if warranted,
   push.
6. **Handoff note**: if the next step has a non-obvious gotcha, append to
   the "Notes to next agent" section below.

### For the Orchestrator specifically
- Keep `docs/TASKS.md` ordered by dependency, not preference.
- When a worker pushes, review the diff before assigning the next task.
- If a worker is stuck or drifting, reassign the scope.
- Own the branch merge strategy. Workers do not rebase or force-push.

### For Workers specifically
- Do not modify `docs/TASKS.md` ordering — only claim/tick.
- Do not edit another worker's in-flight files.
- If your task turns out to be bigger than one module, stop, comment in
  `docs/TASKS.md` explaining, and let the orchestrator split it.

## Commit Cadence (enforced)

Ship files periodically, not all at once. Rule of thumb:

- After the engine module compiles → commit + push.
- After AI module → commit + push.
- After server bootstraps → commit + push.
- After HTML/CSS skeleton renders → commit + push.
- After client Socket.IO handshake works → commit + push.
- After Dockerfile builds → commit + push.

Each commit message format:
```
<scope>: <short summary>

<1-3 lines of context>

https://claude.ai/code/session_<id>
```

Scopes: `docs`, `engine`, `ai`, `server`, `client`, `deploy`, `fix`, `style`.

## Current Status

**v2.2.26 — Session 2026-04-17, Claude Opus 4.7 (live on Railway)**

Long screenshot-driven tuning arc from v2.2.11 through v2.2.26 —
user supplied iPhone captures after each deploy; each version
addresses the issues visible in the prior one. A condensed log of
what landed and why:

- **v2.2.11** Flashes ~1.7× longer. bid8 enforced "one turn per seat"
  via `bid8Acted[]`; `trump_pick2` resumes bid8 so remaining seats
  respond. Indicator card is always face-up + playable to the caller
  in a labelled slot; non-callers see a dedicated opp-seat indicator
  pill that flips on reveal and disappears when played.
- **v2.2.12** Removed the silent 2nd-turn ≥ 200 floor in bid4. AI
  `INSPECT` delay 3.2 s / `HAND_END` delay 7.2 s so tricks + hand
  results linger past their flashes. Token indicator became `N/22`
  + proportional bar.
- **v2.2.13** Header room code stopped clipping. Own-hand
  indicator ↔ first-card overlap fixed. Opp-seat asymmetry fixed
  (indicator moved out of `.seat-cards` into a dedicated sibling).
- **v2.2.14** Flash queue — trump flash plays fully before the
  hand-won flash starts. Header symmetry. Compact horizontal opp
  indicator pill so the top seat doesn't squeeze the trick row.
- **v2.2.15** Soft bid8 partner-lockout (only blocks at ≥ 250).
  3-column header: tokens ↔ trump dial ↔ code/hand, with decorated
  seat pills in the play area.
- **v2.2.16** Removed the `askedPartner` ≥ 200 floor — asker's
  partner can raise at any legal amount.
- **v2.2.17** Beauty sweep — larger header text, tighter play-area
  spacing, subtle gradient on phase/bid-strip.
- **v2.2.18** Side seats moved to row 2 only (no row-span); the
  inverted-U corner kissing between AI 2 and AI 1 / AI 3 is gone.
- **v2.2.19** Symmetric 80 px side columns, locked `.team` row so
  "11" starts at the same x for both teams, retired hand # + room
  code in favour of a `.bid-readout` in the top right.
- **v2.2.20** Tokens narrowed so the bar doesn't kiss the centre
  trump dial; side-seat vertical stacks leave room for name + bid
  pills.
- **v2.2.21** TRUMP pill on AI 3 capped at 74 px + `overflow:hidden`
  (used to overflow when "Trump · open" was set; now always just
  "TRUMP"). Side name pills got a solid background + 55 % gold
  border. Play-area pinned `flex-start` to stop drift.
- **v2.2.22** `.play-area { overflow: visible }` — permanent fix
  for the recurring "top edge of side pill shaved" bug. User hand
  re-centred per user preference.
- **v2.2.23** Bulletproof `.seat-name`: explicit 26 px height,
  2 px gold border, `background-clip: padding-box`,
  `transform: translateZ(0)` — kills the iOS sub-pixel rendering
  class of bugs. Added in-game menu (⋯ → Exit room); new server
  `leaveRoom` handler.
- **v2.2.24** Menu button pinned fixed to bottom-right. Play surface
  statically spaced — row 1 fixed 164 px; `.seat-top .seat-cards`
  and `.seat-cards.vertical` got explicit dimensions. INDICATOR
  label no longer clips on the left. Bid readout mirrors the
  tokens column (134 px, two rows).
- **v2.2.25** Reclaimed space above AI 2 (row 1 164 → 144 px +
  `align-self: center`). Fixed AI 3 indicator ↔ stack ↔ bid pill
  overlaps. Replaced "···" glyph with three explicit dot spans for
  pixel-perfect centring. Tokens + bid readout share exact width
  and gap (134 px, 6 px).
- **v2.2.26** CATASTROPHIC overlap when AI 1 / AI 3 is trump maker —
  the side stack's extra content (name + TRUMP + 8 backs + BID) was
  overflowing row 2 DOWNWARD into the user's hand area. Root cause
  was `.seat-cards.vertical { flex: none; height: 252px }` — the
  stack couldn't shrink. Now `flex: 1 1 0; max-height: 252px` lets
  the stack cap at 8 cards when room allows and shrink cleanly when
  the cell is tight, keeping the BID pill inside row 2. Trick-card
  cells got explicit dimensions (`width/height: card-*-trick`) +
  `will-change: contents` so the trick grid never reflows when
  plays come in.

Verification: `scripts/layout-smoke.js` → 71 checks; `bid-test.js`
→ 12 scenarios; `cut-test.js` → 4 scenarios; `smoke.js` + `soak.js 5`
green.

---

**v2.2.12 — Session 2026-04-17, Claude Opus 4.7 (live on Railway)**

Shipped in this release chain (v2.2.11 → v2.2.12):
- **Flashes linger longer** (~1.7×). Trump 3.5 s, trick 2.4 s, bid 4 s,
  hand 6.5 s, match 7.5 s. Gives table talk time to catch up with the
  UI.
- **Inspect / hand-end pacing**. When AI is waiting to continue, the
  INSPECT-phase delay is now 3.2–3.6 s (flash + ~1 s breathing room),
  and HAND_END is 7.2–7.6 s. Tricks + hand result now stay on screen
  long enough to read.
- **Bid8 is strictly "one turn per seat".** New `state.bid8Acted[]`
  flag; `handleBid8` + `advanceBid8` enforce it. After a `trump_pick2`
  outbid we RESUME bid8 so the remaining seats still get their single
  shot — previously the engine jumped straight to `open_choice` and
  silenced the rest of the table.
- **Bid4 rotation defensively skips all locked seats** (self-high,
  partner-high, asker). "Other team responds, not you or your
  teammate; higher bid wins in play order" is guaranteed by
  construction.
- **Removed the "2nd-turn ≥ 200 floor"** in bid4. It silently stopped
  users from raising 70 to 80 on their second turn. `askedPartner`
  still forces a 200 floor for both partners (deliberate commitment).
- **Indicator card — caller view.** Always rendered face-up in its
  separated slot; remains tappable whenever the engine says it's
  legal (cut path, trick-8 forced lead, open-declare lead).
- **Indicator card — non-caller view.** New labeled slot inside the
  caller's opponent stack. Face-down while closed; flips face-up when
  trump reveals (open declare / cut / auto-open); removed once the
  indicator has been played. Back-stack count is auto-decremented
  when the indicator is counted in-hand, so we don't double-render.

Verification (all green after these changes):
- `node scripts/bid-test.js` → 12 scenarios; no regression from the
  floor removal or the bid8Acted tracking.
- `node scripts/cut-test.js` → 4 scenarios.
- `node scripts/smoke.js`, `soak.js 5` → tokens always = 22; no
  deadlocks.

Next-up priority (unchanged from v2.2.10):
- Visual snapshot harness (Playwright).
- Invite-link flow for 2nd human (`?room=ABCDEF&name=Dad`).
- Animation polish: deal, trick sweep, token slide.
- PCC 3-player mechanics.

---

**v2.2.6 — Session 2026-04-17, Claude Opus 4.7 (live on Railway)**

Shipped in this release chain (v2.2.5 → v2.2.6):
- **Engine quality pass.** Dead state removed (`closeCaps`,
  `dealtFirstBatch`, `bid8Passes`, `highBid.isCloseCaps`);
  `whoseTurn` centralised in the engine; timing constants hoisted;
  lobby handlers (`setSeat`/`addAI`/`removeAI`) reset the idle-GC
  timer consistently.
- **Hand-row card clip fix.** `.your-hand` min-height bumped to cover
  full padding + card height in both the default and the short-screen
  media query.
- **Trump status pill** in the table header — `TRUMP ♠ OPEN` /
  `TRUMP ♠ CLOSED` / `TRUMP CLOSED` depending on viewer role.
- **Trump maker face-down = disposal or indicator only** (from the
  parallel v2.2.5 on the watched branch, merged back in).
- **Custom-bid free-form input removed** — every legal bid is a chip.
- **Documentation deep refresh.** Glossary in RULES; phase diagram +
  corrected GameState + module-boundaries table in ARCHITECTURE;
  errors-reasons table + how-to-add-a-new-action in API; seven-script
  parity across TESTING & DEPLOYMENT; scannable index atop DECISIONS.

Verification (all green):
- `node scripts/layout-smoke.js` → 45 checks.
- `node scripts/cut-test.js` → 34 assertions (4 scenarios).
- `node scripts/bid-test.js` → 58 assertions (8 scenarios).
- `node scripts/robust-test.js` → 16 boundary + live-boot assertions.
- `node scripts/smoke.js`, `soak.js 5`, `e2e.js`.

Next-up priority:
- Visual snapshot harness (Playwright) at the 5 reference viewports.
- Invite-link flow for 2nd human (`?room=ABCDEF&name=Dad`).
- Animation polish: deal, trick sweep, token slide.
- PCC 3-player mechanics.

---

**v2.2.0 — Session 2026-04-17, Claude Opus 4.7 (ship-ready)**

Shipped:
- **Stall fallback** (`STALL_FALLBACK_MS = 25 s`). A closed-tab actor
  seat auto-plays via the AI after 25 s; reconnect cancels it.
- **Idle room GC** (`IDLE_ROOM_TTL_MS = 30 min`, sweep every 5 min).
- **Boundary input hardening** in `src/util/sanitize.js`. All
  client → server payloads are sanitized at the edge.
- **Documentation refresh.** SOUL.md boot sequence updated; the doc
  index now reads as a 1→10 cold-start path. ARCHITECTURE.md adds a
  Robustness Invariants table mapping each guarantee to its test.
- **Test suite at 7 scripts** (115+ assertions total). `robust-test.js`
  is new this release.

Verification (all green):
- `node scripts/layout-smoke.js` → 36 checks.
- `node scripts/cut-test.js` → 24 assertions.
- `node scripts/bid-test.js` → 31 assertions.
- `node scripts/robust-test.js` → 24 assertions, includes live boot.
- `node scripts/smoke.js`, `node scripts/soak.js 5`, `node scripts/e2e.js`.

Next-up priority:
- Visual snapshot harness (Playwright) at the 5 reference viewports.
- Invite-link flow for 2nd human (`?room=ABCDEF&name=Dad`).
- Polish: animations, sound effects.
- PCC 3-player mechanics.

---

**v2.1.0 — Session 2026-04-17, Claude Opus 4.7**

- No bidding over yourself (bid4 + bid8); legalActions hides the chips.
- Open declaration is committal: only offered to the trick-1 leader,
  forces leading the (former) indicator card on trick 1.
- Bid+3-passes auto-resolves to trump pick (already engine behavior;
  now explicit in tests + docs).
- Current-bid strip in the table UI, visible across bidding + play.

---

**v2.0.0 — Session 2026-04-17, Claude Opus 4.7**

Shipped:
- **Cutting mechanic** with full UX (banner prompt, cutter seat tag,
  trump-maker private peek with `makerPeek` view flag, "CUT!" reveal,
  indicator returns to maker's hand on trump cut, cutting team leads
  next trick).
- **Trump indicator selectable** — rendered as a tappable card in the
  `YOUR TRUMP` row when the engine lists its id as legal. Fixes the
  dead-screen failure mode shown in the user-supplied screenshot.
- **Responsive layout overhaul** — `clamp()` card sizes, `100dvh`,
  `env(safe-area-inset-*)`, vertical-stack overflow caps, short-screen
  media query. Resolves all five layout regressions from the screenshots.
- **Standard semver** versioning (`2.0.0`). `package.json` is the source
  of truth; `server.js` reads it for `/version`; `index.html` and
  `client.js` reference it directly.
- **Regression suite** — `scripts/layout-smoke.js` (22 structural
  assertions) + `scripts/cut-test.js` (24 engine assertions across 3 cut
  scenarios). All 5 test scripts green.

Engine changes:
- `legalCardIds` now includes the trump indicator id when the maker
  can't follow suit (cut path).
- `viewFor.currentTrick` filter exposes face-down cards face-up to the
  trump maker with `makerPeek: true`; everyone else still sees `hidden`.
- `resolveTrick` sets `cutResolved: true` for one frame on a successful
  cut; `handleInspect` clears it.

UI changes:
- Phase banner shows the cut prompt + the "CUT!" reveal in distinct
  colors (amber for prompt, gold for reveal).
- Trump maker's view of a cut shows a face-up card with a gold ring +
  "cut" badge.
- Other players' view of a cut shows a back with the seat tag prefixed
  "cut — <name>".

Verification (all green):
- `node scripts/layout-smoke.js` → 22 checks pass.
- `node scripts/cut-test.js` → 24 assertions across 3 scenarios pass.
- `node scripts/smoke.js` → full match completes; token invariant holds.
- `node scripts/soak.js 5` → 5 matches; no deadlocks; tokens always = 22.
- `node scripts/e2e.js` → server boots, room created, views flow.

Next-up priority:
- Visual snapshot harness (Playwright) at the 5 reference viewports.
- Invite-link flow for 2nd human (`?room=ABCDEF&name=Dad`).
- Polish: animations, sound effects.
- PCC 3-player mechanics.

---

**Session `0136BhfwMDsMM6tHKFzrc2WJ` (2026-04-16, Claude Opus 4.7)**

Shipped:
- Docs suite (SOUL, RULES, ARCHITECTURE, API, TASKS, DECISIONS, TESTING,
  DEPLOYMENT, README, COLLABORATION).
- `src/engine/cards.js` — deck, ranks, points (integer ×10), compare, winningIndex.
- `src/engine/game.js` — full state machine (merged from parallel-agent branch).
- `src/engine/ai.js` — bidding + play heuristics (merged).
- `server.js` — Express + Socket.IO, room manager, view filtering, AI pacing (merged).
- `public/index.html`, `public/styles.css`, `public/cards.js`,
  `public/client.js` — mobile-first UI (merged).
- `Dockerfile`, `railway.json`, `.dockerignore` — Railway deployment.
- `scripts/smoke.js`, `scripts/soak.js`, `scripts/e2e.js` — regression tests.

Bugs fixed this session:
- `legalCardIds` returned `[]` when trump maker's hand was empty but indicator
  still held (trick 8 case).
- `handlePlay` rejected plays of the indicator when it lived outside the hand.
- `ai.choosePlayCard` ignored the indicator even when listed as the only
  legal card.
- `advanceBid4` infinite-looped when a high bidder passed after bidding.

Smoke/soak verification:
- `node scripts/soak.js 5` → 5 matches, 88 hands, all invariants hold.
- `node scripts/e2e.js` → Socket.IO handshake + AI pacing confirmed.

Next-up priority:
- Interactive hands-on test by user in the browser (mobile).
- Deploy to Railway.
- Polish UI: card reveal animations, mobile haptics.
- Implement 2nd human invite link flow.

## Contact Points for This Project

- User: @rrathip-glitch (novice programmer, primary decision-maker)
- Agent lineage: Claude Opus 4.7 via Claude Code web session

## When You Finish Your Session

1. Update the "Current Status" block above with what shipped.
2. Make sure `docs/TASKS.md` has a crisp "Next up" list.
3. `git push`.
4. Leave a message for the next agent in a `## Note to next agent` block
   at the bottom of this file if anything would save them time.

---

## Notes to Next Agent

*(Append new notes here. Oldest at top. Don't delete — they are history.)*

- **[2026-04-16]** Docs are intentionally thorough because the project is
  being handed off between AI sessions. Don't treat them as ceremony.
  Update them as rules evolve (user has already revised card values and
  betting conventions mid-session).
- **[2026-04-16]** The user's 304 has two important house variants vs
  pagat: (1) display points are /10 of classic (J=3 not 30); (2) winning
  all 8 tricks gives **5 tokens** automatically. Don't re-derive these.
- **[2026-04-17]** The view filter for `currentTrick` is now THREE
  shapes per played card (cutter / trump-maker / everyone-else). See the
  table in `docs/API.md#cutting-visibility-currenttrick-per-seat-filter`.
  Any change to that filter MUST be matched by an update to the
  `scripts/cut-test.js` `makerPeek` and `hidden` assertions.
- **[2026-04-17]** When you bump the version, update FOUR places
  in lockstep: `package.json`, `public/index.html` (both the build marker
  and the `?v=` query strings), and `public/client.js` (the `BUILD`
  constant). Then run `node scripts/layout-smoke.js` — it will fail if
  any one of the four falls out of sync.
- **[2026-04-17]** `scripts/layout-smoke.js` is *static analysis*, not
  pixel-rendering. It proves the CSS rule that prevents a regression
  exists — that's enough for the kind of bugs we've seen (missing
  safe-area, missing clamp, missing overflow cap). For pixel-perfect
  diffs, add a Playwright suite (next-up item).
- **[2026-04-17 / v2.2.6]** The watched branch and feature branches
  have occasionally shipped **different v2.2.5 commits in parallel**
  (one on the watched branch, one on a quality-pass branch). Always
  `git fetch origin claude/mobile-game-development-GifG7` at the top
  of a session and merge it into your feature branch before coding —
  otherwise you will try to ship a version that's already taken. The
  resolution is to bump to the next patch (2.2.6) and list both sets
  of changes in the release notes. `git log --oneline --graph`
  surfaces this quickly.
- **[2026-04-17 / v2.2.6]** Box-model bug that's easy to regress:
  `.your-hand` has `box-sizing: border-box` and `overflow-y: hidden`,
  so `min-height` must cover `card-h + (padding-top + padding-bottom)`
  plus a small buffer. Don't tighten it without running layout-smoke
  at the target viewports — the bug manifests as clipped bottom
  rank/suit corners.
- **[2026-04-17 / v2.2.11]** The indicator card is now rendered in
  **two independent places**:
    1. Caller's own hand row (`renderHand` in client.js) — always
       face-up, tappable when legal, separated by the gold-badge
       `.indicator-slot` wrapper.
    2. Caller's opponent stack (`renderOpponentSeats`) — a scaled-down
       `.indicator-slot.opp` injected INSIDE `.seat-cards`. Face-down
       while `indicatorLocation === 'closed'`, face-up when
       `'in-maker-hand'`, hidden when `'played'`.
  The back-stack renders `handCounts[maker] - (indicatorInHandCount)`
  cards to avoid double-rendering once the indicator is pushed into
  the maker's hand (open phase). If you change either the view's
  `indicatorLocation` / `indicatorCard` fields or the maker's hand
  composition, re-eyeball both render paths.
- **[2026-04-17 / v2.2.12]** Bid8 now uses `state.bid8Acted[]`
  per-seat instead of the old single `bid8Turns` counter. The
  counter is still there for backward-compat logging, but
  termination + rotation use `bid8Acted`. Fixtures that seed
  `PHASES.BID8` directly must also seed `bid8Acted` (or rely on
  `handleBid8`'s defensive init, which only covers the top of that
  function — `advanceBid8` has its own guard).
- **[2026-04-17 / v2.2.12]** Flash durations are the **single lever**
  that controls how long tricks / hands linger — the AI `INSPECT`
  and `HAND_END` delays in `server.js` are tuned to match. If you
  bump a flash duration, bump the corresponding AI delay too (≥
  flash + 800 ms so the cards linger after the flash fades). Map:
    - trick flash 2400 ms → INSPECT delay 3200–3600 ms
    - hand  flash 6500 ms → HAND_END delay 7200–7600 ms
- **[2026-04-17 / v2.2.12]** `minAllowedBid` was simplified — it used
  to return 200 if `bidTurns[seat] >= 1`. That rule silently blocked
  the screenshot case (AI called 70, user couldn't counter with 80).
  If you re-introduce a second-turn floor, keep the chip-render side
  in sync: the client suggests [160, 170, 180, 200, 210, 220, 250];
  anything else is a `ghost` chip in an extras slot.
