# Decision Log

Append-only. Each entry: date, decision, alternatives, rationale, links.
If a decision is reversed, add a new entry that references and supersedes
the old one — never edit prior entries.

## Index

Scan the index before diving in; each row is a one-line characterization
of the decision's scope. Chronological order within each bracket.

| Version | Area | Decision |
|---|---|---|
| v1.0.0 | Stack | Vanilla HTML/CSS/JS client — no framework |
| v1.0.0 | Stack | In-memory room state only (no DB/Redis) |
| v1.0.0 | Stack | Socket.IO over raw WebSocket |
| v1.0.0 | Engine | Integer points internally, decimal display (×10) |
| v1.0.0 | Engine | Counter-clockwise indexing `next(p) = (p+3) % 4` |
| v1.0.0 | House rule | All-8-tricks = 5 tokens ("high court") |
| v2.0.0 | Deploy | Pin Railway builder to `DOCKERFILE` |
| v2.0.0 | UX | Cutting mechanic UX; maker peek; indicator selectable |
| v2.0.0 | UX | Responsive layout (`clamp` + `100dvh` + safe-area) |
| v2.1.0 | House rule | No bidding over yourself (bid4 + bid8) |
| v2.1.0 | House rule | Open declaration committal; only for trick-1 leader |
| v2.2.0 | Robustness | Stall fallback (25 s AI takeover on disconnect) |
| v2.2.0 | Robustness | Idle room GC (30 min + sweep every 5 min) |
| v2.2.0 | Security | Boundary input hardening (`src/util/sanitize.js`) |
| v2.2.1 | House rule | Asker lockout (asker can only pass for the round) |
| v2.2.2 | UX | Bid display convention (subtract 100 in `[160, 250)`) |
| v2.2.3 | House rule | askPartner = asker's pass; once per round |
| v2.2.4 | House rule | Cut reveal shows only trump-suited face-downs |
| v2.2.5 | House rule | Maker face-down = disposal or indicator only |
| v2.2.5 | UX | Remove custom-bid free-form input |
| v2.2.6 | Quality | Engine quality pass; hand-clip fix; trump-status pill |
| v2.2.7 | House rule | Partners cannot bid over each other at all |
| v2.2.7 | UX | Trump-indicator status widget + clearer cut log |
| v2.2.8 | UX | Trump-reveal + trick-won flash overlays |
| v2.2.8 | Layout | Trick-card bottom-clip fix (round two) |
| v2.2.9 | UX | Indicator inlined into maker's hand; drop redundant strips + seat tags |
| v2.2.10 | House rule | Partner auto-pass + passed-seat lockout in bid4 |
| v2.2.10 | Engine | Early-finalize when hand outcome is decided |
| v2.2.10 | UX | Bid-settled + hand-won + match-won flash overlays |

---

## 2026-04-16 — Use vanilla HTML/CSS/JS for client

**Decision:** No framework (React, Vue, Svelte). Plain DOM + CSS + a thin
client script.

**Alternatives:**
- React + Vite (familiar, more tooling)
- Preact (lighter)
- Svelte (compiled)

**Rationale:** Novice user, small scope, no build step needed, faster
Railway cold starts, fewer dependencies to maintain. Card game UI is
fundamentally DOM state + CSS; frameworks buy us nothing material.

---

## 2026-04-16 — In-memory room state only

**Decision:** Game state lives in server.js memory. No database, no Redis.

**Alternatives:** Redis for session state; SQLite for persistence.

**Rationale:** 2-player casual game. Server restart loses games — acceptable
when the audience is a son and his dad, not a tournament platform. Adds a
reconnection-within-same-process feature instead.

---

## 2026-04-16 — Socket.IO over raw WebSocket

**Decision:** Use Socket.IO (server + client).

**Alternatives:** `ws` npm package + custom event layer.

**Rationale:** Socket.IO gives us rooms, reconnection, broadcast helpers,
and auto-fallback for flaky mobile networks out of the box. ~80KB client
payload is acceptable on phones.

---

## 2026-04-16 — Integer points internally, decimal display

**Decision:** Store card points as J=30, 9=20, A=11, 10=10, K=3, Q=2 (total
304). Display as /10 (J=3, A=1.1, total=30.4). Bids stored as integers
(160, 170, …, 250), displayed /10 (16, 17, …, 25).

**Alternatives:** Store as decimals natively.

**Rationale:** JavaScript floats (`0.1 + 0.2 !== 0.3`) cause subtle bugs
when summing hand points. Integer math is exact and trivial to display-scale.
User confirmed they want decimal display but the underlying rules still use
the classic "304" structure, so we keep the classic numbers internally.

---

## 2026-04-16 — Counter-clockwise = (p + 3) % 4

**Decision:** Universal seat indexing 0–3 with `next(p) = (p + 3) % 4`.
Teams: seats {0,2} vs {1,3}. Dealer rotates right: `nextDealer = (d + 3) % 4`.

**Alternatives:** Named seats ('N','E','S','W').

**Rationale:** Numeric indexing is smaller and faster in hot paths
(winning-card search, turn advance). Named constants can be derived for the
UI. Counter-clockwise is the canonical direction per pagat.com.

---

## 2026-04-16 — House variant: all-8-tricks = 5 tokens ("high court")

**Decision:** Override the normal token table: if the trump maker's team
wins all 8 tricks, they win 5 tokens regardless of bid level, instead of
1/2/3 + Caps bonuses.

**Source:** User message 2026-04-16 ("All 8 cards is automatically high
court and you get 5 victory tokens").

**Alternatives:** Implement pagat's Caps timing penalties (Wrong Caps -2,
Losing after Caps -5, +1 bonus for early call).

**Rationale:** User is the rules authority for their household variant.
Also simpler to implement well — Caps timing detection requires a perfect-
play AI, which isn't v1 scope.

---

## 2026-04-16 — Seat defaults (host = seat 0, partner = seat 2)

**Decision:** Room creator goes to seat 0. First joiner goes to seat 2
(partner). AI fills 1 and 3 (opponents) unless a third/fourth human joins.

**Rationale:** Default experience is "play with my dad against the computer".
One tap/link gets you there. Advanced seating is possible via `setSeat`.

---

## 2026-04-16 — Betting UI surfaces common amounts as chips

**Decision:** Bid UI shows chips for {160, 170, 180, 200, 210, 220, 230, 240,
250, 260}, with 190 **deliberately absent** but available via "custom"
entry. In the 8-card round, chips show {250, 260, 270, 300}.

**Source:** User message 2026-04-16 ("190 is almost never called", "second
round rarely goes above 260").

**Rationale:** UX should nudge toward the actual conventions of the game so
novice humans behave like experienced players. Avoids decision paralysis.

---

## 2026-04-16 — No 8-card bidding re-entry

**Decision:** 8-card bidding is strictly one turn each, no re-bidding
within that round.

**Source:** pagat.com.

---

## 2026-04-17 — Semver release tags (v2.0.0)

**Decision:** Drop the `hand-center-N` codename pattern for build markers
and ship to standard semver. `package.json#version` is the single source of
truth; `server.js` reads it for `/version`, `public/index.html` references
it via the `?v=` cache-bust query, and `public/client.js` has it in the
`BUILD` constant.

**Rationale:** Codenames buried which build was newer (`hand-center-5` vs
`emit-gate-3` — which one shipped first?). Semver makes the order obvious,
makes upgrade/downgrade trivial in `git log`, and matches what every
engineer sees in npm / GitHub releases. The version was bumped to
**2.0.0** (major) because v2 is the first release with the cutting UX,
the responsive layout overhaul, and the trump-indicator-tappable fix.

---

## 2026-04-17 — Trump-maker private peek on face-down cuts

**Decision:** Add `makerPeek: true` to the `currentTrick` view entry the
server sends to the trump maker for any face-down card from another seat.
The card data is real; the flag tells the client to render the gold-ring
"others see a back" affordance instead of a vanilla face-up.

**Alternatives:**
- Withhold the card from the maker until the inspect phase (matches v1).
- Send the card data but no flag, letting the maker see it indistinguishably
  from a face-up play.

**Rationale:** Pagat's canonical rule is that the trump maker may inspect
face-down cards "at the end of the trick". In a real game, the maker
naturally watches the cards as they're played — the privacy is between
the maker and *the other players*, not between the maker and the rules.
Surfacing the peek live is a strict UX improvement and matches what
in-person players already do mentally. The `makerPeek` flag preserves the
"others can't see this" social contract visually.

---

## 2026-04-17 — Trump indicator is included in `legalCardIds` when can't follow

**Decision:** When the trump maker is to follow a non-trump-led trick in a
closed game and can't follow suit, the trump indicator's id is included in
the `playCard.cardIds` array (alongside any non-indicator hand cards).

**Alternatives:**
- Keep v1 behavior: indicator excluded from legalCardIds; rely on the
  player typing in or otherwise specifying it.
- Include it always (even when following suit), letting the engine reject
  it.

**Rationale:** The pagat rule explicitly allows the indicator to be played
face-down to cut. In v1 the indicator was excluded from the legal list,
which meant the client couldn't render it as tappable — and the player
literally had no UI affordance to cut with the indicator. The screenshot
labelled "Playing tricks — your turn" with only the indicator left was
the dead-screen failure mode. Including the id in legalCardIds is
strictly additive (the engine still validates the play), and unlocks the
tappable-indicator UX.

---

## 2026-04-17 — Responsive layout: `clamp()` + `dvh` + safe-area

**Decision:** All card sizes use `clamp(min, vw-based, max)`. The table
screen uses `100dvh` with `env(safe-area-inset-*)` padding on all four
sides. Side opponent stacks are capped with `max-height: calc(100% - 28px)`
and `overflow: hidden`.

**Alternatives:**
- Keep fixed `px` card sizes with breakpoints at 375 / 768 / 1024 (v1).
- JavaScript-driven layout that measures the viewport and resizes cards.

**Rationale:** Three of the user's screenshots showed concrete failures
(header behind notch; 8-card vertical stack overflowing; cards extending
past the screen edge). Each was a missing CSS rule, not a JS bug. `clamp`
+ `dvh` fixes all three and works without media-query gymnastics across
the iPhone SE (smallest target) → iPad mini (largest mobile-like) range.
Static analysis (`scripts/layout-smoke.js`) now asserts each rule's
presence, so a regression that drops the safe-area or the clamp will
fail CI before it ships.

---

## 2026-04-17 — No bidding over yourself (bid4 + bid8) — v2.1.0

**Decision:** Once a player is the current high bidder, `bid` is removed
from their `legalActions` for the rest of that round. The engine also
rejects `{type:'bid'}` from that seat as belt-and-suspenders.

**Source:** User message ("I should not be able to bet over myself").

**Rationale:** There's no tactical reason in 304 to inflate your own
bid. The previous UI surfaced bid chips even when the seat was the
high bidder, which produced confusing flows in bid8 (the maker entered
the round as high bidder by definition and could pointlessly raise
themselves). The rule applies symmetrically to both rounds.

---

## 2026-04-17 — Open declaration gated on trick-1 leadership + must lead the indicator — v2.1.0

**Decision:** The `declareOpen` action is offered only when
`trumpMaker === next(dealer)` (the maker also leads trick 1).
A successful declaration sets `state.openIndicatorId` to the
indicator's card id. On trick 1 the maker's `legalCardIds` is
restricted to that single id, and `handlePlay` rejects any other lead
with "open declaration: must lead the trump indicator on trick 1".
The flag clears the moment the indicator is played.

**Source:** User messages
- "I should only have the option to go open if I am also the one
  opening the first trick"
- "On open rounds the trump also has to be played in the first trick by
  the trump caller revealing it to everyone and hence the open
  designation"

**Rationale:** Matches the in-person ritual — declaring open IS the act
of laying the indicator face-up on the first trick. Turning it into a
phase-only choice (v1) divorced the declaration from the commitment
that proves it. The new model also means an opponent can't be sandbagged
into expecting an open game when the maker isn't even leading.

The AI's `chooseOpenChoice` is updated to honour the same gate so it
never produces an illegal `declareOpen` action.

---

## 2026-04-17 — Visible bid strip across bidding + play — v2.1.0

**Decision:** Add `#bid-strip` to the table screen, populated by
`renderBidStrip()` whenever `view.highBid` exists. Shows the amount,
the bidder's name (or "you"), and (where appropriate) the trump suit +
open/closed status.

**Source:** User message ("create a ui indicator for current betting
round value for both the betting and gameplay face").

**Rationale:** v1 hid the high bid behind seat avatars; mid-hand a
player who looked away briefly couldn't tell what the team was chasing.
The strip is `display: none` while empty so it adds zero vertical space
when bidding hasn't started.

---

## 2026-04-17 — Robustness pass: stall fallback, idle GC, input hardening — v2.2.0

**Decision:** Three runtime guarantees, each implemented as a small,
test-covered piece of `server.js`:

1. **Stall fallback (25 s).** When the actor seat has a `null` socket
   for `STALL_FALLBACK_MS`, the AI auto-plays that seat. De-duped via
   the same `aiQueue` token mechanism used for normal AI pacing — a
   reconnect within the window aborts the fire.
2. **Idle room GC (30 min TTL, 5 min sweep).** A `setInterval` sweeps
   `rooms` and drops any whose `lastTouched` is older than
   `IDLE_ROOM_TTL_MS` AND whose four socket slots are all `null`.
   `lastTouched` is bumped on every state-changing or activity event
   (createRoom, joinRoom, resume, startGame, action, AI fire,
   disconnect schedule).
3. **Boundary input hardening.** Extracted `sanitizeName` and
   `sanitizeAction` into `src/util/sanitize.js`. The server applies
   them on every client → server payload that becomes part of state
   or routing. The engine assumes well-formed shapes; without this,
   a non-string `cardId` would throw inside `findIndex`.

**Alternatives considered:**
- Move state to Redis so a server restart doesn't lose rooms (rejected:
  out of scope for a casual game; adds an external dependency).
- Use socket.io's built-in rooms timeout (rejected: less precise; we
  want to keep rooms alive while AIs are playing even if humans drop).
- Validate via a JSON schema library (rejected: extra dep, the action
  surface is small enough to whitelist by hand).

**Source:** Pre-ship robustness pass requested by the user
("ensure stability of multiplayer and the overall gameplay").

---

## 2026-04-17 — Asker lockout after askPartner — v2.2.1

**Decision:** When a player calls `askPartner` in the 4-card bid round,
set `state.isAsker[seat] = true`. For the rest of the round, that
seat's only legal action is `pass`. `bid` is stripped from their
`legalActions` and `handleBid4` rejects the action server-side.

**Source:** User message ("You should not be able to bid on the round
after asking your partner").

**Rationale:** `askPartner` is an explicit delegation — "I don't have
the call; my partner might". If the asker can then outbid the
partner's own raise, it breaks the social contract of the gesture and
opens exploits (ask partner into a small bid to signal, then bid over
them to grab the call).

The new field `state.isAsker[]` is distinct from the pre-existing
`state.askedPartner[]`. The latter is symmetric (both asker and
partner are flagged, used only to raise the ≥200 floor for the rest
of the round). The former fires only on the asker.

---

## 2026-04-17 — Token scale locked in via tests — v2.2.1

**Decision:** The household token table (see `docs/RULES.md#normal-outcomes`)
is now under test in `scripts/bid-test.js#Test 7`. No code change —
the table was already correct since v1 — but the rule is now pinned
by pattern-matched assertions on `finalizeHand`'s source, so any
future refactor that silently reshapes the table will fail the suite.

**Source:** User message ("ensure the victory tokens are 3 for 25+, 2
for 20+, and 1 for 16+ for the team betting that round and setting
the trump or one more token each for the team that is showing points
against the trump calling team (so 4 if the non callling team wins
25+) making sure tokens taken from opponents").

**Rule shape:**

| Bid range | Caller wins | Non-caller wins |
|-----------|-------------|-----------------|
| 160–199   | 1           | 2               |
| 200–249   | 2           | 3               |
| 250+      | 3           | 4               |

Transfer is zero-sum: loser's balance decreases by the same amount
the winner's balance increases, capped at the loser's balance so no
team ever goes negative. All-8-tricks "high court" remains a +5
override.

---

## 2026-04-17 — Bid display relabel: 160–240 subtract 100; 250+ unchanged — v2.2.2

**Decision:** Change `public/client.js#displayBid()` so every bid
rendered in the UI follows the household convention:

| Internal | Display |
|---------:|--------:|
| 160      | 60      |
| 170      | 70      |
| 180      | 80      |
| 190      | 90      |
| 200      | 100     |
| 210      | 110     |
| 220      | 120     |
| 230      | 130     |
| 240      | 140     |
| 250      | 250     |
| 260      | 260     |
| 270      | 270     |
| 280      | 280     |
| 290      | 290     |
| 300      | 300     |

Rule: for `160 ≤ internal < 250`, display `internal - 100`. For
`internal ≥ 250`, display the raw value.

**Supersedes** the v1 rule "Bids entered in integer units of 10
internally (160, 170, …, 250), displayed /10 (16, 17, …, 25)". The
/10 form matched internal math but didn't match how the family
actually calls bids at the table. The subtract-100 form reads
naturally ("sixty", "hundred", "140") in the 4-card range, and the
full three-digit form at 250+ signals the jump to 8-card stakes.

**Source:** User messages establishing the ladder: "change 16 to 60
and 17 to 70 and 18 to 80 and 19 to 90 … 20 to 100 … 21 to 110 and
22 to 120 and 23 to 130 and 24 to 140 … But 25 is 250 … The system
changes there".

**Scope:** strictly UI. Engine internals (bid comparisons, floor
checks, scoring) untouched. `scripts/bid-test.js#Test 8` exhaustively
verifies the 15-value ladder 160 → 300 and pattern-matches the source
so a regression can't silently ship.

---

## 2026-04-17 — Ask partner counts as your pass; once per round; no stale bid UI — v2.2.3

**Decisions (three related fixes in one release):**

1. **askPartner adds the asker to `state.passedSeats`.** The asker is
   never routed back for a second turn. `advanceBid4`'s existing
   skip-passed-seats loop handles the rest. Supersedes the v2.2.1
   "asker can still pass" behavior, which was a half-step.
2. **askPartner is once per round.** `handleBid4` rejects a second
   askPartner attempt with `'ask-partner already used this round'`.
   `legalActions(bid4)` omits the chip when `askedPartner[seat]` is
   true. Blocks ask-back loops.
3. **Per-seat `pass` / `bid N` labels clear the moment bidding ends.**
   `bidLabelFor` in `public/client.js` returns empty string outside
   `bid4` / `bid8` phases, fixing the reported bug where opponent
   seats still read "pass" and "bid 100" during trick play. The
   winning bid + bidder remains visible in the top bid-strip.

**Source:** User messages
- "I should not get the chance to pass after ask partner, it should
  count as a pass from me"
- "Also the pass and bid ui should disappear after betting is settled"
- "See how pass and bid text persists during the trick" (with
  screenshot showing "pass" under AI 1/AI 2 and "bid 100" under AI 3
  during play).

**Defensive client-side guard:** `renderActionBar` now also checks
`v.phase === 'bid4' || v.phase === 'bid8'` before rendering any
bid/pass/askPartner chip. Redundant with the server filter but
protects against a stale view-render in the transition window.

---

## 2026-04-17 — Cut reveal: only trump-suited face-downs are exposed — v2.2.4

**Decision:** When `resolveTrick` detects a face-down trump and flips
`trumpRevealed = true`, it now reveals ONLY the trump-suited face-down
cards. Non-trump face-downs (the trump holder's defensive discard
AND any other player's bluff cut attempt) stay face-down permanently.
The view filter is hardened to honor `p.faceDown` per-card even after
`state.trumpRevealed` is true, so a non-maker never sees the rank or
suit of anyone else's non-trump face-down play.

**Source:** User rule clarification (Q1=B):
> "When a cut succeeds, only the trump-suited cards are revealed;
> non-trump face-down cards stay hidden permanently."

**Supersedes:** the v2.0.0 pagat-canonical behavior ("reveal all
face-downs when a cut happens"). The household variant is more
conservative — every player's discard privacy is protected.

**Code touches:**
- `game.js#resolveTrick` — the `currentTrick.map` branch no longer
  flips non-trump cards.
- `game.js#viewFor.currentTrick` — per-card `faceDown` check instead
  of a global `trumpRevealed` toggle. Same filter applied to
  `view.lastTrick` so the post-trick record can't leak either.
- `scripts/cut-test.js` — new assertions that seat 2's non-trump 8D
  stays face-down after seat 3 cuts with a trump, and that non-makers
  still see it as a back via `viewFor`.

---

## 2026-04-17 — Trump maker face-down: indicator or disposal only; no custom-bid input — v2.2.5

**Two related changes:**

### 1. Trump maker's face-down play is constrained

The trump maker's only legal face-down plays in a closed game are:
- **Disposal** — a non-trump card from hand (stays hidden forever).
- **Cut** — the trump indicator itself (revealed at trick end).

A non-indicator trump from the maker's hand is NEVER a legal
face-down play. `legalCardIds` filters them out for the maker in
closed-and-can't-follow context; `handlePlay` rejects them
server-side with `"trump maker cannot play a non-indicator trump
face-down"`.

**Rationale:** per user rule, whenever the maker cuts, the card that
gets flipped face-up is by definition the indicator. Forbidding
hand-trumps as face-down cuts preserves that invariant and makes
the mental model for every seat at the table crisper.

**Non-maker cutters are unaffected** — they don't hold an indicator,
and their cut logic already worked.

### 2. Custom-bid input removed

`renderBidAction` no longer renders the free-form numeric input or
the secondary "Bid" button. Every legal bid amount is surfaced as a
tappable chip (common amounts as solid chips; rare amounts as ghost
chips, up to 6). Avoids typos, ambiguous manual entry, and the UX
disconnect where the display ladder (60/70/…/140/250) didn't match
the digits users typed (160/170/…).

**Tests:**
- `scripts/cut-test.js#Test 4` — 10 new assertions covering the
  maker face-down restriction (legalCardIds filter + engine reject +
  disposal path still works).
- `scripts/layout-smoke.js` — asserts the custom input and the
  bid-input placeholder are both gone.

---

---

## 2026-04-17 — Engine quality pass + trump-status pill + hand-clip fix — v2.2.6

**Three threads shipped together after merging the parallel v2.2.5
branch (`claude/mobile-game-development-GifG7`) back into the
quality-pass branch.**

### 1. Engine quality pass

- Removed dead state fields: `closeCaps`, `dealtFirstBatch`,
  `bid8Passes`, and the `isCloseCaps` flag on `highBid` (its branch in
  `finalizeHand` was unreachable).
- `bid8Turns` now initialized in `createGame`/`startHand`, matching
  every other per-hand field — was previously set only when entering
  `bid8`.
- `handlePlay` no longer mutates the caller's action payload; a local
  `faceDown` variable carries the decision.
- Dropped dead indicator-in-hand checks in `handlePlay` (the indicator
  is held **outside** `hands[seat]` while closed; those predicates
  were structurally unreachable).
- Exported `whoseTurn` from `src/engine/game.js`; removed the duplicate
  phase→actor mapping from `server.js`.
- Hoisted `STALL_FALLBACK_MS` / `IDLE_ROOM_TTL_MS` /
  `IDLE_SWEEP_INTERVAL_MS` above `scheduleAITurn` (they were relying on
  forward reference through a closure — legal but brittle).
- `setSeat`, `addAI`, `removeAI` now call `touchRoom`, matching every
  other lobby operation.

### 2. Hand-row clipping fix

`.your-hand` had `min-height: card-h + 14px` against **18 px** total
padding under `box-sizing: border-box`, so the content area was
`card-h − 4px` — and with `overflow-y: hidden`, the mirrored bottom
corner of every card was shaved. Fixed in both the default and the
`max-height: 640px` override.

### 3. Trump-status pill

New `#trump-status` element in the table header. Four states:

- hidden before trump pick
- `TRUMP ♠ OPEN` once public
- `TRUMP ♠ CLOSED` to the maker (suit visible only to them)
- `TRUMP CLOSED` to everyone else during a closed game

Suit glyph rendered on a cream disc in its native red/black colour so
hearts/diamonds stay legible on the dark header.

**Rationale:** the quality pass removed 60+ lines of dead state and
duplication without changing externally observable behaviour; the CSS
fix was a box-model off-by-one; the trump pill was user-requested and
pairs well with the cut-prompt already in the phase banner.

**Tests:** all seven green after the merge (layout-smoke +4 checks for
v2.2.5 rules + trump pill; cut-test unchanged; bid-test unchanged).

---

---

## 2026-04-17 — Early bid + early hand resolution; hand-won flash — v2.2.10

**Four interlocking changes, all driven by the same principle: don't
drag out a round whose outcome is already decided. Show the outcome
clearly the moment it's locked in.**

### 1. Partner auto-pass in bid4

When a bid lands, the bidder's partner is immediately added to
`passedSeats` (v2.2.7 rule: partner can't bid over you). Previously
the partner had to be given a turn and explicitly pass even though
their only legal action was pass. Rotation now skips them entirely.

### 2. Passed-seat lockout

Once a seat passes in bid4 they cannot bid again. This was
effectively enforced via the `currentBidder` gate, but v2.2.10 adds
an explicit engine check that rejects a bid from a passed seat with
`"you have already passed this round"`. Belt-and-suspenders against
a malicious or buggy client bypassing the rotation.

### 3. Early-finalize of a hand

`resolveTrick` now calls `checkEarlyFinalize(state)` after updating
points + before requiring 8 tricks played. The hand ends as soon as:
- the defenders have clinched (maker can't reach the bid even with
  all remaining points), OR
- the maker has met the bid AND defenders have won ≥ 1 trick (so the
  all-8 bonus is off the table).

If the maker has met the bid AND hasn't lost a trick, play continues
— they could still upgrade to the 5-token high-court bonus.

### 4. Four new flash overlays

The client now fires centred transient banners on the same transitions
the engine surfaces:
- **Bid won** (2.4 s) — bid4 → trump_pick1. Shows caller + display bid.
- **Trump is …** (2.0 s) — first view where `isOpenTrump /
  trumpRevealed` flips to true. Big suit glyph on a cream disc.
- **Trick won / lost** (1.3 s) — `tricksPlayed` increments.
- **Hand won / lost** (4.0 s) — `tokens` changes. Shows token delta
  + caller + bid + per-team display points (`US 18.5 · THEM 11.9`).
  Exposed a new `trickPoints` field on the view to drive this.
- **Match won / lost** (4.5 s) — a team reaches 22 tokens. Takes
  precedence over the hand flash on the same frame.

Flashes are pointer-events: none (never block taps), stack ordering
is match > hand > trick, and baselines are set on the first view so
reconnects don't fire spurious flashes.

### 5. Inline indicator card + docs pass (v2.2.9 residuals)

Rolled in from the v2.2.9 ship: the indicator is now part of the
maker's hand row (labeled + gold ring + flip animation), and the
old `#indicator-strip` + `#your-trump` + trick seat-name tags are
all gone. Bid strip no longer duplicates trump suit/open (it's on
the header pill).

**Tests:** bid-test gains early-finalize coverage + updated Test 3
(walks rotation adaptively post-auto-pass); layout-smoke grows
from 59 → 71 assertions covering the new engine logs, view field,
flash variants, and CSS.

---

*Append new entries below this line. Do not modify prior entries — if a
decision is reversed, add a new entry that references and supersedes it.*
