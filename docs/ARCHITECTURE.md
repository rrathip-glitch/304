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
  currentTrick: PlayedCard[]                  // face-down cards show {hidden:true}
                                              // (except to the trump maker who can
                                              //  inspect at trick end)
};
```

Sensitive fields (`hands`, `trumpIndicator` when closed) are stripped before
broadcast.

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

## Mobile UI Layout (target 375×812)

```
┌─────────────────────────────┐
│ header: tokens, room code   │  (40px)
├─────────────────────────────┤
│        partner (top)        │  (80px)
│                             │
│ L-opp        trick        R-opp  (240px center)
│                             │
│       your hand (bottom)    │  (180px)
├─────────────────────────────┤
│ action bar: bid/play/open   │  (80px)
└─────────────────────────────┘
```

Cards are CSS-drawn (not images) for fast paint and infinite scalability.
