# -*- coding: utf-8 -*-
"""innogrid ppt-service — Next.js(frontend)가 호출하는 PPT 생성 API. 패키지 innogrid_ppt는 수정하지 않는다."""
import hmac
import os
import shutil
import tempfile
import uuid
from pathlib import Path

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from pydantic import BaseModel

from innogrid_ppt import tokens as T
from service import catalog as C, extract as X, storage as S

app = FastAPI(title="innogrid ppt-service", docs_url=None, redoc_url=None)

MAX_BODY = 2 * 1024 * 1024


def check_token(x_ppt_token: str | None):
    token = os.environ.get("PPT_SERVICE_TOKEN", "")
    if not token or not x_ppt_token or not hmac.compare_digest(token.encode(), x_ppt_token.encode()):
        raise HTTPException(status_code=401, detail="unauthorized")


def check_body(request: Request):
    length = request.headers.get("content-length")
    try:
        too_big = bool(length) and int(length) > MAX_BODY
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid content-length")
    if too_big:
        raise HTTPException(status_code=413, detail="body too large")


@app.get("/health")
def health(x_ppt_token: str | None = Header(default=None)):
    check_token(x_ppt_token)
    return {"ok": True, "templateSlides": T.TEMPLATE_SLIDES, "layouts": len(T.LAYOUTS), "package": C.PACKAGE_VERSION}


@app.get("/catalog")
def catalog(x_ppt_token: str | None = Header(default=None)):
    check_token(x_ppt_token)
    return C.load_catalog()


class ExtractRequest(BaseModel):
    sourceUrl: str


@app.post("/extract")
def extract(req: ExtractRequest, request: Request, x_ppt_token: str | None = Header(default=None)):
    check_token(x_ppt_token)
    check_body(request)
    if not S.allowed_host(req.sourceUrl):
        raise HTTPException(status_code=400, detail="sourceUrl 호스트가 허용되지 않습니다")
    work = Path(tempfile.gettempdir()) / f"ppt-{uuid.uuid4().hex}"
    try:
        src = S.download(req.sourceUrl, work / "source.pptx")
        return {"slides": X.extract_slides(str(src))}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=400, detail=f"원고를 내려받지 못했습니다({e.response.status_code})")
    finally:
        shutil.rmtree(work, ignore_errors=True)
