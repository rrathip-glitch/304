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

This file is the bulletin board. When multiple agents may touch the code,
each session should:

1. **Check in** by reading the "Current Status" section below.
2. **Claim** a task by adding your name/session ID next to an item in
   `docs/TASKS.md` under "Next up".
3. **Ship often.** Commit and push after each major module (engine, AI,
   server, each client file, deployment config) — do NOT batch.
4. **Check out** by updating "Current Status" here, updating `docs/TASKS.md`,
   appending to `docs/DECISIONS.md` if you made a notable choice, and
   pushing.

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
- Docs suite (SOUL, RULES, ARCHITECTURE, API, TASKS, DECISIONS, TESTING, DEPLOYMENT, README).
- `src/engine/cards.js` — deck, ranks, points (integer ×10), compare, winningIndex.

In progress:
- `src/engine/game.js` — state machine.

Pending:
- `src/engine/ai.js`
- `server.js`
- `public/index.html`, `public/styles.css`, `public/client.js`, `public/cards.js`
- `Dockerfile`, `railway.json`
- Local smoke test + Railway deploy.

Next-up priority: complete `game.js`, ship it, then AI + server in parallel,
then client, then deploy.

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
