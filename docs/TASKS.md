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

1. **Interactive play-through in a real mobile browser.** `npm install`,
   `npm start`, open `http://<laptop-ip>:3000` on a phone. Create room,
   add 3 AIs, play a full hand. Verify no view-leak bugs (face-down cards
   leaking rank/suit to opponents, trump indicator visible to non-makers).
2. **Deploy to Railway.** Push branch, create Railway project, confirm
   healthcheck passes. See `docs/DEPLOYMENT.md`.
3. **Invite-link flow for 2nd human.** Today the 2nd player can join by
   typing the room code. Add a share button that copies a URL like
   `https://<domain>/?room=ABCDEF&name=Dad` — client auto-joins.
4. **Polish:** card deal animation, trick collection animation, trump reveal
   flourish, sound effects (card play, trick won, token transfer).
5. **PCC (Partner Close Caps)** 3-player mechanics — currently deferred;
   see `docs/RULES.md#partner-close-caps-pcc`.

## Verification status

Automated tests (run from repo root):
- `node scripts/smoke.js` — single-AI-match walkthrough.
- `node scripts/soak.js 5` — 5 full matches to completion; checks token
  invariant (always sums to 22).
- `node scripts/e2e.js` — boots server, connects socket, creates room,
  adds AIs, starts game, verifies views flow.

All passing as of commit 2b9e265 (2026-04-16).

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

None currently open. Four bugs fixed this session (trump-indicator play
paths + bid4 infinite loop); see commit 2b9e265.

## Notes for future sessions

- Don't try to build a React-style UI. Vanilla DOM + CSS is faster and more
  readable for this scope.
- AI decision timing: add 600–1200ms delay so the human sees the action.
- The server view filter is the most bug-prone area — always double-check
  that a face-down card doesn't leak its `rank`/`suit` to non-privileged
  seats.
