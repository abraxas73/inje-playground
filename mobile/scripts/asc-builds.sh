#!/usr/bin/env bash
# App Store Connect 빌드 처리 상태 조회(읽기 전용). 사용법: mobile/scripts/asc-builds.sh
# .env.release의 ASC_KEY_ID·ASC_ISSUER_ID와 ~/.private_keys/AuthKey_<ID>.p8로 ES256 JWT를 만들어 /v1/apps·/v1/builds를 읽는다. 키 값은 출력하지 않는다.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
envval() { { grep -E "^$2=" "$1" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
KID=$(envval "$ROOT/mobile/.env.release" ASC_KEY_ID); ISS=$(envval "$ROOT/mobile/.env.release" ASC_ISSUER_ID)
[ -n "$KID" ] && [ -n "$ISS" ] || { echo "mobile/.env.release에 ASC_KEY_ID·ASC_ISSUER_ID가 필요합니다." >&2; exit 1; }
P8=$(ls ~/.private_keys/AuthKey_"$KID".p8 ~/private_keys/AuthKey_"$KID".p8 2>/dev/null | head -1) || true
[ -n "${P8:-}" ] || { echo "~/.private_keys/AuthKey_$KID.p8 가 없습니다." >&2; exit 1; }
python3 - "$KID" "$ISS" "$P8" <<'PY'
import sys, time, json, base64, subprocess, urllib.request, urllib.error
kid, iss, p8 = sys.argv[1:4]
b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
now = int(time.time())
header = b64(json.dumps({"alg": "ES256", "kid": kid, "typ": "JWT"}).encode())
payload = b64(json.dumps({"iss": iss, "iat": now, "exp": now + 600, "aud": "appstoreconnect-v1"}).encode())
der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", p8], input=f"{header}.{payload}".encode(), capture_output=True, check=True).stdout
i = 2; l = der[i + 1]; r = der[i + 2:i + 2 + l]; i += 2 + l; l = der[i + 1]; s = der[i + 2:i + 2 + l]
sig = r.lstrip(b"\x00").rjust(32, b"\x00") + s.lstrip(b"\x00").rjust(32, b"\x00")
token = f"{header}.{payload}.{b64(sig)}"
def get(path):
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path, headers={"Authorization": "Bearer " + token})
    try:
        with urllib.request.urlopen(req, timeout=30) as res: return json.load(res)
    except urllib.error.HTTPError as e:
        print("API 오류", e.code, e.read()[:300].decode(errors="replace")); sys.exit(1)
apps = get("/v1/apps?filter[bundleId]=com.innogrid.playground&fields[apps]=name,bundleId")
if not apps.get("data"): print("앱 레코드 없음(com.innogrid.playground)"); sys.exit(1)
a = apps["data"][0]; print(f"앱: {a['attributes']['name']} ({a['attributes']['bundleId']}) id {a['id']}")
b = get(f"/v1/builds?filter[app]={a['id']}&sort=-uploadedDate&limit=10&fields[builds]=version,uploadedDate,processingState,expired,expirationDate,preReleaseVersion&include=preReleaseVersion&fields[preReleaseVersions]=version")
pre = {x["id"]: x["attributes"]["version"] for x in b.get("included", []) if x["type"] == "preReleaseVersions"}
rows = b.get("data", [])
print(f"빌드 {len(rows)}개" + (" — 아직 없음(업로드 후 처리 대기 10~60분, ITMS 메일 확인)" if not rows else ""))
for x in rows:
    at = x["attributes"]; pv = pre.get((x.get("relationships", {}).get("preReleaseVersion", {}).get("data") or {}).get("id"), "?")
    print(f"  {pv} ({at['version']})  {at['processingState']:<10}  업로드 {at['uploadedDate']}  {'만료' if at.get('expired') else '만료일 ' + str(at.get('expirationDate'))}")
PY
