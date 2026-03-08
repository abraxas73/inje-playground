#!/usr/bin/env bash
set -e
STORAGE_DIR="${1:-$(dirname "$0")/..}"
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
