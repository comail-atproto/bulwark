#!/usr/bin/env bash

set -euo pipefail

# Node 25+ exposes an experimental global localStorage without a backing file.
# That shadows jsdom's implementation and breaks browser-oriented tests. Older
# CI versions do not know the flag, so add it only when the runtime accepts it.
if node --no-experimental-webstorage -e '' >/dev/null 2>&1; then
  export NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--no-experimental-webstorage"
fi

# Match the CI guest's three CPUs while keeping each test file in its own
# process. Timezone tests need process-level isolation.
exec npx vitest run --config vitest.comail.config.ts --maxWorkers=3 "$@"
