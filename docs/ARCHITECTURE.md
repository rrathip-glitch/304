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
├── docs/
│   ├── SOUL.md               # Agent orientation (read first!)
│   ├── RULES.md              # Canonical 304 rules
│   ├── ARCHITECTURE.md       # This file
│   ├── API.md                # Socket.IO protocol
│   ├── TASKS.md              # Work tracker
│   ├── DECISIONS.md          # ADR log
│   ├── TESTING.md            # Manual test scenarios
│   └── DEPLOYMENT.md         # Railway specifics
├── src/
│   └── engine/
│       ├── cards.js          # Deck, ranks, compare, winning index
│       ├── game.js           # State machine, actions, transitions
│       └── ai.js             # AI bid & play strategy
└── public/
    ├── index.html            # Single-page app shell
    ├── styles.css            # Mobile-first styles
    ├── client.js             # Socket.IO client, UI state, renderers
    └── cards.js              # Card SVG/DOM rendering helpers
```

## Data Flow (typical turn)

1. User taps a card to play.
2. Client emits `{event: 'action', type: 'playCard', cardId}`.
3. Server validates via `game.canPlay(state, seat, card)`.
4. If legal, `game.applyAction(state, action)` mutates state.
5. Server broadcasts a filtered **view** to each seat (hiding opponents'
   hands and the trump indicator when applicable).
6. Client receives the view and re-renders.
7. If next player is AI, server schedules `ai.chooseAction(state, seat)` on
   a short delay (for perceived think-time).

## Game State Shape (v1)

```ts
type Suit = 'S'|'H'|'D'|'C';
type Rank = '7'|'8'|'Q'|'K'|'10'|'A'|'9'|'J';
type Card = { suit: Suit, rank: Rank, id: string };

type PlayedCard = {
  seat: 0|1|2|3,
  card: Card,
  faceDown: boolean,    // closed-trump discard or trump indicator played face-down
  isTrumpIndicator: boolean
};

type GameState = {
  roomId: string,
  phase: 'waiting'|'bid4'|'trump_pick1'|'bid8'|'trump_pick2'|'open_choice'
        |'play'|'inspect'|'hand_end'|'game_over',
  seats: [Seat, Seat, Seat, Seat],      // player presence
  dealer: 0|1|2|3,
  handNumber: number,
  tokens: [number, number],             // team tokens
  message: string,
  log: string[],

  // Per-hand state (reset at startHand)
  hands: [Card[], Card[], Card[], Card[]],    // PRIVATE per seat
  bids: BidAction[],                          // history
  currentBidder: 0|1|2|3|null,
  passedSeats: Set<number>,
  highBid: { amount: number, bidder: 0|1|2|3, isCloseCaps: boolean }|null,
  trumpMaker: 0|1|2|3|null,
  trumpIndicator: Card|null,                  // PRIVATE (trump maker) until revealed
  trumpSuit: Suit|null,
  isOpenTrump: boolean,
  trumpRevealed: boolean,
  closeCaps: boolean,                         // PCC flag
  currentTrick: PlayedCard[],
  trickLeader: 0|1|2|3|null,
  currentPlayer: 0|1|2|3|null,
  tricksWon: [number, number],
  trickPoints: [number, number],              // internal units
  tricksPlayed: number,
  lastTrick: PlayedCard[]|null,               // for UI display
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
2. Mid-game disconnect: seat remains; if the player reconnects with the
   same room code + name, they resume. Otherwise AI takes over temporarily.
3. Room is destroyed when:
   - All humans have disconnected for > 10 minutes, or
   - Host ends the game.

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
