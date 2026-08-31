#!/usr/bin/env bash
set -euo pipefail

# Verify that installation preserves native codex and exposes cx as the HUD
# entry for bash and zsh.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-native-entry-XXXXXX)"
FAKE_BIN="$TEST_ROOT/bin"
TMP_ROOT="$TEST_ROOT/tmp"
EMPTY_HOME="$TEST_ROOT/empty-home"
EMPTY_ZDOTDIR="$TEST_ROOT/empty-zdotdir"
PRESERVE_HOME="$TEST_ROOT/preserve-home"
PRESERVE_ZDOTDIR="$TEST_ROOT/preserve-zdotdir"
MARKER="# codex-hud alias"
NATIVE_ALIAS="alias codex='/opt/native-codex' # user-owned native entry"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN" "$TMP_ROOT" \
  "$EMPTY_HOME" "$EMPTY_ZDOTDIR" \
  "$PRESERVE_HOME" "$PRESERVE_ZDOTDIR"
touch "$EMPTY_HOME/.bashrc" "$EMPTY_HOME/.bash_profile" "$EMPTY_ZDOTDIR/.zshrc"
touch "$PRESERVE_HOME/.bashrc" "$PRESERVE_HOME/.bash_profile" "$PRESERVE_ZDOTDIR/.zshrc"

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

cat > "$FAKE_BIN/codex" <<'FAKE_CODEX'
#!/usr/bin/env bash
printf 'native-codex\n'
FAKE_CODEX

cat > "$FAKE_BIN/tmux" <<'FAKE_TMUX'
#!/usr/bin/env bash
if [[ "${1:-}" == "-V" ]]; then
  printf 'tmux 3.4\n'
fi
exit 0
FAKE_TMUX

chmod +x "$FAKE_BIN/node" "$FAKE_BIN/npm" "$FAKE_BIN/codex" "$FAKE_BIN/tmux"

export PATH="$FAKE_BIN:/usr/bin:/bin"
export TMPDIR="$TMP_ROOT"
export SHELL=/bin/bash

assert_exact_line() {
  local file="$1"
  local expected="$2"
  if ! grep -Fqx "$expected" "$file"; then
    printf 'expected line in %s: %s\n' "$file" "$expected" >&2
    sed -n '1,160p' "$file" >&2
    exit 1
  fi
}

assert_no_managed_codex_alias() {
  local file="$1"
  if grep -Eq "^alias codex=.*${MARKER}$|^alias codex ${MARKER}$" "$file"; then
    printf 'managed codex alias unexpectedly present in %s\n' "$file" >&2
    sed -n '1,160p' "$file" >&2
    exit 1
  fi
}

assert_no_alias() {
  local file="$1"
  local alias_name="$2"
  if grep -Eq "^alias ${alias_name}(=| )" "$file"; then
    printf 'alias %s unexpectedly present in %s\n' "$alias_name" "$file" >&2
    sed -n '1,160p' "$file" >&2
    exit 1
  fi
}

run_install() {
  local home="$1"
  local zdotdir="$2"
  HOME="$home" ZDOTDIR="$zdotdir" SHELL=/bin/bash \
    "$ROOT_DIR/bin/codex-hud-install" >"$TEST_ROOT/install-$(basename "$home").log" 2>&1
}

run_sync() {
  local home="$1"
  local zdotdir="$2"
  HOME="$home" ZDOTDIR="$zdotdir" SHELL=/bin/bash \
    "$ROOT_DIR/bin/codex-hud-sync" >"$TEST_ROOT/sync-$(basename "$home").log" 2>&1
}

run_uninstall() {
  local home="$1"
  local zdotdir="$2"
  HOME="$home" ZDOTDIR="$zdotdir" SHELL=/bin/bash \
    "$ROOT_DIR/bin/codex-hud-uninstall" >"$TEST_ROOT/uninstall-$(basename "$home").log" 2>&1
}

# A fresh installation must leave codex to PATH and expose cx as the wrapper.
run_install "$EMPTY_HOME" "$EMPTY_ZDOTDIR"
assert_no_managed_codex_alias "$EMPTY_HOME/.bashrc"
assert_no_managed_codex_alias "$EMPTY_HOME/.bash_profile"
assert_no_managed_codex_alias "$EMPTY_ZDOTDIR/.zshrc"
assert_exact_line "$EMPTY_HOME/.bashrc" "alias cx='$ROOT_DIR/bin/codex-hud'  $MARKER"
assert_exact_line "$EMPTY_ZDOTDIR/.zshrc" "alias cx='$ROOT_DIR/bin/codex-hud'  $MARKER"

bash_resolution="$(
  HOME="$EMPTY_HOME" ZDOTDIR="$EMPTY_ZDOTDIR" PATH="$FAKE_BIN:/usr/bin:/bin" \
    bash --noprofile --norc -ic '
      source "$HOME/.bashrc"
      printf "codex_kind=%s\n" "$(type -t codex)"
      printf "codex_path=%s\n" "$(command -v codex)"
      printf "cx_kind=%s\n" "$(type -t cx)"
    ' 2>/dev/null
)"
grep -Fqx "codex_kind=file" <<<"$bash_resolution"
grep -Fqx "codex_path=$FAKE_BIN/codex" <<<"$bash_resolution"
grep -Fqx "cx_kind=alias" <<<"$bash_resolution"

zsh_resolution="$(
  HOME="$EMPTY_HOME" ZDOTDIR="$EMPTY_ZDOTDIR" PATH="$FAKE_BIN:/usr/bin:/bin" \
    zsh -dfi -c '
      source "$ZDOTDIR/.zshrc"
      if (( $+aliases[codex] )); then
        print "codex_alias=present"
      else
        print "codex_alias=absent"
      fi
      print "codex_path=$(whence -p codex)"
      if (( $+aliases[cx] )); then
        print "cx_kind=alias"
      else
        print "cx_kind=missing"
      fi
    ' 2>/dev/null
)"
grep -Fqx "codex_alias=absent" <<<"$zsh_resolution"
grep -Fqx "codex_path=$FAKE_BIN/codex" <<<"$zsh_resolution"
grep -Fqx "cx_kind=alias" <<<"$zsh_resolution"

# A pre-existing native alias must survive install, sync, legacy managed alias
# cleanup, and uninstall.
printf '%s\n' "$NATIVE_ALIAS" > "$PRESERVE_HOME/.bashrc"
printf '%s\n' "$NATIVE_ALIAS" > "$PRESERVE_ZDOTDIR/.zshrc"
run_install "$PRESERVE_HOME" "$PRESERVE_ZDOTDIR"
assert_exact_line "$PRESERVE_HOME/.bashrc" "$NATIVE_ALIAS"
assert_exact_line "$PRESERVE_ZDOTDIR/.zshrc" "$NATIVE_ALIAS"
assert_no_managed_codex_alias "$PRESERVE_HOME/.bashrc"
assert_no_managed_codex_alias "$PRESERVE_ZDOTDIR/.zshrc"

printf "alias codex='$ROOT_DIR/bin/codex-hud'  %s\n" "$MARKER" >> "$PRESERVE_HOME/.bashrc"
run_sync "$PRESERVE_HOME" "$PRESERVE_ZDOTDIR"
assert_exact_line "$PRESERVE_HOME/.bashrc" "$NATIVE_ALIAS"
assert_no_managed_codex_alias "$PRESERVE_HOME/.bashrc"
assert_exact_line "$PRESERVE_HOME/.bashrc" "alias cx='$ROOT_DIR/bin/codex-hud'  $MARKER"

run_uninstall "$PRESERVE_HOME" "$PRESERVE_ZDOTDIR"
assert_exact_line "$PRESERVE_HOME/.bashrc" "$NATIVE_ALIAS"
assert_exact_line "$PRESERVE_ZDOTDIR/.zshrc" "$NATIVE_ALIAS"
assert_no_alias "$PRESERVE_HOME/.bashrc" "cx"
assert_no_alias "$PRESERVE_ZDOTDIR/.zshrc" "cx"

printf 'test-installer-native-codex-entry: PASS (native_resolution=1, cx_hud_alias=1, legacy_cleanup=1, uninstall_preservation=1)\n'
