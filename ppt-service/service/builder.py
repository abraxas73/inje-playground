# -*- coding: utf-8 -*-
"""deck JSON(dict) → pptx. 패키지 deck.build()와 같은 순서로 돌리되 장표마다 try/except를 둬 **어느 장표가 실패했는지**를 붙인다.

ponytail: deck.build 20줄과 같은 루프를 한 번 복제한 것 — 패키지가 예외에 슬라이드 위치를 담아 주면 지운다.
표지·목차·간지·뒷표지·라벨 규칙·message·product 분기는 패키지 함수(deck._emit 등)를 그대로 호출해 규칙을 중복 구현하지 않는다.
"""
import contextlib
import copy
import io
import re
import threading
from pathlib import Path

import yaml

import check as CHECK
from innogrid_ppt import deck as D
from innogrid_ppt import tokens as T
from innogrid_ppt.media import extract_images
from innogrid_ppt.slots import Overflow
from innogrid_ppt.template import find_template

ROOT = Path(__file__).resolve().parent.parent
PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation"
DEFAULT_TITLE_BOTTOM_CM = 3.2
# ponytail: 전역 stderr·템플릿 상태(builders.TEMPLATE_PRS) 때문에 빌드를 프로세스 안에서 직렬화 — 병렬이 필요하면 프로세스 풀로
_BUILD_LOCK = threading.Lock()
SPEC_ERRORS = (ValueError, KeyError, TypeError, IndexError, AttributeError)
IMAGE_REF = re.compile(r"^src:(\d+):(\d+)$")


class BuildError(Exception):
    def __init__(self, kind, message, section=None, slide=None):
        super().__init__(message)
        self.kind, self.message, self.section, self.slide = kind, message, section, slide


def _prepare_media(spec, source_pptx, work, extract_info):
    """images "src:장:번호" → 파일 경로, source {slide} → {file, slide, from}. 원고 pptx가 없으면 참조를 지운다."""
    info = {s["no"]: s for s in (extract_info or [])}
    cache = {}
    for si, sec in enumerate(spec.get("sections") or []):
        for sj, sl in enumerate(sec.get("slides") or []):
            try:
                _prepare_slide(sl, source_pptx, work, info, cache)
            except SPEC_ERRORS as e:
                raise BuildError("spec", _msg(e), si, sj)


def _prepare_slide(sl, source_pptx, work, info, cache):
    imgs = sl.get("images")
    if isinstance(imgs, list):
        paths = []
        for ref in imgs:
            m = IMAGE_REF.match(str(ref))
            if not (m and source_pptx):
                continue
            no, idx = int(m.group(1)), int(m.group(2))
            if no < 1 or idx < 1:
                continue
            if no not in cache:
                cache[no] = extract_images(source_pptx, work / "images" / f"s{no}", slide_no=no)
            if 1 <= idx <= len(cache[no]):
                paths.append(str(cache[no][idx - 1]))
        if paths:
            sl["images"] = paths
        else:
            sl.pop("images", None)
    src = sl.get("source")
    if isinstance(src, dict):
        if not source_pptx:
            sl.pop("source", None)
            return
        src["file"] = str(source_pptx)
        no = int(src.get("slide") or 1)
        src["slide"] = no
        if "from" not in src:
            bottom = (info.get(no) or {}).get("titleBottomCm")
            src["from"] = float(bottom) if bottom else DEFAULT_TITLE_BOTTOM_CM


def _build_with_positions(template, spec):
    try:
        d = D.Deck(template)
    except ValueError as e:
        raise BuildError("template", str(e))
    meta = spec.get("meta") or {}
    body_only = bool(meta.get("body_only"))
    try:
        if not body_only:
            if "title" not in meta:
                raise ValueError("meta.title이 없다 (본문만 뽑으려면 meta.body_only: true)")
            dept = meta.get("dept") or T.DEFAULT_DEPT
            if not meta.get("dept"):
                D._advise(f"meta.dept가 없어 표지에 '{T.DEFAULT_DEPT}'로 표기했다 (템플릿 노트 22)")
            d.cover(title=meta["title"], subtitle=meta.get("subtitle", ""), ver=str(meta.get("ver", "01")),
                    date=str(meta.get("date", "")), dept=dept, author=meta.get("author", ""))
        sections = spec["sections"]
        if not body_only:
            d.toc([s["name"] for s in sections])
    except Overflow as e:
        raise BuildError("overflow", str(e))
    except SPEC_ERRORS as e:
        raise BuildError("spec", _msg(e))

    for i, sec in enumerate(sections):
        subs = sec.get("subs") or []
        try:
            if not body_only:
                d.divider(i, sec["name"], subs)
        except (*SPEC_ERRORS, Overflow) as e:
            raise BuildError("overflow" if isinstance(e, Overflow) else "spec", _msg(e), i, None)
        base = sec.get("label") or f"{i + 1:02d}. {sec['name']}"
        for j, sl in enumerate(sec.get("slides", [])):
            label = base
            sub = sl.get("sub")
            if sub:
                label = f"{base} : {sub}"
            elif subs and not sec.get("label") and str(sl.get("layout", "")).lower() != "message":
                D._advise(f"[{sec['name']}] 하위 섹션이 있는데 장표에 'sub'가 없다 — 라벨은 '01. 섹션명 : 하위섹션명' 구조여야 한다 (프롬프트 필수 준수 사항)")
            try:
                D._emit(d, label, sl)
            except Overflow as e:
                raise BuildError("overflow", str(e), i, j)
            except SPEC_ERRORS as e:
                raise BuildError("spec", _msg(e), i, j)
    if not body_only:
        d.back_cover()
    D._lint(spec)
    return d


def _msg(e):
    if isinstance(e, KeyError):
        return f"필수 키가 없다: {e.args[0] if e.args else e}"
    return str(e)


def build_deck(spec, work: Path, source_pptx, extract_info):
    with _BUILD_LOCK:
        work.mkdir(parents=True, exist_ok=True)
        work_spec = copy.deepcopy(spec)  # 미디어 치환은 사본에만 — deck.yaml에 서버 임시 경로가 새지 않게
        _prepare_media(work_spec, source_pptx, work, extract_info)
        template = find_template(None, root=ROOT)
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            d = _build_with_positions(str(template), work_spec)
            pptx_path = work / "deck.pptx"
            d.save(str(pptx_path))
        advisories = [line[len("[권고] "):].strip() for line in err.getvalue().splitlines() if line.startswith("[권고]")]
        slides, issues, _grafted = CHECK.check(str(pptx_path))
        yaml_path = work / "deck.yaml"
        yaml_path.write_text(yaml.safe_dump(spec, allow_unicode=True, sort_keys=False), encoding="utf-8")
        return {"pptxPath": pptx_path, "yamlPath": yaml_path, "slides": len(slides), "advisories": advisories, "issues": {k: sorted(set(v)) for k, v in issues.items()}}
