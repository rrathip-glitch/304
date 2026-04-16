#!/usr/bin/env bash
# scripts/orchestrate.sh — lane-lock + sync helper for the 304 soul project.
#
# Subcommands:
#   sync                  git fetch + rebase pull current branch
#   status                print JSON summary of all lanes
#   board                 print markdown table of all lanes (paste-friendly)
#   claim  <LANE> "task"  create/overwrite .locks/<LANE>.json as CLAIMED, commit, push
#   heartbeat [LANE]      refresh heartbeat_utc on your lane, sync, push
#   release <LANE> --status DONE|WIP|RELEASED --summary "..."
#                         update status + commit + push
#   prune   <LANE> "reason"   L0-only: mark a stale lock FREE, commit, push
#   init                  seed .locks/ with FREE entries for L0..L7 if missing
#
# All subcommands are idempotent and safe to call repeatedly.
# Requires: bash, git, node (already a project dep).

set -euo pipefail

LANES=(L0 L1 L2 L3 L4 L5 L6 L7)
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || { echo "not in a git repo" >&2; exit 2; })"
cd "$repo_root"
branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

mkdir -p .locks

now_iso() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }

# session_id: Claude Code exposes CLAUDE_SESSION_ID or similar; fall back.
session_id() {
  echo "${CLAUDE_SESSION_ID:-${CLAUDE_CODE_SESSION_ID:-$(git config user.email 2>/dev/null || echo "anon")-$(date +%s)}}"
}
agent_label() { echo "${CLAUDE_MODEL:-Claude}"; }

valid_lane() {
  local l="$1"
  for L in "${LANES[@]}"; do
    [ "$l" = "$L" ] && return 0
  done
  return 1
}

sync_branch() {
  if ! git remote get-url origin >/dev/null 2>&1; then
    echo "[orch] no origin remote; skipping sync"
    return 0
  fi
  if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
    echo "[orch] detached HEAD; skipping sync"
    return 0
  fi
  git fetch --quiet origin "$branch" 2>/dev/null || \
    echo "[orch] fetch failed (offline?); continuing"
  if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    git pull --rebase --autostash --quiet origin "$branch" || {
      echo "[orch] pull --rebase failed. Resolve conflicts manually." >&2
      return 1
    }
  fi
}

push_with_retry() {
  local tries=0
  local delays=(2 4 8 16)
  while :; do
    if git push -u origin "$branch" 2>&1; then
      return 0
    fi
    if [ $tries -ge ${#delays[@]} ]; then
      echo "[orch] push failed after retries" >&2
      return 1
    fi
    local d=${delays[$tries]}
    echo "[orch] push failed; retry in ${d}s ..." >&2
    sleep "$d"
    tries=$((tries + 1))
  done
}

write_lock() {
  # args: lane status task touches_json notes
  local lane="$1" status="$2" task="$3" touches_json="${4:-[]}" notes="${5:-}"
  local sid agent ts file
  sid="$(session_id)"
  agent="$(agent_label)"
  ts="$(now_iso)"
  file=".locks/${lane}.json"
  # Preserve started_utc if the holder matches.
  local started="$ts"
  if [ -f "$file" ]; then
    local prev_started prev_sid
    prev_started=$(node -e '
      try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).started_utc || ""); } catch(_){}
    ' "$file")
    prev_sid=$(node -e '
      try { console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).session_id || ""); } catch(_){}
    ' "$file")
    if [ "$prev_sid" = "$sid" ] && [ -n "$prev_started" ]; then
      started="$prev_started"
    fi
  fi
  node -e '
    const fs = require("fs");
    const [file, lane, status, sid, agent, started, ts, task, touches, notes] = process.argv.slice(1);
    const body = {
      lane, status,
      session_id: sid,
      agent,
      started_utc: started,
      heartbeat_utc: ts,
      task,
      touches: JSON.parse(touches || "[]"),
      notes
    };
    fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  ' "$file" "$lane" "$status" "$sid" "$agent" "$started" "$ts" "$task" "$touches_json" "$notes"
}

cmd_sync() { sync_branch; }

cmd_status() {
  node -e '
    const fs = require("fs");
    const out = [];
    for (const f of fs.readdirSync(".locks")) {
      if (!f.endsWith(".json")) continue;
      try { out.push(JSON.parse(fs.readFileSync(`.locks/${f}`, "utf8"))); } catch(_) {}
    }
    out.sort((a,b) => (a.lane||"").localeCompare(b.lane||""));
    console.log(JSON.stringify(out, null, 2));
  '
}

cmd_board() {
  node -e '
    const fs = require("fs");
    const now = Date.now();
    const rows = [];
    for (const f of fs.readdirSync(".locks")) {
      if (!f.endsWith(".json")) continue;
      try { rows.push(JSON.parse(fs.readFileSync(`.locks/${f}`, "utf8"))); } catch(_) {}
    }
    rows.sort((a,b) => (a.lane||"").localeCompare(b.lane||""));
    console.log("| Lane | Status | Holder | Task | Heartbeat (min ago) |");
    console.log("|------|--------|--------|------|---------------------|");
    for (const r of rows) {
      const hb = r.heartbeat_utc ? Math.round((now - Date.parse(r.heartbeat_utc))/60000) : "-";
      const holder = r.status === "FREE" ? "—" : (r.session_id || "?");
      const task = (r.task || "").replace(/\|/g, "\\|").slice(0,60);
      console.log(`| ${r.lane} | ${r.status} | ${holder} | ${task} | ${hb} |`);
    }
  '
}

cmd_claim() {
  local lane="${1:-}" task="${2:-}"
  valid_lane "$lane" || { echo "invalid lane: $lane (use L0..L7)" >&2; exit 2; }
  [ -n "$task" ] || { echo "usage: orchestrate.sh claim <LANE> \"<task>\"" >&2; exit 2; }
  sync_branch
  # Block if another active session holds the lane.
  if [ -f ".locks/${lane}.json" ]; then
    local cur_status cur_sid
    cur_status=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status||"")}catch(_){}' ".locks/${lane}.json")
    cur_sid=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).session_id||"")}catch(_){}' ".locks/${lane}.json")
    if { [ "$cur_status" = "CLAIMED" ] || [ "$cur_status" = "WIP" ]; } && [ "$cur_sid" != "$(session_id)" ]; then
      echo "[orch] lane ${lane} is held by session ${cur_sid} (${cur_status})." >&2
      echo "       Pick a different lane or ask L0 to prune if stale." >&2
      exit 3
    fi
  fi
  write_lock "$lane" "CLAIMED" "$task" "[]" ""
  git add ".locks/${lane}.json"
  git commit -m "orch: claim ${lane} — ${task}" >/dev/null
  push_with_retry
  echo "[orch] ${lane} CLAIMED by $(session_id). Remember: heartbeat every ~10 min."
}

cmd_heartbeat() {
  local lane="${1:-}"
  # If lane omitted, heartbeat every lane this session holds.
  local sid="$(session_id)"
  local touched=0
  for f in .locks/*.json; do
    [ -f "$f" ] || continue
    local f_lane f_sid f_status f_task
    f_lane=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).lane||"")}catch(_){}' "$f")
    f_sid=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).session_id||"")}catch(_){}' "$f")
    f_status=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).status||"")}catch(_){}' "$f")
    f_task=$(node -e 'try{console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).task||"")}catch(_){}' "$f")
    if [ -n "$lane" ] && [ "$f_lane" != "$lane" ]; then continue; fi
    if [ "$f_sid" != "$sid" ]; then continue; fi
    if [ "$f_status" != "CLAIMED" ] && [ "$f_status" != "WIP" ]; then continue; fi
    # Promote CLAIMED → WIP on first heartbeat.
    local new_status="$f_status"
    [ "$f_status" = "CLAIMED" ] && new_status="WIP"
    write_lock "$f_lane" "$new_status" "$f_task" "[]" ""
    git add "$f"
    touched=1
  done
  sync_branch || true
  if [ "$touched" = "1" ]; then
    git commit -m "orch: heartbeat ${lane:-all}" >/dev/null || true
    push_with_retry || true
  fi
  cmd_board
}

cmd_release() {
  local lane="${1:-}"; shift || true
  local status="" summary=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --status) status="${2:-}"; shift 2;;
      --summary) summary="${2:-}"; shift 2;;
      *) echo "unknown arg: $1" >&2; exit 2;;
    esac
  done
  valid_lane "$lane" || { echo "invalid lane" >&2; exit 2; }
  case "$status" in DONE|WIP|RELEASED) ;; *) echo "--status must be DONE|WIP|RELEASED" >&2; exit 2;; esac
  [ -n "$summary" ] || { echo "--summary required" >&2; exit 2; }
  sync_branch || true
  write_lock "$lane" "$status" "$summary" "[]" ""
  git add ".locks/${lane}.json"
  git commit -m "orch: release ${lane} → ${status} — ${summary}" >/dev/null
  push_with_retry
  echo "[orch] ${lane} released as ${status}."
}

cmd_prune() {
  # L0-only. Reassign a stale lock back to FREE with reason recorded.
  local lane="${1:-}" reason="${2:-}"
  valid_lane "$lane" || { echo "invalid lane" >&2; exit 2; }
  [ -n "$reason" ] || { echo "usage: prune <LANE> \"reason\"" >&2; exit 2; }
  sync_branch || true
  write_lock "$lane" "FREE" "(pruned)" "[]" "$reason"
  git add ".locks/${lane}.json"
  git commit -m "orch: prune stale lock ${lane} — ${reason}" >/dev/null
  push_with_retry
  echo "[orch] ${lane} pruned."
}

cmd_init() {
  for L in "${LANES[@]}"; do
    if [ ! -f ".locks/${L}.json" ]; then
      write_lock "$L" "FREE" "(unclaimed)" "[]" ""
    fi
  done
  cmd_board
}

sub="${1:-}"
shift || true
case "$sub" in
  sync)       cmd_sync "$@" ;;
  status)     cmd_status "$@" ;;
  board)      cmd_board "$@" ;;
  claim)      cmd_claim "$@" ;;
  heartbeat)  cmd_heartbeat "$@" ;;
  release)    cmd_release "$@" ;;
  prune)      cmd_prune "$@" ;;
  init)       cmd_init "$@" ;;
  ""|help|-h|--help)
    cat <<'USAGE'
orchestrate.sh — lane-lock + sync helper

  sync                     fetch + rebase pull current branch
  status                   dump all locks as JSON
  board                    markdown table of lane status (paste-friendly)
  claim  <LANE> "<task>"   claim a lane; commits+pushes lock
  heartbeat [LANE]         refresh heartbeat_utc + sync; auto-promotes CLAIMED→WIP
  release <LANE> --status DONE|WIP|RELEASED --summary "..."
  prune   <LANE> "<reason>"   L0-only: reset a stale lock to FREE
  init                     seed .locks/ with FREE entries

Lanes: L0 Orch, L1 Engine, L2 AI, L3 Server, L4 Client, L5 Deploy, L6 QA, L7 Docs.
See COLLABORATION.md for the charter.
USAGE
    ;;
  *) echo "unknown subcommand: $sub (try --help)" >&2; exit 2 ;;
esac
