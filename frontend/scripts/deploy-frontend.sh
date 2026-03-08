#!/bin/bash
# 프론트엔드 Vercel 배포
# Usage:
#   ./frontend/scripts/deploy-frontend.sh          # Preview 배포
#   ./frontend/scripts/deploy-frontend.sh prod     # Production 배포

set -e

cd "$(dirname "$0")/.."

START_TIME=$(date +%s)

echo "🔨 빌드 확인 중..."
npm run build

if [ "$1" = "prod" ]; then
  echo "🚀 Production 배포 중..."
  vercel --prod
else
  echo "🔍 Preview 배포 중..."
  vercel
fi

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))
MINUTES=$((ELAPSED / 60))
SECONDS=$((ELAPSED % 60))

echo "✅ 배포 완료 — $(date '+%Y-%m-%d %H:%M:%S') (소요시간: ${MINUTES}분 ${SECONDS}초)"
