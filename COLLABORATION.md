# COLLABORATION.md

> The single entry point for any agent or human collaborating on this project.
> If you are a new AI instance, read this, then `docs/SOUL.md`.

## Repository

- Repo: `rrathip-glitch/304`
- Active branch: **`claude/mobile-game-development-GifG7`**
- Clone: `git clone <repo-url> && git checkout claude/mobile-game-development-GifG7`

## Project in One Paragraph

A mobile-first, web-hosted multiplayer implementation of the Sri Lankan card
game **304**. Two humans + two AI by default (you and your dad vs AI).
Server-authoritative Node.js + Socket.IO; vanilla HTML/CSS/JS client.
Deployed on Railway via Dockerfile. See `README.md` for user-facing intro.

## Quick Links

- **Orientation for AI agents:** [`docs/SOUL.md`](docs/SOUL.md) ← read first
- **Rules:** [`docs/RULES.md`](docs/RULES.md)
- **Architecture:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- **API:** [`docs/API.md`](docs/API.md)
- **Tasks / what's next:** [`docs/TASKS.md`](docs/TASKS.md)
- **Decisions log:** [`docs/DECISIONS.md`](docs/DECISIONS.md)
- **Testing:** [`docs/TESTING.md`](docs/TESTING.md)
- **Deployment:** [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)

## How Agents Coordinate

We operate under an **orchestrator + worker** model:

- **Orchestrator agent**: the coordinator. Reads `docs/TASKS.md` and
  `COLLABORATION.md`, decomposes work, assigns tasks to workers, reviews
  shipped commits, resolves conflicts, keeps the task list crisp.
- **Worker agent(s)**: execute one assigned task at a time end-to-end,
  ship a commit, then report back.

Protocol for every session (orchestrator or worker):

1. **Sync first**: `git fetch origin && git pull origin <branch>`. Read the
   "Current Status" section below *and* the last 20 lines of `git log`.
2. **Claim**: edit `docs/TASKS.md`. Under "Next up", mark the item you're
   taking with `[CLAIMED: <agent-id> <timestamp>]`. Push immediately so
   other agents see the claim.
3. **Scope**: one module per claim. Do not silently expand scope.
4. **Ship often**: commit and push after each module compiles or renders.
   Do NOT batch multiple modules in one commit.
5. **Check out**: after your commit, update "Current Status" here, tick
   the task in `docs/TASKS.md`, append to `docs/DECISIONS.md` if warranted,
   push.
6. **Handoff note**: if the next step has a non-obvious gotcha, append to
   the "Notes to next agent" section below.

### For the Orchestrator specifically
- Keep `docs/TASKS.md` ordered by dependency, not preference.
- When a worker pushes, review the diff before assigning the next task.
- If a worker is stuck or drifting, reassign the scope.
- Own the branch merge strategy. Workers do not rebase or force-push.

### For Workers specifically
- Do not modify `docs/TASKS.md` ordering — only claim/tick.
- Do not edit another worker's in-flight files.
- If your task turns out to be bigger than one module, stop, comment in
  `docs/TASKS.md` explaining, and let the orchestrator split it.

## Commit Cadence (enforced)

Ship files periodically, not all at once. Rule of thumb:

- After the engine module compiles → commit + push.
- After AI module → commit + push.
- After server bootstraps → commit + push.
- After HTML/CSS skeleton renders → commit + push.
- After client Socket.IO handshake works → commit + push.
- After Dockerfile builds → commit + push.

Each commit message format:
```
<scope>: <short summary>

<1-3 lines of context>

https://claude.ai/code/session_<id>
```

Scopes: `docs`, `engine`, `ai`, `server`, `client`, `deploy`, `fix`, `style`.

## Current Status

**Session `0136BhfwMDsMM6tHKFzrc2WJ` (2026-04-16, Claude Opus 4.7)**

Shipped:
- Docs suite (SOUL, RULES, ARCHITECTURE, API, TASKS, DECISIONS, TESTING,
  DEPLOYMENT, README, COLLABORATION).
- `src/engine/cards.js` — deck, ranks, points (integer ×10), compare, winningIndex.
- `src/engine/game.js` — full state machine (merged from parallel-agent branch).
- `src/engine/ai.js` — bidding + play heuristics (merged).
- `server.js` — Express + Socket.IO, room manager, view filtering, AI pacing (merged).
- `public/index.html`, `public/styles.css`, `public/cards.js`,
  `public/client.js` — mobile-first UI (merged).
- `Dockerfile`, `railway.json`, `.dockerignore` — Railway deployment.
- `scripts/smoke.js`, `scripts/soak.js`, `scripts/e2e.js` — regression tests.

Bugs fixed this session:
- `legalCardIds` returned `[]` when trump maker's hand was empty but indicator
  still held (trick 8 case).
- `handlePlay` rejected plays of the indicator when it lived outside the hand.
- `ai.choosePlayCard` ignored the indicator even when listed as the only
  legal card.
- `advanceBid4` infinite-looped when a high bidder passed after bidding.

Smoke/soak verification:
- `node scripts/soak.js 5` → 5 matches, 88 hands, all invariants hold.
- `node scripts/e2e.js` → Socket.IO handshake + AI pacing confirmed.

Next-up priority:
- Interactive hands-on test by user in the browser (mobile).
- Deploy to Railway.
- Polish UI: card reveal animations, mobile haptics.
- Implement 2nd human invite link flow.

## Contact Points for This Project

- User: @rrathip-glitch (novice programmer, primary decision-maker)
- Agent lineage: Claude Opus 4.7 via Claude Code web session

## When You Finish Your Session

1. Update the "Current Status" block above with what shipped.
2. Make sure `docs/TASKS.md` has a crisp "Next up" list.
3. `git push`.
4. Leave a message for the next agent in a `## Note to next agent` block
   at the bottom of this file if anything would save them time.

---

## Notes to Next Agent

*(Append new notes here. Oldest at top. Don't delete — they are history.)*

- **[2026-04-16]** Docs are intentionally thorough because the project is
  being handed off between AI sessions. Don't treat them as ceremony.
  Update them as rules evolve (user has already revised card values and
  betting conventions mid-session).
- **[2026-04-16]** The user's 304 has two important house variants vs
  pagat: (1) display points are /10 of classic (J=3 not 30); (2) winning
  all 8 tricks gives **5 tokens** automatically. Don't re-derive these.
