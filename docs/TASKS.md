# TASKS — 304 Implementation Tracker

> This file is the canonical "what's next". Update it at the end of every
> session. The "Next up" section should always be actionable from a cold read.

## Done

- [x] Project skeleton (`package.json`, `.gitignore`)
- [x] Documentation suite (SOUL, RULES, ARCHITECTURE, API, TASKS, DECISIONS)
- [x] `src/engine/cards.js` — deck, ranks, points (integer ×10 internal),
      compare, winningIndex, legalCards, displayPoints
- [x] `src/engine/game.js` — full state machine (bid4 → trump_pick1 → bid8 →
      trump_pick2? → open_choice → play → inspect → hand_end → game_over)
- [x] `src/engine/ai.js` — chooseAction with bid/pick/open/play heuristics
- [x] `server.js` — Express + Socket.IO room manager with AI pacing
- [x] `public/` — vanilla HTML/CSS/JS client (landing, lobby, table)
- [x] `Dockerfile`, `railway.json`, `.dockerignore` — Railway deployment

## Next up

**Start here if you are a fresh instance:**

1. `npm install` then `node server.js`. Smoke test: open two tabs in the same
   browser, create room from one, join from the other, fill remaining seats
   with AI, play a hand end-to-end. Watch for view-leak bugs (face-down card
   leaking rank/suit, trump indicator visible to non-makers).
2. Build out `docs/TESTING.md` scenarios once verified.
3. Polish: sound effects, card deal animation, mobile safe-area insets.
4. PCC (Partner Close Caps) 3-player mechanics — currently deferred; see
   `docs/RULES.md#partner-close-caps-pcc`.

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
