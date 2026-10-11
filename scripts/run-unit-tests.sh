#!/usr/bin/env bash

set -euo pipefail

# Node 25+ exposes an experimental global localStorage without a backing file.
# That shadows jsdom's implementation and breaks browser-oriented tests. Older
# CI versions do not know the flag, so add it only when the runtime accepts it.
if node --no-experimental-webstorage -e '' >/dev/null 2>&1; then
  export NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--no-experimental-webstorage"
fi

# The measured one-worker suite peaked at 2228 MiB in an isolated 11964 MiB
# guest. Use two workers to overlap per-file imports and jsdom setup while
# retaining headroom; vitest.setup.ts still waits for lazy imports on teardown.
exec npx vitest run --maxWorkers=2 "$@"
