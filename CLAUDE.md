# CLAUDE.md — auto-loaded instructions for every Claude Code instance

> This file is picked up automatically by Claude Code on every session in
> this repo. If you are a Claude instance reading this, you are part of a
> multi-agent orchestration. **Follow the protocol below before your first
> tool call.**

## What this repo is

The **304 soul project** — a mobile-first, Railway-hosted multiplayer
implementation of the Sri Lankan card game 304 that the user wants to play
with his dad.

Authoritative reading order (do not skip):

1. [`docs/SOUL.md`](docs/SOUL.md) — identity, principles, prime directive.
2. [`COLLABORATION.md`](COLLABORATION.md) — the orchestration charter.
3. [`docs/TASKS.md`](docs/TASKS.md) — what's next.
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — where things live.

## Boot ritual (auto-runs, but you should still understand it)

A `SessionStart` hook in `.claude/settings.json` runs
`.claude/hooks/session-start.sh` every time a Claude Code session opens
this repo. It will:

1. Print the north-star + reading order.
2. `git fetch --all --prune` + `git pull --rebase --autostash`.
3. Print the live lane board from `.locks/*.json`.
4. Flag any stale locks (no heartbeat > 30 min).

If the hook did **not** run (disabled, offline, unsupported runner),
manually reproduce it:

```bash
bash .claude/hooks/session-start.sh
```

## "Refresh the repo file context" — the user-facing command

When the user says **"refresh the repo"**, **"refresh the repo file
context"**, **"re-sync"**, **"pull latest"**, or any obvious variation,
you run this ritual — no other action first:

1. `bash scripts/orchestrate.sh sync`       — fetch + rebase pull current branch.
2. `bash scripts/orchestrate.sh board`      — print current lane board.
3. Re-read `COLLABORATION.md` §7 "Lane Files" and any file whose path
   appeared in commits since your last known HEAD
   (`git log --oneline <last>..HEAD` + `git diff --stat <last>..HEAD`).
4. Re-read `docs/TASKS.md` "Next up" block.
5. If you hold a lane lock (`.locks/<LANE>.json` whose `session_id`
   matches yours), run `bash scripts/orchestrate.sh heartbeat` to refresh
   your claim's `heartbeat_utc` and surface any concurrent edits.
6. Summarize back to the user in ≤5 lines: what changed since your last
   snapshot, who holds which lane, whether any stale locks need L0's
   attention, and what you will do next.

There is also a slash command: **`/refresh`** — invoking the skill in
`.claude/commands/refresh.md` runs exactly the above. Prefer the slash
command when the user types `/refresh`.

## Before you edit code

1. **Claim a lane** — `bash scripts/orchestrate.sh claim <L1..L7> "<task>"`.
   This writes `.locks/<LANE>.json` and pushes it immediately so other
   sessions see the lock.
2. **Stay in your lane** — the lanes and their owner files are defined in
   `COLLABORATION.md` §3. Cross-boundary edits must be noted in the lock's
   `notes` field.
3. **Heartbeat every ~10 min** — `bash scripts/orchestrate.sh heartbeat`.
   This pulls+rebases first, so you see concurrent work early.
4. **Commit in slices** — follow `COLLABORATION.md` §6 commit cadence.

## Before you stop

Release your lane:

```bash
bash scripts/orchestrate.sh release <LANE> --status DONE|WIP|RELEASED \
     --summary "one-line summary of what shipped or why you stopped"
```

The `Stop` hook will remind you if you forget.

## Non-negotiables

- Never `git push --force`, `--no-verify`, `--no-gpg-sign`. Denied in
  `.claude/settings.json`.
- Never edit another agent's lock file. Only lane **L0** may prune a stale
  lock, and only with a reason recorded.
- Never bypass the SessionStart hook. If it misbehaves, fix it in an
  `orch:` commit.
- The user is the rules authority for 304. If a doc conflicts with a user
  message, the user wins and the doc is updated in the same session.

## Useful one-liners

```bash
# See who holds what.
bash scripts/orchestrate.sh board

# See the full JSON for every lane.
bash scripts/orchestrate.sh status

# Seed .locks/ on a fresh clone (idempotent).
bash scripts/orchestrate.sh init

# Prune a stale lock (L0 only).
bash scripts/orchestrate.sh prune <LANE> "reason"
```

When in doubt, read `COLLABORATION.md` end-to-end. It is short on
purpose.
