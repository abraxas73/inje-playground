#!/bin/bash
# Windows 서명 릴리스(임시 경로 B) — 런북 docs/windows-signing.md
#   운영자 Mac의 az login 토큰 → GitHub 비밀값 AZURE_SIGNING_TOKEN(잠깐) → "Windows app" sign=true
#   → 끝나면(실패해도) 비밀값 삭제 → 산출물 서명 검증 → desktop-releases 게시 → settings 확인
# 사용: mobile/scripts/release-windows-signed.sh [--no-publish]
# 버전은 mobile/pubspec.yaml(커밋·푸시된 main) 그대로. 같은 버전은 다시 게시할 수 없다(불변).
# 토큰·키 값은 출력하지 않는다.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT"
PUBLISH=1; [ "${1:-}" = "--no-publish" ] && PUBLISH=0
REF=avooqcxehfeurjhqqgui
OUT=${TMPDIR:-/tmp}/innocrew-windows-signed; rm -rf "$OUT"; mkdir -p "$OUT"
say() { printf '\n▶ %s\n' "$*"; }
sql() { # Management API(키체인 "Supabase CLI" 토큰)로 SQL 한 건
  local t; t=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
  python3 -c 'import json,sys;print(json.dumps({"query":sys.argv[1]}))' "$1" |
    curl -sf -X POST "https://api.supabase.com/v1/projects/$REF/database/query" -H "Authorization: Bearer $t" -H "Content-Type: application/json" --data-binary @-
}

VER_LINE=$(grep -E '^version:' mobile/pubspec.yaml | awk '{print $2}'); VERSION=${VER_LINE%%+*}
say "Windows $VERSION 서명 릴리스"
[ "$(git rev-parse --abbrev-ref HEAD)" = main ] || { echo "main에서만 실행" >&2; exit 1; }
git fetch -q; [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main이 origin/main과 다릅니다(push 먼저)" >&2; exit 1; }
az account show >/dev/null 2>&1 || { echo "az login이 필요합니다: ! az login" >&2; exit 1; }

# 토큰은 만료 5분 전부터만 새로 발급된다. 비밀값은 작업 시작 때 읽히고 서명은 시작 후 ~15분에 돈다 → 남은 시간 40분 미만이면 새 토큰까지 대기.
remaining() { python3 - "$(az account get-access-token --resource https://codesigning.azure.net --query expiresOn -o tsv)" <<'PY'
import sys, datetime
print(int((datetime.datetime.fromisoformat(sys.argv[1]) - datetime.datetime.now()).total_seconds() // 60))
PY
}
while [ "$(remaining)" -lt 40 ]; do echo "  토큰 남은 시간 $(remaining)분 — 새 토큰 발급까지 대기"; sleep 60; done
echo "  토큰 남은 시간 $(remaining)분"

say "GitHub 비밀값 설정 → 서명 빌드 실행"
trap 'gh secret delete AZURE_SIGNING_TOKEN >/dev/null 2>&1 && echo "  비밀값 AZURE_SIGNING_TOKEN 삭제"' EXIT
az account get-access-token --resource https://codesigning.azure.net --query accessToken -o tsv | gh secret set AZURE_SIGNING_TOKEN
gh workflow run "Windows app" --ref main -f sign=true
sleep 8; RUN=$(gh run list --workflow "Windows app" --limit 1 --json databaseId -q '.[0].databaseId'); echo "  run $RUN"
gh run watch "$RUN" --exit-status >/dev/null 2>&1 || [ "$(gh run view "$RUN" --json conclusion -q .conclusion)" = success ] || { echo "서명 빌드 실패: gh run view $RUN --log-failed" >&2; exit 1; }
gh secret delete AZURE_SIGNING_TOKEN >/dev/null && echo "  비밀값 AZURE_SIGNING_TOKEN 삭제"; trap - EXIT

say "산출물 받기·검증"
gh run download "$RUN" -D "$OUT"
FILE="$OUT/INNOGRID-Windows/INNOGRID-Windows-$VERSION-Setup.exe"
[ -f "$FILE" ] && [ -f "$FILE.update.json" ] || { echo "산출물이 없습니다: $FILE" >&2; exit 1; }
# 로그는 파일로 받아서 검사 — `gh … | grep -q`는 grep이 먼저 끝나 gh가 SIGPIPE로 죽고 pipefail이 실패로 본다(1.7.102에서 서명됐는데 멈춤)
gh run view "$RUN" --log > "$OUT/run.log"
grep -q 'Running Sign Tool jsign' "$OUT/run.log" || { echo "Inno Setup SignTool 서명 로그가 없습니다(임시 설치 엔진 미서명 → Error 4551)" >&2; exit 1; }
SHA=$(shasum -a 256 "$FILE" | cut -c1-64); [ "$SHA" = "$(cut -c1-64 "$FILE.sha256")" ] || { echo "sha256 불일치" >&2; exit 1; }
if command -v osslsigncode >/dev/null; then
  curl -sfL "http://www.microsoft.com/pkiops/certs/Microsoft%20Identity%20Verification%20Root%20Certificate%20Authority%202020.crt" | openssl x509 -inform DER -out "$OUT/msroot.pem"
  osslsigncode verify -in "$FILE" -CAfile "$OUT/msroot.pem" -TSA-CAfile "$OUT/msroot.pem" 2>&1 | grep -q '^Succeeded' || { echo "Authenticode 검증 실패" >&2; exit 1; }
  echo "  Authenticode·타임스탬프 검증 ok"
else echo "  (osslsigncode 없음 — brew install osslsigncode, CI 검증만 신뢰)"; fi
echo "  $FILE  sha256 $SHA"
[ "$PUBLISH" = 1 ] || exit 0

say "게시(desktop-releases) → settings.desktop_app_release.windows"
PREV=$(sql "select value::jsonb->'windows'->>'sha256' s from settings where key='desktop_app_release'" | python3 -c 'import json,sys;print(json.load(sys.stdin)[0]["s"])')
(cd frontend && node --env-file=.env.local scripts/publish-desktop.mjs windows "$VERSION" "$FILE" "$PREV") > "$OUT/publish.json"
sql "$(python3 -c 'import json,sys;print(json.load(open(sys.argv[1]))["publicationSQL"])' "$OUT/publish.json")" | head -c 120; echo
NOW=$(sql "select value::jsonb->'windows'->>'version' v, value::jsonb->'windows'->>'sha256' s from settings where key='desktop_app_release'")
echo "  게시 확인: $NOW"
echo "$NOW" | grep -q "$SHA" || { echo "게시 정보의 sha256이 파일과 다릅니다" >&2; exit 1; }
