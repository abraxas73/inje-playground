#!/bin/bash
# Next.js 프론트엔드 재시작
# Usage: ./frontend/scripts/restart-frontend.sh [port]

PORT="${1:-3003}"

echo "🔄 프론트엔드 재시작 중 (port: $PORT)..."

# 기존 프로세스 종료
PID=$(lsof -ti :$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  echo "기존 프로세스 종료 (PID: $PID)..."
  kill -9 $PID
  sleep 1
fi

cd "$(dirname "$0")/.."

# Turbopack 캐시 정리
rm -rf .next

echo "🚀 dev 서버 시작 (port: $PORT)..."
npm run dev -- -p $PORT
