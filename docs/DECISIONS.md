# Decision Log

Append-only. Each entry: date, decision, alternatives, rationale, links.

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

*Append new entries below this line. Do not modify prior entries — if a
decision is reversed, add a new entry that references and supersedes it.*
