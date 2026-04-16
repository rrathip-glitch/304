# COLLABORATION.md — Orchestration Charter

> Single source of truth for how agents and humans **divide labor, stay
> synchronized, and hand off** to complete the goals in
> [`docs/SOUL.md`](docs/SOUL.md). If `docs/SOUL.md` is the *why* and
> `docs/TASKS.md` is the *what*, this file is the **how we work together**.
> It is binding on every session — human or AI.

Fresh agents read in this order: `docs/SOUL.md` → this file → `docs/TASKS.md`
→ `docs/ARCHITECTURE.md`. Do not touch code without completing this reading.

---

## 0. The Prime Directive for Collaboration

**Pull before you think. Push before you stop. Claim before you type.**

Every instance that opens this repo — whether it's a Claude Code CLI
session, a Claude Code web session, an IDE extension, or a human — runs the
same synchronization ritual. The ritual is automated by a
[`SessionStart` hook](./.claude/settings.json) so the default is "already
correct." Do not disable the hook.

## 1. Soul Project Goal (north star)

Ship a **mobile-first, Railway-hosted, shareable-link multiplayer 304** that
the user can play with his dad tonight. Every rule here exists to serve that
goal. If a rule gets in the way, fix the rule in the same session you
notice it.

Success = the user opens a phone, taps the URL, creates a room, sends the
link to his dad, and they play a full match (first team to 22 tokens) against
two AI with no visible bugs.

## 2. Coordination Principles

1. **One writer per file at a time.** Claim in `.locks/` before editing (§5).
2. **Pull every 10 minutes, at minimum.** The SessionStart hook pulls on
   boot; `scripts/orchestrate.sh sync` pulls mid-session. Long sessions must
   re-sync before every push.
3. **Ship in slices, not suites.** Each slice is a committable, pushable
   increment that leaves the branch runnable or clearly flagged WIP.
4. **Server-authoritative invariants never regress.** A client-side change
   must not require weakening `src/engine/*`.
5. **Docs track code in the same commit.** If behavior changed, the relevant
   doc (`RULES.md`, `API.md`, `ARCHITECTURE.md`, `DECISIONS.md`, `TASKS.md`)
   changes in the same push.
6. **The user is the tiebreaker.** When two agents' assumptions conflict,
   stop and ask; never pick a side silently.

## 3. Labor Division — Lanes & Ownership

Each lane has a primary scope, an owner file set, and a "done" bar. One
session = one active lane. Pick based on blockers (§4) and record the claim
in `.locks/<LANE>.json` (§5).

| Lane | Scope | Owner files | Done = |
|------|-------|-------------|--------|
| **L1 Engine**  | Rules, state machine, legal moves | `src/engine/cards.js`, `src/engine/game.js` | Full hand simulable in Node REPL; all phases reachable; no throws |
| **L2 AI**      | Bot bidding + play heuristics     | `src/engine/ai.js`                           | `ai.chooseAction` returns a legal action in every phase over 100 simulated hands |
| **L3 Server**  | HTTP, Socket.IO, room manager     | `server.js`, static mount of `public/`       | Two browsers on a LAN receive correctly filtered views per `docs/API.md` |
| **L4 Client**  | UI, rendering, input              | `public/index.html`, `public/styles.css`, `public/client.js`, `public/cards.js` | A human completes a full hand on 375×812 with no console errors |
| **L5 Deploy**  | Railway, Dockerfile, env          | `Dockerfile`, `railway.json`, deploy notes   | `docker build` passes locally; Railway URL reachable |
| **L6 QA**      | Test scenarios, reproductions     | `docs/TESTING.md`, ad-hoc repro scripts      | Every scenario has a pass/fail at current HEAD |
| **L7 Docs**    | Cross-cutting doc hygiene         | `docs/*.md`, `README.md`, this file          | No stale links; `TASKS.md` "Next up" actionable from a cold read |
| **L0 Orch**    | Prime orchestrator (this lane)    | `.claude/`, `scripts/orchestrate.sh`, `.locks/`, this file | Hooks green; no stale locks; all other lanes have a clear next step |

**Boundary rules**

- Cross-lane edits require a note in the lock file (`notes:` field).
- `docs/SOUL.md` and this file are L7/L0-only; other lanes must not drift
  principles in passing.
- `docs/TASKS.md` is writable by every lane — updating it is part of every
  lane's done bar.
- **Only L0 prunes stale locks.** Other lanes never delete another lane's
  lock; they flag it in §9 "Notes to Next Agent."

## 4. Dependency Graph & Critical Path

```
            L1 Engine ──► L2 AI ──┐
                  │               ├──► L3 Server ──► L4 Client ──► L5 Deploy
                  └───────────────┘                         │
                                                            └──► L6 QA (continuous)
                                        L7 Docs (continuous, every lane touches)
                                L0 Orch (continuous — sync, reconcile, heartbeat)
```

**Blocking rules**

- L2 cannot ship without L1's `legalActions` and `applyAction` stable.
- L3 cannot ship a phase it can't drive via L1; stub phases return a clear
  `phase not implemented` error rather than fake success.
- L4 renders only fields defined in `docs/API.md#PlayerView`. If the client
  needs a new field, open it in `API.md` first (L7) then implement in L3.
- L5 is gated on L3 + L4 running together locally for one full hand.

**Safe parallelism**

- L1 and L7 in the same session.
- L2 and L4 once L1 is frozen for the phase they depend on.
- L6 runs continuously; a QA pass after any L1/L2/L3 change is always welcome.

## 5. Synchronization Protocol — the five-step loop

Every session executes these five steps. Skipping any of them is a defect.
The loop runs once at start, then re-enters at step 2 every ~10 minutes
(use the [`/loop`](#loop-mode-for-long-sessions) skill for long work).

### Step 1 — Boot & Pull
Handled automatically by `.claude/settings.json` SessionStart hook, which:
1. Prints the current lane board.
2. Runs `git fetch --all --prune`.
3. Runs `git pull --rebase --autostash origin <branch>`.
4. Prints lock status and any stale claims (older than 30 min without
   heartbeat).
5. Emits a human-readable summary to the session.

If the hook fails (network, conflict), stop and resolve before coding. Do
not bypass.

**Mid-session re-sync:** when the user says "refresh the repo", "refresh
the repo file context", "re-sync", or "pull latest", run the `/refresh`
slash command (see `.claude/commands/refresh.md`). It performs the same
ritual and produces a ≤5-line summary of what changed, who holds what,
and the single most impactful next action. See also `CLAUDE.md` which
every Claude Code instance auto-loads at session start.

### Step 2 — Claim
Before your first edit, create or update `.locks/<LANE>.json`:

```json
{
  "lane": "L1",
  "status": "CLAIMED",
  "session_id": "<your Claude Code session id>",
  "agent": "Claude Opus 4.7",
  "started_utc": "2026-04-16T18:45:00Z",
  "heartbeat_utc": "2026-04-16T18:45:00Z",
  "task": "src/engine/game.js — bid4 → trump_pick1 phases",
  "touches": ["src/engine/game.js", "docs/TASKS.md"],
  "notes": ""
}
```

Commit and push the lock file **before** editing source. That push is how
other instances see the lock.

Helper: `scripts/orchestrate.sh claim L1 "task description"` writes the
lock, commits, and pushes in one shot.

### Step 3 — Work + heartbeat
- Keep the claim scoped to one lane (§3 boundary rules).
- Every ~10 minutes run `scripts/orchestrate.sh heartbeat` — it updates
  `heartbeat_utc` and `git pull --rebase`s, surfacing any concurrent work
  before you have a merge conflict.
- Commit after each module per the cadence in §6.

### Step 4 — Verify (lane done-bar)
Before handoff, exercise the done-bar for your lane (§3 table). Record the
result in `docs/TESTING.md` even if it's "manually ran `node -e ...`, saw
expected output." Unverified work does not ship.

### Step 5 — Release & Handoff
In your last commit:
1. `scripts/orchestrate.sh release L1 --status DONE --summary "…"`
   updates the lock file status to `DONE` (or `WIP`, or `RELEASED`).
2. Update `docs/TASKS.md` — tick done items, surface discovered work,
   refresh "Next up".
3. Append to `docs/DECISIONS.md` if you made a non-obvious call.
4. If you learned a rule from the user, update `docs/RULES.md` in the same
   commit.
5. Leave a `## Note to next agent` entry in §9 if anything will save the
   next session time.
6. `git push` (retry on network per §10).

## 6. Commit Cadence (enforced)

Ship after each cohesive slice — never batch a whole feature into one
commit. Minimum slicing:

- After `src/engine/cards.js` → commit + push.
- After each phase group in `src/engine/game.js` (`bid4`, `trump_pick*`,
  `open_choice`, `play`, `inspect`, `hand_end`) → commit + push.
- After `src/engine/ai.js` bidding, then after play heuristic → two commits.
- After `server.js` bootstraps → commit + push.
- After each `public/*` file is minimally functional → commit + push.
- After `Dockerfile` builds locally → commit + push.
- After Railway deploy succeeds → commit + push (update `docs/DEPLOYMENT.md`).

**Commit message format**

```
<scope>: <imperative short summary>

<1–3 lines of why / what this unblocks>

https://claude.ai/code/session_<id>
```

Scopes: `docs`, `engine`, `ai`, `server`, `client`, `deploy`, `fix`,
`style`, `collab` (this file), `orch` (lock/hook/script changes).

## 7. Lock Files (`.locks/`) — machine-readable claim manifest

- One file per lane: `.locks/L1.json` … `.locks/L7.json`, plus `.locks/L0.json`
  for the prime orchestrator.
- `status`: `FREE` | `CLAIMED` | `WIP` | `DONE` | `RELEASED`.
- `heartbeat_utc` is updated every ≤10 min by the holder. A lock with no
  heartbeat for **30 minutes** is considered stale and may be pruned by L0.
- On `DONE`, the lock stays in the repo as history; the next claim on that
  lane overwrites it.
- The script `scripts/orchestrate.sh status` prints a human-readable view;
  `scripts/orchestrate.sh board` renders a markdown table you can paste
  into chat.

**Never edit another agent's lock** except L0, which may prune a stale one
with reason recorded in `notes:` and a commit message starting with
`orch: prune stale lock L<n>`.

## 8. Milestone Gates

A milestone is reached only when **every** acceptance item passes. Record
the pass in `docs/TASKS.md` "Done" with the commit SHA.

### M1 — Engine playable in REPL
- `createGame() → seatPlayer ×4 → startHand → full bid → play 8 tricks →
  hand_end` returns a final `GameState` with updated tokens and no thrown
  errors.
- `viewFor(state, seat)` never exposes another seat's `hand` or the closed
  `trumpIndicator`.

### M2 — AI completes a hand
- Four AI seats finish a hand end-to-end via repeated
  `ai.chooseAction`. No illegal moves over 100 simulated hands.

### M3 — Two browsers, one room
- Two devices connected to a room; each sees only its own hand; AI fills
  seats 1 and 3; one full hand completes.

### M4 — Mobile polish
- On 375×812 viewport: tap targets ≥ 40px, no horizontal scroll, cards
  readable without zoom, trick area shows all four played cards.

### M5 — Railway live
- Public URL reachable; `docs/DEPLOYMENT.md` reflects actual steps; cold
  start < 10s.

### M6 — Match-ready with dad
- First-to-22 match played end-to-end with AI partners. User signs off.
  This is the soul project definition of done.

## 9. Notes to Next Agent

*(Append new notes at the bottom. Oldest first. Never delete — history.)*

- **[2026-04-16]** Docs are intentionally thorough because the project is
  handed off between AI sessions. Treat them as tools, not ceremony.
- **[2026-04-16]** User's 304 has two house variants vs pagat: (1) display
  points are /10 of classic (J=3 not 30); (2) winning all 8 tricks gives
  **5 tokens** automatically. Don't re-derive these.
- **[2026-04-16]** COLLABORATION.md upgraded from bulletin board → charter
  with lanes, `.locks/` machine-readable claims, and a SessionStart hook
  that enforces `git pull` before every session. The prior "Current
  Status" block is superseded by `.locks/*.json` + `scripts/orchestrate.sh
  board`. First thing any new session sees is the board, printed by the
  hook. **Do not disable the hook.**
- **[2026-04-16]** Next session: pick up L1 (engine `game.js`). Run
  `scripts/orchestrate.sh claim L1 "game.js phases"` before editing.

## 10. Operational Details

### Git push retries
On push failure due to network, retry up to 4×: 2s, 4s, 8s, 16s backoff.
Do not `--force` without explicit user permission; never `--no-verify`.

### Loop mode for long sessions
Long-running sessions (> 30 min) should invoke the `/loop` skill with
`/loop 10m scripts/orchestrate.sh heartbeat` so heartbeat + pull happen
automatically. Stop the loop before the final `release` step.

### PR coordination (optional)
If the user opts into PR-based review, each lane opens one PR per
milestone. The orchestrator subscribes with
`mcp__github__subscribe_pr_activity` so CI failures and review comments
are surfaced in-session.

### Conflict resolution
1. Re-pull with `--rebase`.
2. If the conflict is in a lock file, the owner (by `session_id`) wins.
3. If the conflict is in code, resolve in favor of the lane that holds
   the file per §3; escalate to user if ambiguous.
4. Never resolve by discarding another agent's work blindly.

### Hooks you can trust
See `.claude/settings.json`. Currently registered:
- `SessionStart` → pull, print board, warn on stale locks.
- `PreToolUse(Bash:git push*)` → re-pull immediately before push.
- `Stop` → reminder to release lock and push if a claim is still
  `CLAIMED` or `WIP`.

If a hook misbehaves, fix it in a `orch:` commit — don't disable it.
