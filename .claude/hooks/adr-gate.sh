#!/usr/bin/env bash
# ADR gate: blocks any `git commit` launched through Claude Code's Bash tool
# whose message does not carry an `ADR-Reviewed:` trailer.
# Wired as a PreToolUse hook (Bash matcher) in .claude/settings.json — the
# expected ADR pass is described in CLAUDE.md ("Mandatory ADR pass before every commit").
set -euo pipefail

cmd=$(jq -r '.tool_input.command // empty')

# Only commits are concerned; everything else passes silently.
case "$cmd" in
  *"git commit"*) ;;
  *) exit 0 ;;
esac

# The commit message (heredoc included) is part of the command string,
# so the trailer check runs on the command text itself.
if printf '%s' "$cmd" | grep -q 'ADR-Reviewed:'; then
  exit 0
fi

cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Commit blocked by the ADR gate: the message has no 'ADR-Reviewed:' trailer. Do the ADR pass: compare the staged diff (git diff --cached) against the ADRs in docs/adr/, create a new ADR (Nygard format) for any new architecture decision, mark 'Superseded by ADR-XXXX' any ADR made obsolete, update the index docs/adr/README.md, then add an 'ADR-Reviewed: <what was checked / created / superseded>' trailer to the message — or 'ADR-Reviewed: none — no architectural decision touched.'"}}
JSON
exit 0
