#!/usr/bin/env bash
set -euo pipefail

bundle=$(readlink -f "${1:?built standalone bundle}")
test -f "$bundle/server.js"
test -f "$bundle/.next/BUILD_ID"
test -x "$bundle/node_modules/@esbuild/linux-x64/bin/esbuild"
"$bundle/node_modules/@esbuild/linux-x64/bin/esbuild" --version > /dev/null
test -z "$(nix-store --query --references "$bundle")"
test -z "$(find "$bundle" -type l -print -quit)"
temp_dir=$(mktemp -d)
port=$((20000 + RANDOM))
identity=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb
NODE_ENV=production HOSTNAME=127.0.0.1 PORT="$port" COMAIL_RELEASE_IDENTITY="$identity" \
  SETTINGS_DATA_DIR="$temp_dir/settings" ADMIN_CONFIG_DIR="$temp_dir/admin" \
  ADMIN_STATE_DIR="$temp_dir/admin-state" TELEMETRY_DATA_DIR="$temp_dir/telemetry" \
  VERSION_CHECK_DATA_DIR="$temp_dir/version-check" \
  node "$bundle/server.js" > "$temp_dir/server.log" 2>&1 &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null || true; wait "$server_pid" 2>/dev/null || true; rm -r "$temp_dir"' EXIT
for _ in $(seq 1 50); do
  if body=$(curl --fail --silent --max-time 2 "http://127.0.0.1:$port/api/health") &&
    BODY="$body" EXPECTED_IDENTITY="$identity" node -e '
      const value = JSON.parse(process.env.BODY);
      if (value.status !== "healthy" || value.release_identity !== process.env.EXPECTED_IDENTITY) process.exit(1);
    '; then
    exit 0
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then break; fi
  sleep 0.2
done
cat "$temp_dir/server.log" >&2
echo 'Bulwark standalone bundle did not start under release Node' >&2
exit 1
