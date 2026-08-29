#!/usr/bin/env python3
"""
사내 조직도 명부 동기화 — inno-creed MCP(그룹웨어 아마란스) → /api/admin/directory/sync

  ./frontend/scripts/company-directory-sync.py            # 전사 명부(find_person 'innogrid') → 프로덕션 업로드
  ./frontend/scripts/company-directory-sync.py --dry-run  # 업로드 없이 통계만
  BASE_URL=http://localhost:3003 ./frontend/scripts/company-directory-sync.py

전제: ~/bin/inno-creed(또는 INNO_CREED 환경변수 경로)가 그룹웨어 로그인 크레덴셜을 스스로 취득할 수 있는 이 PC.
토큰: CLAUDE_OTEL_INGEST_TOKEN 환경변수 또는 frontend/.env.local (Vercel과 동일 값).
종료 코드: 0 성공 / 1 설정 오류 / 2 MCP 오류 / 3 서버 응답 오류
Python 3.9+ 표준 라이브러리만 사용.
"""
import json
import os
import select
import subprocess
import sys
import time
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_LOCAL = os.path.join(HERE, "..", ".env.local")
MCP_BIN = os.environ.get("INNO_CREED", os.path.expanduser("~/bin/inno-creed"))
BASE_URL = os.environ.get("BASE_URL", "https://inje-playground.vercel.app").rstrip("/")
QUERY = os.environ.get("DIRECTORY_QUERY", "innogrid")  # find_person 광역 검색어(이메일 도메인) → 전사 명부
DRY_RUN = "--dry-run" in sys.argv


def read_token():
    tok = os.environ.get("CLAUDE_OTEL_INGEST_TOKEN")
    if tok:
        return tok.strip()
    try:
        with open(ENV_LOCAL, encoding="utf-8") as f:
            for line in f:
                if line.startswith("CLAUDE_OTEL_INGEST_TOKEN="):
                    return line.split("=", 1)[1].strip().strip('"')
    except OSError:
        pass
    return None


class Mcp:
    """최소 MCP stdio 클라이언트(initialize → tools/call)."""

    def __init__(self, cmd):
        self.p = subprocess.Popen([cmd], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
        self._id = 0

    def _send(self, obj):
        self.p.stdin.write(json.dumps(obj) + "\n")
        self.p.stdin.flush()

    def _recv(self, timeout):
        end = time.time() + timeout
        while time.time() < end:
            r, _, _ = select.select([self.p.stdout], [], [], 0.2)
            if not r:
                if self.p.poll() is not None:
                    raise RuntimeError("MCP 프로세스 종료: " + self.p.stderr.read()[-500:])
                continue
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError("MCP stdout 닫힘: " + self.p.stderr.read()[-500:])
            line = line.strip()
            if not line:
                continue
            try:
                return json.loads(line)
            except ValueError:
                continue
        raise RuntimeError("MCP 응답 시간 초과(%ss)" % timeout)

    def call(self, method, params, timeout=90):
        self._id += 1
        self._send({"jsonrpc": "2.0", "id": self._id, "method": method, "params": params})
        while True:
            msg = self._recv(timeout)
            if msg.get("id") == self._id:
                if "error" in msg:
                    raise RuntimeError("MCP 오류: %s" % json.dumps(msg["error"], ensure_ascii=False)[:300])
                return msg["result"]

    def initialize(self):
        self.call("initialize", {"protocolVersion": "2024-11-05", "capabilities": {}, "clientInfo": {"name": "company-directory-sync", "version": "1"}}, timeout=30)
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def tool(self, name, arguments, timeout=90):
        res = self.call("tools/call", {"name": name, "arguments": arguments}, timeout)
        text = "".join(c.get("text", "") for c in res.get("content", []) if c.get("type") == "text")
        if res.get("isError"):
            raise RuntimeError("도구 %s 실패: %s" % (name, text[:300]))
        return json.loads(text)

    def close(self):
        try:
            self.p.terminate()
        except OSError:
            pass


def main():
    if not os.path.exists(MCP_BIN):
        print("inno-creed 바이너리가 없습니다: %s (INNO_CREED 환경변수로 지정)" % MCP_BIN)
        return 1
    token = read_token()
    if not token and not DRY_RUN:
        print("CLAUDE_OTEL_INGEST_TOKEN이 없습니다(환경변수 또는 frontend/.env.local).")
        return 1

    print("inno-creed(%s) 시작 → find_person('%s')" % (MCP_BIN, QUERY))
    mcp = Mcp(MCP_BIN)
    try:
        mcp.initialize()
        result = mcp.tool("find_person", {"query": QUERY}, timeout=120)
    except (RuntimeError, ValueError) as e:
        print("MCP 실패:", e)
        mcp.close()
        return 2
    mcp.close()

    people = result.get("people") or []
    roster = result.get("rosterSize")
    with_email = [p for p in people if p.get("email")]
    units = {}
    for p in with_email:
        segs = [s.strip() for s in (p.get("deptPath") or "").split(">") if s.strip()]
        company = segs[0] if segs else None
        i = 0
        while i < len(segs) and segs[i] == company:
            i += 1
        top = segs[i] if i < len(segs) else "(없음)"
        units[top] = units.get(top, 0) + 1
    print("명부 %d명(rosterSize=%s, 이메일 있음 %d) · 부문별: %s" % (len(people), roster, len(with_email), json.dumps(units, ensure_ascii=False)))
    if roster and len(people) < int(roster):
        print("⚠️ 검색 결과(%d)가 전사 명부(%s)보다 적습니다 — 검색어를 확인하세요." % (len(people), roster))
    if DRY_RUN:
        print("dry-run: 업로드 생략")
        return 0

    # 개인정보 최소화: 휴대폰은 보내지 않는다
    payload_people = [{k: v for k, v in p.items() if k != "mobile"} for p in people]
    body = json.dumps({"source": "amaranth", "query": QUERY, "people": payload_people}).encode("utf-8")
    req = urllib.request.Request(
        BASE_URL + "/api/admin/directory/sync",
        data=body,
        method="POST",
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            out = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print("서버 오류 HTTP %d: %s" % (e.code, e.read().decode("utf-8", "replace")[:500]))
        return 3
    except (urllib.error.URLError, ValueError) as e:
        print("요청 실패:", e)
        return 3
    print("✓ 동기화 완료 → %s : 총 %s명, upsert %s, 비활성 %s, skipped %s (synced_at %s)" % (
        BASE_URL, out.get("total"), out.get("upserted"), out.get("deactivated"), out.get("skipped"), out.get("synced_at")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
