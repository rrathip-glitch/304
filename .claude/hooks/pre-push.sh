#!/usr/bin/env bash
# PreToolUse(Bash) hook for the 304 soul project.
#
# Claude Code passes the pending tool call as JSON on stdin. We inspect it and
# only act when the command is `git push ...`. For a push, we re-pull first so
# the session never overwrites concurrent work from another agent.
#
# Other bash commands are passed through silently (exit 0).
#
# This hook must not block a push outright; if pull fails, it warns and lets
# the agent decide (the actual push will still fail loudly if the remote has
# diverged, which is the behavior we want).

set -u

# Read JSON payload from stdin; tolerate absence.
payload=""
if [ ! -t 0 ]; then
  payload=$(cat || true)
fi

# Extract the command field without requiring jq.
cmd=""
if [ -n "$payload" ] && command -v node >/dev/null 2>&1; then
  cmd=$(node -e '
    let data = "";
    process.stdin.on("data", c => data += c);
    process.stdin.on("end", () => {
      try {
        const j = JSON.parse(data);
        const c = (j.tool_input && j.tool_input.command) || "";
        process.stdout.write(c);
      } catch (_) {}
    });
  ' <<<"$payload")
fi

case "$cmd" in
  *"git push"*)
    repo_root="$(git rev-parse --show-toplevel 2>/dev/null || echo "")"
    [ -n "$repo_root" ] || exit 0
    cd "$repo_root"
    branch="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
    if [ -z "$branch" ] || [ "$branch" = "HEAD" ]; then
      exit 0
    fi
    printf '[orch] pre-push: syncing origin/%s before push ...\n' "$branch" >&2
    git fetch --quiet origin "$branch" 2>/dev/null || \
      printf '[orch] pre-push: fetch failed (offline?); continuing.\n' >&2
    if git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
      if ! git pull --rebase --autostash --quiet origin "$branch" 2>&1 >&2; then
        printf '[orch] pre-push: rebase pull reported issues. Resolve before pushing.\n' >&2
      fi
    fi
    ;;
  *) ;;
esac

exit 0
