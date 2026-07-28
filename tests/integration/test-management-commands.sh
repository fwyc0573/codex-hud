#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_BIN_DIR="$(mktemp -d)"
TEST_HOME="$(mktemp -d)"
LOG_DIR="$(mktemp -d)"
ZDOTDIR_DIR="$TEST_HOME/zdotdir"
MARKER="# codex-hud alias"

cleanup() {
  rm -rf "$FAKE_BIN_DIR" "$TEST_HOME" "$LOG_DIR"
}
trap cleanup EXIT

mkdir -p "$ZDOTDIR_DIR"
touch "$TEST_HOME/.bashrc" "$TEST_HOME/.bash_profile" "$ZDOTDIR_DIR/.zshrc"

cat > "$FAKE_BIN_DIR/node" <<'FAKE'
#!/usr/bin/env bash
echo "node $*" >> "$LOG_DIR/node.log"
if [[ "${1:-}" == "--version" ]]; then
  echo "v22.17.0"
  exit 0
fi
if [[ "${FAKE_NODE_REMOVE_HOOKS_FAIL:-0}" == "1" && "$*" == *"remove-hooks"* ]]; then
  echo 'simulated hook cleanup failure' >&2
  exit 9
fi
exit 0
FAKE

cat > "$FAKE_BIN_DIR/npm" <<FAKE
#!/usr/bin/env bash
echo "npm \$*" >> "$LOG_DIR/npm.log"
exit 0
FAKE

cat > "$FAKE_BIN_DIR/codex" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/tmux" <<FAKE
#!/usr/bin/env bash
cmd="\${1:-}"
shift || true
case "\$cmd" in
  -V)
    echo "tmux 3.4"
    ;;
  list-sessions|list-panes)
    exit 0
    ;;
  display-message)
    exit 0
    ;;
  kill-session|kill-pane)
    echo "tmux \$cmd \$*" >> "$LOG_DIR/tmux.log"
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
FAKE

cat > "$FAKE_BIN_DIR/git" <<FAKE
#!/usr/bin/env bash
echo "git \$*" >> "$LOG_DIR/git.log"
case "\${1:-}" in
  rev-parse)
    if [[ "\${2:-}" == "--is-inside-work-tree" ]]; then
      echo "true"
      exit 0
    fi
    ;;
  status)
    exit 0
    ;;
  pull)
    exit 0
    ;;
esac
exit 0
FAKE

chmod +x "$FAKE_BIN_DIR/node" "$FAKE_BIN_DIR/npm" "$FAKE_BIN_DIR/codex" "$FAKE_BIN_DIR/tmux" "$FAKE_BIN_DIR/git"

export PATH="$FAKE_BIN_DIR:$PATH"
export HOME="$TEST_HOME"
export ZDOTDIR="$ZDOTDIR_DIR"
export SHELL="/bin/bash"
export LOG_DIR

assert_alias_present() {
  local file="$1"
  local alias_name="$2"
  if ! grep -q "^alias $alias_name=" "$file"; then
    echo "expected alias $alias_name in $file" >&2
    cat "$file" >&2
    exit 1
  fi
}

assert_alias_absent() {
  local file="$1"
  local alias_name="$2"
  if grep -q "^alias $alias_name=" "$file"; then
    echo "expected alias $alias_name to be removed from $file" >&2
    cat "$file" >&2
    exit 1
  fi
}

"$ROOT_DIR/bin/codex-hud-install" >/tmp/codex-hud-manage-install.log 2>&1

for file in "$HOME/.bashrc" "$HOME/.bash_profile" "$ZDOTDIR/.zshrc"; do
  assert_alias_present "$file" "codex"
  assert_alias_present "$file" "cx"
  assert_alias_present "$file" "codex-resume"
  assert_alias_present "$file" "codex-hud-install"
  assert_alias_present "$file" "codex-hud-sync"
  assert_alias_present "$file" "codex-hud-upgrade"
  assert_alias_present "$file" "codex-hud-uninstall"
done

# Fish installs use the fish config path and must expose the same public cx
# alias without touching the bash/zsh fixture above.
FISH_HOME="$TEST_HOME/fish-home"
FISH_CONFIG="$FISH_HOME/.config/fish/config.fish"
mkdir -p "$(dirname "$FISH_CONFIG")"
HOME="$FISH_HOME" SHELL=/bin/fish \
  "$ROOT_DIR/bin/codex-hud-install" >/tmp/codex-hud-manage-fish-install.log 2>&1
for alias_name in codex cx codex-resume codex-hud-install codex-hud-sync codex-hud-upgrade codex-hud-uninstall; do
  if ! grep -q "^alias $alias_name " "$FISH_CONFIG"; then
    echo "expected fish alias $alias_name in $FISH_CONFIG" >&2
    cat "$FISH_CONFIG" >&2
    exit 1
  fi
done
HOME="$FISH_HOME" SHELL=/bin/fish \
  "$ROOT_DIR/bin/codex-hud-uninstall" >/tmp/codex-hud-manage-fish-uninstall.log 2>&1
for alias_name in codex cx codex-resume codex-hud-install codex-hud-sync codex-hud-upgrade codex-hud-uninstall; do
  if grep -q "^alias $alias_name " "$FISH_CONFIG"; then
    echo "expected fish alias $alias_name to be removed from $FISH_CONFIG" >&2
    cat "$FISH_CONFIG" >&2
    exit 1
  fi
done

cat > "$HOME/.bashrc" <<EOF
alias codex='$ROOT_DIR/bin/codex-hud'  $MARKER
alias codex-resume='$ROOT_DIR/bin/codex-hud resume'  $MARKER
EOF

"$ROOT_DIR/bin/codex-hud-sync" >/tmp/codex-hud-manage-sync.log 2>&1

assert_alias_present "$HOME/.bashrc" "codex-hud-sync"
assert_alias_present "$HOME/.bashrc" "codex-hud-upgrade"
assert_alias_present "$HOME/.bashrc" "codex-hud-uninstall"

if ! grep -q 'exec "$ROOT_DIR/install.sh" --upgrade' "$ROOT_DIR/bin/codex-hud-upgrade"; then
  echo "expected the upgrade wrapper to delegate to transactional install mode" >&2
  exit 1
fi

FAKE_NODE_REMOVE_HOOKS_FAIL=1 "$ROOT_DIR/bin/codex-hud-uninstall" >/tmp/codex-hud-manage-uninstall.log 2>&1

if ! grep -q "codex-hud-update\.mjs remove-hooks --checkout $ROOT_DIR" "$LOG_DIR/node.log"; then
  echo "expected uninstall to remove only codex-hud tmux hooks" >&2
  cat "$LOG_DIR/node.log" >&2
  exit 1
fi
if ! grep -q 'Unable to remove codex-hud update hooks' /tmp/codex-hud-manage-uninstall.log; then
  echo "expected uninstall to report hook cleanup failure" >&2
  cat /tmp/codex-hud-manage-uninstall.log >&2
  exit 1
fi

for file in "$HOME/.bashrc" "$HOME/.bash_profile" "$ZDOTDIR/.zshrc"; do
  assert_alias_absent "$file" "codex"
  assert_alias_absent "$file" "cx"
  assert_alias_absent "$file" "codex-resume"
  assert_alias_absent "$file" "codex-hud-install"
  assert_alias_absent "$file" "codex-hud-sync"
  assert_alias_absent "$file" "codex-hud-upgrade"
  assert_alias_absent "$file" "codex-hud-uninstall"
done

echo "test-management-commands: PASS"
