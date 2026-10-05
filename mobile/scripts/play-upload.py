#!/usr/bin/env python3
"""Google Play 내부 테스트 트랙에 AAB 올리기(Google Play Developer API v3, 서비스 계정).

사용: play-upload.py <서비스계정.json> <aab 경로> <패키지> <출시 노트>
      play-upload.py apk <서비스계정.json> <패키지> <versionCode> <저장할 apk 경로>
        — Google(앱 서명 키)이 서명한 universal APK를 내려받는다(Play가 만드는 데 몇 분 걸려 기다린다).
          /apps·SharePoint도 이 APK를 배포해 Play 설치본과 서명을 맞춘다.
- 서비스 계정 JSON은 ~/.private_keys/ 같은 git 밖에 둔다. 키·토큰은 출력하지 않는다.
- 서명은 openssl(RS256)로 — 추가 파이썬 패키지 없이 표준 라이브러리만.
- 앱이 아직 초안이라 "draft만 가능" 오류가 나면 draft로 다시 올리고 콘솔에서 출시하라고 안내한다(종료 코드 3).
"""
import base64, json, os, subprocess, sys, tempfile, time, urllib.error, urllib.parse, urllib.request

API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications"


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def token(sa: dict) -> str:
    now = int(time.time())
    head = b64(json.dumps({"alg": "RS256", "typ": "JWT"}).encode())
    claim = b64(json.dumps({"iss": sa["client_email"], "scope": "https://www.googleapis.com/auth/androidpublisher",
                            "aud": sa["token_uri"], "iat": now, "exp": now + 3000}).encode())
    with tempfile.NamedTemporaryFile("w", delete=False) as f:
        f.write(sa["private_key"])
        keyfile = f.name
    try:
        os.chmod(keyfile, 0o600)
        sig = subprocess.run(["openssl", "dgst", "-sha256", "-sign", keyfile], input=f"{head}.{claim}".encode(),
                             capture_output=True, check=True).stdout
    finally:
        os.unlink(keyfile)
    body = urllib.parse.urlencode({"grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                                   "assertion": f"{head}.{claim}.{b64(sig)}"}).encode()
    return json.load(urllib.request.urlopen(urllib.request.Request(sa["token_uri"], data=body)))["access_token"]


def call(method: str, url: str, tok: str, body=None, raw: bytes | None = None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers={"Authorization": f"Bearer {tok}", "Content-Type": ctype})
    try:
        with urllib.request.urlopen(req, timeout=900) as r:
            txt = r.read().decode()
            return json.loads(txt) if txt else {}
    except urllib.error.HTTPError as e:
        msg = e.read().decode()[:500]
        raise RuntimeError(f"HTTP {e.code} {method} {url.split('/applications/')[-1]}: {msg}") from None


def download_apk(sa_path: str, pkg: str, vc: str, out: str) -> int:
    sa = json.load(open(sa_path))
    deadline = time.time() + 900
    while True:
        tok = token(sa)
        apks = call("GET", f"{API}/{pkg}/generatedApks/{vc}", tok).get("generatedApks", [])
        uni = next((a for a in apks if a.get("generatedUniversalApk", {}).get("downloadId")), None)
        if uni:
            break
        if time.time() > deadline:
            raise RuntimeError("Play가 서명한 APK가 15분 안에 준비되지 않았습니다")
        print("  Play가 APK를 만드는 중 — 20초 뒤 다시 확인")
        time.sleep(20)
    did = uni["generatedUniversalApk"]["downloadId"]
    req = urllib.request.Request(f"{API}/{pkg}/generatedApks/{vc}/downloads/{urllib.parse.quote(did, safe='')}:download?alt=media",
                                 headers={"Authorization": f"Bearer {tok}"})
    with urllib.request.urlopen(req, timeout=900) as r, open(out, "wb") as f:
        f.write(r.read())
    sha = uni.get("certificateSha256Hash", "")
    print(f"  Google 서명 APK: {out} ({os.path.getsize(out) // 1024 // 1024}MB, 서명 SHA-256 {sha[:23]}…)")
    return 0


def main() -> int:
    if len(sys.argv) == 6 and sys.argv[1] == "apk":
        return download_apk(*sys.argv[2:])
    if len(sys.argv) != 5:
        print(__doc__, file=sys.stderr)
        return 2
    sa_path, aab, pkg, notes = sys.argv[1:]
    sa = json.load(open(sa_path))
    tok = token(sa)
    edit = call("POST", f"{API}/{pkg}/edits", tok, {})["id"]
    try:
        with open(aab, "rb") as f:
            vc = call("POST", f"{UPLOAD}/{pkg}/edits/{edit}/bundles?uploadType=media", tok, raw=f.read(), ctype="application/octet-stream")["versionCode"]
    except RuntimeError as e:
        # 같은 버전 코드가 이미 Play에 있으면(지난 실행이 업로드 뒤에 실패) 다시 올리지 않고 넘어간다
        if "already been used" in str(e) or "already used" in str(e):
            call("DELETE", f"{API}/{pkg}/edits/{edit}", tok)
            print("  이미 Play에 있는 버전 코드 — 업로드는 건너뜀")
            return 4
        raise
    print(f"  올림: versionCode {vc}")

    def release(status: str):
        rel = {"versionCodes": [str(vc)], "status": status}
        if notes:
            rel["releaseNotes"] = [{"language": "ko-KR", "text": notes[:500]}]
        call("PUT", f"{API}/{pkg}/edits/{edit}/tracks/internal", tok, {"track": "internal", "releases": [rel]})
        call("POST", f"{API}/{pkg}/edits/{edit}:commit", tok)

    try:
        release("completed")
        print("  내부 테스트 트랙에 출시됨(테스터 폰은 Play 자동 업데이트)")
        return 0
    except RuntimeError as e:
        if "draft" not in str(e).lower():
            raise
        release("draft")
        print("  앱이 아직 초안이라 draft로 올렸습니다 — Play Console 내부 테스트에서 '출시'를 한 번 눌러 주세요.")
        return 3


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # 비밀 값은 메시지에 없다(응답 본문 앞 500자만)
        print(f"  Play 업로드 실패: {e}", file=sys.stderr)
        sys.exit(1)
