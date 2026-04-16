# TESTING

Manual test scenarios for verifying the 304 card-game implementation. No
automated tests yet; use these to validate end-to-end behaviour.

## How to run locally

- `npm install`
- `node server.js`
- Open `http://localhost:3000` in two browser tabs (simulate two humans).
- Tab A: enter name "Alice", tap **Create Room**, note the room code.
- Tab B: enter name "Bob", enter the room code, tap **Join Room**.
- Tab A (host): tap **Start Game**. Empty seats fill with AI; hand 1 deals.

Seat 0 is the host. A joining human is placed at seat 2 first (partner of
host), then 1, then 3.

## Scenario 1 — Basic hand end-to-end

- **Preconditions**: 2 humans + 2 AI seated; `startGame` fired.
- **Steps**:
  1. Each seat receives 4 cards. Bidding opens at seat `next(dealer)`.
  2. Bid through to a winner; trump maker picks indicator (face-down).
  3. Second batch of 4 deals. 8-card round runs (usually all pass).
  4. Trump maker chooses **Open/Closed**.
  5. Play 8 tricks.
  6. Tokens transfer per RULES.md table; next hand deals with `dealer = next(dealer)`.
- **Expected**: both tabs show consistent `tokens`, `tricksWon`, `handNumber`,
  `message`, and `phase` after every action. `handCounts` sums to 32 at deal
  time and decrements in lockstep.

## Scenario 2 — Bid floors

- Seat X bids 160. Partner (seat Z) wants to bid — they should NOT see
  170–190 chips, only 200+.
- On your second turn, you should NOT see 160–190 chips (floor becomes 200
  after any prior bid/pass at that seat).
- **190 must NEVER appear as a chip** (custom entry only, and AI avoids it).

## Scenario 3 — Trump indicator hidden from opponents

- After a bid wins and a trump is picked, seats that aren't the trump maker
  must see `trumpIndicator: null` in their view.
- Trump maker's view shows the indicator's `id`.
- `trumpSuit` stays `null` for everyone (including trump maker until reveal
  triggers via open / auto-open / face-down cut).

## Scenario 4 — Closed game face-down discards

- In a closed game, when void of the lead suit, the played card renders as
  a face-down back to opponents (view has `hidden: true`).
- Trump maker can inspect the face-down card at trick end.
- If **no** trump appears face-down in the trick, the cards stay hidden
  after the trick; trump is NOT revealed; highest card of the suit led wins.

## Scenario 5 — Face-down cut reveals trump

- As trump maker, play a trump face-down when void of lead suit.
- At trick end, `trumpRevealed` flips true; indicator is returned to trump
  maker's hand; all previously face-down trumps in the trick flip up.
- Trump maker's **own** face-down non-trump discard stays hidden.
- Trump suit is now public for all remaining tricks.

## Scenario 6 — Auto-open after trick 1 for bid ≥ 250

- Force a bid of 250 via the 8-card round.
- After trick 1 resolves, even without any face-down trumps in the trick,
  `trumpRevealed` must flip true and `trumpSuit` become public.

## Scenario 7 — Exhausted trumps

- In an open game, if the trump maker holds the last remaining trumps in
  the game and has previously led one, they cannot switch suits: the
  `legalActions.playCard.cardIds` list omits non-trump cards until all
  trumps are played.

## Scenario 8 — First-trick lead restriction (closed)

- If the trump maker also sits to the dealer's right (`trumpMaker === next(dealer)`)
  and the game is closed, trumps are absent from the first-trick lead's
  `cardIds`. The indicator is never leadable (except forced trick 8).

## Scenario 9 — High court (all 8 tricks)

- Rig a hand (via dev-only logging or a hand-seed hook in the engine) so
  the trump maker's team wins all 8 tricks.
- Regardless of bid level, expect `tokens` to transfer **5** to the maker's
  team (clamped by loser's remaining tokens).

## Scenario 10 — Partner "ask partner" restriction

- On your first turn, you may offer `askPartner`.
- After partner bids in your stead, `askedPartner[you]` and `askedPartner[partner]`
  are both true. Their bid floor is 200; if either of you bids again, bid
  floor is 200.

## Scenario 11 — Redeal

- Seed a weak 4-card hand (< 1.5 displayed / < 15 internal) at the first
  bidder's seat (`next(dealer)`).
- Their legal actions include `demandRedeal`. Clicking it keeps the same
  dealer, reshuffles, and re-enters `bid4` with `handNumber` unchanged in
  intent (note the engine increments `handNumber` per `startHand`).

## Scenario 12 — All four pass (abandoned)

- All four players pass in `bid4`. `highBid` stays null.
- `dealer` rotates right (`dealer = next(dealer)`); new hand deals.
- `tokens` unchanged.

## Scenario 13 — Reconnect by name

- Alice disconnects mid-hand (close tab). In the room, her seat is preserved
  but its socket slot is cleared (`room.sockets.set(seat, null)`).
- Reopen `http://localhost:3000` with the same room code + name "Alice".
- Client should emit `resume { roomId, name }`; server binds the new socket
  to Alice's seat; her hand and turn state are restored in the view.

## Scenario 14 — Mobile layout (375×812)

- Use browser dev tools to emulate iPhone SE / 12 mini (375×812).
- Cards fit without horizontal scroll (beyond intentional hand overflow).
- Tap targets (buttons, cards) ≥ 44px.
- No elements cut off by safe-area insets; header and action bar visible
  simultaneously with hand.

## Scenario 15 — Disconnect → AI takeover (not implemented in v1)

Current behaviour (see `server.js disconnect` handler): the seat stays with
the human; their socket slot is cleared; **no AI takes over automatically**.
If the player doesn't reconnect, the turn stalls until they do (or a human
at HAND_END continues the room).

**Documented intent for a future revision**: "v1 keeps the seat; if the
player doesn't reconnect before the hand ends, the AI will act on their
behalf automatically." Track this as future work.

## Known gaps / out of scope for v1

- **PCC (Partner Close Caps) 3-player hands** — engine flag exists
  (`closeCaps`) but the 3-player rotation and partner-face-down flow are
  not implemented.
- **Spoilt Trumps auto-detection** — not implemented; no UI to declare.
- **Caps timing penalties** — replaced by the High Court 5-token override
  per household variant (see `finalizeHand` in `src/engine/game.js`).
- **AI takeover on disconnect** — see Scenario 15.
