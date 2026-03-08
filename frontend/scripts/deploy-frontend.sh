#!/bin/bash
# 프론트엔드 Vercel 배포
# Usage:
#   ./frontend/scripts/deploy-frontend.sh          # Preview 배포
#   ./frontend/scripts/deploy-frontend.sh prod     # Production 배포

set -e

cd "$(dirname "$0")/.."

echo "🔨 빌드 확인 중..."
npm run build

if [ "$1" = "prod" ]; then
  echo "🚀 Production 배포 중..."
  vercel --prod
else
  echo "🔍 Preview 배포 중..."
  vercel
fi

echo "✅ 배포 완료"
