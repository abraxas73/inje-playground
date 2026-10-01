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
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from innogrid_ppt import tokens as T
from service import builder as B, catalog as C, extract as X, storage as S, templates as TP

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
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="원고를 내려받지 못했습니다(연결 오류)")
    except X.ExtractError:
        raise HTTPException(status_code=400, detail="pptx 파일을 열 수 없습니다(손상되었거나 pptx가 아닙니다)")
    finally:
        shutil.rmtree(work, ignore_errors=True)


class UploadTargets(BaseModel):
    pptxUrl: str
    yamlUrl: str


class BuildRequest(BaseModel):
    spec: dict
    sourceUrl: str | None = None
    extract: list[dict] | None = None
    upload: UploadTargets
    templateUrl: str | None = None   # 업로드 템플릿(서명 URL). 없으면 내장 템플릿
    templateId: str | None = None    # 인스턴스 캐시 키
    imageUrls: dict[str, str] | None = None  # 웹 페이지 원고 이미지 {"N": 서명 URL} (images "url:N")


class TemplateValidateRequest(BaseModel):
    templateUrl: str


@app.post("/template/validate")
def template_validate(req: TemplateValidateRequest, request: Request, x_ppt_token: str | None = Header(default=None)):
    """업로드 템플릿 검증 — 장 수(106)와 샘플 덱 전체 빌드. 통과하면 장 수·브랜드 검사 결과를 돌려준다."""
    check_token(x_ppt_token)
    check_body(request)
    if not S.allowed_host(req.templateUrl):
        raise HTTPException(status_code=400, detail="templateUrl 호스트가 허용되지 않습니다")
    work = Path(tempfile.gettempdir()) / f"ppt-{uuid.uuid4().hex}"
    try:
        path = S.download(req.templateUrl, work / "template.pptx")
        return TP.validate_template(path, work / "build")
    except B.BuildError as e:
        return JSONResponse(status_code=422, content={"ok": False, "error": f"[{e.kind}] {e.message}"})
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=400, detail=f"템플릿을 내려받지 못했습니다({e.response.status_code})")
    except httpx.RequestError:
        raise HTTPException(status_code=502, detail="템플릿을 내려받지 못했습니다(연결 오류)")
    except Exception as e:  # noqa: BLE001 — 손상된 pptx 등
        return JSONResponse(status_code=422, content={"ok": False, "error": f"템플릿을 열 수 없습니다: {type(e).__name__}: {e}"})
    finally:
        shutil.rmtree(work, ignore_errors=True)


@app.post("/build")
def build(req: BuildRequest, request: Request, x_ppt_token: str | None = Header(default=None)):
    check_token(x_ppt_token)
    check_body(request)
    for url in (req.upload.pptxUrl, req.upload.yamlUrl, req.sourceUrl or req.upload.pptxUrl, req.templateUrl or req.upload.pptxUrl, *((req.imageUrls or {}).values())):
        if not S.allowed_host(url):
            raise HTTPException(status_code=400, detail="업로드·다운로드 주소 호스트가 허용되지 않습니다")
    if req.imageUrls and len(req.imageUrls) > 24:
        raise HTTPException(status_code=400, detail="이미지는 24장까지입니다")
    work = Path(tempfile.gettempdir()) / f"ppt-{uuid.uuid4().hex}"
    try:
        src = S.download(req.sourceUrl, work / "source.pptx") if req.sourceUrl else None
        template = TP.fetch_template(req.templateUrl, req.templateId, work) if req.templateUrl else None
        res = B.build_deck(req.spec, work, src, req.extract, template=template, image_urls=req.imageUrls)
        size = S.upload(req.upload.pptxUrl, res["pptxPath"], B.PPTX_MIME)
        S.upload(req.upload.yamlUrl, res["yamlPath"], "text/yaml; charset=utf-8")
        return {"ok": True, "slides": res["slides"], "advisories": res["advisories"], "issues": res["issues"], "bytes": size}
    except B.BuildError as e:
        return JSONResponse(status_code=422, content={"ok": False, "kind": e.kind, "message": e.message, "section": e.section, "slide": e.slide})
    except httpx.HTTPStatusError as e:
        return JSONResponse(status_code=502, content={"ok": False, "kind": "internal", "message": f"스토리지 응답 오류({e.response.status_code})", "section": None, "slide": None})
    except httpx.RequestError:
        return JSONResponse(status_code=502, content={"ok": False, "kind": "internal", "message": "스토리지 연결 오류", "section": None, "slide": None})
    except Exception as e:  # noqa: BLE001 — 패키지 내부 오류는 스택을 로그로, 사용자에게는 종류만
        import traceback
        traceback.print_exc()
        return JSONResponse(status_code=500, content={"ok": False, "kind": "internal", "message": f"내부 오류: {type(e).__name__}: {e}", "section": None, "slide": None})
    finally:
        shutil.rmtree(work, ignore_errors=True)
