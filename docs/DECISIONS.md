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

*Append new entries below this line. Do not modify prior entries — if a
decision is reversed, add a new entry that references and supersedes it.*

---

## 2026-04-16 — Client renders purely from server `view`; no local game state

**Decision:** The frontend (`public/client.js`) never computes legal moves,
scores, or phase transitions. It reads `view.legalActions`, `view.phase`,
`view.currentPlayer`, etc., and renders. Card taps emit an `action` and
wait for a new `view` broadcast.

**Alternatives:** Mirror engine state client-side for snappier UI / optimistic
updates.

**Rationale:** Server is authoritative (per SOUL §3). Duplicating rule logic
doubles the surface area for bugs, especially around closed-trump inspection
reveals — which the client must NEVER try to infer. Perceived latency over
Socket.IO on a phone is already low; optimism isn't worth the complexity.

---

## 2026-04-16 — Cards drawn with CSS, no image assets

**Decision:** The card face is a plain `<div class="card red">` with suit
symbol + rank in two corners and a large suit in the center. No SVGs, no
spritesheets, no font-awesome.

**Rationale:** Zero network cost, scales to any size via `--w`/`--h` vars,
readable on 375×812, infinitely themeable later. Matches the "no
dependencies, novice-readable" principle.

---

## 2026-04-16 — Seat-slot mapping is relative to the viewer

**Decision:** The client always renders the viewer at the bottom of the
table, their partner at the top, right-opponent on the right, left-opponent
on the left. Mapping:
  `me = yourSeat`
  `right = (yourSeat + 3) % 4`  (counter-clockwise = next player)
  `partner = (yourSeat + 2) % 4`
  `left = (yourSeat + 1) % 4`

**Rationale:** Everyone expects to be at the bottom of their own screen.
Keeps absolute seat indices on the server; the client never mutates them.

---

## 2026-04-16 — Bid UI: chips + custom entry + rare-badge

**Decision:** Bid amounts come from `view.legalActions[0].amounts` (server
decides). The client renders each as a chip; 190 is styled with a `.rare`
class (lower opacity) so the UI nudges away from it without hiding it. A
numeric "Other" input exists for edge cases. PCC (Partner Close Caps) shows
only when the server includes `canCloseCaps: true`.

**Rationale:** Keeps the legal-bid set server-authoritative while still
encoding the household convention (190 rare) visually. The "Other" input
respects user autonomy on rare amounts.

---

## 2026-04-16 — Mobile polish layered as additive css+js, not edits to client.js

**Decision:** `public/polish.css` and `public/polish.js` are loaded after
the main client. They attach purely through MutationObserver on existing
DOM and never call into `client.js` or the socket. Removing the two files
leaves the client fully functional (minus polish).

**Alternatives:** Edit `client.js` to call a new animation/SFX API at
known points (card played, token changed, trick won).

**Rationale:** Keeps the L4 client lane's surface small for the next
contributor. Animation/SFX logic is independently testable and can be
swapped out or disabled with `?sfx=0` without touching core code. Cost:
one MutationObserver cycle per DOM update — negligible on mobile.

---

## 2026-04-16 — WebAudio tones instead of audio files

**Decision:** SFX is generated in-browser via oscillator nodes (sine /
triangle / sawtooth) for card-play, trick-won, your-turn, error, and
game-over cues. No `.mp3`/`.ogg`/`.wav` assets ship.

**Alternatives:** Bundle short audio files (or data-URIs) for higher
fidelity.

**Rationale:** Zero network cost, zero copyright worries, matches the
"no dependencies, no bundler" constraint from SOUL §3. The beep-like
tones are sufficient for the game's feedback-loop purpose (confirming a
tap registered, flagging your turn, celebrating a taken trick).

---

## 2026-04-16 — Ship a headless engine+AI simulator as L6 QA

**Decision:** `scripts/simulate.js` drives the actual `src/engine/game.js`
and `src/engine/ai.js` across many hands, asserting view-leak, deck,
token, and legal-action invariants. Deterministic via `--seed=N`. Runs in
seconds; usable in CI.

**Alternatives:** Handwritten `node --test` unit tests per module.

**Rationale:** Unit tests assert the author's model; the simulator
stress-tests the actual integration surface and is far more likely to
catch cross-module edge cases (the three bugs filed on first run are
direct evidence). Unit tests can still be added later for regression
pinning of specific fixes.

---

## 2026-04-16 — Resume via `sessionStorage.roomId` + URL `?room=`

**Decision:** On socket connect, the client auto-emits `resume { roomId,
name }` if it has both a stored room and a stored name. The invite link
carries `?room=CODE` so a tap-to-join works with zero typing.

**Rationale:** The novice-user flow is "dad taps link → plays". Pre-filling
from the URL and resuming after a brief disconnect is the minimum viable
"seamless" experience.
