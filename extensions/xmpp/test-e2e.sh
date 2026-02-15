#!/usr/bin/env bash
# End-to-end XMPP test: fully self-contained.
# Sets up everything, runs tests, tears down everything.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.yml"
TEST_DIR="$SCRIPT_DIR/test"

GATEWAY_PID=""
GATEWAY_LOG="/tmp/openclaw-xmpp-e2e-$$.log"
CONFIG_FILE="/tmp/openclaw-xmpp-e2e-$$.json5"
CLEANUP_DONE=false

cleanup() {
  if $CLEANUP_DONE; then return; fi
  CLEANUP_DONE=true
  echo ""
  echo "Cleaning up..."

  # 1. Stop gateway
  if [ -n "$GATEWAY_PID" ] && kill -0 "$GATEWAY_PID" 2>/dev/null; then
    kill "$GATEWAY_PID" 2>/dev/null || true
    wait "$GATEWAY_PID" 2>/dev/null || true
  fi

  # 2. Stop Prosody and remove volume
  $COMPOSE -f "$COMPOSE_FILE" down -v 2>/dev/null || true

  # 3. Remove temp files
  rm -f "$CONFIG_FILE" "${CONFIG_FILE}.bak" "$GATEWAY_LOG"
  rm -f /tmp/openclaw/.gateway.lock 2>/dev/null || true

  # 4. Remove test node_modules
  rm -rf "$TEST_DIR/node_modules" "$TEST_DIR/package-lock.json"

  echo "Done."
}
trap cleanup EXIT INT TERM

# ── Prerequisites ──

if command -v podman &>/dev/null; then
  COMPOSE="podman compose"
  EXEC="podman exec"
elif command -v docker &>/dev/null; then
  COMPOSE="docker compose"
  EXEC="docker exec"
else
  echo "Error: neither podman nor docker found" >&2
  exit 1
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "Error: ANTHROPIC_API_KEY environment variable is not set" >&2
  exit 1
fi

if ! command -v nc &>/dev/null; then
  echo "Error: nc (netcat) is required but not found" >&2
  exit 1
fi

echo "=== XMPP End-to-End Test ==="
echo ""

# ── 1. Install test dependencies ──

echo "1/6  Installing test dependencies..."
(cd "$TEST_DIR" && npm install --silent 2>&1 | tail -1)
echo "     Done."

# ── 2. Start Prosody ──

echo ""
echo "2/6  Starting Prosody XMPP server..."
$COMPOSE -f "$COMPOSE_FILE" up -d 2>&1 | tail -3
echo "     Waiting for Prosody to be ready..."
for i in $(seq 1 30); do
  if nc -z localhost 5222 2>/dev/null; then break; fi
  sleep 1
done
if ! nc -z localhost 5222 2>/dev/null; then
  echo "Error: Prosody not reachable on port 5222 after 30s" >&2
  exit 1
fi
echo "     Prosody is ready."

# ── 3. Register test users (idempotent) ──

echo ""
echo "3/6  Registering XMPP users..."
$EXEC openclaw-prosody prosodyctl register agent localhost agent123 2>/dev/null || true
$EXEC openclaw-prosody prosodyctl register testuser localhost testpass 2>/dev/null || true
echo "     Users registered (agent@localhost, testuser@localhost)."

# ── 4. Build OpenClaw ──

echo ""
echo "4/6  Building OpenClaw..."
(cd "$PROJECT_ROOT" && npx pnpm build 2>&1 | tail -3)

# ── 5. Start gateway ──

echo ""
echo "5/6  Starting OpenClaw gateway..."

cat > "$CONFIG_FILE" <<'CONF'
{
  "gateway": { "mode": "local" },
  "agents": {
    "defaults": {
      "model": { "primary": "anthropic/claude-sonnet-4-5-20250929" }
    }
  },
  "channels": {
    "xmpp": {
      "jid": "agent@localhost",
      "password": "agent123",
      "host": "localhost",
      "port": 5222,
      "tls": false,
      "dmPolicy": "open",
      "allowFrom": ["*"],
      "groupPolicy": "open",
      "autoJoinRooms": ["testroom@conference.localhost"],
      "rooms": { "*": { "requireMention": false, "enabled": true } }
    }
  },
  "plugins": { "entries": { "xmpp": { "enabled": true } } },
  "logging": { "level": "debug" }
}
CONF

# Kill any leftover gateway processes
pkill -9 -f "openclaw-gateway" 2>/dev/null || true
pkill -9 -f "openclaw gateway" 2>/dev/null || true
sleep 1
rm -f /tmp/openclaw/.gateway.lock 2>/dev/null || true

: > "$GATEWAY_LOG"
(cd "$PROJECT_ROOT" && OPENCLAW_CONFIG_PATH="$CONFIG_FILE" npx pnpm openclaw gateway run --verbose) >"$GATEWAY_LOG" 2>&1 &
GATEWAY_PID=$!
echo "     Gateway PID: $GATEWAY_PID"

echo "     Waiting for XMPP provider to connect..."
# Connection confirmation goes to OpenClaw's structured log, not stdout.
# Record the baseline so we only match new entries from this run.
OPENCLAW_LOG="/tmp/openclaw/openclaw-$(date +%Y-%m-%d).log"
BASELINE_LINES=$(wc -l < "$OPENCLAW_LOG" 2>/dev/null || echo 0)
CONNECTED=false
for i in $(seq 1 60); do
  if tail -n +"$((BASELINE_LINES + 1))" "$OPENCLAW_LOG" 2>/dev/null | grep -q "connected to XMPP"; then CONNECTED=true; break; fi
  if grep -q "connected to XMPP" "$GATEWAY_LOG" 2>/dev/null; then CONNECTED=true; break; fi
  if ! kill -0 "$GATEWAY_PID" 2>/dev/null; then
    echo "Error: Gateway exited unexpectedly. Last 20 lines:" >&2
    tail -20 "$GATEWAY_LOG" >&2
    exit 1
  fi
  sleep 1
done
if ! $CONNECTED; then
  echo "Error: XMPP provider did not connect within 60s. Last 20 lines:" >&2
  tail -20 "$GATEWAY_LOG" >&2
  exit 1
fi
echo "     XMPP provider connected. Waiting for MUC room setup..."
sleep 5

# ── 6. Run tests ──

echo ""
echo "6/6  Running tests..."
echo ""

FAILED=0

echo "--- DM Test ---"
if node "$TEST_DIR/test-integration.js" 2>&1; then
  echo "DM test: PASSED"
else
  echo "DM test: FAILED"
  FAILED=1
fi

echo ""
echo "--- MUC Test ---"
if node "$TEST_DIR/test-muc.js" 2>&1; then
  echo "MUC test: PASSED"
else
  echo "MUC test: FAILED"
  FAILED=1
fi

echo ""
echo "=== Results ==="
if [ $FAILED -eq 0 ]; then
  echo "All XMPP tests passed!"
else
  echo "Some tests failed. Gateway log: $GATEWAY_LOG"
  # Keep log on failure so user can inspect
  GATEWAY_LOG=""
fi

exit $FAILED
