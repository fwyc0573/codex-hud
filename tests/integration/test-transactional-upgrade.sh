#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEST_ROOT="$(mktemp -d /tmp/codex-hud-transactional-upgrade-XXXXXX)"
REMOTE="$TEST_ROOT/remote.git"
SEED="$TEST_ROOT/seed"
PUBLISHER="$TEST_ROOT/publisher"
FAKE_BIN="$TEST_ROOT/fake-bin"
HOME_DIR="$TEST_ROOT/home"
NPM_LOG="$TEST_ROOT/npm.log"

cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$SEED/bin" "$FAKE_BIN" "$HOME_DIR"
git init --bare --quiet "$REMOTE"
git -C "$SEED" init --quiet -b main
git -C "$SEED" config user.email codex-hud-transaction-test@example.com
git -C "$SEED" config user.name 'Codex HUD Transaction Test'
cp "$ROOT_DIR/install.sh" "$SEED/install.sh"
for name in codex-hud codex-hud-install codex-hud-sync codex-hud-upgrade codex-hud-uninstall codex-hud-update.mjs; do
  printf '#!/usr/bin/env bash\nexit 0\n' > "$SEED/bin/$name"
done
chmod +x "$SEED/install.sh" "$SEED/bin/"*
printf '{"name":"transaction-fixture","version":"0.1.0"}\n' > "$SEED/package.json"
printf 'node_modules/\ndist/\n' > "$SEED/.gitignore"
printf 'base\n' > "$SEED/version.txt"
git -C "$SEED" add install.sh bin package.json version.txt .gitignore
git -C "$SEED" commit --quiet -m base
git -C "$SEED" tag v0.1.0
git -C "$SEED" remote add origin "$REMOTE"
git -C "$SEED" push --quiet --set-upstream origin main --tags
git --git-dir="$REMOTE" symbolic-ref HEAD refs/heads/main

for case_name in install-fail build-fail success; do
  git clone --quiet "$REMOTE" "$TEST_ROOT/$case_name"
done
git clone --quiet "$REMOTE" "$PUBLISHER"
git -C "$PUBLISHER" config user.email codex-hud-transaction-test@example.com
git -C "$PUBLISHER" config user.name 'Codex HUD Transaction Test'
printf 'target\n' > "$PUBLISHER/version.txt"
git -C "$PUBLISHER" commit --quiet -am target
git -C "$PUBLISHER" tag v0.2.0
git -C "$PUBLISHER" push --quiet origin main --tags
TARGET_HEAD="$(git -C "$PUBLISHER" rev-parse HEAD)"

cat > "$FAKE_BIN/node" <<'EOF_NODE'
#!/usr/bin/env bash
if [[ "${1:-}" == "--version" ]]; then
  echo v20.11.0
  exit 0
fi
exit 0
EOF_NODE

cat > "$FAKE_BIN/npm" <<'EOF_NPM'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "--version" ]]; then
  echo 10.2.4
  exit 0
fi
printf '%s %s\n' "$PWD" "$*" >> "${NPM_LOG:?}"
case "${1:-}" in
  install)
    if [[ "${FAKE_NPM_FAIL:-}" == "install" ]]; then
      echo 'simulated dependency installation failure' >&2
      exit 41
    fi
    mkdir -p node_modules
    git rev-parse HEAD > node_modules/commit
    ;;
  run)
    if [[ "${2:-}" != "build" ]]; then
      echo "unexpected npm run target: ${2:-}" >&2
      exit 2
    fi
    if [[ "${FAKE_NPM_FAIL:-}" == "build" ]]; then
      echo 'simulated TypeScript build failure' >&2
      exit 42
    fi
    mkdir -p dist
    git rev-parse HEAD > dist/commit
    ;;
  *)
    echo "unexpected npm command: $*" >&2
    exit 2
    ;;
esac
EOF_NPM

cat > "$FAKE_BIN/tmux" <<'EOF_TMUX'
#!/usr/bin/env bash
if [[ "${1:-}" == "-V" ]]; then
  echo 'tmux 3.4'
  exit 0
fi
exit 0
EOF_TMUX

chmod +x "$FAKE_BIN/node" "$FAKE_BIN/npm" "$FAKE_BIN/tmux"

prepare_checkout() {
  local checkout="$1"
  mkdir -p "$HOME_DIR/$(basename "$checkout")"
  mkdir -p "$checkout/node_modules" "$checkout/dist"
  printf 'old-dependencies\n' > "$checkout/node_modules/commit"
  printf 'old-build\n' > "$checkout/dist/commit"
}

run_failure_case() {
  local case_name="$1"
  local failure="$2"
  local checkout="$TEST_ROOT/$case_name"
  prepare_checkout "$checkout"
  local before_head
  before_head="$(git -C "$checkout" rev-parse HEAD)"
  set +e
  (
    cd "$checkout"
    HOME="$HOME_DIR/$case_name" \
      ZDOTDIR="$HOME_DIR/$case_name" \
      SHELL=/bin/bash \
      PATH="$FAKE_BIN:$PATH" \
      NPM_LOG="$NPM_LOG" \
      FAKE_NPM_FAIL="$failure" \
      ./install.sh --upgrade
  ) > "$TEST_ROOT/$case_name.log" 2>&1
  local status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "$case_name unexpectedly succeeded" >&2
    exit 1
  fi
  local after_head
  after_head="$(git -C "$checkout" rev-parse HEAD)"
  if [[ "$after_head" != "$before_head" ]]; then
    echo "$case_name changed HEAD before the failing dependency/build step" >&2
    echo "before=$before_head" >&2
    echo "after=$after_head" >&2
    cat "$TEST_ROOT/$case_name.log" >&2
    exit 1
  fi
  if [[ "$(cat "$checkout/node_modules/commit")" != 'old-dependencies' ]]; then
    echo "$case_name changed active node_modules on failure" >&2
    exit 1
  fi
  if [[ "$(cat "$checkout/dist/commit")" != 'old-build' ]]; then
    echo "$case_name changed active dist on failure" >&2
    exit 1
  fi
  if [[ -n "$(git -C "$checkout" status --porcelain --untracked-files=all)" ]]; then
    echo "$case_name left the tracked worktree dirty" >&2
    git -C "$checkout" status --short >&2
    exit 1
  fi
}

run_failure_case install-fail install
run_failure_case build-fail build

SUCCESS_CHECKOUT="$TEST_ROOT/success"
prepare_checkout "$SUCCESS_CHECKOUT"
(
  cd "$SUCCESS_CHECKOUT"
  HOME="$HOME_DIR/success" \
    ZDOTDIR="$HOME_DIR/success" \
    SHELL=/bin/bash \
    PATH="$FAKE_BIN:$PATH" \
    NPM_LOG="$NPM_LOG" \
    FAKE_NPM_FAIL='' \
    ./install.sh --upgrade
) > "$TEST_ROOT/success.log" 2>&1

if [[ "$(git -C "$SUCCESS_CHECKOUT" rev-parse HEAD)" != "$TARGET_HEAD" ]]; then
  echo 'successful upgrade did not reach the fetched target commit' >&2
  exit 1
fi
if [[ "$(cat "$SUCCESS_CHECKOUT/node_modules/commit")" != "$TARGET_HEAD" ]]; then
  echo 'successful upgrade did not activate target dependencies' >&2
  exit 1
fi
if [[ "$(cat "$SUCCESS_CHECKOUT/dist/commit")" != "$TARGET_HEAD" ]]; then
  echo 'successful upgrade did not activate the target build' >&2
  exit 1
fi

SUCCESS_ZSHRC="$HOME_DIR/success/.zshrc"
if [[ ! -f "$SUCCESS_ZSHRC" ]] || ! grep -Fqx "alias codex='$SUCCESS_CHECKOUT/bin/codex-hud'  # codex-hud alias" "$SUCCESS_ZSHRC"; then
  echo 'successful upgrade did not write the alias to the isolated ZDOTDIR' >&2
  cat "$SUCCESS_ZSHRC" 2>/dev/null >&2 || true
  exit 1
fi

install_runs="$(grep -c ' install$' "$NPM_LOG" || true)"
build_runs="$(grep -c ' run build$' "$NPM_LOG" || true)"
if [[ "$install_runs" -ne 3 || "$build_runs" -ne 2 ]]; then
  echo "unexpected staged npm counts: install=$install_runs build=$build_runs" >&2
  cat "$NPM_LOG" >&2
  exit 1
fi

echo "test-transactional-upgrade: PASS install_fail_head_unchanged=1 build_fail_head_unchanged=1 success_target=1 isolated_zsh_alias=1 install_runs=$install_runs build_runs=$build_runs"
