# Socket.IO Protocol

All events are JSON. The server is authoritative: clients send *intents*,
the server computes and broadcasts *views*. A client never sees the
full `GameState` — always a filtered `PlayerView` (see
[`ARCHITECTURE.md#game-state-shape`](ARCHITECTURE.md#game-state-shape)
for the underlying state; the filter rules live in the same file).

All inbound payloads pass through
[`src/util/sanitize.js`](../src/util/sanitize.js) first. Malformed
payloads are rejected at the boundary with `actionError`; they never
touch `game.applyAction`.

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
| `bid`             | `{ amount }`                 | bid4 / bid8  |
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
- `yourHand`: array of Card (excludes the trump indicator if you're the
  trump maker — the indicator is in `trumpIndicator` instead)
- `handCounts`: number of cards per seat (length-4 array)
- `phase`: current game phase
- `currentPlayer`: whose turn it is (may equal yourSeat)
- `legalActions`: array of action templates you can currently perform
  (server-side computed; makes client UI trivial). For `playCard`, the
  `cardIds` list **includes the trump indicator id** when the maker may
  legally play it as a face-down cut, so the client can render the
  indicator card itself as tappable.
- `trumpSuit` / `trumpIndicator`: null unless revealed or you're trump maker
- `currentTrick`: cards played this trick, with face-down filtering applied
  per-seat (see *Cutting visibility* below)
- `tokens`: `[team0, team1]`
- `tricksWon`: per-team count
- `trickPoints`: `[team0, team1]` internal point totals so far this hand
  (divide by 10 for display). Added v2.2.10 for the hand-won flash.
- `log`: recent events (last 10)
- `cutResolved`: `true` for one frame after a face-down trump was revealed
  this trick. Cleared when the next trick begins. Drives the "CUT!" banner.
- `cutWinnerSeat`: the seat that wins the trick when `cutResolved` is true
  (i.e., the cutter); `null` otherwise.
- `openIndicatorId`: when an open declaration is in flight (trick 0 of
  an open round, before the maker has led), this is the card id the
  maker MUST lead. `null` outside that one-action window.

### Bidding action gates (v2.1.0)

- `bid` is omitted from `legalActions` when the recipient is already the
  current high bidder (`highBid.bidder === yourSeat`). The engine also
  rejects `{type:'bid', ...}` server-side as a defence-in-depth.
- `declareOpen` is omitted from `legalActions` unless
  `trumpMaker === (dealer + 3) % 4` (i.e., the maker is the trick-1
  leader). When omitted, only `declareClosed` is offered.
- After the first 4-card bid lands and every other seat passes, the
  engine auto-advances to `trump_pick1` — clients receive a
  `view` with the new phase rather than another bid prompt.

### Cutting visibility (`currentTrick` per-seat filter)

Each entry in `currentTrick` is filtered before send. Three shapes are
possible per played card, depending on who's looking:

| Recipient | Card was face-up | Card was face-down (own play) | Card was face-down (someone else) |
|---|---|---|---|
| The cutter | full `{seat, card, faceDown:false, ...}` | full `{seat, card, faceDown:true, ...}` (you tapped it) | (n/a) |
| Trump maker | full | full | `{seat, card, faceDown:true, isTrumpIndicator, makerPeek:true}` |
| Anyone else | full | full | `{seat, faceDown:true, hidden:true}` (no `card` field) |

After `state.trumpRevealed === true` (a cut was successful, or open was
declared, or the bid ≥ 250 auto-open fired after trick 1), every recipient
sees the unfiltered `{seat, card, faceDown, isTrumpIndicator}` form.

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
finds a matching seat whose player has disconnected (or even one whose
stale socket id is still bound — the old connection may not have fired
`disconnect` yet), it rebinds the new socket to that seat and sends the
current view. See `server.js#resume` for the exact tie-breaking.

The client's **emit gate** (`public/client.js`) holds every user action
until the server confirms the seat. This is what prevents the "Start
Game loops to landing" class of bugs when the socket briefly blips on
mobile — see the comment block at `public/client.js#emit-gate` for the
full story.

## Error reasons (`actionError.reason`)

`actionError` carries a short string. These are the strings the client
may see; group them by where they come from:

### Boundary / routing (server.js)

| `reason` | When |
|---|---|
| `"malformed action"` | `sanitizeAction` returned null (wrong type, missing field, out-of-range value). |
| `"no room"` | Your socket is not bound to any room. Usually means a stale buffered event reached the server before `resume`. The client auto-issues `resume` and swallows this one. |
| `"not seated"` | You're in a room but haven't claimed a seat. |
| `"not your turn"` | Valid action type for the phase, but you're not the actor. |
| `"room not found"` | The room code doesn't exist (server restart / idle GC). Client clears session and returns to landing. |
| `"no seat to resume"` | You asked to resume but no seat with that name exists. |
| `"host only"` / `"game already started"` / `"seat occupied"` / `"invalid seat"` / `"seat is not AI"` | Lobby operations (setSeat, addAI, removeAI, startGame). |

### Engine (src/engine/game.js)

| `reason` | Phase(s) | When |
|---|---|---|
| `"missing action type"` | any | Action has no `type` field. |
| `"not your turn"` | any | Engine-level actor mismatch. |
| `"unknown phase"` | any | Defensive; should never fire in prod. |
| `"minimum bid is 160"` / `"bids must be multiples of 10"` | bid4 | Self-explanatory. |
| `"your bid floor is <n>"` | bid4 | Prior-turn or partner-is-high restriction raised your floor. |
| `"must exceed current high bid"` | bid4 / bid8 | |
| `"you are already the high bidder"` | bid4 / bid8 | No self-overbid (house rule v2.1.0). |
| `"you asked partner to bid — you can only pass this round"` | bid4 | Asker lockout (house rule v2.2.1). |
| `"ask-partner already used this round"` | bid4 | Once per round (house rule v2.2.3). |
| `"cannot bid over your partner"` | bid4 / bid8 | Partner-is-high lockout (house rule v2.2.7). |
| `"you have already passed this round"` | bid4 | Pass lockout (house rule v2.2.10). |
| `"only the first bidder may demand redeal"` / `"hand too strong for redeal"` / `"redeal only on first action"` | bid4 | Redeal gating. |
| `"minimum 8-card bid is 250"` / `"cannot bid after partner"` | bid8 | |
| `"only trump maker picks"` / `"card not in hand"` | trump_pick1/2 | |
| `"only the trick-1 leader may declare open"` | open_choice | House rule v2.1.0. |
| `"open declaration: must lead the trump indicator on trick 1"` | play | Open commitment (house rule v2.1.0). |
| `"cannot lead the trump indicator"` | play | Indicator lead-out only in trick 8 when forced. |
| `"first trick lead cannot be trump in closed game"` | play | |
| `"must follow suit"` | play | |
| `"exhausted trumps: must lead trump"` | play | Open-game rule. |
| `"trump maker cannot play a non-indicator trump face-down …"` | play | House rule v2.2.5. |

`actionError` is sent **only** to the offending client; no other seat
sees the attempt.

## Adding a new action type

If you extend the protocol:

1. Add the type to `ACTION_TYPES` in `src/util/sanitize.js` and extend
   `sanitizeAction` to validate / coerce its payload.
2. Add a `case` branch in the engine (`applyAction` → whichever
   `handle<Phase>` is appropriate). Return `{ ok: true }` or `fail(reason)`.
3. Wire `legalActions` so the client knows to render a button / tap
   target for the new action.
4. Add a test in `scripts/<existing-or-new>-test.js` exercising both
   the accepted and the rejected cases.
5. Update this file's Client → Server events table + the Error reasons
   table above.
