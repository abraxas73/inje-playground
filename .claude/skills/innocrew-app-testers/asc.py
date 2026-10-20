#!/usr/bin/env python3
"""App Store Connect API 도우미(이노크루 앱 테스터 처리용). 키 값·토큰은 출력하지 않는다.

키: mobile/.env.release의 ASC_KEY_ID·ASC_ISSUER_ID + ~/.private_keys/AuthKey_<ID>.p8 (릴리스 키, Admin 권한).
토큰은 매번 새로 만들고 파일에 남기지 않는다.

  asc.py status [email ...]       사용자·초대(앱 범위 포함)·AX-Dev 테스터 조회(이메일을 주면 그 사람만 표시, AX-Dev는 * 표시)
  asc.py invite EMAIL 이름 성      Customer Support·INNOGRID만으로 사용자 초대
  asc.py uninvite INVITATION_ID   초대 삭제(만료·잘못 만든 초대 정리)
  asc.py axdev EMAIL 이름 성        TestFlight AX-Dev 내부 그룹에 추가(초대 수락한 사용자만)
  asc.py scope USER_ID            사용자의 보이는 앱을 INNOGRID 하나로 교체(PATCH — relationships DELETE는 204만 주고 적용 안 됨)
  asc.py raw METHOD PATH [JSON]   그 밖의 호출
"""
import base64, json, os, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
APP_ID = "6818983333"  # INNOGRID (com.innogrid.playground)
AXDEV = "62fd9923-9909-4fa3-8a3a-3cd59801c9fc"  # TestFlight 내부 그룹 AX-Dev
API = "https://api.appstoreconnect.apple.com"


def envval(key):
    for p in (ROOT / "mobile/.env.release", Path.home() / "Repos/inje-playground/mobile/.env.release"):
        if p.exists():
            v = ""
            for line in p.read_text(encoding="utf-8").splitlines():
                if line.startswith(key + "="):
                    v = line.split("=", 1)[1].strip().strip('"')
            if v:
                return v
    sys.exit(f"mobile/.env.release에 {key}가 없습니다.")


def token():
    kid, iss = envval("ASC_KEY_ID"), envval("ASC_ISSUER_ID")
    p8 = next((p for p in (Path.home() / f".private_keys/AuthKey_{kid}.p8", Path.home() / f"private_keys/AuthKey_{kid}.p8") if p.exists()), None)
    if not p8:
        sys.exit(f"~/.private_keys/AuthKey_{kid}.p8 가 없습니다.")
    b64 = lambda b: base64.urlsafe_b64encode(b).rstrip(b"=").decode()
    now = int(time.time())
    head = b64(json.dumps({"alg": "ES256", "kid": kid, "typ": "JWT"}).encode())
    body = b64(json.dumps({"iss": iss, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"}).encode())
    der = subprocess.run(["openssl", "dgst", "-sha256", "-sign", str(p8)], input=f"{head}.{body}".encode(), capture_output=True, check=True).stdout
    i = 2; n = der[i + 1]; r = der[i + 2:i + 2 + n]; i += 2 + n; n = der[i + 1]; s = der[i + 2:i + 2 + n]
    sig = r.lstrip(b"\x00").rjust(32, b"\x00") + s.lstrip(b"\x00").rjust(32, b"\x00")
    return f"{head}.{body}.{b64(sig)}"


TOKEN = None


def call(method, path, data=None):
    global TOKEN
    TOKEN = TOKEN or token()
    req = urllib.request.Request(API + path, method=method, data=json.dumps(data).encode() if data is not None else None,
                                 headers={"Authorization": "Bearer " + TOKEN, **({"Content-Type": "application/json"} if data is not None else {})})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, {"error": e.read().decode(errors="replace")[:800]}


def pages(path):
    out = []
    while path:
        st, j = call("GET", path)
        if st != 200:
            sys.exit(f"{path} → HTTP {st} {j}")
        out += j.get("data", [])
        nxt = j.get("links", {}).get("next")
        path = nxt.replace(API, "") if nxt else None
    return out


def apps_of(kind, id_):
    _, j = call("GET", f"/v1/{kind}/{id_}/visibleApps?fields[apps]=name&limit=50")
    return [a["attributes"]["name"] for a in (j or {}).get("data", [])]


def status(targets):
    t = [x.lower() for x in targets]
    hit = lambda e: not t or (e or "").lower() in t
    users = pages("/v1/users?limit=200&fields[users]=username,firstName,lastName,roles,allAppsVisible")
    print(f"== 사용자 {len(users)}명")
    for u in users:
        a = u["attributes"]
        if hit(a["username"]):
            apps = "전체" if a.get("allAppsVisible") else ",".join(apps_of("users", u["id"]))
            print(f"  USER {a['username']} | {a['lastName']}{a['firstName']} | {a['roles']} | 앱={apps} | id={u['id']}")
    inv = pages("/v1/userInvitations?limit=200&fields[userInvitations]=email,firstName,lastName,roles,allAppsVisible,expirationDate")
    print(f"== 초대(수락 전) {len(inv)}건")
    for u in inv:
        a = u["attributes"]
        if hit(a["email"]):
            print(f"  INVITE {a['email']} | {a['lastName']}{a['firstName']} | {a['roles']} | 앱={','.join(apps_of('userInvitations', u['id']))} | 만료={a['expirationDate']} | id={u['id']}")
    testers = pages(f"/v1/betaGroups/{AXDEV}/betaTesters?limit=200&fields[betaTesters]=email,firstName,lastName,state")
    print(f"== AX-Dev {len(testers)}명")
    for x in testers:
        a = x["attributes"]
        if not t or hit(a["email"]):
            print(f"  {'*' if t else ' '} {a['email']} | {a['lastName']}{a['firstName']} | state={a['state']}")


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == "status":
        status(args)
    elif cmd == "invite" and len(args) == 3:
        email, first, last = args
        st, j = call("POST", "/v1/userInvitations", {"data": {"type": "userInvitations", "attributes": {
            "email": email, "firstName": first, "lastName": last, "roles": ["CUSTOMER_SUPPORT"], "allAppsVisible": False, "provisioningAllowed": False},
            "relationships": {"visibleApps": {"data": [{"type": "apps", "id": APP_ID}]}}}})
        print(st, email, (j or {}).get("data", {}).get("attributes", {}).get("expirationDate") or j)
    elif cmd == "uninvite" and len(args) == 1:
        print(call("DELETE", f"/v1/userInvitations/{args[0]}")[0])
    elif cmd == "axdev" and len(args) == 3:
        email, first, last = args
        st, j = call("POST", "/v1/betaTesters", {"data": {"type": "betaTesters", "attributes": {"email": email, "firstName": first, "lastName": last},
            "relationships": {"betaGroups": {"data": [{"type": "betaGroups", "id": AXDEV}]}}}})
        print(st, email, (j or {}).get("data", {}).get("id") or j)
    elif cmd == "scope" and len(args) == 1:
        uid = args[0]
        st, j = call("PATCH", f"/v1/users/{uid}", {"data": {"type": "users", "id": uid, "attributes": {"roles": ["CUSTOMER_SUPPORT"], "allAppsVisible": False, "provisioningAllowed": False},
            "relationships": {"visibleApps": {"data": [{"type": "apps", "id": APP_ID}]}}}})
        print(st, apps_of("users", uid) if st == 200 else j)
    elif cmd == "raw" and len(args) >= 2:
        st, j = call(args[0].upper(), args[1], json.loads(args[2]) if len(args) > 2 else None)
        print(st); print(json.dumps(j, ensure_ascii=False, indent=1)[:4000])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
