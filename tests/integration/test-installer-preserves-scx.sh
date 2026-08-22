#!/usr/bin/env bash
set -euo pipefail

# Verify that generic install, sync, and uninstall preserve a user-owned scx
# entry. StepCode activation remains a separate, explicit shell operation.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-installer-scx-XXXXXX)"
FAKE_BIN="$TEST_ROOT/bin"
TMP_ROOT="$TEST_ROOT/tmp"
HOME_DIR="$TEST_ROOT/home"
ZDOTDIR="$TEST_ROOT/zdotdir"
SCX_ALIAS="alias scx='stepcode codex --sandbox danger-full-access' # user-owned StepCode entry"

mkdir -p "$FAKE_BIN" "$TMP_ROOT" "$HOME_DIR" "$ZDOTDIR"
touch "$HOME_DIR/.bashrc" "$HOME_DIR/.bash_profile" "$ZDOTDIR/.zshrc"
printf '%s\n' "$SCX_ALIAS" > "$HOME_DIR/.bashrc"
printf '%s\n' "$SCX_ALIAS" > "$ZDOTDIR/.zshrc"

cat > "$FAKE_BIN/node" <<'FAKE_NODE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  printf 'v20.11.0\n'
fi
exit 0
FAKE_NODE

cat > "$FAKE_BIN/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
exit 0
FAKE_NPM

cat > "$FAKE_BIN/tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
if [[ "${1:-}" == "-V" ]]; then
  printf 'tmux 3.4\n'
fi
exit 0
FAKE_TMUX

chmod +x "$FAKE_BIN/node" "$FAKE_BIN/npm" "$FAKE_BIN/tmux"

export HOME="$HOME_DIR"
export ZDOTDIR
export SHELL="/bin/bash"
export TMPDIR="$TMP_ROOT"
export PATH="$FAKE_BIN:/usr/bin:/bin"

assert_scx_preserved() {
  local file="$1"
  if ! grep -Fqx "$SCX_ALIAS" "$file"; then
    echo "user-owned scx entry was not preserved in $file" >&2
    cat "$file" >&2
    exit 1
  fi
}

run_and_check() {
  local label="$1"
  shift
  local output="$TEST_ROOT/${label}.log"
  "$@" >"$output" 2>&1
  assert_scx_preserved "$HOME/.bashrc"
  assert_scx_preserved "$ZDOTDIR/.zshrc"
}

run_and_check install "$ROOT_DIR/bin/codex-hud-install"
run_and_check sync "$ROOT_DIR/bin/codex-hud-sync"
run_and_check uninstall "$ROOT_DIR/bin/codex-hud-uninstall"

echo "test-installer-preserves-scx: PASS (install=1, sync=1, uninstall=1)"
