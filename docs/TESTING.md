# Testing

Two complementary paths:

1. **Headless simulator** (`scripts/simulate.js`) — exercises the real engine
   + AI across many hands, asserting invariants. Automated. Runs in CI or
   locally in seconds. Covers L6 QA done-bar ("every scenario has a pass/
   fail at current HEAD").
2. **Manual browser scenarios** — for UI, multiplayer, and mobile polish
   that can't be exercised headlessly.

---

## Headless Simulator

### Quick run

```bash
node scripts/simulate.js                    # 100 hands, random seed
node scripts/simulate.js --hands=500         # longer sweep
node scripts/simulate.js --seed=1            # deterministic
node scripts/simulate.js --match             # full match to 22 tokens
node scripts/simulate.js --verbose           # per-hand result line
TRACE=1 node scripts/simulate.js --hands=3   # per-action trace
```

Exit code 0 on pass, 1 on invariant failure, 2 on uncaught exception. The
harness will abort (not crash) on known engine edge cases (see
`docs/TASKS.md#issues--bugs`); abort count is reported at the end.

Because a known engine bug (#2) can cause `applyAction` to infinite-loop on
certain bid sequences, always wrap long runs with a shell timeout:

```bash
timeout 60 node scripts/simulate.js --hands=200 --seed=42
```

### Invariants checked, per iteration

| # | Invariant | Code reference |
|---|-----------|----------------|
| 1 | `viewFor(state, seat).yourHand.length` matches `state.hands[seat].length` | `checkViewsLeakFree` |
| 2 | View for seat X never contains another seat's cards | `checkViewsLeakFree` |
| 3 | Trump indicator is exposed only to the trump maker *or* when revealed | `checkViewsLeakFree` |
| 4 | Face-down played cards are hidden from non-privileged seats in a closed game | `checkViewsLeakFree` |
| 5 | No duplicate card ids across the four hands | `checkDeckIntegrity` |
| 6 | Tokens sum to 22; neither team goes negative | `checkTokenTotal` |
| 7 | Over a completed hand, `trickPoints[0] + trickPoints[1] === 304` | post-hand check |
| 8 | `tricksWon[0] + tricksWon[1] === 8` per completed hand | post-hand check |
| 9 | `ai.chooseAction(state, seat)` returns an action whose `type` is in `legalActions(state, seat)` | per-iteration |
| 10 | `applyAction(state, seat, action)` never returns `ok: false` for an AI-chosen action | per-iteration |
| 11 | Progress detector: aborts if (phase, bidder, currentPlayer, highBid, tricksPlayed, hand sizes) doesn't change across 20 iterations | per-iteration |
| 12 | Safety cap: 2000 iterations per hand | per-iteration |

### Phase coverage over 100 hands (seed=1, at time of first run)

Before the simulator aborts on engine bug #2, it exercises:
- `bid4` (every hand)
- `trump_pick1` (every hand that reaches it)
- `bid8` (every hand that reaches it)
- `open_choice`
- `play`
- `inspect`

The simulator should visit all non-terminal phases once the three bugs in
`docs/TASKS.md#issues--bugs` are resolved.

### Adding a new invariant

1. Add a `checkXxx(state)` function near the existing checks.
2. Call it from inside the `runHand` while-loop alongside the existing
   `checkViewsLeakFree` etc.
3. Re-run: `node scripts/simulate.js --hands=100 --seed=1`.

---

## Manual Test Scenarios

### Setup
```bash
npm install
npm start
```
Open two browser tabs/windows at `localhost:3000`. In tab 1, "Create Room".
Copy the URL and paste into tab 2 to simulate two humans. AI fills the
other two seats.

### Core flow (smoke test)
1. Create a room as "Host".
2. Second browser joins; verify seat 2 is assigned.
3. Host clicks "Start Game".
4. First hand deals 4 cards to each (verify count).
5. Bidding opens at dealer's right; verify turn highlight.
6. Each human/AI bids or passes; verify illegal bids rejected.
7. Winner places trump indicator (verify only picker sees the card).
8. Remaining 4 cards dealt to each (8 in hand, trump maker has 7+1).
9. 8-card bidding round; if all pass, 4-card bid stands.
10. Trump maker sees Open/Closed choice; pick Closed.
11. Dealer's right leads first trick (may not be a trump).
12. Play 8 tricks; verify:
    - Must follow suit enforced.
    - Face-down card when can't follow suit (only trump maker inspects).
    - Trick winner leads next.
    - Trump indicator restrictions (only played face-down to cut, or trick 8).
13. Hand ends, points tallied, tokens transferred per the table.
14. Next dealer = current dealer's right; next hand starts.

### Token math
- Bid 160, achieve ≥ 160 pts → +1 token for bidder team.
- Bid 160, fall short → -2 tokens.
- Bid 200, achieve → +2.
- Bid 250, achieve → +3.
- **Win all 8 tricks → +5 (overrides).**
- Fail bid 250 → -4.

Verify: tokens never go negative; total is always 22; when one team hits 0
the other wins.

### Edge cases
1. All 4 pass in 4-card bidding → hand abandoned, next dealer deals.
2. Dealer's right demands redeal (hand < 15 internal pts) → same dealer redeals.
3. Trump maker leads trick 1 in closed — can't lead trump.
4. Trump maker has only trumps left — must lead them all before other suits.
5. Player can't follow suit in open game — any card legal.
6. Player can't follow suit in closed game — card played face-down.
7. Face-down trump detected at inspect → trump revealed, trick awarded to trump.
8. Bid ≥ 250 → trump auto-reveals after trick 1.
9. Tied points (trump maker team = bid exactly) → bid succeeds (ties go to bidder).

### Mobile UX checks
- 375×812 viewport: no horizontal scroll.
- Cards in hand are tappable (min 44x44 hit target).
- Active player has clear highlight.
- Trump indicator badge visible and distinct.
- Token count always visible.

### Multiplayer checks
- Host disconnects mid-hand → AI resumes play on seat 0.
- Host reconnects with same name + room → seat rebinds.
- Invite link includes room code for one-tap join.
