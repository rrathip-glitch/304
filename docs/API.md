# Socket.IO Protocol

All events are JSON. Timings reference client-perceived latency targets.

## Client → Server events

### `createRoom { name }`
Create a new room. Server responds with `roomCreated { roomId, seat, view }`.

### `joinRoom { roomId, name }`
Join an existing room. Server places you in the first free seat (prioritizes
seat 2, then 1, then 3 — so a second human joining becomes the host's
partner by default). Responds with `roomJoined { seat, view }`, and
broadcasts `playerUpdate` to the room.

### `setSeat { seat }`
Before game start, host only: reassign seats. Server validates no conflict.

### `addAI { seat }` / `removeAI { seat }`
Host only, before game start. Toggle an AI at a given seat.

### `startGame`
Host only. All empty seats become AI. First hand begins.

### `action { type, ...payload }`
All in-game actions go through this channel. `type` is one of:

| type              | payload                      | phase        |
|-------------------|------------------------------|--------------|
| `bid`             | `{ amount, isCloseCaps? }`   | bid4 / bid8  |
| `pass`            | `{}`                         | bid4 / bid8  |
| `askPartner`      | `{}`                         | bid4 only    |
| `demandRedeal`    | `{}`                         | bid4 (first turn, dealer's right only) |
| `pickTrump`       | `{ cardId }`                 | trump_pick1 / trump_pick2 |
| `declareOpen`     | `{}`                         | open_choice  |
| `declareClosed`   | `{}`                         | open_choice  |
| `playCard`        | `{ cardId, faceDown? }`      | play         |
| `continue`        | `{}`                         | inspect / hand_end |

The server validates every action; illegal actions return `actionError`
without mutating state.

## Server → Client events

### `roomCreated { roomId, seat, view }`
Response to `createRoom`.

### `roomJoined { seat, view }`
Response to `joinRoom`.

### `view { view }`
Broadcast after any state change. Sent individually per-seat so that hidden
state (hands, trump indicator) is filtered.

### `actionError { reason }`
Returned to the offending client only; other clients don't see the attempt.

### `chat { seat, text }` (future)
Not implemented in v1.

## `view` shape

See `docs/ARCHITECTURE.md#client-view-filtering`. Key fields:

- `yourSeat`: which seat you are (0–3)
- `yourHand`: array of Card
- `handCounts`: number of cards per seat
- `phase`: current game phase
- `currentPlayer`: whose turn it is (may equal yourSeat)
- `legalActions`: array of action templates you can currently perform
  (server-side computed; makes client UI trivial)
- `trumpSuit` / `trumpIndicator`: null unless revealed or you're trump maker
- `currentTrick`: cards played this trick, with face-down ones masked if not
  visible to you
- `tokens`: `[team0, team1]`
- `tricksWon`: per-team count
- `log`: recent events (last 10)

## Legal Actions

The server computes the legal-action menu for the current player and sends
it in the view. This lets the client render only valid buttons / cards.
Example legalActions payloads:

```json
[
  { "type": "bid", "amounts": [160, 170, 180, 200, 210, 220, 230, 240] },
  { "type": "pass" },
  { "type": "askPartner" },
  { "type": "demandRedeal" }
]
```

or during play:

```json
[
  { "type": "playCard", "cardIds": ["JS", "9S", "10S"] }
]
```

## Reconnection

On `connect`, the client may send `resume { roomId, name }`. If the server
finds a matching seat whose player has disconnected, it binds the new socket
to that seat and sends the current view.
