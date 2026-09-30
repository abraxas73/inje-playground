# -*- coding: utf-8 -*-
"""서명 URL로만 파일을 주고받는다. 호스트는 env SUPABASE_URL의 것만 허용한다(SSRF 방지)."""
import os
from pathlib import Path
from urllib.parse import urlparse

import httpx

TIMEOUT = httpx.Timeout(120.0, connect=10.0)


def allowed_host(url: str) -> bool:
    base = os.environ.get("SUPABASE_URL", "")
    want = urlparse(base).hostname
    got = urlparse(url)
    return bool(want) and got.scheme == "https" and got.hostname == want


def download(url: str, dest: Path) -> Path:
    if not allowed_host(url):
        raise ValueError("허용되지 않은 다운로드 주소")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with httpx.stream("GET", url, timeout=TIMEOUT, follow_redirects=False) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
    return dest


def upload(url: str, path: Path, content_type: str) -> int:
    if not allowed_host(url):
        raise ValueError("허용되지 않은 업로드 주소")
    data = path.read_bytes()
    r = httpx.put(url, content=data, headers={"Content-Type": content_type, "x-upsert": "true"}, timeout=TIMEOUT)
    r.raise_for_status()
    return len(data)
