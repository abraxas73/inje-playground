"""inno-creed(stdio MCP) 호출 드라이버 — mitmproxy 뒤에서 도구를 부르고 호출 시간 창·결과를 기록한다.
사용: from driver import call, finish  (환경변수 CAP_OUT=출력 폴더, CAP_LOG=로그 파일, CAP_PROXY=http://127.0.0.1:8089, INNO_CREED=바이너리 경로)
각 call(tool, args, label)은 out/<label>.json을 쓰고, finish()는 모든 호출을 CAP_LOG에 모은다(merge.py가 t0/t1로 흐름을 배정)."""
import json, os, select, subprocess, sys, time
OUT = os.environ.get('CAP_OUT', 'out'); LOG = os.environ.get('CAP_LOG', 'batch-log.json'); os.makedirs(OUT, exist_ok=True)
env = dict(os.environ)
if os.environ.get('CAP_PROXY'): env['HTTPS_PROXY'] = os.environ['CAP_PROXY']
p = subprocess.Popen([os.environ.get('INNO_CREED', os.path.expanduser('~/bin/inno-creed'))], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, env=env)
def send(m): p.stdin.write(json.dumps(m, ensure_ascii=False) + '\n'); p.stdin.flush()
def recv(i, timeout=120):
    end = time.time() + timeout
    while time.time() < end:
        r, _, _ = select.select([p.stdout], [], [], 1)
        if not r: continue
        line = p.stdout.readline()
        if not line: return None
        try: m = json.loads(line)
        except Exception: continue
        if m.get('id') == i: return m
send({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "cap", "version": "0"}}}); recv(1)
send({"jsonrpc": "2.0", "method": "notifications/initialized"})
seq = [100]; log = []
def call(tool, args, label=None):
    seq[0] += 1; i = seq[0]; t0 = time.time()
    send({"jsonrpc": "2.0", "id": i, "method": "tools/call", "params": {"name": tool, "arguments": args}})
    m = recv(i) or {}; t1 = time.time()
    res = m.get('result') or {}; texts = [c.get('text', '') for c in res.get('content', []) if c.get('type') == 'text']
    body = '\n'.join(texts) if texts else json.dumps(m.get('error') or res, ensure_ascii=False)
    try: j = json.loads(body)
    except Exception: j = body
    rec = {'tool': tool, 'args': args, 'label': label or tool, 't0': t0, 't1': t1, 'isError': res.get('isError'), 'result': j}
    log.append(rec); json.dump(rec, open(os.path.join(OUT, (label or tool) + '.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"{label or tool}: {int((t1 - t0) * 1000)}ms isError={res.get('isError')} {str(body)[:110].replace(chr(10), ' ')}", flush=True)
    return j
def finish():
    p.stdin.close(); p.terminate()
    json.dump(log, open(LOG, 'w'), ensure_ascii=False, indent=1); print('done', len(log))
