#!/usr/bin/env bash
set -euo pipefail

# Verify an isolated shell-function entry for StepCode Codex. The production
# shell files remain untouched; each fixture defines only its temporary scx
# function and keeps the ordinary stepcode command available.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /data/ycfeng/tmp/codex-hud-shell-stepcode-XXXXXX)"
CHECKOUT="$TEST_ROOT/checkout"
FAKE_BIN="$TEST_ROOT/bin"
WRAPPER_LOG="$TEST_ROOT/wrapper.log"
STEPCODE_LOG="$TEST_ROOT/stepcode.log"

mkdir -p "$CHECKOUT/bin" "$FAKE_BIN"

cat > "$CHECKOUT/bin/codex-hud" <<'FAKE_WRAPPER'
#!/usr/bin/env bash
set -euo pipefail
printf 'case=%s argc=%s\n' "${SHELL_CASE:?}" "$#" >> "${WRAPPER_LOG:?}"
for arg in "$@"; do
  printf 'arg=<%s>\n' "$arg" >> "${WRAPPER_LOG:?}"
done
FAKE_WRAPPER

cat > "$FAKE_BIN/stepcode" <<'FAKE_STEPCODE'
#!/usr/bin/env bash
set -euo pipefail
printf 'case=%s argc=%s\n' "${SHELL_CASE:?}" "$#" >> "${STEPCODE_LOG:?}"
for arg in "$@"; do
  printf 'arg=<%s>\n' "$arg" >> "${STEPCODE_LOG:?}"
done
FAKE_STEPCODE

chmod +x "$CHECKOUT/bin/codex-hud" "$FAKE_BIN/stepcode"

write_fixture() {
  local shell_name="$1"
  local fixture="$TEST_ROOT/${shell_name}.rc"

  cat > "$fixture" <<EOF
set -e
WRAPPER_PATH=$(printf '%q' "$CHECKOUT/bin/codex-hud")
scx() {
  "\$WRAPPER_PATH" \\
    --stepcode \\
    --sandbox danger-full-access \\
    --ask-for-approval never \\
    -c model_reasoning_effort=high \\
    -c model_auto_compact_token_limit=200000 \\
    -c model_providers.stepcode-api.stream_idle_timeout_ms=600000 \\
    "\$@"
}
scx --custom-option 'value with spaces'
stepcode ordinary-subcommand
EOF

  local output="$TEST_ROOT/${shell_name}.out"
  case "$shell_name" in
    zsh)
      env \
        PATH="$FAKE_BIN:/usr/bin:/bin" \
        SHELL_CASE="$shell_name" \
        WRAPPER_LOG="$WRAPPER_LOG" \
        STEPCODE_LOG="$STEPCODE_LOG" \
        zsh -df "$fixture" >"$output" 2>&1
      ;;
    bash)
      env \
        PATH="$FAKE_BIN:/usr/bin:/bin" \
        SHELL_CASE="$shell_name" \
        WRAPPER_LOG="$WRAPPER_LOG" \
        STEPCODE_LOG="$STEPCODE_LOG" \
        bash --noprofile --norc -f "$fixture" >"$output" 2>&1
      ;;
    *)
      echo "Unsupported shell fixture: $shell_name" >&2
      exit 1
      ;;
  esac
}

: > "$WRAPPER_LOG"
: > "$STEPCODE_LOG"

write_fixture zsh
write_fixture bash

expected_wrapper="$TEST_ROOT/expected-wrapper.log"
cat > "$expected_wrapper" <<'EOF'
case=zsh argc=13
arg=<--stepcode>
arg=<--sandbox>
arg=<danger-full-access>
arg=<--ask-for-approval>
arg=<never>
arg=<-c>
arg=<model_reasoning_effort=high>
arg=<-c>
arg=<model_auto_compact_token_limit=200000>
arg=<-c>
arg=<model_providers.stepcode-api.stream_idle_timeout_ms=600000>
arg=<--custom-option>
arg=<value with spaces>
case=bash argc=13
arg=<--stepcode>
arg=<--sandbox>
arg=<danger-full-access>
arg=<--ask-for-approval>
arg=<never>
arg=<-c>
arg=<model_reasoning_effort=high>
arg=<-c>
arg=<model_auto_compact_token_limit=200000>
arg=<-c>
arg=<model_providers.stepcode-api.stream_idle_timeout_ms=600000>
arg=<--custom-option>
arg=<value with spaces>
EOF

diff -u "$expected_wrapper" "$WRAPPER_LOG"

expected_stepcode="$TEST_ROOT/expected-stepcode.log"
cat > "$expected_stepcode" <<'EOF'
case=zsh argc=1
arg=<ordinary-subcommand>
case=bash argc=1
arg=<ordinary-subcommand>
EOF

diff -u "$expected_stepcode" "$STEPCODE_LOG"

echo "test-shell-stepcode-entry: PASS (shells=2, wrapper_invocations=2, ordinary_stepcode_invocations=2, forwarded_args=26)"
