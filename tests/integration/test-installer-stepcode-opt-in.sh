#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-installer-stepcode-XXXXXX)"
FAKE_BIN="$TEST_ROOT/bin"
TMP_ROOT="$TEST_ROOT/tmp"
HOME_DIR="$TEST_ROOT/home"
ZDOTDIR="$TEST_ROOT/zdotdir"
STEPCODE_MARKER="# codex-hud stepcode entry"
USER_SCX="alias scx='stepcode codex --sandbox danger-full-access' # user-owned StepCode entry"

mkdir -p "$FAKE_BIN" "$TMP_ROOT" "$HOME_DIR" "$ZDOTDIR"
touch "$HOME_DIR/.bashrc" "$HOME_DIR/.bash_profile" "$ZDOTDIR/.zshrc"
printf '%s\n' "$USER_SCX" > "$ZDOTDIR/.zshrc"

cat > "$FAKE_BIN/node" <<'FAKE_NODE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  printf 'v20.11.0\n'
fi
exit 0
FAKE_NODE

cat > "$FAKE_BIN/npm" <<'FAKE_NPM'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  printf '10.2.4\n'
fi
exit 0
FAKE_NPM

cat > "$FAKE_BIN/tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
if [[ "${1:-}" == "-V" ]]; then
  printf 'tmux 3.4\n'
fi
exit 0
FAKE_TMUX

cat > "$FAKE_BIN/stepcode" <<'FAKE_STEPCODE'
#!/usr/bin/env bash
exit 0
FAKE_STEPCODE

chmod +x "$FAKE_BIN/node" "$FAKE_BIN/npm" "$FAKE_BIN/tmux" "$FAKE_BIN/stepcode"

export HOME="$HOME_DIR"
export ZDOTDIR
export SHELL="/bin/zsh"
export TMPDIR="$TMP_ROOT"
export PATH="$FAKE_BIN:/usr/bin:/bin"

rc_files=("$HOME/.bashrc" "$HOME/.bash_profile" "$ZDOTDIR/.zshrc")

assert_marker_count() {
  local file="$1"
  local expected="$2"
  local actual
  actual=$(grep -Fc "$STEPCODE_MARKER" "$file" || true)
  if [[ "$actual" -ne "$expected" ]]; then
    echo "expected $expected StepCode marker lines in $file, found $actual" >&2
    cat "$file" >&2
    exit 1
  fi
}

assert_managed_scx() {
  local file="$1"
  assert_marker_count "$file" 2
  grep -Fq 'unalias scx 2>/dev/null || true' "$file"
  grep -Fq 'scx() {' "$file"
  grep -Fq "$ROOT_DIR/bin/codex-hud" "$file"
  grep -Fq -- '--stepcode --new-session' "$file"
  grep -Fq -- '--sandbox danger-full-access' "$file"
  grep -Fq -- '--ask-for-approval never' "$file"
  grep -Fq 'model_reasoning_effort="high"' "$file"
  grep -Fq 'model_auto_compact_token_limit=200000' "$file"
  grep -Fq 'model_providers.stepcode-api.stream_idle_timeout_ms=600000' "$file"
  grep -Fq '"$@"' "$file"
}

"$ROOT_DIR/bin/codex-hud-install" > "$TEST_ROOT/default-install.log" 2>&1

for file in "${rc_files[@]}"; do
  assert_marker_count "$file" 0
done
grep -Fqx "$USER_SCX" "$ZDOTDIR/.zshrc"

if ! "$ROOT_DIR/install.sh" --help | grep -q -- '--enable-stepcode'; then
  echo "installer help must expose --enable-stepcode" >&2
  exit 1
fi

"$ROOT_DIR/bin/codex-hud-install" --enable-stepcode > "$TEST_ROOT/opt-in-install.log" 2>&1

for file in "${rc_files[@]}"; do
  assert_managed_scx "$file"
done

bash --noprofile --norc -c 'source "$1"; declare -F scx >/dev/null' _ "$HOME/.bashrc"
zsh -f -c 'source "$1"; (( $+functions[scx] ))' _ "$ZDOTDIR/.zshrc"

if grep -Fqx "$USER_SCX" "$ZDOTDIR/.zshrc"; then
  echo "explicit opt-in must replace the user scx alias" >&2
  exit 1
fi
grep -Fqx "$USER_SCX" "$HOME/.codex-hud-backup-aliases"

"$ROOT_DIR/bin/codex-hud-sync" --enable-stepcode > "$TEST_ROOT/opt-in-sync.log" 2>&1
for file in "${rc_files[@]}"; do
  assert_managed_scx "$file"
done

before_default_sync="$TEST_ROOT/before-default-sync"
after_default_sync="$TEST_ROOT/after-default-sync"
for file in "${rc_files[@]}"; do
  grep -F "$STEPCODE_MARKER" "$file"
done > "$before_default_sync"

"$ROOT_DIR/bin/codex-hud-sync" > "$TEST_ROOT/default-sync.log" 2>&1

for file in "${rc_files[@]}"; do
  grep -F "$STEPCODE_MARKER" "$file"
done > "$after_default_sync"
diff -u "$before_default_sync" "$after_default_sync"

"$ROOT_DIR/bin/codex-hud-uninstall" > "$TEST_ROOT/uninstall.log" 2>&1

for file in "${rc_files[@]}"; do
  assert_marker_count "$file" 0
done
grep -Fqx "$USER_SCX" "$ZDOTDIR/.zshrc"

export SHELL="/usr/bin/fish"
fish_rc="$HOME/.config/fish/config.fish"

"$ROOT_DIR/bin/codex-hud-install" > "$TEST_ROOT/default-fish-install.log" 2>&1
assert_marker_count "$fish_rc" 0

"$ROOT_DIR/bin/codex-hud-install" --enable-stepcode > "$TEST_ROOT/opt-in-fish-install.log" 2>&1
assert_marker_count "$fish_rc" 4
grep -Fq 'functions -e scx 2>/dev/null' "$fish_rc"
grep -Fq 'function scx' "$fish_rc"
grep -Fq -- '--stepcode --new-session' "$fish_rc"
grep -Fq '$argv' "$fish_rc"
grep -Fq 'end' "$fish_rc"

"$ROOT_DIR/bin/codex-hud-uninstall" > "$TEST_ROOT/uninstall-fish.log" 2>&1
assert_marker_count "$fish_rc" 0

echo "test-installer-stepcode-opt-in: PASS (default=disabled, opt_in=enabled, sync=idempotent, default_sync=preserved, uninstall=restored, fish=managed)"
