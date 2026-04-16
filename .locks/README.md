# `.locks/` — machine-readable lane claims

This directory is the source of truth for **who is working on what**. Every
Claude Code instance (and every human contributor) writes a file here before
editing code, and updates it on a heartbeat until release.

## Why this exists

`COLLABORATION.md` describes the charter; `.locks/*.json` *enforces* it. The
`SessionStart` hook in `.claude/settings.json` reads these files on every
boot and prints the board. The `orchestrate.sh` helper is the only
tool you should use to mutate them.

## File format (`L<n>.json`)

```json
{
  "lane": "L1",
  "status": "CLAIMED | WIP | DONE | RELEASED | FREE",
  "session_id": "<Claude Code session id or human handle>",
  "agent": "Claude Opus 4.7",
  "started_utc": "2026-04-16T18:45:00Z",
  "heartbeat_utc": "2026-04-16T19:05:00Z",
  "task": "human-readable what-you-are-doing",
  "touches": ["src/engine/game.js", "docs/TASKS.md"],
  "notes": ""
}
```

- `status` transitions: `FREE → CLAIMED → WIP → DONE` (normal path),
  or `→ RELEASED` if abandoned, or `→ FREE` if L0 pruned it.
- `heartbeat_utc` must be refreshed every ≤10 minutes while `WIP`. Locks
  with no heartbeat > 30 min are considered stale.
- `touches` is advisory; it helps other lanes spot cross-file collisions
  before they commit.

## How to use it (copy-paste)

```bash
# Start a session: sync + see who is doing what.
bash scripts/orchestrate.sh sync
bash scripts/orchestrate.sh board

# Claim a lane.
bash scripts/orchestrate.sh claim L1 "engine game.js bid4 → play phases"

# Every ~10 minutes while working.
bash scripts/orchestrate.sh heartbeat

# When you stop.
bash scripts/orchestrate.sh release L1 --status DONE \
  --summary "bid4, trump_pick1, bid8, play, hand_end all pass repl smoke"
```

## Rules

1. **Never edit another lane's lock directly.** Only L0 may `prune`, and
   only with a reason.
2. **One lane per session.** Hold multiple only if explicitly cross-cutting
   (e.g., L7 + L1 for a doc+code commit) and record it in `notes`.
3. **Release before you stop.** The Stop hook will remind you if you don't.
4. **Heartbeat is pull-then-write.** `orchestrate.sh heartbeat` rebases
   from origin first, so a conflicting push from another agent surfaces
   before you go further.

See `COLLABORATION.md` for the full charter.
