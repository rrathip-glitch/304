# Architecture

## High-Level

```
Browser (phone)                            Railway (Node)
┌─────────────────────┐   Socket.IO    ┌──────────────────────┐
│ public/index.html   │ ◄────────────► │ server.js            │
│ public/styles.css   │                │  ├─ express static   │
│ public/client.js    │                │  ├─ socket.io rooms  │
│ public/cards.js     │                │  └─ room manager     │
└─────────────────────┘                │ src/engine/*         │
                                       │  ├─ cards.js         │
                                       │  ├─ game.js          │
                                       │  └─ ai.js            │
                                       └──────────────────────┘
```

- **Server-authoritative state.** All game state lives in `server.js` memory,
  keyed by room code. Clients send *intents* (bid, play card, etc.) and
  receive *views* (their hand + public state).
- **Ephemeral rooms.** Rooms live in memory only. If the server restarts,
  active games are lost. Acceptable tradeoff for a 2-person casual game.
- **No database.** No user accounts. Players enter a display name per session.

## File Map

```
/
├── package.json              # express + socket.io
├── server.js                 # HTTP server, Socket.IO, room manager
├── Dockerfile                # Railway build
├── railway.json              # Railway config (optional)
├── .gitignore
├── README.md                 # Human entry point
├── COLLABORATION.md          # Agent + branch coordination
├── docs/
│   ├── SOUL.md               # Agent orientation (read first!)
│   ├── RULES.md              # Canonical 304 rules (incl. glossary)
│   ├── ARCHITECTURE.md       # This file: state shape + phase diagram
│   ├── API.md                # Socket.IO protocol + error table
│   ├── TASKS.md              # Work tracker
│   ├── DECISIONS.md          # ADR log (append-only)
│   ├── TESTING.md            # Test inventory + manual scenarios
│   └── DEPLOYMENT.md         # Railway specifics + rollback
├── src/
│   ├── engine/
│   │   ├── cards.js          # Deck, ranks, compare, winning index
│   │   ├── game.js           # State machine, actions, transitions
│   │   └── ai.js             # AI bid & play strategy
│   └── util/
│       └── sanitize.js       # Boundary input hardening (sanitizeName,
│                             #   sanitizeAction). All client → server
│                             #   payloads MUST pass through these.
├── public/
│   ├── index.html            # Single-page app shell
│   ├── styles.css            # Mobile-first styles
│   ├── client.js             # Socket.IO client, UI state, renderers
│   └── cards.js              # Card SVG/DOM rendering helpers
└── scripts/
    ├── smoke.js              # 1-AI-match end-to-end
    ├── soak.js               # N-match marathon; token invariant
    ├── e2e.js                # Boots server + drives a real socket
    ├── cut-test.js           # Cutting mechanic (24 assertions)
    ├── bid-test.js           # Bid + open rules (31 assertions)
    ├── robust-test.js        # Sanitize + live /version /health
    └── layout-smoke.js       # Static analysis of CSS/HTML/JS rules
```

## Module boundaries

| Module | Owns | Never does |
|---|---|---|
| `src/engine/cards.js` | Deck, rank order, point values, `winningIndex`, `compareCards`. Pure. | Networking, DOM, state mutation beyond shuffle. |
| `src/engine/game.js` | Phase state machine, `applyAction`, `legalActions`, `viewFor`, `whoseTurn`. Pure; no I/O. | Express, Socket.IO, AI decisions, DOM. |
| `src/engine/ai.js` | `chooseAction(state, seat)` — picks a legal action for a non-human seat. Reads state but never mutates. | Networking, DOM, writing to state. |
| `src/util/sanitize.js` | `sanitizeName`, `sanitizeAction`. Pure boundary validators for any untrusted input. | Game logic, error UX. |
| `server.js` | HTTP + Socket.IO, room manager, AI scheduler, stall fallback, idle GC. | Game rules, card ranking. All state-changing paths go through `game.applyAction`. |
| `public/client.js` | UI state, render loop, emit gate, session persistence. | Authoritative game state — it always trusts the server view. |
| `public/cards.js` | DOM rendering helpers for a card (face-up / face-down / small / legal). | Game logic, DOM event routing beyond a single `onClick`. |

## Data Flow (typical turn)

1. User taps a card to play.
2. `public/client.js` emits `action { type: 'playCard', cardId, faceDown }` through the **emit gate** (drops it on the floor if the socket is mid-reconnect; flushes when the seat is rebound).
3. `server.js` routes it through `sanitizeAction` (boundary) then `game.applyAction(state, seat, action)`.
4. If legal, the engine mutates state in-place and returns `{ ok: true }`. Illegal returns `{ ok: false, reason }` → client receives `actionError`.
5. Server broadcasts a filtered **view** to each seat via `game.viewFor(state, seat)`. Hidden state (other hands, closed indicator, face-down cards from other seats) is stripped.
6. Each client receives its view and re-renders.
7. If the *next* actor is AI or a disconnected human, `scheduleAITurn` arms a timer (600–1200 ms for AI pacing, 25 s for stall-fallback) that re-runs the cycle.

## Phase state machine

```
              startHand                           all pass
  waiting ─────────────►  bid4  ─┬──► (redeal; dealer rotates) ─┐
                                 │                              │
                                 │ winning bid                  │
                                 ▼                              │
                           trump_pick1                          │
                                 │                              │
                                 │ deals second batch           │
                                 ▼                              │
                              bid8  ─┬──► (no one outbids) ─────┤
                                     │                          │
                                     │ someone outbids          │
                                     ▼                          │
                               trump_pick2                      │
                                     │                          │
                                     ▼                          │
                             open_choice                        │
                                     │                          │
                                     ▼                          │
                                   play  ◄──── inspect          │
                                     │            ▲             │
                                     │ 4 cards   │ continue     │
                                     ▼           │              │
                                  resolveTrick ──┘              │
                                     │                          │
                                     │ 8 tricks done            │
                                     ▼                          │
                                 hand_end ─┬──► next hand ──────┘
                                           │
                                           │ team ≥ 22 tokens
                                           ▼
                                       game_over
```

Each transition is either deterministic (engine advances on its own) or
driven by a player action listed in [`API.md#client--server-events`](API.md#client--server-events).
The engine refuses actions that don't fit the current phase — see the
`switch (state.phase)` dispatch in `applyAction`.

## Game State Shape

This is the authoritative type of the in-memory state owned by `game.js`.
Field comments describe *why* the field exists, not just its type. The
canonical source of truth is `createGame()` in
[`src/engine/game.js`](../src/engine/game.js) — if this diverges, the code
wins and this doc is stale.

```ts
type Suit = 'S'|'H'|'D'|'C';
type Rank = '7'|'8'|'Q'|'K'|'10'|'A'|'9'|'J';
type Card = { suit: Suit, rank: Rank, id: string };   // id = rank + suit (e.g. 'JS')
type Seat = { name: string, isAI: boolean } | null;

type PlayedCard = {
  seat: 0|1|2|3,
  card: Card,
  faceDown: boolean,          // closed-trump disposal OR indicator played face-down
  isTrumpIndicator: boolean,  // true iff this play WAS the trump indicator
};

type GameState = {
  // ---- Room-level (persist across hands until game_over) -----------------
  roomId: string,
  phase: 'waiting'|'bid4'|'trump_pick1'|'bid8'|'trump_pick2'|'open_choice'
        |'play'|'inspect'|'hand_end'|'game_over',
  seats: [Seat, Seat, Seat, Seat],
  dealer: 0|1|2|3,                            // rotates right after each hand
  handNumber: number,
  tokens: [number, number],                   // team tokens, always sums to 22
  message: string,                            // last log line, shown in UI
  log: string[],                              // capped at 50 entries

  // ---- Per-hand state (reset at startHand) -------------------------------
  hands: [Card[], Card[], Card[], Card[]],    // PRIVATE per seat
  bids: BidAction[],                          // history of bid/pass/ask in order
  currentBidder: 0|1|2|3|null,                // whose turn to bid
  passedSeats: number[],                      // seats that have passed this round
  bidTurns: [number, number, number, number], // how many turns each seat has taken
  askedPartner: [boolean,boolean,boolean,boolean], // symmetric: asker + partner both true
  isAsker: [boolean,boolean,boolean,boolean], // true only for the seat that called askPartner
  bid8Turns: number,                          // counter used by advanceBid8
  highBid: { amount: number, bidder: 0|1|2|3 }|null,

  trumpMaker: 0|1|2|3|null,
  trumpIndicator: Card|null,                  // PRIVATE (trump maker) while closed; held OUTSIDE hands[]
  trumpSuit: Suit|null,
  isOpenTrump: boolean,
  trumpRevealed: boolean,                     // true once anyone should see the suit
  openIndicatorId: string|null,               // v2.1.0 open-commitment: the id the maker MUST lead

  currentTrick: PlayedCard[],
  trickLeader: 0|1|2|3|null,
  currentPlayer: 0|1|2|3|null,
  tricksWon: [number, number],
  trickPoints: [number, number],              // internal units, summed per team
  tricksPlayed: number,
  lastTrick: PlayedCard[]|null,               // surfaced in views for post-trick UI
  cutResolved: boolean,                       // true the frame a trump cut won a trick
  pendingSecondBatch: Card[]|null,            // remaining 16 cards until dealSecondBatch
};
```

## Client View Filtering

The server sends each client a `PlayerView`:

```ts
type PlayerView = GameState & {
  yourSeat: 0|1|2|3,
  yourHand: Card[],                           // only your cards
  handCounts: [number, number, number, number],
  trumpIndicator: Card|null,                  // set only if you are trump maker
                                              // or it has been revealed
  currentTrick: PlayedCard[]                  // face-down filter — see below
  cutResolved: boolean,                       // true the frame a trump cut wins
  cutWinnerSeat: 0|1|2|3|null,                // the cutter when cutResolved
};
```

Sensitive fields (`hands`, `trumpIndicator` when closed) are stripped before
broadcast.

### Cutting (face-down play) — visibility table

When a player can't follow suit in a closed game, they tap a card and the
client tags it `faceDown: true`. The server-side view filter then exposes
that card differently to each seat:

- The **cutter** sees their own play (with the card data).
- The **trump maker** sees a `{ ...card, makerPeek: true }` shape — the
  card is real (so the maker can adjudicate cuts privately) but the
  `makerPeek` flag tells the UI to render the gold-ringed "the others see
  a back" affordance instead of a vanilla face-up.
- **Everyone else** sees `{ seat, faceDown: true, hidden: true }` — no
  `card` field at all (no way to leak rank/suit through devtools).

When a face-down card is a trump, `resolveTrick` flips `trumpRevealed +
isOpenTrump` to true, returns the indicator to the maker's hand, sets
`cutResolved: true` for one frame, and lets the existing winner-leads-next
rule give the cutter the next lead. From this trick onward every player
sees the full `currentTrick` shape — the game is now open.

## Turn Direction

Counter-clockwise: `next(p) = (p + 3) % 4`.
Dealer rotation: `nextDealer = (dealer + 3) % 4`.
First leader: `nextPlayer(dealer)`.

## Room Lifecycle

1. POST-style flow via Socket.IO:
   - `createRoom` → server generates 6-char code (A-Z, no ambiguous chars),
     adds creator to seat 0.
   - `joinRoom(code)` → server places player in first empty seat (typically 2,
     so they're partnered with creator). Supports manual seat pick later.
   - `startGame` → host initiates; empty seats become AI.
2. Mid-game disconnect: the seat stays bound to the player's name; the
   socket slot is set to `null`. The client's `sessionStorage`-backed
   `resume` handshake re-binds the new socket on reconnect.
3. **Stall fallback (v2.2.0):** if the seat that's currently the actor
   has no live socket, the AI takes that seat's turn after
   `STALL_FALLBACK_MS` (25 s). De-duped by token: if the human
   reconnects before the timer fires, the fallback is skipped.
4. **Idle room GC (v2.2.0):** every 5 min a sweeper drops any room
   whose `lastTouched` is older than `IDLE_ROOM_TTL_MS` (30 min) AND
   has no live sockets. This keeps memory bounded across long uptimes.

## Robustness Invariants

These are the hard guarantees the live server provides. Each has a
test in `scripts/`:

| Guarantee | Where | Test |
|---|---|---|
| Malformed action payloads can't crash the server | `src/util/sanitize.js#sanitizeAction` | `scripts/robust-test.js` |
| Player names are bounded (24 chars, no control chars) | `src/util/sanitize.js#sanitizeName` | `scripts/robust-test.js` |
| Closed-tab seat doesn't freeze the table | `server.js#scheduleAITurn` (stall fallback) | `scripts/robust-test.js` (live boot) |
| Abandoned rooms are reclaimed | `server.js#sweepIdleRooms` | covered by manual review |
| `/health` is in-process, not cached | `server.js` | `scripts/robust-test.js` |
| Token total = 22 across any number of hands | `src/engine/game.js#finalizeHand` | `scripts/soak.js` |
| Hidden state never leaks (face-down cards) | `src/engine/game.js#viewFor` | `scripts/cut-test.js` |

## Mobile UI Layout (responsive, ~320–1024 wide)

```
┌─────────────────────────────┐
│ ▲ safe-area-inset-top       │  (iPhone notch / Android status bar)
├─────────────────────────────┤
│ header: tokens · hand · room│  (≥40px, never overlapped)
├─────────────────────────────┤
│ phase banner / cut prompt   │  (28px; amber when "you can cut")
├─────────────────────────────┤
│ ┌──┐    partner (top)   ┌──┐
│ │L │     trick center   │R │ (play-area: flex:1, overflow:hidden)
│ │op│     2×2 cards      │op│ (side stacks cap at column height)
│ │p │                    │p │
│ └──┘                    └──┘
├─────────────────────────────┤
│ YOUR TRUMP  [card]          │ (only the maker sees this row)
│ your hand: ♠ ♥ ♦ ♣          │ (safe-center; min 44px tap target)
├─────────────────────────────┤
│ action bar: bid / play hint │  (≥60px)
├─────────────────────────────┤
│ ▼ safe-area-inset-bottom    │
└─────────────────────────────┘
```

### Layout invariants (enforced by `scripts/layout-smoke.js`)

1. `#app.screen-table` claims `100dvh` (dynamic viewport) so iOS Safari's
   URL-bar collapse never causes overflow.
2. `padding-top: var(--safe-top)` etc. on the table screen so the header is
   never hidden behind the notch / camera island.
3. Card sizes are `clamp(min, ideal-vw, max)` so the same DOM works on a
   320px-wide phone and a 1024px tablet without media queries.
4. Side-opponent vertical stacks set `max-height: calc(100% - 28px)` and
   `overflow: hidden` so an 8-card back row never extends past the play
   area (the failure mode of the v1 8-card-bidding screen).
5. `body { overflow-x: hidden }` makes a horizontal page scroll
   structurally impossible.
6. A `@media (max-height: 640px)` override re-clamps card sizes for
   landscape phones / iPhone SE.

Cards are CSS-drawn (not images) for fast paint and infinite scalability.
