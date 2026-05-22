#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/codex-hud-install-guidance.XXXXXX")"
TEST_HOME="$TEST_ROOT/home"
BASH_BIN="${BASH:-/bin/bash}"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$TEST_HOME"

write_common_tools() {
  local bin_dir="$1"
  mkdir -p "$bin_dir"

  cat > "$bin_dir/dirname" <<'FAKE'
#!/bin/sh
case "${1:-}" in
  */*) printf '%s\n' "${1%/*}" ;;
  *) printf '.\n' ;;
esac
FAKE

  cat > "$bin_dir/sed" <<'FAKE'
#!/bin/sh
pattern="${1:-}"
while IFS= read -r line; do
  case "$pattern" in
    s/v//) printf '%s\n' "${line#v}" ;;
    *) printf '%s\n' "$line" ;;
  esac
done
FAKE

  cat > "$bin_dir/cut" <<'FAKE'
#!/bin/sh
while IFS= read -r line; do
  printf '%s\n' "${line%%.*}"
done
FAKE

  cat > "$bin_dir/cat" <<'FAKE'
#!/bin/sh
while IFS= read -r line; do
  printf '%s\n' "$line"
done
FAKE

  chmod +x "$bin_dir/dirname" "$bin_dir/sed" "$bin_dir/cut" "$bin_dir/cat"
}

run_install_expect_failure() {
  local name="$1"
  local bin_dir="$TEST_ROOT/$name-bin"
  local output="$TEST_ROOT/$name.out"
  write_common_tools "$bin_dir"
  shift
  "$@" "$bin_dir"

  set +e
  PATH="$bin_dir" HOME="$TEST_HOME" SHELL="/bin/bash" "$BASH_BIN" "$ROOT_DIR/install.sh" >"$output" 2>&1 </dev/null
  local rc=$?
  set -e

  if [[ "$rc" -eq 0 ]]; then
    echo "expected install.sh to fail for $name" >&2
    cat "$output" >&2
    exit 1
  fi

  printf '%s\n' "$output"
}

assert_contains() {
  local file="$1"
  local needle="$2"
  if ! grep -Fq "$needle" "$file"; then
    echo "expected output to contain: $needle" >&2
    cat "$file" >&2
    exit 1
  fi
}

node_missing_output=$(run_install_expect_failure node-missing true)
assert_contains "$node_missing_output" "Node.js 18+ is required, but node was not found in PATH."
assert_contains "$node_missing_output" "command -v node"
assert_contains "$node_missing_output" "Ubuntu/Debian:"
assert_contains "$node_missing_output" "Windows Git Bash:"

npm_missing_output=$(run_install_expect_failure npm-missing bash -c '
  cat > "$1/node" <<'"'"'FAKE'"'"'
#!/bin/sh
if [ "${1:-}" = "--version" ]; then
  echo "v22.17.0"
  exit 0
fi
exit 0
FAKE
  chmod +x "$1/node"
' _)
assert_contains "$npm_missing_output" "npm is required, but npm was not found in PATH."
assert_contains "$npm_missing_output" "command -v npm"
assert_contains "$npm_missing_output" "Reinstall Node.js LTS"

tmux_missing_output=$(run_install_expect_failure tmux-missing bash -c '
  cat > "$1/node" <<'"'"'FAKE'"'"'
#!/bin/sh
if [ "${1:-}" = "--version" ]; then
  echo "v22.17.0"
  exit 0
fi
exit 0
FAKE
  cat > "$1/npm" <<'"'"'FAKE'"'"'
#!/bin/sh
if [ "${1:-}" = "--version" ]; then
  echo "11.0.0"
  exit 0
fi
exit 0
FAKE
  chmod +x "$1/node" "$1/npm"
' _)
assert_contains "$tmux_missing_output" "tmux is required for Codex HUD, but tmux was not found in PATH."
assert_contains "$tmux_missing_output" "Non-interactive shell detected; install tmux manually and re-run install.sh."
assert_contains "$tmux_missing_output" "Ubuntu/Debian: sudo apt-get update && sudo apt-get install -y tmux"
assert_contains "$tmux_missing_output" "Windows Git Bash:"

echo "test-install-dependency-guidance: PASS"
