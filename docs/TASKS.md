# TASKS — 304 Implementation Tracker

> This file is the canonical "what's next". Update it at the end of every
> session. The "Next up" section should always be actionable from a cold read.

## Done

- [x] Project skeleton (`package.json`, `.gitignore`)
- [x] Documentation suite (SOUL, RULES, ARCHITECTURE, API, TASKS, DECISIONS, TESTING)
- [x] `src/engine/cards.js` — deck, ranks, points (integer ×10 internal),
      compare, winningIndex, legalCards, displayPoints
- [x] `src/engine/game.js` — full state machine (bid4 → trump_pick1 → bid8 →
      trump_pick2? → open_choice → play → inspect → hand_end → game_over)
- [x] `src/engine/ai.js` — chooseAction with bid/pick/open/play heuristics
- [x] `server.js` — Express + Socket.IO room manager with AI pacing
- [x] `public/` — vanilla HTML/CSS/JS client (landing, lobby, table)
- [x] `Dockerfile`, `railway.json`, `.dockerignore` — Railway deployment

## Done in v2.0.0 (2026-04-17)

- [x] **Cutting mechanic** — explicit UX (banner prompt, cutter seat tag,
      maker private peek, "CUT!" reveal, indicator returns to hand,
      cutting team leads next trick).
- [x] **Trump indicator selectable** — rendered as a tappable card in the
      `YOUR TRUMP` row when its id appears in `legalActions.cardIds`.
      Fixes the dead-screen failure mode where the maker had only the
      indicator left.
- [x] **Responsive layout** — `clamp()` card sizes, `100dvh`,
      `env(safe-area-inset-*)`, vertical-stack overflow cap, short-screen
      media query. Resolves all five layout regressions visible in the
      reference screenshots.
- [x] **Standard semver** — `2.0.0`. Single source of truth in
      `package.json`; `server.js`, `index.html`, and `client.js` read or
      reference it.
- [x] **Regression tests** — `scripts/layout-smoke.js` (22 assertions on
      CSS/HTML/JS structure), `scripts/cut-test.js` (24 engine assertions
      across three cut scenarios). All five test scripts green.

## Next up

**Start here if you are a fresh instance:**

1. **Visual diff harness.** layout-smoke proves the *rules* exist; a
   Playwright/Puppeteer suite that snapshots the table at each reference
   viewport (iPhone SE, 14 Pro, Pixel 7, iPad mini, landscape phone) would
   catch *visual* regressions the same way. ~50 LOC + a single
   devDependency.
2. **Invite-link flow for 2nd human.** Add a share button on the lobby
   that copies `https://<domain>/?room=ABCDEF&name=Dad`; client
   auto-joins on load.
3. **Polish:** card deal animation, trick collection animation, sound
   effects (card play, trick won, token transfer).
4. **PCC (Partner Close Caps)** 3-player mechanics — currently deferred;
   see `docs/RULES.md#partner-close-caps-pcc`.

## Verification status

Run the full test suite from the repo root:

```bash
node scripts/layout-smoke.js    # 22 structural assertions
node scripts/cut-test.js        # 24 engine assertions, 3 scenarios
node scripts/smoke.js           # one full 4-AI match
node scripts/soak.js 5          # 5 matches; token invariant
node scripts/e2e.js             # boots server, drives socket
```

All five passing as of v2.0.0 (commit on `claude/fix-layout-cutting-mechanic-kepuN`).

## Backlog (not blocking)

- Partner Close Caps full mechanics (bid + 3-player hand).
- Spoilt Trumps auto-detection & declaration UI.
- Caps timing penalties (Wrong Caps -2, Losing after Caps -5). House rule
  "all 8 tricks = 5 tokens automatic" is the v1+v2 substitute.
- Reconnection persistence across server restart (needs a KV store).
- Visual snapshot harness (Playwright).
- Animations: dealing, card flip on reveal, token slide.
- Chat box for humans.
- i18n (Sinhala, Tamil).

## Notes for future sessions

- Don't try to build a React-style UI. Vanilla DOM + CSS is faster and more
  readable for this scope.
- AI decision timing: 600–1200 ms delay so the human sees the action.
- The server view filter is the most bug-prone area — always double-check
  that a face-down card doesn't leak its `rank`/`suit` to non-privileged
  seats. The cutting visibility table in `docs/API.md` is the spec.
- Bump `package.json#version` whenever you ship a UI- or
  protocol-affecting change. The `?v=` cache-bust query in `index.html`
  must always match the file URL pattern; otherwise iOS Safari will serve
  the old `client.js` indefinitely.
