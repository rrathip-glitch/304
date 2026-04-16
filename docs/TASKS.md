# TASKS — 304 Implementation Tracker

> This file is the canonical "what's next". Update it at the end of every
> session. The "Next up" section should always be actionable from a cold read.

## Done

- [x] Project skeleton (`package.json`, `.gitignore`)
- [x] Documentation suite (SOUL, RULES, ARCHITECTURE, API, TASKS, DECISIONS)
- [x] `src/engine/cards.js` — deck, ranks, points (integer ×10 internal),
      compare, winningIndex, legalCards, displayPoints
- [x] Orchestration infrastructure (`COLLABORATION.md`, `CLAUDE.md`,
      `.claude/hooks/`, `scripts/orchestrate.sh`, `.locks/`) — milestone M0,
      PR #1.
- [x] `src/engine/game.js` — full state machine: createGame, seatPlayer,
      startHand, applyAction, legalActions, viewFor. Phases bid4,
      trump_pick1, bid8, trump_pick2, open_choice, play, inspect,
      hand_end, game_over all implemented. Scoring with token transfer
      and high-court override. Smoke-tested via `scripts/smoke-engine.js`
      — milestone M1.

## Next up

**Start here if you are a fresh instance:**

1. Build `src/engine/ai.js`:
   - `chooseAction(state, seat)` — returns an action given legal actions.
   - Bidding heuristic per `docs/RULES.md#ai-betting-heuristics`.
   - Play heuristic: follow suit with lowest winning card; if can't win, play
     lowest; trump cautiously; track played cards.
   Entry points match `src/engine/game.js` — use `G.legalActions(state, seat)`
   as the source of truth. Acceptance: `node scripts/smoke-engine.js` rigged
   to drive all four seats via `ai.chooseAction` completes 100 hands with no
   illegal-move rejections.
2. Build `server.js`:
   - Express static file serving for `public/`.
   - Socket.IO room manager per `docs/API.md`.
   - Scheduled AI ticks with 600–1200ms delay for natural pacing.
4. Build `public/index.html`, `public/styles.css`, `public/client.js`,
   `public/cards.js`:
   - Landing: create room / join room.
   - Lobby: seat assignment, share link.
   - Game table: mobile-first, cards bottom, trick center, partner top.
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
