#!/usr/bin/env bash
# Install / uninstall the happy-stop-notify Claude Code Stop hook.
#
#   ./install.sh              install (copy hook + wire settings.json)
#   ./install.sh --uninstall  remove the hook and its settings.json entry
#
# What install does:
#   1. checks runtime deps (jq, perl, python3, ntfy)
#   2. copies happy-stop-notify -> $CLAUDE_DIR/bin/ (chmod 0755)
#   3. idempotently wires the Stop hook into $CLAUDE_DIR/settings.json using jq,
#      backing the file up first ($CLAUDE_DIR/settings.json.bak.<timestamp>)
#
# Honors CLAUDE_CONFIG_DIR (defaults to ~/.claude).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
BIN_DIR="$CLAUDE_DIR/bin"
SETTINGS="$CLAUDE_DIR/settings.json"
HOOK_NAME="happy-stop-notify"
HOOK_SRC="$SCRIPT_DIR/$HOOK_NAME"
HOOK_DST="$BIN_DIR/$HOOK_NAME"

die() { echo "✗ $*" >&2; exit 1; }

command -v jq >/dev/null 2>&1 || die "jq is required (needed to edit settings.json)."

backup_settings() {
  [ -f "$SETTINGS" ] || return 0
  local bak="$SETTINGS.bak.$(date +%Y%m%d%H%M%S)"
  cp "$SETTINGS" "$bak"
  echo "✓ Backed up settings -> $bak"
}

uninstall() {
  rm -f "$HOOK_DST" && echo "✓ Removed $HOOK_DST" || true
  if [ -f "$SETTINGS" ]; then
    backup_settings
    local tmp; tmp="$(mktemp)"
    jq --arg cmd "$HOOK_DST" '
      if .hooks.Stop then
        .hooks.Stop |= ( map( .hooks |= map(select(.command != $cmd)) )
                         | map(select((.hooks | length) > 0)) )
        | if (.hooks.Stop | length) == 0 then del(.hooks.Stop) else . end
      else . end
    ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
    echo "✓ Removed Stop hook entry from $SETTINGS"
  fi
  echo "Done. (deps and backups left in place)"
}

install_hook() {
  # 1. deps
  local missing=()
  for dep in jq perl python3 ntfy; do
    command -v "$dep" >/dev/null 2>&1 || missing+=("$dep")
  done
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "⚠️  Missing runtime deps: ${missing[*]}"
    echo "    jq/perl/python3 are usually preinstalled; install the ntfy CLI"
    echo "    from https://docs.ntfy.sh/ if it is listed above."
    echo "    Continuing — the hook will no-op safely until deps are present."
  fi

  # 2. copy hook
  mkdir -p "$BIN_DIR"
  install -m 0755 "$HOOK_SRC" "$HOOK_DST"
  echo "✓ Installed hook -> $HOOK_DST"

  # 3. wire settings.json (idempotent, with backup)
  mkdir -p "$CLAUDE_DIR"
  [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"
  backup_settings
  local tmp; tmp="$(mktemp)"
  jq --arg cmd "$HOOK_DST" '
    .hooks //= {}
    | .hooks.Stop //= []
    | if ([.hooks.Stop[]?.hooks[]? | select(.type=="command" and .command==$cmd)] | length) > 0
      then .                                                   # already wired
      else .hooks.Stop += [ { "hooks": [ { "type":"command", "command":$cmd } ] } ]
      end
  ' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "✓ Wired Stop hook into $SETTINGS"

  echo
  echo "Done. Notifications go to: ${HAPPY_STOP_NOTIFY_TOPIC:-ntfy.zmddg.com/claude}"
  echo "Override per-machine by exporting HAPPY_STOP_NOTIFY_TOPIC in your shell profile."
}

case "${1:-}" in
  --uninstall|-u) uninstall ;;
  ""|--install)   install_hook ;;
  *) die "Unknown argument: $1 (use --install or --uninstall)" ;;
esac
