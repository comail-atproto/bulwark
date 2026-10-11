#!/usr/bin/env bash
# Run the Playwright integration suite against the containerised Stalwart stack.
#
# Playwright's browser download host is often unreachable (and some host OSes
# aren't supported by the browser bundles), so the tests run inside the official
# Playwright container, which ships the browsers. That container joins the
# Stalwart container's network namespace (docker run --network container:...).
# Webmail shares it too; JMAP, SMTP and the app use separate loopback ports.
#
# The docker stack itself is brought up here (on the host) and the in-container
# run is told to skip its own docker management via IT_NO_DOCKER=1.
#
# Usage:
#   integration/run-tests.sh                 # whole suite
#   integration/run-tests.sh 01-login        # a single spec (grep on file name)
#   IT_GREP=@smoke integration/run-tests.sh  # a named selection
#
# Env:
#   IT_VIDEO=on   record a video.webm for every test (not just failures);
#                 also: off | retain-on-failure (default) | on-first-retry.
#                 e.g. IT_VIDEO=on integration/run-tests.sh 01-login
#   IT_GREP       Playwright --grep selection, e.g. @smoke
#   IT_PROJECT    Compose project name (default bulwark-integration). A run that
#                 sets a unique value gets its own containers and volumes.
#                 Dynamic-port runs default to a unique project.
#   IT_STACK_PREFIX  container/volume prefix (defaults to IT_PROJECT when set,
#                 otherwise bulwark-it; dynamic runs use their generated project)
#   IT_DYNAMIC_PORTS=1  publish each service on a Docker-assigned ephemeral host
#                 port (host port 0) instead of the fixed defaults
#   IT_TEARDOWN=1 always remove the stack (and volumes) when the run ends
#   CI            keeps one retry for evidence and rejects flaky results.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
INTEGRATION_DIR="${REPO_ROOT}/integration"
PROJECT="${IT_PROJECT:-bulwark-integration}"
stack_prefix=bulwark-it
if [[ -n "${IT_PROJECT:-}" || "${IT_DYNAMIC_PORTS:-}" == 1 ]]; then
  PROJECT="${IT_PROJECT:-bulwark-integration-$(date +%s)-$$}"
  stack_prefix="$PROJECT"
fi
export IT_STACK_PREFIX="${IT_STACK_PREFIX:-$stack_prefix}"
NETWORK_CONTAINER="${IT_STACK_PREFIX}-stalwart"

cd "${INTEGRATION_DIR}"
[ -f .env ] || cp .env.example .env
set -a
# shellcheck disable=SC1091
source .env
set +a

# Fixed defaults keep local runs matching the documentation. IT_DYNAMIC_PORTS=1
# asks Docker for ephemeral host ports instead, so concurrent runs cannot
# collide on a fixed port. The test-facing URLs below are unaffected: the
# browser shares the Stalwart container's network namespace.
if [ "${IT_DYNAMIC_PORTS:-}" = "1" ]; then
  export IT_STALWART_HOST_PORT="${IT_STALWART_HOST_PORT:-0}"
  export IT_SMTP_HOST_PORT="${IT_SMTP_HOST_PORT:-0}"
  export IT_IMAP_HOST_PORT="${IT_IMAP_HOST_PORT:-0}"
  export IT_WEBMAIL_HOST_PORT="${IT_WEBMAIL_HOST_PORT:-0}"
fi

export IT_WEBMAIL_URL="${IT_WEBMAIL_URL:-http://localhost:3000}"
export IT_JMAP_URL="${IT_JMAP_URL:-http://localhost:8080}"
export IT_JMAP_SERVER_URL="${IT_JMAP_SERVER_URL:-$IT_JMAP_URL}"
export IT_SMTP_HOST="${IT_SMTP_HOST:-localhost}"
export IT_SMTP_PORT="${IT_SMTP_PORT:-587}"
export IT_ACCOUNT_PASSWORD="${IT_ACCOUNT_PASSWORD:-${TEST_ACCOUNT_PASSWORD:-test-pass-123}}"

compose() { docker compose -p "${PROJECT}" --env-file .env "$@"; }

diagnostics() {
  mkdir -p test-results
  compose ps --all > test-results/compose-ps.log 2>&1 || true
  compose logs --no-color > test-results/compose.log 2>&1 || true
  echo "== integration diagnostics written to integration/test-results =="
}

# Runs for every exit path. A failing build, up, readiness wait or Playwright
# run captures the compose diagnostics before the stack is removed, and the
# original exit code is preserved (including the 130/143 set by the signal
# traps below).
cleanup() {
  local code=$?
  if [ "${code}" -ne 0 ]; then
    diagnostics || true
  fi
  if [ "${IT_TEARDOWN:-}" = "1" ]; then
    echo "== tearing down ${PROJECT} =="
    compose down -v --remove-orphans || true
  else
    echo "== leaving ${PROJECT} up (set IT_TEARDOWN=1 to remove it) =="
  fi
  exit "${code}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [ ! -d "${REPO_ROOT}/node_modules/@playwright/test" ]; then
  echo "error: ${REPO_ROOT}/node_modules/@playwright/test is missing." >&2
  echo "       The Playwright container mounts this repository and resolves" >&2
  echo "       @playwright/test from node_modules; run 'npm ci' first." >&2
  exit 1
fi

# The image tag must track the installed @playwright/test (which npm ci pins to
# package-lock.json), or the browser executable the image ships will not match
# the runner that asks for it.
PW_VERSION="$(node -p '
  const installed = require("@playwright/test/package.json").version;
  const locked = require("../package-lock.json").packages["node_modules/@playwright/test"].version;
  if (installed !== locked) throw new Error("Playwright differs from package-lock.json");
  installed
' 2>/dev/null || true)"
if [ -z "${PW_VERSION}" ]; then
  echo "error: installed @playwright/test is missing or differs from the lock; run 'npm ci'." >&2
  exit 1
fi
PW_IMAGE="mcr.microsoft.com/playwright:v${PW_VERSION}-noble"

echo "== bringing up stack (project ${PROJECT}) =="
bash stalwart/prepare-stalwart-cli.sh
compose up -d --build --wait --wait-timeout 300

echo "== running Playwright in ${PW_IMAGE} =="
playwright_args=(npx --no-install playwright test -c playwright.integration.config.ts)
[[ -n "${IT_GREP:-}" ]] && playwright_args+=(--grep "${IT_GREP}")
if (($#)); then playwright_args+=("$@"); fi

docker run --rm \
  --network "container:${NETWORK_CONTAINER}" \
  --user "$(id -u):$(id -g)" \
  -v "${REPO_ROOT}":/work -w /work \
  -e IT_NO_DOCKER=1 \
  -e HOME=/tmp \
  -e IT_VIDEO="${IT_VIDEO:-}" \
  -e CI="${CI:-}" \
  -e IT_ACCOUNT_PASSWORD \
  -e IT_WEBMAIL_URL \
  -e IT_JMAP_URL \
  -e IT_SMTP_HOST \
  -e IT_SMTP_PORT \
  "${PW_IMAGE}" \
  "${playwright_args[@]}"