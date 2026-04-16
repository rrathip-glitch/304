# Testing

No automated test framework yet. Manual scenarios are the verification path.
A future instance may add `node --test` with the Node test runner.

## Orchestration harness (verified 2026-04-16)

Smoke test of the multi-agent sync infrastructure added by the
`claude/create-collaboration-guide-NBO3E` branch. Run from the repo root:

```bash
bash .claude/hooks/session-start.sh      # boot banner + fetch + pull + board
bash scripts/orchestrate.sh init         # seed .locks/ FREE entries (idempotent)
bash scripts/orchestrate.sh board        # markdown lane table
bash scripts/orchestrate.sh status       # JSON dump
bash scripts/orchestrate.sh claim L6 "smoke"
bash scripts/orchestrate.sh heartbeat L6 # CLAIMED → WIP + refresh
CLAUDE_SESSION_ID="other" bash scripts/orchestrate.sh claim L6 "collide"  # exit 3
bash scripts/orchestrate.sh release L6 --status DONE --summary "harness verified"
bash scripts/orchestrate.sh prune L5 "simulated stale"
echo '{"tool_input":{"command":"git push"}}' | bash .claude/hooks/pre-push.sh
bash .claude/hooks/stop.sh               # reminder when a lock is held
```

Last pass: commit `7ae60a5` on `claude/create-collaboration-guide-NBO3E`.
All nine steps passed — hooks print expected output, claim collision exits
non-zero, commits land on origin after each mutating call, board reflects
every status transition.

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
