# 304 — Rules as Implemented

This is the canonical rules document for **our** implementation of 304.
Where we diverge from the pagat.com reference or use house variants, it is
called out explicitly.

- **Upstream reference:** https://www.pagat.com/jass/304.html
- **Household variant source:** user messages dated 2026-04-16; captured as
  ADR entries in [`DECISIONS.md`](DECISIONS.md).
- **Implemented by:** [`src/engine/game.js`](../src/engine/game.js)
  (state machine) + [`src/engine/cards.js`](../src/engine/cards.js)
  (deck + ranking). Every house rule below is exercised in
  [`scripts/bid-test.js`](../scripts/bid-test.js) or
  [`scripts/cut-test.js`](../scripts/cut-test.js).

---

## Glossary

Read this once; the rest of the document assumes the vocabulary.

| Term | Meaning |
|---|---|
| **Seat** | One of the four positions at the table, indexed `0..3`. Seat 0 is always the room creator (host). |
| **Partner** | The player opposite you. Partners share a team: `{0, 2}` vs `{1, 3}`. |
| **Trump maker** (or caller) | The winner of the bidding; sets the trump suit by picking an indicator. |
| **Trump indicator** | The one face-down card the maker places aside to designate the trump suit. Held *outside* the maker's hand while the game is closed. |
| **Closed** game | The default. Trump indicator is secret; nobody except the maker knows the trump suit. |
| **Open** game | Trump suit is public. Triggered by an explicit `declareOpen`, a successful cut, or the auto-open rule for bids ≥ 250. |
| **Cut** | In a closed game, playing a card face-down to attempt winning with trump. If the face-down card is a trump, the trick is won and the game opens. |
| **Disposal** | In a closed game, playing a *non-trump* face-down when you can't follow suit. It cannot win; the card stays hidden forever. |
| **Maker peek** | Rendering affordance: the trump maker privately sees every face-down card face-up, because they have to know which cuts were successful. The UI shows a gold ring + "cut" badge so the maker remembers the others still see a back. |
| **High court** | House rule: winning all 8 tricks in a hand awards 5 tokens regardless of bid level. |
| **Token** | Scoring currency. Each team starts with 11; first to 22 wins the match. |
| **Hand** | One deal's worth of play (8 tricks). Rotates dealer afterwards. |
| **Match** | Multiple hands played until one team accumulates all 22 tokens. |

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

## Bid Display Convention *(house rule, v2.2.2)*

Internal bid amounts are always multiples of 10 (160 → 300). They are
displayed to players in a household-specific form:

| Round     | Internal | Displayed as |
|-----------|---------:|-------------:|
| 4-card    | 160      | **60**       |
|           | 170      | **70**       |
|           | 180      | **80**       |
|           | 190      | **90**       |
|           | 200      | **100**      |
|           | 210      | **110**      |
|           | 220      | **120**      |
|           | 230      | **130**      |
|           | 240      | **140**      |
| 8-card    | 250      | **250**      |
|           | 260      | **260**      |
|           | 270      | **270**      |
|           | 280      | **280**      |
|           | 290      | **290**      |
|           | 300      | **300**      |

**Rule:** for internal values in `[160, 250)`, subtract 100 for display.
For internal values `≥ 250`, show the full value.

The transition at **250** is deliberate — it marks the boundary between
the normal 4-card range and the 8-card (high-stakes) range. Calling a
bid as "sixty" / "hundred" / "140" is quicker in table talk; once the
stake jumps to the 8-card level, the full three-digit number
communicates the commitment weight.

This is display-only. Every engine check (floor, minimum, comparisons,
scoring) uses the internal value unchanged.

---

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
- **No bidding over yourself** *(house rule, v2.1.0)*: once you are the
  current high bidder, you cannot bid again. Your only options on a
  future turn are to pass or wait to be outbid. The UI hides the bid
  chips for the high bidder; the engine rejects the action defensively.
- **Auto-resolution**: if you bid and every other active player passes,
  the bid stands and the engine advances to trump pick automatically —
  no further confirmation needed.
- **Second-turn <200 restriction**: if you have already bid or passed once,
  you may not bid <200 on your next turn (you may still pass).
- **Partner-is-high restriction** *(house rule; tightened in v2.2.7)*:
  if the current high bidder is your partner, **you may not bid at
  all** — pass is your only action. The bid chips are hidden; the
  engine also rejects the action defensively with
  `"cannot bid over your partner"`.
- **Ask-partner-to-bid**: at your turn, you may ask your partner to bid
  in your place. This counts as a turn for both players. After this,
  neither of you may bid <200.
  - *(House rule, v2.2.1)* **The asker is locked out of bidding for
    the rest of the round** — they've delegated the call.
  - *(House rule, v2.2.3)* **Asking counts as the asker's pass.** They
    don't get routed back; rotation skips them for the rest of the
    round. Mechanically, the engine adds the asker to `passedSeats`
    at the moment the ask is logged. The UI chip reads
    "Ask partner (counts as pass)" so the consequence is visible
    before the tap.
  - *(House rule, v2.2.3)* **Once per round.** If you've been part of
    an ask chain (as either asker or asked partner), you cannot ask
    partner again in the same round.
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
- **No bidding over yourself** *(house rule, v2.1.0)*: the trump maker
  enters bid8 as the high bidder by definition; their only option is
  pass. They cannot self-raise their own 4-card bid.
- **No bidding over your partner** *(house rule, v2.2.7)*: if the
  current high bidder is your partner, you must pass.
- **Minimum bid: 250**. Must exceed the 4-card high bid.
- Household convention: **rarely goes above 260**. The AI should only bid
  higher than 260 with extraordinary hands (6+ top cards).
- Cannot ask partner to bid in this round.
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
- When a player cannot follow suit in a closed game, they **must** play a
  card face-down. Two distinct tactical choices:
  - **Discard** a non-trump card face-down (throw it away; it cannot win).
  - **Cut** by playing a trump-suited card face-down — if it's the
    highest trump on the trick, their team wins.
- **Trump maker's face-down is restricted** *(house rule, v2.2.5)*:
  the maker can only play face-down either (a) a non-trump card
  (disposal) OR (b) the **indicator** itself (cut). A non-indicator
  trump from the maker's hand is never a legal face-down play. This
  means: whenever the maker "cuts", the card that's flipped face-up
  at trick end is necessarily the preselected indicator.
  Non-indicator trumps stay in the maker's hand until the game opens
  (via an indicator cut, or the bid-≥250 auto-open after trick 1,
  or an explicit open declaration). `legalCardIds` omits non-indicator
  trumps; `handlePlay` also rejects them server-side.
- Other players (non-makers) can cut with any trump from their hand
  — they don't have an indicator, so the restriction doesn't apply.
- **Visibility** while the trick is in progress:
  - **The cutter** sees their own card (it's their tap).
  - **The trump maker** privately sees every face-down card face-up (the
    "maker peek"). The UI marks them with a tint + "cut" badge so the
    maker knows the others still see backs.
  - **All other players** see only a face-down back. The seat tag in the
    trick area is prefixed with "cut — <name>" so everyone knows the
    intent, but the rank/suit is hidden.
- **At end of trick**:
  - If **no face-down card was the trump suit**: every face-down stays
    hidden permanently. Trick is won by the highest card of the suit
    led.
  - If **any face-down card was the trump suit**: only the trump-suited
    face-down cards are flipped face-up. **Non-trump face-down cards —
    whether from the trump maker's defensive discard OR from another
    player's bluff cut attempt — stay hidden permanently** *(house
    rule, v2.2.4)*. The trump indicator is returned to the trump
    maker's hand. The cutter's team wins the trick. The cutter leads
    the next trick. The game becomes **open** for the remainder of the
    hand.
- Multiple players can cut on the same trick. The highest trump played
  face-down still wins per normal trump-card precedence.

### Open
- The trump maker may **declare open** before the first card is led —
  but only if **they also lead trick 1** (i.e., they sit at the dealer's
  right). If someone else leads, the open option is not offered; the
  game plays closed by default.
- The act of declaring open commits the maker to **leading the (former)
  trump indicator card on trick 1**. Laying the indicator on the table
  is *what* reveals the suit publicly; it's the open declaration in
  card form.
- The indicator is removed from "face-down" status and joins the maker's
  hand (8 cards). On trick 1, the only legal lead for the maker is that
  specific card.
- After the indicator has been led, all subsequent play is face-up,
  standard rules.

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

Tokens are always transferred **from the losing team to the winning
team** (zero-sum, capped at the loser's balance). The non-caller row
is simply the caller's row + **one extra token** — the opposing team
is rewarded for defeating the call.

| Bid range | Caller's team wins | Non-caller team wins (caller fails) |
|-----------|-------------------:|------------------------------------:|
| 160–199   | **+1**             | **+2**                              |
| 200–249   | **+2**             | **+3**                              |
| 250+      | **+3**             | **+4**                              |
| PCC       | +4                 | +5                                  |

**Worked example:** caller bids 250, non-caller team wins more than
30.4 − 25 = 5.4 points ⇒ non-caller team takes **4 tokens** from the
caller's team.

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
