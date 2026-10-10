"""merge.py 출력 → 저장소 픽스처: 이메일 user@example.com, 이름·제목·본문류 'x', 토큰·첨부 키 자리표시, 응답 배열은 3개까지(단 `calls`는 전부 유지).
사용: python3 sanitize.py <in_dir> <out_dir> [가릴 이름 ...]   — 커밋 전 grep으로 잔존 확인(authToken·@innogrid·실명·전화·IP)."""
import json, os, re, sys
src, out, names = sys.argv[1], sys.argv[2], sys.argv[3:]; os.makedirs(out, exist_ok=True)
EMAIL = re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')
PII_KEY = re.compile(r'(name|nm|subject|context|content|title|text|memo|desc|fromaddr|toaddr|addr|email|phone|tel|mobile|signature|html|body|reqtext|note|login_id|view_order|linkkey|approkey|hash_key)', re.I)
KEEP_KEY = {'kind', 'box', 'scope', 'docType', 'version', 'source', 'sourceOf', 'period', 'status', 'dayType', 'gubun', 'code', 'resultMsg', 'note', 'message', 'moduleGbn', 'boxName', 'form_nm', 'proc_nm', 'act_nm'}
TOKEN_KEY = {'filesn', 'file_sn', 'fileid', 'authtoken', 'authsign', 'token', 'signkey'}
PHONE = re.compile(r'\b01[016789][-. ]?\d{3,4}[-. ]?\d{4}\b'); IP = re.compile(r'\b10\.\d+\.\d+\.\d+\b'); ERP = re.compile(r'(ERP_)[0-9a-f-]{20,}')
def san(o, key=None, top=False):
    if isinstance(o, dict): return {k: san(v, k, top and k == 'calls') for k, v in o.items()}
    if isinstance(o, list): return [san(x, key) for x in (o if top else o[:3])]
    if isinstance(o, str):
        kl = (key or '').lower()
        if kl in TOKEN_KEY and len(o) > 20: return 'x'
        o = EMAIL.sub('user@example.com', o); o = PHONE.sub('x', o); o = IP.sub('x', o); o = ERP.sub(r'\1x', o)
        for n in names: o = o.replace(n, 'x')
        if key in KEEP_KEY: return o
        if key and PII_KEY.search(key) and not re.fullmatch(r'[\d.:\-/ ~x]+', o): return 'x'
        if len(o) > 400: return o[:120] + '…'
        return o
    return o
n = 0
for f in sorted(os.listdir(src)):
    if not f.endswith('.json'): continue
    j = json.load(open(os.path.join(src, f)))
    json.dump(san(j, None, True), open(os.path.join(out, f), 'w'), ensure_ascii=False, indent=1); n += 1
print('sanitized', n, '->', out)
