#!/bin/bash
# Kill existing Next.js dev server and start a new one

PORT=3003

# Kill any process using the port
PID=$(lsof -ti :$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  echo "Killing existing process on port $PORT (PID: $PID)..."
  kill -9 $PID
  sleep 1
fi

cd "$(dirname "$0")/.."

# Clear stale Turbopack cache
rm -rf .next

echo "Starting dev server on port $PORT..."
npm run dev -- -p $PORT
