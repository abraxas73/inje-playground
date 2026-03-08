#!/usr/bin/env bash
# NotebookLM 로그인 — Playwright 브라우저로 Google 로그인 후 쿠키 저장
# Usage: ./nlm-service/scripts/nlm-login.sh [storage_path]
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
pip install -q playwright
python -m playwright install chromium 2>/dev/null || true

STORAGE_PATH="${1:-./storage_state.json}"

echo "🔐 NotebookLM 로그인을 시작합니다..."
echo "Storage: $STORAGE_PATH"

python3 -c "
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright

storage_path = Path('$STORAGE_PATH')
storage_path.parent.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(
        user_data_dir=str(Path.home() / '.notebooklm' / 'browser_profile'),
        headless=False,
        args=[
            '--disable-blink-features=AutomationControlled',
            '--password-store=basic',
        ],
        ignore_default_args=['--enable-automation'],
    )

    page = context.pages[0] if context.pages else context.new_page()
    page.goto('https://notebooklm.google.com/')

    print()
    print('📋 안내:')
    print('  1. 브라우저에서 Google 로그인을 완료하세요')
    print('  2. NotebookLM 홈 화면이 보일 때까지 기다리세요')
    print('  3. 여기서 ENTER를 눌러 저장하세요')
    print()

    input('[로그인 완료 후 ENTER] ')

    context.storage_state(path=str(storage_path))
    context.close()

print(f'✅ 인증 정보 저장 완료: {storage_path}')
"
