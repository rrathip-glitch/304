# AGENTS.md

## Persona

You are a senior full-stack engineer extending a Sri Lankan 304 card game with a vanilla-JS mobile web client and Socket.IO backend, for a son to play with his dad.

## Stack & Versions

- **Runtime:** Node 20
- **Server:** Express 4.19, Socket.IO 4.7.5
- **Client:** Vanilla HTML / CSS / JS (no bundler, no framework)
- **Deployment:** Railway (Nixpacks auto-build on push)
- **Modules:** CommonJS (`require` / `module.exports`)

## Commands

Copy-pasteable. Run from repo root.

```bash
# Install
npm install

# Run (defaults to :3000)
node server.js

# Run on an alternate port
PORT=3456 node server.js

# Health smoke test
curl -s localhost:3000/health

# Full test suite (see docs/TESTING.md for scenarios)
node test/run.js

# Deploy: push to the tracked branch, Railway auto-builds
git push -u origin <branch>
```

No `npm run` scripts are load-bearing — call `node` directly.

## Project Structure

```
/
├── server.js             # HTTP + Socket.IO + room manager
├── src/engine/           # Pure game logic (cards, game, ai)
├── public/               # Static client (index.html, styles.css, client.js, cards.js)
├── test/run.js           # Node-driven test runner
├── docs/                 # Source of truth for rules, architecture, protocol
└── AGENTS.md             # (this file)
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for module boundaries, data flow, and the full state shape.

## Where to Start a New Session

1. Read [`docs/SOUL.md`](docs/SOUL.md) — the full boot sequence lives there; do not skip.
2. Read [`docs/TASKS.md`](docs/TASKS.md) — the "Next up" section is always actionable.
3. Skim `git log --oneline -20` to see how the last session ended.
4. Before touching code, state in one sentence what you're about to change and why.

## Code Style & Conventions

- **CommonJS modules.** No TypeScript, no build step, no transpilation.
- **2-space indent, single quotes, semicolons required.** Match the surrounding file.
- **Integer math for points.** Internal values are `POINTS[rank]` × 10 (J=30, 9=20, A=11, 10=10, K=3, Q=2). Divide by 10 only at the display layer — see `displayPoints()` in `src/engine/cards.js`. Never use float arithmetic for scoring.
- **Counter-clockwise everywhere.** `next(p) = (p + 3) % 4`. Teams are `{0,2}` vs `{1,3}`. Seat 0 is always the host.
- **Server-authoritative.** Clients send intents via the `action` Socket.IO event. They never mutate game state locally — they re-render from the `view` event broadcast by the server.
- **Mobile-first.** Every UI change must be evaluated at **375×812** before anything else. Desktop is the fallback.
- **Prefer editing over creating.** If a helper fits in an existing module, put it there.

## Git Workflow

- Work on a branch, not `main`. Current long-running branch name is recorded in `docs/SOUL.md`.
- Commit messages: explain **why**, not just **what**. One logical change per commit.
- `git push` triggers a Railway redeploy. Don't push broken builds.
- Never force-push `main`.
- Never commit with `--no-verify` to bypass hooks.

## Testing & Verification

- **Unit / integration:** `node test/run.js` must pass.
- **Manual scenarios:** walk through [`docs/TESTING.md`](docs/TESTING.md) for any change that touches the state machine, view filter, or UI.
- **UI changes:** open DevTools at 375×812 and play at least one full hand. Watch the console — `window.onerror` toasts surface runtime errors in the UI.
- **Multiplayer:** two browser tabs, one creates the room, the other joins. See [`docs/RUNBOOK.md`](docs/RUNBOOK.md#smoke-test-with-two-virtual-clients) for an automated two-client smoke script.

## Boundaries

### Always do
- Read [`docs/SOUL.md`](docs/SOUL.md) before your first action.
- Prefer editing existing files over creating new ones.
- Keep this file under ~300 lines. Link to deeper docs instead of inlining them.
- Update [`docs/TASKS.md`](docs/TASKS.md) at the end of every session — tick completed items, mark "Next up".
- Use integer math internally for card points and bids.

### Ask first
- Adding a new runtime dependency (we ship with `express` + `socket.io`, full stop).
- Changing game rules or adding a variant (rules authority is the user; update `docs/RULES.md` in the same change).
- Introducing a database, cache, or any external service.
- Deleting or renaming a file under `docs/`.

### Never do
- Add React, Vue, Svelte, or any bundler (webpack, vite, esbuild, …).
- Commit secrets, `.env` files, or credentials.
- Skip hooks with `--no-verify` or bypass signing flags.
- Force-push `main` or rewrite shared history.
- Use float arithmetic for card points or bids (`0.1 + 0.2 !== 0.3`).
- Mutate game state on the client.
- Leak hidden state: filter `hands` and closed `trumpIndicator` out of the view before broadcast.

## Documentation Index

| File | Purpose |
|------|---------|
| [`docs/SOUL.md`](docs/SOUL.md) | Agent orientation, principles, handoff ritual |
| [`docs/RULES.md`](docs/RULES.md) | Canonical 304 rules as implemented |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | File map, modules, data flow, state shape |
| [`docs/API.md`](docs/API.md) | Socket.IO event protocol |
| [`docs/TASKS.md`](docs/TASKS.md) | What's done, what's next |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Append-only ADR log |
| [`docs/TESTING.md`](docs/TESTING.md) | Manual test scenarios |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Railway specifics |
| [`docs/RUNBOOK.md`](docs/RUNBOOK.md) | Operational playbook (this one is for doing, not reading) |
| [`README.md`](README.md) | User-facing quick start |

## Known Gotchas

- **View-leak bugs** are the most common regression. A face-down card or closed trump indicator must not carry `rank` / `suit` into a non-privileged player's view.
- **Socket.IO client** is loaded from a CDN in `public/index.html` to work around Railway's static-routing of `/socket.io/socket.io.js`. Don't change it without reading `docs/DEPLOYMENT.md`.
- **AI pacing** — the server deliberately delays AI moves 600-1200ms so humans perceive the action. Don't tighten this.
- **Dealer rotation** is counter-clockwise (`dealer = (dealer + 3) % 4`), same as play direction.
- **Bid amounts** are integers, multiples of 10, minimum 160. Display divides by 10.
- Full anti-pattern list: see [`docs/SOUL.md#anti-patterns`](docs/SOUL.md#7-anti-patterns).

---

*If a rule here conflicts with a user message, the user wins — then update this file and `docs/RULES.md` in the same session.*
