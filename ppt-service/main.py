# -*- coding: utf-8 -*-
"""innogrid ppt-service — Next.js(frontend)가 호출하는 PPT 생성 API. 패키지 innogrid_ppt는 수정하지 않는다."""
import hmac
import os

from fastapi import FastAPI, Header, HTTPException, Request

from innogrid_ppt import tokens as T
from service import catalog as C

app = FastAPI(title="innogrid ppt-service", docs_url=None, redoc_url=None)

MAX_BODY = 2 * 1024 * 1024


def check_token(x_ppt_token: str | None):
    token = os.environ.get("PPT_SERVICE_TOKEN", "")
    if not token or not x_ppt_token or not hmac.compare_digest(token.encode(), x_ppt_token.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


def check_body(request: Request):
    length = request.headers.get("content-length")
    if length and int(length) > MAX_BODY:
        raise HTTPException(status_code=413, detail="body too large")


@app.get("/health")
def health(x_ppt_token: str | None = Header(default=None)):
    check_token(x_ppt_token)
    return {"ok": True, "templateSlides": T.TEMPLATE_SLIDES, "layouts": len(T.LAYOUTS), "package": C.PACKAGE_VERSION}


@app.get("/catalog")
def catalog(x_ppt_token: str | None = Header(default=None)):
    check_token(x_ppt_token)
    return C.load_catalog()
