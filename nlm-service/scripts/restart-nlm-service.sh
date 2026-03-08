#!/bin/bash
# NLM Service (FastAPI) 재시작
# Usage: ./nlm-service/scripts/restart-nlm-service.sh [port]

PORT="${1:-8090}"

echo "🔄 NLM Service 재시작 중 (port: $PORT)..."

# 기존 프로세스 종료
PID=$(lsof -ti :$PORT 2>/dev/null)
if [ -n "$PID" ]; then
  echo "기존 프로세스 종료 (PID: $PID)..."
  kill -9 $PID
  sleep 1
fi

cd "$(dirname "$0")/.."

# venv 생성 (없으면)
if [ ! -d .venv ]; then
  echo "📦 가상환경 생성 중..."
  python3 -m venv .venv
fi

# venv 활성화
source .venv/bin/activate

# 의존성 설치
pip install -q -r requirements.txt

echo "🚀 NLM Service 시작 (port: $PORT)..."
python -m uvicorn src.main:app --host 0.0.0.0 --port $PORT --reload
