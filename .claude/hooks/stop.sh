#!/usr/bin/env bash
# Stop hook for the 304 soul project.
#
# When a session ends, remind the agent to release its lane lock and push.
# This hook is advisory — it only prints to stderr; exit code is always 0.

set -u

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
if [ -z "$repo_root" ]; then
  exit 0
fi
cd "$repo_root"

# Detect any locks still in CLAIMED or WIP state.
open_locks=""
if [ -d .locks ] && command -v node >/dev/null 2>&1; then
  open_locks=$(node -e '
    const fs = require("fs");
    const out = [];
    for (const f of fs.readdirSync(".locks")) {
      if (!f.endsWith(".json")) continue;
      try {
        const j = JSON.parse(fs.readFileSync(`.locks/${f}`, "utf8"));
        if (j.status === "CLAIMED" || j.status === "WIP") {
          out.push(`${j.lane || f}: ${j.status} (session ${j.session_id || "?"})`);
        }
      } catch (_) {}
    }
    process.stdout.write(out.join("\n"));
  ' 2>/dev/null || echo "")
fi

# Detect uncommitted changes.
dirty=""
if ! git diff --quiet || ! git diff --cached --quiet; then
  dirty=1
fi
untracked="$(git ls-files --others --exclude-standard | head -5 || true)"

if [ -n "$open_locks" ] || [ -n "$dirty" ] || [ -n "$untracked" ]; then
  printf '\n[orch] Stop checklist:\n' >&2
  if [ -n "$open_locks" ]; then
    printf '  - Open lane locks (release before ending):\n' >&2
    while IFS= read -r line; do printf '      %s\n' "$line" >&2; done <<<"$open_locks"
    printf '    Fix: scripts/orchestrate.sh release <LANE> --status DONE|WIP|RELEASED --summary "..."\n' >&2
  fi
  if [ -n "$dirty" ]; then
    printf '  - Uncommitted changes present. Commit with an <scope>: message.\n' >&2
  fi
  if [ -n "$untracked" ]; then
    printf '  - Untracked files present:\n' >&2
    while IFS= read -r f; do [ -n "$f" ] && printf '      %s\n' "$f" >&2; done <<<"$untracked"
  fi
  printf '  - Finish with: git push -u origin <branch>\n\n' >&2
fi

exit 0
