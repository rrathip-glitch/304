#!/usr/bin/env bash
# SessionStart hook for the 304 soul project.
#
# Every Claude Code instance that opens this repo runs this on boot. It:
#   1. Prints the soul-project north star + lane board.
#   2. Syncs git (fetch + rebase pull) so the session never starts stale.
#   3. Flags stale locks (no heartbeat > 30 min).
#
# Exit 0 always — this hook is informational; it should never block a session
# from starting. Errors are surfaced as warnings so the agent can decide.

set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [ -z "$repo_root" ]; then
  echo "[orch] Not inside a git repo; skipping sync."
  exit 0
fi
cd "$repo_root"

branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

printf '\n'
printf '=== 304 Soul Project — Session Boot ===\n'
printf 'North star: ship a mobile-first, Railway-hosted multiplayer 304\n'
printf 'Read order : docs/SOUL.md -> COLLABORATION.md -> docs/TASKS.md\n'
printf 'Branch     : %s\n' "${branch:-<detached>}"
printf '\n'

# --- Sync ---------------------------------------------------------------
if git remote get-url origin >/dev/null 2>&1; then
  printf '[orch] git fetch --all --prune ...\n'
  if ! git fetch --all --prune --quiet 2>&1; then
    printf '[orch] WARN: fetch failed; continuing offline.\n'
  fi

  if [ -n "$branch" ] && [ "$branch" != "HEAD" ]; then
    if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      printf '[orch] git pull --rebase --autostash origin %s ...\n' "$branch"
      if ! git pull --rebase --autostash --quiet origin "$branch" 2>&1; then
        printf '[orch] WARN: pull failed (conflict or network). Resolve before editing.\n'
      fi
    else
      printf '[orch] Branch %s has no upstream yet; first push will create it.\n' "$branch"
    fi
  fi
else
  printf '[orch] No origin remote; skipping sync.\n'
fi

printf '\n'

# --- Lane board ---------------------------------------------------------
if [ -x scripts/orchestrate.sh ]; then
  bash scripts/orchestrate.sh board || true
else
  printf '[orch] scripts/orchestrate.sh not executable; lane board unavailable.\n'
fi

# --- Stale-lock detection ----------------------------------------------
if [ -d .locks ] && command -v node >/dev/null 2>&1; then
  node - <<'NODE' || true
const fs = require('fs');
const path = '.locks';
const now = Date.now();
const STALE_MS = 30 * 60 * 1000;
let stale = [];
for (const f of fs.readdirSync(path)) {
  if (!f.endsWith('.json')) continue;
  try {
    const raw = JSON.parse(fs.readFileSync(`${path}/${f}`, 'utf8'));
    if (!raw.heartbeat_utc) continue;
    if (raw.status === 'DONE' || raw.status === 'FREE' || raw.status === 'RELEASED') continue;
    const hb = Date.parse(raw.heartbeat_utc);
    if (Number.isFinite(hb) && (now - hb) > STALE_MS) {
      stale.push({ lane: raw.lane || f.replace('.json',''), age_min: Math.round((now - hb)/60000), holder: raw.session_id });
    }
  } catch (_) {}
}
if (stale.length) {
  console.log('');
  console.log('[orch] STALE LOCKS (no heartbeat > 30 min):');
  for (const s of stale) {
    console.log(`  - ${s.lane}: ${s.age_min} min stale, holder=${s.holder}`);
  }
  console.log('[orch] If you are L0 (orchestrator), consider pruning with:');
  console.log('       scripts/orchestrate.sh prune <LANE> "reason"');
}
NODE
fi

printf '\n[orch] Boot complete. Claim your lane before editing:\n'
printf '       scripts/orchestrate.sh claim <L1..L7> "<task>"\n\n'

exit 0
