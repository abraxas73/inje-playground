#!/usr/bin/env bash
# Dooray API 연결 테스트
# Usage: ./nlm-service/scripts/test-dooray.sh [token] [projectId]
#
# 환경별 테스트:
#   1) curl 직접 → Dooray API
#   2) 로컬 nlm-service (localhost:8090)
#   3) fly.io nlm-service (inje-nlm-service.fly.dev)
set -e

TOKEN="${1:-ajjt1imxmtj4:H8zkUa6fRomR4nEvD1FA0A}"
PROJECT_ID="${2:-4239250185816538712}"

echo "=== Dooray API 연결 테스트 ==="
echo "Token: ${TOKEN:0:8}..."
echo "Project: $PROJECT_ID"
echo ""

# 1) Dooray API 직접 호출
echo "--- [1] curl → Dooray API 직접 ---"
HTTP_CODE=$(curl -s -o /tmp/dooray-test-1.json -w "%{http_code}" \
  "https://api.dooray.com/project/v1/projects/${PROJECT_ID}/members?page=0&size=1" \
  -H "Authorization: dooray-api ${TOKEN}" \
  -H "Content-Type: application/json")
echo "HTTP $HTTP_CODE"
cat /tmp/dooray-test-1.json | python3 -m json.tool 2>/dev/null || cat /tmp/dooray-test-1.json
echo ""

# 2) 로컬 nlm-service
echo "--- [2] localhost:8090 → nlm-service ---"
HTTP_CODE=$(curl -s -o /tmp/dooray-test-2.json -w "%{http_code}" \
  "http://localhost:8090/dooray/members?projectId=${PROJECT_ID}" \
  -H "x-dooray-token: ${TOKEN}" 2>/dev/null) || HTTP_CODE="연결 실패"
echo "HTTP $HTTP_CODE"
cat /tmp/dooray-test-2.json 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "(응답 없음)"
echo ""

# 3) fly.io nlm-service
echo "--- [3] fly.io → nlm-service ---"
HTTP_CODE=$(curl -s -o /tmp/dooray-test-3.json -w "%{http_code}" \
  "https://inje-nlm-service.fly.dev/dooray/members?projectId=${PROJECT_ID}" \
  -H "x-dooray-token: ${TOKEN}" 2>/dev/null) || HTTP_CODE="연결 실패"
echo "HTTP $HTTP_CODE"
cat /tmp/dooray-test-3.json 2>/dev/null | python3 -m json.tool 2>/dev/null || echo "(응답 없음)"
echo ""

# 정리
rm -f /tmp/dooray-test-{1,2,3}.json
echo "=== 테스트 완료 ==="
