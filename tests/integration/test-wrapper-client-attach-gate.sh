#!/usr/bin/env bash
set -euo pipefail

# Verifies the PR#8 client-attach launch gate at two levels:
#   1. Structural semantics of what the wrapper emits into tmux (gate is
#      initialized closed, the client-attached hook opens it, a plain non-append
#      set-hook is used, the wait is bounded, and the gate is armed before the
#      launch is sent).
#   2. Runtime behavior of the *actual* wait-loop string the wrapper produces,
#      executed against a stateful fake tmux: it must block while closed,
#      release when the gate opens, and fail open at the iteration cap.
#
# The fake tmux used for the wrapper run (level 1) is a stateless logger, so it
# cannot prove runtime behavior on its own. Level 2 extracts the real command
# and runs it directly, which is what makes this test resistant to mutations
# that delete the gate while leaving the surrounding commands in place.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
FAKE_TMUX_DIR="$SCRIPT_DIR/fake-tmux"
FAKE_BIN_DIR="$(mktemp -d)"
STATE_DIR="$(mktemp -d)"
log_file=""
output_log=""

cleanup() {
  rm -rf "$FAKE_BIN_DIR" "$STATE_DIR"
  [[ -n "$log_file" ]] && rm -f "$log_file"
  [[ -n "$output_log" ]] && rm -f "$output_log"
}
trap cleanup EXIT

fail() {
  echo "test-wrapper-client-attach-gate: FAIL - $1" >&2
  [[ -n "$log_file" && -f "$log_file" ]] && { echo "--- tmux log ---" >&2; cat "$log_file" >&2; }
  exit 1
}

cat > "$FAKE_BIN_DIR/codex" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/node" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo "v20.0.0"
  exit 0
fi
exit 0
FAKE

cat > "$FAKE_BIN_DIR/npm" <<'FAKE'
#!/usr/bin/env bash
exit 0
FAKE

cat > "$FAKE_BIN_DIR/tput" <<'FAKE'
#!/usr/bin/env bash
if [[ "${1:-}" == "lines" ]]; then
  echo "24"
  exit 0
fi
if [[ "${1:-}" == "cols" ]]; then
  echo "80"
  exit 0
fi
echo "0"
FAKE

chmod +x "$FAKE_BIN_DIR/codex" "$FAKE_BIN_DIR/node" "$FAKE_BIN_DIR/npm" "$FAKE_BIN_DIR/tput"

export PATH="$FAKE_BIN_DIR:$FAKE_TMUX_DIR:$PATH"
export CODEX_HUD_HEIGHT="5"
export CODEX_HUD_HEIGHT_AUTO="0"

log_file="$(mktemp)"
output_log="$(mktemp)"
export TMUX_LOG_FILE="$log_file"
export TMUX_MAIN_PANE_ID="%1"
export TMUX_PANE_ID="%2"
export TMUX_PANES=$'%1\n%2'
export TMUX_SPLIT_PANE_ID="%2"
export TMUX_BASE_HEIGHT="5"
export TMUX_HEIGHT="5"
export TMUX_HEIGHT_MIN="5"
export TMUX_HEIGHT_MAX="12"
export TMUX_AUTO="0"
export TMUX_PANE_WIDTH="120"
export TMUX_PANE_HEIGHT="5"

"$ROOT_DIR/bin/codex-hud" >"$output_log" 2>&1

# ---------------------------------------------------------------------------
# Level 1: structural semantics of the emitted tmux commands.
# ---------------------------------------------------------------------------

# The gate must be initialized to the closed state (0) before anything waits.
if ! grep -q '@codex_hud_client_attached 0' "$log_file"; then
  fail "gate was not initialized to the closed state (@codex_hud_client_attached 0)"
fi

# The client-attached hook must open the gate (set it to 1).
hook_line="$(grep -m1 '^set-hook .*client-attached' "$log_file" || true)"
if [[ -z "$hook_line" ]]; then
  fail "no client-attached hook was registered"
fi
if ! grep -q '@codex_hud_client_attached 1' <<<"$hook_line"; then
  fail "client-attached hook does not open the gate (@codex_hud_client_attached 1)"
fi

# A plain (non-append) set-hook must be used so tmux >= 3.2 is not required.
if grep -q 'set-hook[[:space:]].*-a[[:space:]]' <<<"$hook_line"; then
  fail "client-attached hook uses 'set-hook -a' (append); a plain set-hook is required"
fi

# The launch must be gated: the wait loop must reference the gate option.
launch_line="$(grep -m1 '^send-keys .*@codex_hud_client_attached' "$log_file" || true)"
if [[ -z "$launch_line" ]]; then
  fail "codex launch was sent without waiting on the attach gate"
fi

# The wait must be bounded (fail-open cap) so the pane cannot hang forever.
if ! grep -q -- '-lt 200' <<<"$launch_line"; then
  fail "attach wait loop is missing its bounded iteration cap (-lt 200)"
fi

# Ordering: gate init and hook registration must precede the gated launch.
init_ln="$(grep -n '@codex_hud_client_attached 0' "$log_file" | head -n1 | cut -d: -f1)"
hook_ln="$(grep -n '^set-hook .*client-attached' "$log_file" | head -n1 | cut -d: -f1)"
launch_ln="$(grep -n '^send-keys .*@codex_hud_client_attached' "$log_file" | head -n1 | cut -d: -f1)"
if (( init_ln >= launch_ln )); then
  fail "gate was initialized at/after the launch was sent (init=$init_ln launch=$launch_ln)"
fi
if (( hook_ln >= launch_ln )); then
  fail "attach hook was armed at/after the launch was sent (hook=$hook_ln launch=$launch_ln)"
fi

# ---------------------------------------------------------------------------
# Level 2: runtime behavior of the real wait-loop string.
# Extract the wait loop emitted by the wrapper (everything from `i=0;` up to the
# `; cd ` that begins the codex invocation) and run it against a stateful fake.
# ---------------------------------------------------------------------------

if [[ "$launch_line" != *"i=0; "* || "$launch_line" != *"; cd "* ]]; then
  fail "could not locate the wait loop within the launch command"
fi
wait_body="${launch_line#*i=0; }"   # drop everything up to and including 'i=0; '
wait_body="${wait_body%%; cd *}"     # drop the '; cd ... && codex ...' tail
wait_cmd="i=0; ${wait_body}"

# Sanity: the extracted loop must actually poll the gate and be bounded.
if [[ "$wait_cmd" != *"@codex_hud_client_attached"* || "$wait_cmd" != *"-lt 200"* || "$wait_cmd" != *"done"* ]]; then
  fail "extracted wait loop is malformed: $wait_cmd"
fi

# Stateful fake tmux: `show-option` echoes the gate state file; else no-op.
STATE_TMUX_DIR="$STATE_DIR/tmuxbin"
mkdir -p "$STATE_TMUX_DIR"
cat > "$STATE_TMUX_DIR/tmux" <<'SH'
#!/usr/bin/env bash
if [[ "$1" == "show-option" ]]; then
  cat "${GATE_STATE_FILE:?}" 2>/dev/null || echo 0
  exit 0
fi
exit 0
SH
chmod +x "$STATE_TMUX_DIR/tmux"

GATE_STATE_FILE="$STATE_DIR/gate"

# 2a) Gating + release: gate starts closed, opens after ~0.3s; the loop must
# wait until it opens (not return early) and then release promptly.
echo 0 > "$GATE_STATE_FILE"
( sleep 0.3; echo 1 > "$GATE_STATE_FILE" ) &
flip_pid=$!
start_ns="$(date +%s%N)"
PATH="$STATE_TMUX_DIR:$PATH" GATE_STATE_FILE="$GATE_STATE_FILE" bash -c "$wait_cmd"
end_ns="$(date +%s%N)"
wait "$flip_pid" 2>/dev/null || true
elapsed_ms=$(( (end_ns - start_ns) / 1000000 ))
if (( elapsed_ms < 250 )); then
  fail "gate did not block: loop returned after ${elapsed_ms}ms, before the gate opened (expected >= 250ms)"
fi
if (( elapsed_ms > 3000 )); then
  fail "gate did not release promptly after attach: ${elapsed_ms}ms"
fi
echo "  level2a gate-block-and-release: PASS (${elapsed_ms}ms)"

# 2b) Fail-open cap: gate never opens; with sleep stubbed out the bounded loop
# must still terminate (the cap prevents an infinite hang). A mutation that
# removes the cap would spin forever and be killed by `timeout`.
echo 0 > "$GATE_STATE_FILE"
NOSLEEP_DIR="$STATE_DIR/nosleep"
mkdir -p "$NOSLEEP_DIR"
printf '#!/usr/bin/env bash\nexit 0\n' > "$NOSLEEP_DIR/sleep"
chmod +x "$NOSLEEP_DIR/sleep"

cap_runner=(bash -c "$wait_cmd")
if command -v timeout >/dev/null 2>&1; then
  cap_runner=(timeout 5 bash -c "$wait_cmd")
fi
if ! PATH="$NOSLEEP_DIR:$STATE_TMUX_DIR:$PATH" GATE_STATE_FILE="$GATE_STATE_FILE" "${cap_runner[@]}"; then
  fail "fail-open cap missing: wait loop did not terminate when the gate never opened"
fi
echo "  level2b fail-open-cap: PASS"

echo "test-wrapper-client-attach-gate: PASS"
