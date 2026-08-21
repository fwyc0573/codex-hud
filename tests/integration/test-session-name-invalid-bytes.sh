#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
WRAPPER_PATH="${CODEX_HUD_WRAPPER:-$ROOT_DIR/bin/codex-hud}"
TEST_TMPDIR="${CODEX_HUD_TEST_TMPDIR:-${TMPDIR:-${XDG_RUNTIME_DIR:-$HOME/.cache}}}"
mkdir -p "$TEST_TMPDIR"
TEST_ROOT="$(mktemp -d "$TEST_TMPDIR/codex-hud-invalid-bytes-XXXXXX")"
trap 'find "$TEST_ROOT" -depth -delete >/dev/null 2>&1 || true' EXIT

UTF8_LOCALE="$(locale -a 2>/dev/null | awk 'tolower($0) ~ /utf[-.]?8/ { print; exit }')"
if [[ -z "$UTF8_LOCALE" ]]; then
  echo "A UTF-8 locale is required for this regression test." >&2
  exit 1
fi

INVALID_BASENAME="$(LC_ALL=C printf '\xd2\xb5\xce\xf1')"
PROJECT_DIR="$TEST_ROOT/$INVALID_BASENAME"
mkdir -p "$PROJECT_DIR"

FUNCTIONS_FILE="$TEST_ROOT/functions.sh"
{
  sed -n '/^command_exists()/,/^}/p' "$WRAPPER_PATH"
  sed -n '/^hash_cwd()/,/^}/p' "$WRAPPER_PATH"
  sed -n '/^session_project_slug()/,/^}/p' "$WRAPPER_PATH"
} > "$FUNCTIONS_FILE"

LC_ALL="$UTF8_LOCALE" bash -c '
set -euo pipefail
source "$1"

slug="$(session_project_slug "$2")"
expected="proj-$(hash_cwd "$2")"
if [[ "$slug" != "$expected" ]]; then
  printf "Expected locale-independent fallback %q, got %q\n" "$expected" "$slug" >&2
  exit 1
fi
if [[ ! "$slug" =~ ^proj-[a-f0-9]{8}$ ]]; then
  printf "Fallback contains unsafe bytes: %q\n" "$slug" >&2
  exit 1
fi
' _ "$FUNCTIONS_FILE" "$PROJECT_DIR"

echo "test-session-name-invalid-bytes: PASS (locale=$UTF8_LOCALE)"
