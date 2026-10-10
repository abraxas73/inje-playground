"""mitmdump -nr <flows> -s dump_addon.py --set dump_out=<json> : 흐름을 JSON 배열로(토큰·서명·쿠키 제외)."""
import json
from mitmproxy import ctx
DROP = {'authorization', 'cookie', 'wehago-sign', 'transaction-id', 'timestamp', 'set-cookie', 'access-domain'}
class Dump:
    def __init__(self): self.rows = []
    def load(self, loader): loader.add_option('dump_out', str, 'flows.json', '출력 파일')
    def _body(self, msg):
        raw = msg.get_text(strict=False)
        if raw is None: return None
        try: return json.loads(raw)
        except Exception: return raw[:20000]
    def response(self, f):
        ct = f.response.headers.get('content-type', '')
        self.rows.append({'t': f.request.timestamp_start, 'method': f.request.method, 'path': f.request.path, 'host': f.request.host,
            'contentType': f.request.headers.get('content-type', ''), 'headers': {k: v for k, v in f.request.headers.items() if k.lower() not in DROP},
            'body': self._body(f.request), 'status': f.response.status_code, 'responseType': ct,
            'response': self._body(f.response) if ('json' in ct or 'text' in ct) else f'<binary {len(f.response.raw_content or b"")}B>'})
    def done(self):
        json.dump(self.rows, open(ctx.options.dump_out, 'w'), ensure_ascii=False, indent=1)
addons = [Dump()]
