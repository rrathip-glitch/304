---
description: Re-sync the repo, re-read charter + tasks, refresh the lane board, and summarize what changed since the session's last snapshot.
allowed-tools: Bash(bash scripts/orchestrate.sh:*), Bash(git:*), Read, Grep, Glob
---

You have been asked to refresh your view of this repo. Run the "refresh the
repo file context" ritual exactly as defined in `CLAUDE.md` and
`COLLABORATION.md` §5 / §10:

1. **Sync**: run `bash scripts/orchestrate.sh sync` — this does
   `git fetch --all --prune` followed by `git pull --rebase --autostash`
   on the current branch. Abort and surface the error if the rebase fails.
2. **Identify delta**: capture the previous HEAD before sync. After sync,
   run `git log --oneline <prev>..HEAD` and `git diff --stat <prev>..HEAD`
   to see exactly what changed.
3. **Re-read key files** (use parallel Read calls):
   - `COLLABORATION.md`
   - `docs/TASKS.md`
   - any file whose path appeared in step 2's diff stat
4. **Lane board**: `bash scripts/orchestrate.sh board`.
5. **Heartbeat if held**: if any `.locks/*.json` has a `session_id`
   matching this session, run `bash scripts/orchestrate.sh heartbeat`.
6. **Summarize to the user** in ≤5 lines:
   - commits pulled (count + one-line description of the most recent 2–3),
   - lane board deltas (who claimed/released since last snapshot),
   - any stale locks (heartbeat > 30 min),
   - the single most impactful "next action" based on `docs/TASKS.md`
     "Next up" plus current lane holdings,
   - whether you are ready to proceed or need the user to choose a lane.

Do **not** modify code or docs in a `/refresh` invocation — it is a
read-only synchronization step. Any mutation (claim, heartbeat write,
release) must be via the explicit `orchestrate.sh` verbs listed above.

If the user piped arguments to `/refresh` (`$ARGUMENTS`), treat them as
additional focus areas — e.g. `/refresh L3` means also open the current
`.locks/L3.json` and its `touches` files, then report specifically on L3's
state.
