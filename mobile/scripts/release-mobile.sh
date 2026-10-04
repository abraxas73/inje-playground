#!/usr/bin/env bash
# 모바일 앱 릴리스(운영자 Mac). 사용법:
#   mobile/scripts/release-mobile.sh (android|ios|all) [--notes "…"] [--testflight-url URL] [--dry-run] [--allow-dirty]
# 1) 작업 트리 확인 2) flutter test·analyze 3) pubspec version → APP_VERSION/APP_BUILD
# 4) android: APK 빌드 → Supabase 스토리지 mobile/android/innogrid-<v>+<b>.apk 업로드 → settings.mobile_release.android 갱신
# 5) ios: IPA 빌드 → App Store Connect 업로드(xcrun altool, API 키) → settings.mobile_release.ios 갱신 6) 다음 할 일 출력
# 환경: frontend/.env.local(NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY), mobile/.env.release(ASC_KEY_ID·ASC_ISSUER_ID — iOS만, .p8은 ~/.private_keys/AuthKey_<ID>.p8)
# 비밀 값은 절대 출력하지 않는다. 버전 올리기는 pubspec.yaml을 손으로 고친다. 런북 docs/mobile-app.md §배포
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MOBILE="$ROOT/mobile"
TARGET=${1:-}; [ $# -gt 0 ] && shift
NOTES=""; TF_URL=""; DRY=0; ALLOW_DIRTY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --notes) NOTES=$2; shift 2;;
    --testflight-url) TF_URL=$2; shift 2;;
    --dry-run) DRY=1; shift;;
    --allow-dirty) ALLOW_DIRTY=1; shift;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 2;;
  esac
done
case "$TARGET" in android|ios|all) ;; *) echo "사용법: $0 (android|ios|all) [--notes \"…\"] [--testflight-url URL] [--dry-run] [--allow-dirty]" >&2; exit 2;; esac
DO_ANDROID=0; DO_IOS=0; [ "$TARGET" != ios ] && DO_ANDROID=1; [ "$TARGET" != android ] && DO_IOS=1
say() { printf '\n▶ %s\n' "$*"; }

# 1. 작업 트리
if [ "$ALLOW_DIRTY" = 0 ] && [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "작업 트리가 깨끗하지 않습니다. 커밋하거나 --allow-dirty를 쓰세요." >&2; exit 1
fi

# 2. 환경(값은 출력하지 않음)
# 키가 없거나 파일이 없으면 빈 문자열(set -e·pipefail에서도 조용히 죽지 않게 grep 실패를 삼킨다)
envval() { { grep -E "^$2=" "$1" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
SUPABASE_URL=$(envval "$ROOT/frontend/.env.local" NEXT_PUBLIC_SUPABASE_URL)
SERVICE_KEY=$(envval "$ROOT/frontend/.env.local" SUPABASE_SERVICE_ROLE_KEY)
[ -n "$SUPABASE_URL" ] && [ -n "$SERVICE_KEY" ] || { echo "frontend/.env.local에 NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 필요합니다." >&2; exit 1; }
ASC_KEY_ID=""; ASC_ISSUER_ID=""
if [ "$DO_IOS" = 1 ]; then
  ASC_KEY_ID=$(envval "$MOBILE/.env.release" ASC_KEY_ID); ASC_ISSUER_ID=$(envval "$MOBILE/.env.release" ASC_ISSUER_ID)
  [ -n "$ASC_KEY_ID" ] && [ -n "$ASC_ISSUER_ID" ] || { echo "mobile/.env.release에 ASC_KEY_ID=…, ASC_ISSUER_ID=… 가 필요합니다(App Store Connect → Users and Access → Integrations)." >&2; exit 1; }
  ls ~/.private_keys/AuthKey_"$ASC_KEY_ID".p8 ~/private_keys/AuthKey_"$ASC_KEY_ID".p8 >/dev/null 2>&1 || { echo "~/.private_keys/AuthKey_$ASC_KEY_ID.p8 가 없습니다." >&2; exit 1; }
fi

# 3. 버전
VERSION_LINE=$(grep -E '^version:' "$MOBILE/pubspec.yaml" | head -1 | awk '{print $2}')
VERSION=${VERSION_LINE%%+*}; BUILD=${VERSION_LINE##*+}
[[ "$BUILD" =~ ^[0-9]+$ ]] && [ "$BUILD" != "$VERSION_LINE" ] || { echo "pubspec version 형식은 X.Y.Z+N 이어야 합니다: $VERSION_LINE" >&2; exit 1; }
say "버전 $VERSION (빌드 $BUILD) · 대상 $TARGET$([ "$DRY" = 1 ] && echo ' · dry-run')"
DEFINES=(--dart-define=APP_VERSION="$VERSION" --dart-define=APP_BUILD="$BUILD")

# 4. 게이트
say "flutter test · analyze"
if [ "$DRY" = 1 ]; then echo "  (dry-run) flutter test && flutter analyze"; else
  (cd "$MOBILE" && flutter test >/dev/null && flutter analyze >/dev/null) || { echo "테스트/분석 실패 — 중단" >&2; exit 1; }
  echo "  통과"
fi

REST="$SUPABASE_URL/rest/v1"; STORAGE="$SUPABASE_URL/storage/v1"
AUTH=(-H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY")
read_release() { curl -sf "${AUTH[@]}" "$REST/settings?key=eq.mobile_release&select=value" | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r[0]["value"] if r else "{}")'; }
# write_release <android|ios> [apkPath] — 자기 플랫폼 블록과 --notes/--testflight-url만 갈아 끼우고 나머지는 보존
write_release() {
  local cur="{}"; [ "$DRY" = 0 ] && cur=$(read_release)
  local merged
  merged=$(PLATFORM="$1" APK_PATH="${2:-}" VERSION="$VERSION" BUILD="$BUILD" NOTES="$NOTES" TF_URL="$TF_URL" python3 - "$cur" <<'PY'
import json, os, sys, datetime
try: cur = json.loads(sys.argv[1] or "{}")
except Exception: cur = {}
if not isinstance(cur, dict): cur = {}
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
p = os.environ["PLATFORM"]
block = {"version": os.environ["VERSION"], "build": int(os.environ["BUILD"]), "releasedAt": now}
if p == "android": block["apkPath"] = os.environ["APK_PATH"]
cur[p] = block
if os.environ["NOTES"]: cur["notes"] = os.environ["NOTES"]
if os.environ["TF_URL"]: cur["testflightUrl"] = os.environ["TF_URL"]
cur.setdefault("notes", ""); cur.setdefault("testflightUrl", None)
print(json.dumps(cur, ensure_ascii=False))
PY
)
  if [ "$DRY" = 1 ]; then echo "  (dry-run) settings.mobile_release ← $merged"; return; fi
  local body; body=$(python3 -c 'import json,sys; print(json.dumps({"key":"mobile_release","value":sys.argv[1]}))' "$merged")
  curl -sf -X POST "${AUTH[@]}" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=minimal" "$REST/settings?on_conflict=key" --data-binary "$body" >/dev/null
  echo "  settings.mobile_release ← $merged"
}

# 5. Android
if [ "$DO_ANDROID" = 1 ]; then
  APK_NAME="innogrid-$VERSION+$BUILD.apk"; APK_PATH="android/$APK_NAME"; APK_URL_PATH="android/${APK_NAME//+/%2B}"
  say "Android: 같은 빌드가 이미 올라가 있는지 확인"
  SKIP_UPLOAD=0
  if [ "$DRY" = 1 ]; then echo "  (dry-run) storage list mobile/android → $APK_NAME"; else
    n=$(curl -sf "${AUTH[@]}" -H "Content-Type: application/json" -X POST "$STORAGE/object/list/mobile" --data-binary "{\"prefix\":\"android\",\"search\":\"$APK_NAME\",\"limit\":10}" | python3 -c 'import sys,json; n=sys.argv[1]; print(sum(1 for o in json.load(sys.stdin) if o.get("name")==n))' "$APK_NAME")
    if [ "$n" != 0 ]; then
      # APK는 있는데 settings가 다른 곳을 가리키면 지난 실행이 설정 쓰기에서 실패한 것 — 빌드·업로드를 건너뛰고 설정만 다시 쓴다(고아 APK 복구)
      cur_apk=$(read_release | python3 -c 'import sys,json
try: d = json.loads(sys.stdin.read() or "{}")
except Exception: d = {}
print(((d.get("android") or {}) if isinstance(d, dict) else {}).get("apkPath", ""))')
      [ "$cur_apk" != "$APK_PATH" ] || { echo "$APK_PATH 가 이미 있습니다 — pubspec의 빌드 번호(+N)를 올리세요." >&2; exit 1; }
      echo "  APK는 있으나 settings.mobile_release가 가리키지 않음 — 빌드·업로드는 건너뛰고 설정만 갱신"
      SKIP_UPLOAD=1
    else echo "  없음"; fi
  fi
  if [ "$SKIP_UPLOAD" = 0 ]; then
  say "Android: flutter build apk --release"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) flutter build apk --release ${DEFINES[*]}"; else
    (cd "$MOBILE" && flutter build apk --release "${DEFINES[@]}" >/dev/null) || { echo "APK 빌드 실패" >&2; exit 1; }
    ls -la "$MOBILE/build/app/outputs/flutter-apk/app-release.apk" | awk '{print "  " $5 " bytes"}'
  fi
  say "Android: 스토리지 업로드 → mobile/$APK_PATH"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) POST $STORAGE/object/mobile/$APK_URL_PATH"; else
    # 프로젝트 전역 파일 상한(Storage 설정 fileSizeLimit, 2026-10-04 200MB로 올림)을 넘으면 서버가 거부한다 — 상태 코드와 본문을 보여 준다
    RESP=$(mktemp); CODE=$(curl -s --max-time 900 -o "$RESP" -w '%{http_code}' -X POST "${AUTH[@]}" -H "Content-Type: application/vnd.android.package-archive" -H "x-upsert: false" "$STORAGE/object/mobile/$APK_URL_PATH" --data-binary @"$MOBILE/build/app/outputs/flutter-apk/app-release.apk" || true)
    [ "$CODE" = 200 ] || { echo "업로드 실패 (HTTP $CODE): $(head -c 300 "$RESP")" >&2; rm -f "$RESP"; exit 1; }
    rm -f "$RESP"; echo "  완료"
  fi
  fi
  write_release android "$APK_PATH"
fi

# 6. iOS
if [ "$DO_IOS" = 1 ]; then
  say "iOS: flutter build ipa --release (App Store Connect 수출)"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) flutter build ipa --release ${DEFINES[*]}"; else
    (cd "$MOBILE" && flutter build ipa --release "${DEFINES[@]}" >/dev/null) || { echo "IPA 빌드 실패 — Xcode 서명(팀·인증서)을 확인하세요" >&2; exit 1; }
  fi
  IPA=$(ls "$MOBILE"/build/ios/ipa/*.ipa 2>/dev/null | head -1 || true)
  say "iOS: App Store Connect 업로드(altool)"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) xcrun altool --upload-app --type ios --file <ipa> --apiKey <key-id> --apiIssuer <issuer>"; else
    [ -n "$IPA" ] || { echo "IPA가 없습니다(build/ios/ipa)." >&2; exit 1; }
    LOG=$(mktemp)
    xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" >"$LOG" 2>&1 || { tail -20 "$LOG" >&2; rm -f "$LOG"; echo "업로드 실패" >&2; exit 1; }
    grep -i -E "uploaded|succeeded|Delivery UUID" "$LOG" | head -3 || echo "  완료"
    rm -f "$LOG"
  fi
  write_release ios
fi

# 7. 다음 할 일
say "다음 할 일"
[ "$DO_ANDROID" = 1 ] && echo "  · Android: 웹 https://inje-playground.vercel.app/apps 에서 바로 받을 수 있습니다. 설치된 앱은 다음 실행 때 배너로 안내합니다."
[ "$DO_IOS" = 1 ] && echo "  · iOS: App Store Connect → TestFlight에서 처리 완료(≈10분)를 기다린 뒤 외부 그룹 '이노그리드 구성원'에 빌드를 추가하세요(첫 빌드는 Beta App Review)."
echo "  · 공지 예시: [이노그리드 앱 $VERSION] ${NOTES:-변경 내용} — 설치·업데이트: https://inje-playground.vercel.app/apps"
