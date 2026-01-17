#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

CODEX_HUD_LIB_ONLY=1
source "$SCRIPT_DIR/../bin/codex-hud"

echo "[Test] shell_escape round-trip"
original="path/with 'quotes' and spaces"
escaped=$(shell_escape "$original")
eval "roundtrip=$escaped"
if [[ "$roundtrip" != "$original" ]]; then
    echo "shell_escape round-trip failed" >&2
    exit 1
fi

echo "[Test] hash_cwd fallbacks"
tmpbin=$(mktemp -d)
cleanup() {
    rm -rf "$tmpbin"
}
trap cleanup EXIT

PATH_ORIG="$PATH"
PATH="$tmpbin:/usr/bin:/bin"

cat > "$tmpbin/md5sum" <<'EOF'
#!/usr/bin/env bash
echo "deadbeefcafebabe  -"
EOF
chmod +x "$tmpbin/md5sum"

hash=$(hash_cwd "/tmp/codex-hud")
if [[ "$hash" != "deadbeef" ]]; then
    echo "md5sum fallback failed: $hash" >&2
    exit 1
fi

rm "$tmpbin/md5sum"
cat > "$tmpbin/md5" <<'EOF'
#!/usr/bin/env bash
echo "MD5 (stdin) = feedfacecafed00d"
EOF
chmod +x "$tmpbin/md5"

hash=$(hash_cwd "/tmp/codex-hud")
if [[ "$hash" != "feedface" ]]; then
    echo "md5 fallback failed: $hash" >&2
    exit 1
fi

rm "$tmpbin/md5"
cat > "$tmpbin/shasum" <<'EOF'
#!/usr/bin/env bash
echo "0123456789abcdef0123456789abcdef  -"
EOF
chmod +x "$tmpbin/shasum"

hash=$(hash_cwd "/tmp/codex-hud")
if [[ "$hash" != "01234567" ]]; then
    echo "shasum fallback failed: $hash" >&2
    exit 1
fi

rm "$tmpbin/shasum"
PATH="$tmpbin"

hash=$(hash_cwd "/tmp/codex-hud")
if [[ "$hash" != "$$" ]]; then
    echo "no-hash fallback failed: $hash" >&2
    exit 1
fi

PATH="$PATH_ORIG"

echo "Wrapper helper tests passed."
