#!/usr/bin/env bash
# NotebookLM 로그인 — storage_state.json 생성
# Usage: ./nlm-service/scripts/nlm-login.sh [storage_dir]
set -e

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

STORAGE_DIR="${1:-.}"
echo "NotebookLM 로그인을 시작합니다..."
echo "Storage directory: $STORAGE_DIR"
NOTEBOOKLM_HOME="$STORAGE_DIR" python -c "
import asyncio
from notebooklm import NotebookLMClient

async def login():
    client = NotebookLMClient()
    async with client:
        print('로그인 성공! storage_state.json이 저장되었습니다.')

asyncio.run(login())
"
