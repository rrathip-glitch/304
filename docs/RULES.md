# 304 — Rules as Implemented

This is the canonical rules document for **our** implementation of 304.
Where we diverge from the pagat.com reference or use house variants, it is
called out explicitly.

Source: https://www.pagat.com/jass/304.html
Household variant source: user messages dated 2026-04-16 (see DECISIONS.md).

---

## Deck & Card Values

- **32 cards**: 7, 8, 9, 10, J, Q, K, A in 4 suits (♠ ♥ ♦ ♣).
- **Rank high→low**: J, 9, A, 10, K, Q, 8, 7.
- **Point values** (display shown; internal is ×10):
  | Card | Display | Internal |
  |------|--------:|---------:|
  | J    | 3       | 30       |
  | 9    | 2       | 20       |
  | A    | 1.1     | 11       |
  | 10   | 1       | 10       |
  | K    | 0.3     | 3        |
  | Q    | 0.2     | 2        |
  | 8    | 0       | 0        |
  | 7    | 0       | 0        |
- **Total in deck**: 30.4 (displayed) / 304 (internal).

## Players, Teams, Direction

- 4 players, 2 teams of 2. Partners sit **opposite** (seats 0+2 vs 1+3).
- Play and dealing are **counter-clockwise**: `next(p) = (p + 3) % 4`.
- After each hand, the deal passes **to the right** (counter-clockwise):
  `nextDealer = (dealer + 3) % 4`.

## Dealing

1. Dealer shuffles (minimally; residual order from prior hand is acceptable).
2. Left-hand opponent may cut (we skip the cut ceremony; the shuffle is full).
3. **First batch**: 4 cards to each player, counter-clockwise, starting with
   the dealer's right-hand opponent.
4. Bidding (see below).
5. **Second batch**: remaining 4 cards to each player (total 8).

## Four-Card Bidding

- Starts with the dealer's right-hand opponent; proceeds counter-clockwise.
- Bids represent the minimum points the bidder's team promises to win.
- Minimum bid: **160**. All bids are multiples of **10**.
- Each bid must exceed the prior high bid.
- A player may **pass** at their turn.
- **Second-turn <200 restriction**: if you have already bid or passed once,
  you may not bid <200 on your next turn (you may still pass).
- **Partner-is-high restriction**: if the current high bidder is your
  partner, you may not bid <200 (you may still pass).
- **Ask-partner-to-bid**: at your turn, you may ask your partner to bid in
  your place. This counts as a turn for **both** players. After this, neither
  of you may bid <200.
- **Redeal demand**: the dealer's right-hand opponent, and *only* they,
  before their first bid/pass, may demand a redeal if their 4 cards total
  < 15 internal points (< 1.5 displayed). Same dealer reshuffles.
- Bidding ends when all players except one have passed *or* when all four
  players pass consecutively.
- If **all four players pass**, the hand is abandoned; next dealer deals.

## Trump Selection (First Indicator)

- The highest 4-card bidder becomes the **trump maker**.
- Trump maker selects **one of their four dealt cards** and places it
  **face-down** on the table. Its suit is the trump suit (unknown to others).
- The second batch (remaining 4 cards) is then dealt to everyone.
- Trump maker now holds **7 cards + 1 face-down indicator**.

## Eight-Card Bidding (Second Round)

- Happens after the second batch is dealt.
- Starts with the current high bidder, proceeds counter-clockwise, **one
  turn each**, no re-bidding.
- **Minimum bid: 250**. Must exceed the 4-card high bid.
- Household convention: **rarely goes above 260**. The AI should only bid
  higher than 260 with extraordinary hands (6+ top cards).
- Cannot ask partner to bid in this round.
- If your partner just bid, you must pass.
- If all four pass in the 8-card round, the 4-card bid stands.
- If someone does bid higher:
  - They become the **new trump maker**.
  - The previous trump maker takes their face-down indicator back into hand.
  - The new trump maker picks a new face-down indicator from their 8 cards.

### Partner Close Caps (PCC)

- The maximum possible bid: win all 8 tricks playing solo.
- The bidder's **partner's 8 cards are placed face-down**; partner does not
  play.
- Bidder leads the first trick. Play is a 3-player counter-clockwise rotation
  (bidder → right opponent → left opponent → bidder).
- Bid succeeds only if bidder wins **all 8 tricks**.
- Exhausted-trumps rule does not apply. Caps announcement is not required.

## Open vs Closed Trump

### Closed (default)
- Trump indicator stays face-down.
- When a player cannot follow suit, they play a card **face-down**.
  Other players (except the trump maker) do not see it.
- **At end of trick**, trump maker privately inspects any face-down cards:
  - If **none are trumps**: face-down cards stay face-down permanently;
    trick is won by the highest card of the suit led.
  - If **any card is a trump**: all face-down cards are revealed, the
    trump indicator is revealed (added to trump maker's hand if not the
    played card), and the trick is won by the highest trump.
  - **Trump maker's own face-down non-trump discard** remains hidden even
    after a reveal — it stays a discard.
- Once trump is revealed, the game is **open** for all remaining tricks.

### Open
- The trump maker may **declare open** before the first card is led.
  The indicator is flipped face-up, shown to all, returned to hand
  (trump maker now has 8 cards).
- All subsequent play is face-up, standard rules.

### Auto-open after Trick 1 (bid ≥ 250)
- If the final bid (either round) is ≥ 250 and the game started closed,
  the indicator is revealed at the end of trick 1, regardless of whether
  any face-down cards were played.

## Trump Indicator — Special Restrictions

While face-down in the trump maker's hand, the indicator can only be played:

1. Face-down, to **cut** a non-trump trick led by another player, **or**
2. In the **eighth trick**, when it is the trump maker's only remaining card.

The trump maker may never **lead** the indicator (except in trick 8 when
forced).

## Trick Play Rules

- The player to the **dealer's right** leads the first trick.
- Thereafter, the winner of each trick leads the next.
- Players must **follow suit** if able.
- If unable to follow suit:
  - In a closed game: the card is played **face-down** (cannot win unless
    later revealed as a trump during inspection).
  - In an open game: any card may be played, face-up. (Trumping is not
    compulsory.)
- Trick is won by the highest trump in it, or if no trumps, the highest
  card of the suit led.

### First-Trick Lead Restriction (Closed)

- If the trump maker sits to the dealer's right (leads trick 1) in a
  **closed** game, they may NOT lead a trump. They must lead a non-trump.
- This does not apply in an open game.

### Exhausted Trumps Rule

- If the trump maker holds all remaining trumps in the game and leads a
  trump, they must **lead all remaining trumps from their hand before
  leading any other suit**.
- The face-down indicator is never forced to be led except in trick 8.

### Spoilt Trumps

- If the trump maker's opponents collectively hold **zero** trumps, any
  player who notices may declare "Spoilt Trumps" before the final card of
  the final trick.
- Hand is void; same dealer redeals. No tokens change hands.

## Scoring (Points)

- At end of hand, count internal point values (30, 20, 11, 10, 3, 2, 0, 0)
  in cards each team won in tricks. Total across all tricks = 304.
- If the trump maker's team's points **≥ bid**, they succeed. Ties go to
  the trump maker.

## Scoring (Tokens)

### Starting
- Each team begins with **11 tokens** (22 tokens total in play).

### Normal outcomes

| Bid range | Win (success)         | Lose (failure) |
|-----------|----------------------:|---------------:|
| 160–199   | 1                     | 2              |
| 200–249   | 2                     | 3              |
| 250+      | 3                     | 4              |
| PCC       | 4                     | 5              |

### "High Court" override (house variant)

- If the trump maker's team **wins all 8 tricks**, they earn **5 tokens**
  automatically (overrides the table above). This is called "high court".
- This applies to any bid level (not just Caps calls). The Caps
  announcement timing penalties from the pagat reference are **not** used
  in this household variant.

### Win Condition

- The first team to hold **all 22 tokens** (opponent reaches 0) wins the
  match.

## AI Betting Heuristics (implemented)

Based on household norms confirmed by the user:

- **Good hand** (≥ 2 Jacks, or ≥ 3 top cards J/9/A across ≥ 2 suits):
  bid 200–210 first round.
- **Medium hand** (1 top card + 10s, mixed suits): minimum-bet 160–180.
- **Weak hand**: pass.
- **190 is almost never called.** AI avoids 190.
- **Second round (8-card) bidding is rare**: only with 5–7 top cards and a
  near-guaranteed path to 250+ points. AI rarely bids over 260.
