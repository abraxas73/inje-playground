#!/usr/bin/env bash
# NLM Service — Fly.io 배포
# Usage: ./nlm-service/scripts/deploy.sh [--no-cache]
set -euo pipefail

cd "$(dirname "$0")/.."

APP_NAME="inje-nlm-service"
NO_CACHE=""

for arg in "$@"; do
  case $arg in
    --no-cache) NO_CACHE="--no-cache" ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

# flyctl 설치 확인
if ! command -v flyctl &>/dev/null; then
  echo "❌ flyctl이 설치되어 있지 않습니다."
  echo "   brew install flyctl  또는  curl -L https://fly.io/install.sh | sh"
  exit 1
fi

# 인증 확인
if ! flyctl auth whoami &>/dev/null; then
  echo "❌ Fly.io에 로그인되어 있지 않습니다."
  echo "   flyctl auth login"
  exit 1
fi

echo "🚀 $APP_NAME 배포 시작..."
echo "   Region: nrt (Tokyo)"
echo ""

# 배포
flyctl deploy --app "$APP_NAME" $NO_CACHE

echo ""
echo "✅ 배포 완료!"
echo "   URL: https://$APP_NAME.fly.dev"
echo ""

# 상태 확인
flyctl status --app "$APP_NAME"
