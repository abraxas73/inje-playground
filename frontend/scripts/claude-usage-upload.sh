#!/usr/bin/env bash
# ~/Downloads의 members-analytics-*.csv(최근 N일)를 /api/admin/claude-usage/imports에 한 번에 업로드
# 사용: ./frontend/scripts/claude-usage-upload.sh [days=3]
set -euo pipefail
DAYS="${1:-3}"
BASE_URL="${INJE_BASE_URL:-https://inje-playground.vercel.app}"
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env.local"
TOKEN="${CLAUDE_OTEL_INGEST_TOKEN:-$(grep -E '^CLAUDE_OTEL_INGEST_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)}"
if [ -z "$TOKEN" ]; then echo "CLAUDE_OTEL_INGEST_TOKEN이 없습니다(.env.local 또는 환경변수)." >&2; exit 1; fi
DL="$HOME/Downloads"; DONE_DIR="$DL/claude-usage-uploaded"; mkdir -p "$DONE_DIR"
FILES=()
while IFS= read -r f; do FILES+=("$f"); done < <(find "$DL" -maxdepth 1 -name 'members-analytics-*.csv' -mtime -"$DAYS" | sort)
if [ ${#FILES[@]} -eq 0 ]; then echo "업로드할 CSV가 없습니다(최근 ${DAYS}일)."; exit 0; fi
ARGS=(); for f in "${FILES[@]}"; do ARGS+=(-F "files=@$f"); done
echo "업로드 ${#FILES[@]}개 → $BASE_URL"
RESP=$(curl -sS -X POST "$BASE_URL/api/admin/claude-usage/imports" -H "Authorization: Bearer $TOKEN" "${ARGS[@]}")
echo "$RESP" | python3 -c '
import json,sys
d=json.load(sys.stdin)
if "error" in d: print("실패:", d["error"]); sys.exit(1)
ok=0
for r in d["results"]:
    if r["ok"]: ok+=1; print(f"✓ {r[\"filename\"]} → {r[\"org_id\"][:8]} {r[\"period_start\"]}~{r[\"period_end\"]} {r[\"row_count\"]}명")
    else: print(f"✗ {r[\"filename\"]}: {r[\"error\"]}")
print(f"{ok}/{len(d[\"results\"])} 성공")
sys.exit(0 if ok==len(d["results"]) else 2)'
STATUS=$?
if [ $STATUS -eq 0 ]; then for f in "${FILES[@]}"; do mv "$f" "$DONE_DIR/"; done; echo "업로드 완료 파일을 $DONE_DIR 로 이동"; fi
exit $STATUS
