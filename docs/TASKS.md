# TASKS — 304 Implementation Tracker

> This file is the canonical "what's next". Update it at the end of every
> session. The "Next up" section should always be actionable from a cold read.

## Done

- [x] Project skeleton (`package.json`, `.gitignore`)
- [x] Documentation suite (SOUL, RULES, ARCHITECTURE, API, TASKS, DECISIONS)
- [x] `src/engine/cards.js` — deck, ranks, points (integer ×10 internal),
      compare, winningIndex, legalCards, displayPoints
- [x] `public/index.html` — landing, lobby, table shells (sub-agent
      `claude/sub-agent-soul-goals-5CCGd`)
- [x] `public/styles.css` — mobile-first, 375×812 target, CSS-drawn cards,
      dark felt theme
- [x] `public/cards.js` — DOM helpers: card element, back, facedown, sortHand
- [x] `public/client.js` — Socket.IO binding, view renderer, action bar,
      lobby/table dispatch, share-link + resume handling

## Next up

**Start here if you are a fresh instance:**

1. Build `src/engine/game.js` — full state machine implementing `docs/RULES.md`.
   Entry points:
   - `createGame()` — returns initial state.
   - `seatPlayer(state, { seat, name, isAI })`
   - `startHand(state)` — deal first 4, move to `bid4`.
   - `applyAction(state, seat, action)` — returns new state + events.
   - `legalActions(state, seat)` — returns array of action templates.
   - `viewFor(state, seat)` — returns filtered `PlayerView`.
   Phases to implement: `bid4 → trump_pick1 → bid8 → trump_pick2? →
   open_choice → play → inspect → hand_end → (next hand or game_over)`.
2. Build `src/engine/ai.js`:
   - `chooseAction(state, seat)` — returns an action given legal actions.
   - Bidding heuristic per `docs/RULES.md#ai-betting-heuristics`.
   - Play heuristic: follow suit with lowest winning card; if can't win, play
     lowest; trump cautiously; track played cards.
3. Build `server.js`:
   - Express static file serving for `public/`.
   - Socket.IO room manager per `docs/API.md`.
   - Scheduled AI ticks with 600–1200ms delay for natural pacing.
4. ~~Build `public/*`~~ — done on sub-agent branch
   `claude/sub-agent-soul-goals-5CCGd`. Integration notes below.

### Frontend ↔ backend contract (as built)

The client expects the server `view` to include, at minimum:
   - `roomId`, `yourSeat`, `phase`, `currentPlayer`, `dealer`
   - `seats[4]` as `{ name, isAI, empty? }`
   - `tokens[2]`, `tricksWon[2]`
   - `yourHand[]` of `{ suit, rank, id }`
   - `handCounts[4]` (opponent card counts)
   - `trumpSuit`, `trumpIndicator` (null unless you are trump maker or it's
     been revealed)
   - `highBid` as `{ amount, bidder, isCloseCaps }` or null
   - `currentTrick[]` of `{ seat, card?, faceDown, hidden, isTrumpIndicator,
     revealed? }`. Set `hidden: true` for cards the current viewer is not
     permitted to see; when the trick is awarded and a reveal happens, send
     `revealed: true` and include `card`.
   - `legalActions[]` — the client renders chips/buttons from this:
     - `bid` supports `{ amounts:[...], min, canCloseCaps? }`
     - `playCard` supports `{ cardIds:[...], faceDownRequired? }`
     - `pickTrump` supports `{ cardIds:[...] }`
     - `pass`, `askPartner`, `demandRedeal`, `declareOpen`, `declareClosed`,
       `continue` have no payload
   - `handResult` (only during `phase === 'hand_end'`):
     `{ trumpMaker, trumpMakerTeam, bidAmount, isCloseCaps, makerPoints,
        succeeded, highCourt }`
   - `log[]` of strings (client shows last 20 in the drawer)

The client emits exactly the events documented in `docs/API.md`:
`createRoom`, `joinRoom`, `setSeat`, `addAI`, `removeAI`, `startGame`,
`action { type, ... }`, `resume`.
5. Add `Dockerfile` and `railway.json`.
6. Test flow end-to-end; commit & push.

## Backlog (not blocking v1 playable)

- Partner Close Caps full mechanics (bid + 3-player hand).
- Spoilt Trumps auto-detection & declaration UI.
- Caps timing penalties (Wrong Caps -2, Losing after Caps -5). Currently we
  use the "all 8 tricks = 5 tokens automatic" house rule instead.
- Reconnection persistence across server restart (needs a KV store).
- Sound effects (card play, trick won, token transfer).
- Animations: dealing, card flip on reveal, token slide.
- Chat box for humans to message each other.
- i18n (Sinhala, Tamil).

## Known rule gaps still to resolve with user

- In a closed game, if a player's only unplayable option is the trump
  indicator on a non-trump-led trick (they have no cards of the lead suit
  and no non-indicator cards), can they play the indicator face-down to cut
  even though there's no trump played? Pagat says yes (cutting is allowed).
  Implemented as allowed.
- If the trump maker's 4-card hand has ≥ 2 cards of the same suit, the
  indicator's suit is unambiguous if revealed; if they pick a card of a suit
  they only have once in the first 4, later inspections still work. No
  action needed; noting for completeness.

## Issues / bugs

None currently open.

## Notes for future sessions

- Don't try to build a React-style UI. Vanilla DOM + CSS is faster and more
  readable for this scope.
- AI decision timing: add 600–1200ms delay so the human sees the action.
- The server view filter is the most bug-prone area — always double-check
  that a face-down card doesn't leak its `rank`/`suit` to non-privileged
  seats.
