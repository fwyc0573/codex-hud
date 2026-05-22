#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/codex-hud-self-check.XXXXXX")"
FAKE_BIN="$TMP_DIR/bin"
OUTPUT="$TMP_DIR/self-check.out"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN"

cat > "$FAKE_BIN/codex" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN/node" <<'FAKE'
#!/usr/bin/env bash
echo "v24.0.0"
FAKE

cat > "$FAKE_BIN/tmux" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "-V" ]]; then
  echo "tmux 3.4"
  exit 0
fi

if [[ "${1:-}" == "show-options" ]]; then
  echo "error connecting to /tmp/tmux-test/default (No such file or directory)" >&2
  exit 1
fi

exit 0
FAKE

chmod +x "$FAKE_BIN/codex" "$FAKE_BIN/node" "$FAKE_BIN/tmux"

cat > "$TMP_DIR/.bashrc" <<'EOF_RC'
# codex-hud alias
EOF_RC

set +e
PATH="$FAKE_BIN:$PATH" HOME="$TMP_DIR" SHELL="/bin/bash" "$REPO_ROOT/bin/codex-hud" --self-check >"$OUTPUT" 2>&1
rc=$?
set -e

if [[ "$rc" -ne 0 ]]; then
  echo "self-check should pass when tmux exists but no tmux server is running (exit=$rc):" >&2
  cat "$OUTPUT" >&2
  exit 1
fi

if grep -q "error connecting to /tmp/tmux-test/default" "$OUTPUT"; then
  echo "self-check should ignore missing tmux server while reading optional global options" >&2
  cat "$OUTPUT" >&2
  exit 1
fi

if ! grep -q "Self-check passed" "$OUTPUT"; then
  echo "self-check did not report success:" >&2
  cat "$OUTPUT" >&2
  exit 1
fi

echo "test-self-check-no-tmux-server: PASS"
