#!/usr/bin/env bash
# 모바일 앱 릴리스(운영자 Mac). 사용법:
#   mobile/scripts/release-mobile.sh (android|ios|all) [--notes "…"] [--testflight-url URL] [--dry-run] [--allow-dirty]
#   mobile/scripts/release-mobile.sh link --testflight-url URL      # 빌드 없이 TestFlight 공개 링크만 저장(심사 승인 뒤 링크가 생기므로 따로 둔다)
#   mobile/scripts/release-mobile.sh sharepoint-folder <폴더 링크>   # APK 사본을 올릴 SharePoint 폴더 링크 저장(한 번)
#   mobile/scripts/release-mobile.sh aab                             # Google Play용 AAB만 빌드(업로드·설정 변경 없음)
#   mobile/scripts/release-mobile.sh play                            # AAB 빌드 + Google Play 내부 테스트 트랙 업로드(android/all 뒤 자동, 실패 시 재시도용)
#   Play 업로드는 mobile/.env.release의 PLAY_SERVICE_ACCOUNT_JSON(서비스 계정 키 경로, git 밖)이 있을 때만 — docs/play-console-guide.md §자동 업로드
#   mobile/scripts/release-mobile.sh sharepoint                      # 현재 Android 릴리스 APK 사본을 SharePoint에 innogrid-app-<X.Y.Z>.apk로 올림(android/all 뒤 자동, 실패 시 재시도용)
# 1) 작업 트리 확인 2) flutter test·analyze 3) pubspec version → APP_VERSION/APP_BUILD
# 4) android: APK 빌드 → Supabase 스토리지 mobile/android/innogrid-<v>+<b>.apk 업로드 → settings.mobile_release.android 갱신
# 5) ios: IPA 빌드 → App Store Connect 업로드(xcrun altool, API 키) → settings.mobile_release.ios 갱신 6) 다음 할 일 출력
# 환경: frontend/.env.local(NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY·CRON_SECRET — SharePoint 단계), mobile/.env.release(OPERATOR_EMAIL — SharePoint 단계의 Microsoft 연결 주인(관리자); ASC_KEY_ID·ASC_ISSUER_ID — iOS만, .p8은 ~/.private_keys/AuthKey_<ID>.p8)
# 비밀 값은 절대 출력하지 않는다. 버전 올리기는 pubspec.yaml을 손으로 고친다. 런북 docs/mobile-app.md §배포
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MOBILE="$ROOT/mobile"
APP_URL="https://inje-playground.vercel.app"
TARGET=${1:-}; [ $# -gt 0 ] && shift
FOLDER_URL=""; if [ "$TARGET" = sharepoint-folder ]; then FOLDER_URL=${1:-}; [ $# -gt 0 ] && shift; case "$FOLDER_URL" in http://*|https://*) ;; *) echo "sharepoint-folder에는 폴더 링크(https://…)가 필요합니다." >&2; exit 2;; esac; fi
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
DO_ANDROID=0; DO_IOS=0
case "$TARGET" in
  android) DO_ANDROID=1;;
  ios) DO_IOS=1;;
  all) DO_ANDROID=1; DO_IOS=1;;
  link) [ -n "$TF_URL" ] || { echo "link에는 --testflight-url URL 이 필요합니다." >&2; exit 2; };;
  sharepoint|sharepoint-folder|aab|play) ;;
  *) echo "사용법: $0 (android|ios|all) [--notes \"…\"] [--testflight-url URL] [--dry-run] [--allow-dirty] | $0 link --testflight-url URL | $0 sharepoint-folder <링크> | $0 sharepoint | $0 aab | $0 play" >&2; exit 2;;
esac
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
if [ "$TARGET" != aab ] && [ "$TARGET" != play ]; then [ -n "$SUPABASE_URL" ] && [ -n "$SERVICE_KEY" ] || { echo "frontend/.env.local에 NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 필요합니다." >&2; exit 1; }; fi
CRON_SECRET=$(envval "$ROOT/frontend/.env.local" CRON_SECRET)
OPERATOR_EMAIL=$(envval "$MOBILE/.env.release" OPERATOR_EMAIL)
PLAY_SA=$(envval "$MOBILE/.env.release" PLAY_SERVICE_ACCOUNT_JSON); PLAY_SA=${PLAY_SA/#\~/$HOME}
PLAY_PACKAGE=com.innogrid.playground
if [ "$TARGET" = sharepoint ]; then
  [ -n "$CRON_SECRET" ] && [ -n "$OPERATOR_EMAIL" ] || { echo "SharePoint 단계에는 frontend/.env.local의 CRON_SECRET과 mobile/.env.release의 OPERATOR_EMAIL(관리자, Microsoft 연결됨)이 필요합니다." >&2; exit 1; }
fi
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

# 4. 게이트(link·sharepoint·sharepoint-folder는 빌드가 없어 건너뜀)
case "$TARGET" in link|sharepoint|sharepoint-folder) GATE=0;; *) GATE=1;; esac
if [ "$GATE" = 1 ]; then
say "flutter test · analyze"
if [ "$DRY" = 1 ]; then echo "  (dry-run) flutter test && flutter analyze"; else
  (cd "$MOBILE" && flutter test >/dev/null && flutter analyze >/dev/null) || { echo "테스트/분석 실패 — 중단" >&2; exit 1; }
  echo "  통과"
fi
fi

# AAB(Google Play): 서명은 APK와 같은 업로드 키(key.properties), 버전 코드는 pubspec +N(APK·Play가 같은 번호를 공유 — Play는 이전에 올린 번호보다 커야 받는다)
AAB_OUT="$MOBILE/build/innogrid-$VERSION+$BUILD.aab"
build_aab() {
  [ -f "$MOBILE/android/key.properties" ] || { echo "mobile/android/key.properties가 없습니다 — 디버그 키로 서명된 AAB는 Play가 받지 않습니다." >&2; return 1; }
  say "Android: flutter build appbundle --release"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) flutter build appbundle --release ${DEFINES[*]}"; return 0; fi
  (cd "$MOBILE" && flutter build appbundle --release "${DEFINES[@]}" >/dev/null) || { echo "AAB 빌드 실패" >&2; return 1; }
  cp "$MOBILE/build/app/outputs/bundle/release/app-release.aab" "$AAB_OUT"
  echo "  $AAB_OUT ($(du -h "$AAB_OUT" | cut -f1))"
}
# Google Play 내부 테스트 업로드. $1=soft면 키가 없거나 실패해도 릴리스를 깨지 않는다.
play_upload() {
  say "Google Play: 내부 테스트 트랙 업로드"
  if [ -z "$PLAY_SA" ] || [ ! -f "$PLAY_SA" ]; then
    echo "  건너뜀 — mobile/.env.release에 PLAY_SERVICE_ACCOUNT_JSON=<서비스 계정 키 경로>가 필요합니다(docs/play-console-guide.md §자동 업로드). 나중에: $0 play" >&2
    [ "${1:-}" = soft ] && return 0 || exit 1
  fi
  build_aab || { [ "${1:-}" = soft ] && { echo "  나중에: $0 play" >&2; return 0; } || exit 1; }
  if [ "$DRY" = 1 ]; then echo "  (dry-run) play-upload.py $PLAY_PACKAGE internal"; return 0; fi
  local rc=0; python3 "$MOBILE/scripts/play-upload.py" "$PLAY_SA" "$AAB_OUT" "$PLAY_PACKAGE" "$VERSION — $NOTES" || rc=$?
  if [ "$rc" = 0 ] || [ "$rc" = 3 ]; then return 0; fi
  echo "  다시 시도: $0 play" >&2
  [ "${1:-}" = soft ] && return 0 || exit 1
}
if [ "$TARGET" = aab ]; then
  build_aab || exit 1
  say "다음 할 일"; echo "  · 자동 업로드: $0 play  (또는 Play Console → 내부 테스트 → 새 버전 만들기에 위 파일)"
  exit 0
fi
if [ "$TARGET" = play ]; then play_upload; exit 0; fi

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
if p in ("android", "ios"):
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

# 전역 설정 한 키 쓰기(문자열)
write_setting() {
  local body; body=$(python3 -c 'import json,sys; print(json.dumps({"key":sys.argv[1],"value":sys.argv[2]}))' "$1" "$2")
  if [ "$DRY" = 1 ]; then echo "  (dry-run) settings.$1 ← $2"; return; fi
  curl -sf -X POST "${AUTH[@]}" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=minimal" "$REST/settings?on_conflict=key" --data-binary "$body" >/dev/null
  echo "  settings.$1 ← $2"
}
# SharePoint 사본: 서버(POST /api/mobile/release/sharepoint, CRON_SECRET)가 스토리지 APK를 읽어 Graph로 올린다. $1=soft면 실패해도 릴리스를 깨지 않는다.
sharepoint_upload() {
  say "SharePoint: APK 사본 업로드(innogrid-app-$VERSION.apk)"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) POST $APP_URL/api/mobile/release/sharepoint {operator: <관리자>}"; return 0; fi
  if [ -z "$CRON_SECRET" ] || [ -z "$OPERATOR_EMAIL" ]; then
    echo "  건너뜀 — frontend/.env.local CRON_SECRET, mobile/.env.release OPERATOR_EMAIL이 필요합니다. 나중에: $0 sharepoint" >&2
    [ "${1:-}" = soft ] && return 0 || exit 1
  fi
  local resp; resp=$(mktemp)
  local code; code=$(curl -s --max-time 600 -o "$resp" -w '%{http_code}' -X POST "$APP_URL/api/mobile/release/sharepoint" -H "Authorization: Bearer $CRON_SECRET" -H "Content-Type: application/json" --data-binary "{\"operator\":\"$OPERATOR_EMAIL\"}" || true)
  if [ "$code" = 200 ]; then
    python3 -c 'import sys,json; j=json.load(open(sys.argv[1])); print("  올림:", j.get("folderName",""), "/", j.get("name",""), "\n  링크:", j.get("webUrl","")); w=j.get("warning"); print("  주의:", w) if w else None' "$resp"
    rm -f "$resp"; return 0
  fi
  echo "  실패 (HTTP $code): $(head -c 300 "$resp")" >&2; rm -f "$resp"
  echo "  다시 시도: $0 sharepoint   (폴더 링크가 없으면 먼저: $0 sharepoint-folder <링크>)" >&2
  [ "${1:-}" = soft ] && return 0 || exit 1
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
  sharepoint_upload soft
  play_upload soft
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

# 6b. 공개 링크만 저장 / SharePoint 폴더 저장 / SharePoint 사본만 다시
if [ "$TARGET" = link ]; then
  say "TestFlight 공개 링크 저장"
  write_release link
fi
if [ "$TARGET" = sharepoint-folder ]; then
  say "SharePoint 폴더 링크 저장"
  write_setting mobile_sharepoint_folder "$FOLDER_URL"
fi
[ "$TARGET" = sharepoint ] && sharepoint_upload hard

# 7. 다음 할 일
say "다음 할 일"
[ "$DO_ANDROID" = 1 ] && echo "  · Android: 웹 https://inje-playground.vercel.app/apps 에서 바로 받을 수 있습니다. 설치된 앱은 다음 실행 때 배너로 안내합니다."
[ "$TARGET" = sharepoint-folder ] && echo "  · 다음 android 릴리스부터 APK 사본이 이 폴더에 innogrid-app-<X.Y.Z>.apk로 올라갑니다. 지금 것은: $0 sharepoint"
[ "$TARGET" = link ] && echo "  · 웹 /apps의 'TestFlight에서 열기' 버튼과 iOS 앱 배너 링크가 이 주소를 씁니다."
[ "$DO_IOS" = 1 ] && echo "  · iOS: App Store Connect → TestFlight에서 처리 완료(≈10분)를 기다린 뒤 외부 그룹 '이노그리드 구성원'에 빌드를 추가하세요(첫 빌드는 Beta App Review)."
echo "  · 공지 예시: [이노그리드 앱 $VERSION] ${NOTES:-변경 내용} — 설치·업데이트: https://inje-playground.vercel.app/apps"
