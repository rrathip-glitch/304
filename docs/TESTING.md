# Testing

## Test inventory

Run all four from the repo root. Each is a self-contained Node script — no
test runner or globals — so a fresh agent can copy a single command and get
green/red within seconds.

| Script | What it covers | Typical runtime |
|---|---|---|
| `node scripts/smoke.js` | One full 4-AI match end-to-end. Asserts token invariant (always sums to 22). | < 1 s |
| `node scripts/soak.js 5` | Five back-to-back matches. Catches drift + rare deadlocks. | 1–3 s |
| `node scripts/cut-test.js` | Engine unit tests for the cutting mechanic: maker peek, hidden-from-others, trump-cut wins trick, cutting team leads next, indicator-as-cut. | < 1 s |
| `node scripts/bid-test.js` | Engine unit tests for v2.1.0 bidding rules: no self-overbid (bid4 + bid8), bid+3-passes auto-resolves, open choice gated on trick-1 leadership, open declaration forces leading the indicator. | < 1 s |
| `node scripts/layout-smoke.js` | Static analysis of `public/styles.css`, `public/index.html`, `public/client.js`, `src/engine/game.js`, `src/engine/ai.js` to lock in safe-area, clamp() scaling, vertical-stack overflow caps, semver markers, maker-peek wiring, bid-strip presence, open-choice gates. | < 1 s |
| `node scripts/e2e.js` | Boots `server.js`, opens a Socket.IO client, drives a real handshake. Verifies room create + join + start emits the expected views. | 2–4 s |

All six are green as of the v2.1.0 commit.

## CI sequence

```bash
npm install
node scripts/layout-smoke.js   # cheapest; fails fast on style/structure regressions
node scripts/cut-test.js
node scripts/bid-test.js
node scripts/smoke.js
node scripts/soak.js 5
node scripts/e2e.js
```

Add this block to any pre-merge gate. Each script exits non-zero on failure
and emits a one-line summary on success.

## Manual UI test scenarios

The automated harness covers the engine and the *structure* of the UI; the
following must be exercised in a real mobile browser before tagging a
release. Pair every release with screenshots at the listed viewports so
regressions are visually diffable.

### Setup
```bash
npm install
npm start
```
Open two browser tabs/windows at `localhost:3000`. In tab 1, "Create
Room"; copy the room code into tab 2 to simulate two humans. AI fills the
remaining seats automatically.

### Core flow (smoke)
1. Create room as Host. Verify build marker shows `v2.0.0`.
2. Second browser joins; verify seat 2 is assigned (partner of host).
3. Host clicks "Start Game".
4. Bid 4 → trump pick → bid 8 → open/closed → play 8 tricks → hand end.
5. Tokens transfer per the table.
6. Next dealer = current dealer's right; next hand starts.

### Cutting mechanic (new in v2.0.0)
1. Set up a hand where you (non-maker) hold no card of the lead suit.
2. The phase banner now reads **"You can't follow suit — tap a card to
   cut (face-down)"** in amber.
3. Tap any card. The trick area shows your card as a face-down back, with
   the seat tag prefixed `cut — <name>` so all players know an intent
   was committed.
4. Open a third browser as the trump maker. Verify their trick view shows
   *your* card face-up with a gold ring + a small "cut" badge — only they
   see it.
5. If your card was the trump suit, after the 4th play:
   - Banner flashes **"CUT! Trump is <Suit> — <Name> takes the trick"**.
   - Indicator returns to maker's hand (face-up); game becomes open.
   - Cutting team gets the trick; your seat leads the next trick.
6. If no trump was cut, face-downs stay backs forever; the highest card of
   the lead suit wins.

### Bidding rules (new in v2.1.0)
1. Bid 200 as the first bidder. Verify the bid chips disappear from
   your action bar — only `Pass` (and `Ask partner` / `Demand redeal`
   on first turn) remain.
2. Have the other three pass. The hand should auto-advance to "Pick
   trump indicator" with you as the trump maker. No extra confirmation.
3. After picking trump and dealing the second batch, you (as trump
   maker = current high bidder) start bid8. Verify only `Pass` is
   offered — no bid chips.
4. The bid strip at the top should read `BID 20 by you · trump <suit>
   · closed` (numbers depend on your bid).

### Open declaration (new in v2.1.0)
1. Set up a hand where you (the trump maker) sit at the dealer's right
   (i.e., you would lead trick 1).
2. The open-choice screen offers BOTH `Declare open (lead indicator)`
   and `Play closed`.
3. Tap `Declare open …`. The trump indicator card joins your hand.
4. On the very first trick, only the (former) indicator card is
   highlighted as legal — every other card in your hand is unlit.
   Tapping a non-indicator shows a toast "open declaration: must lead
   the trump indicator on trick 1".
5. Now repeat with a hand where you are NOT the trick-1 leader. The
   open-choice screen offers ONLY `Play closed` — no `Declare open`
   chip at all.

### Trump indicator selectability (regression)
The previous build left the maker stuck when the indicator was their only
remaining legal card. Verify:
1. Reach a play state where only the trump indicator is legal (e.g.,
   trick 8 with maker holding only the indicator, or any non-lead trick
   where the maker can't follow).
2. The card in the **YOUR TRUMP** row pulses gold (legal indicator) and
   responds to taps. Tapping it plays the card face-down.

### Token math (regression)
- Bid 160, achieve ≥ 160 pts → +1 token.
- Bid 160, fall short → -2.
- Bid 200 → ±2 / -3.
- Bid 250 → +3 / -4.
- All 8 tricks → +5 (overrides).

### Edge cases
1. All 4 pass in 4-card bidding → hand abandoned, next dealer deals.
2. Dealer's right demands redeal (hand < 15 internal pts) → same dealer redeals.
3. Trump maker leads trick 1 in closed — can't lead trump.
4. Trump maker holds all remaining trumps and leads — must lead trumps until exhausted.
5. Bid ≥ 250 → trump auto-reveals after trick 1.
6. Tied points (maker team = bid exactly) → bid succeeds (ties go to bidder).

### Mobile UX checks (target viewports)
Run each at: **iPhone SE (375×667)**, **iPhone 14 Pro (393×852)**,
**Pixel 7 (412×915)**, **iPad mini (744×1133)**, and a **landscape**
phone (812×375). For each:
- Header (Us / Them / Hand N / room code) is fully visible — never hidden
  behind the notch or status bar.
- Side opponent stacks (left/right) never extend past the play area.
- Your hand fits on one row with no horizontal *page* scroll (only the
  hand region itself may scroll).
- Cards have ≥ 44 × 44 px tap target (CSS enforces a `min-width: 44px`).
- Phase banner is legible and always one line.
- Trump indicator badge is visible to the maker and *only* the maker.

### Multiplayer / reconnect
- Host kills tab mid-hand → AI continues seat 0; host reconnects with
  same name + room → seat rebinds, view resyncs.
- Server receives reload of *all* tabs while a hand is in flight → all
  four resume cleanly via the `resume` handshake.

## Adding new tests

If you fix a bug or add a feature, add a test in the same patch:

- **Engine logic** → extend `scripts/cut-test.js` or add a sibling
  `scripts/<feature>-test.js` mirroring its pattern (assert + exit code).
- **UI structure / CSS rules** → add a regex check to
  `scripts/layout-smoke.js`. The pattern is intentionally simple: prove
  the rule that *would have prevented the bug* exists in the file.
- **Protocol** → add a step to `scripts/e2e.js` after the existing flow.

The bar is "green within seconds, no flakes". Avoid sleeps, avoid
externalities. If a test needs the server, boot it inside the script and
tear it down at the end (see `scripts/e2e.js` for the pattern).
