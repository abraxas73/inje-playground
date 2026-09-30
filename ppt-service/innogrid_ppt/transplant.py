# -*- coding: utf-8 -*-
"""원고 PPT의 도식을 그대로 이식한다 — 표준 프롬프트 "원고가 PPT 파일일 경우" 3항.

  "템플릿으로 표현하기 어려운 내용은 원고의 레이아웃을 유지하되,
   디자인 스타일은 이노그리드 템플릿에 맞추어 변경."

복잡한 아키텍처 구성도(노드 수십 개 + 연결선 + 장비 그림)는 템플릿 도식으로 다시 그리면
반드시 내용이 깎인다. 그래서 **원본 도형을 벡터 그대로 가져온다** — 캡처 이미지가 아니라
도형이므로 확대해도 깨지지 않고, 받는 사람이 열어서 고칠 수 있다.

가져오면서 바꾸는 것은 **스타일뿐**이다.

  · 글꼴을 Pretendard로 통일한다 (프롬프트 1항)
  · 원고의 브랜드 파랑을 이노그리드 Primary로 바꾼다
  · 가이드라인(좌우 1.35 / 아래 15.35) 안쪽으로 비율을 유지한 채 맞춰 넣는다 (4항)

좌표는 **도형마다 직접 고쳐 쓴다.** 그룹 배율(`chExt`)에 맡기면 파워포인트와
LibreOffice가 글자 크기를 서로 다르게 처리해 렌더 확인이 믿을 수 없게 된다.
"""

import copy

from pptx import Presentation
from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.oxml.ns import qn

from . import tokens as T

MARK = "원고 이식 도식"          # 검사기가 이 이름의 그룹 안은 팔레트 검사에서 뺀다

# 원고의 브랜드 파랑 → 이노그리드 Primary. 나머지 색은 **건드리지 않는다** —
# 빨강 화살표·주황 강조처럼 도식의 의미를 담은 색을 임의로 바꾸면 그림이 망가진다.
RECOLOR = {
    "006EFF": T.ACCENT, "0066FF": T.ACCENT, "0070C0": T.ACCENT,
    "0081FF": T.ACCENT,
}

_XFRM = (qn("a:xfrm"), qn("p:xfrm"))
_RID_ATTRS = (qn("r:embed"), qn("r:id"), qn("r:link"), qn("r:pict"))
_MIN_PT = 6.0                     # 축소해도 이보다 작게는 줄이지 않는다


# ── 원본 읽기 ────────────────────────────────────────────────────

_CACHE = {}


def open_source(path):
    if path not in _CACHE:
        _CACHE[path] = Presentation(path)
    return _CACHE[path]


def _xfrm_of(shape):
    for tag in _XFRM:
        el = shape._element.find(tag)
        if el is not None:
            return el
    for child in shape._element:
        el = child.find(qn("a:xfrm"))
        if el is not None:
            return el
    return None


def _rect(shape):
    """도형의 (x, y, w, h) — cm."""
    x, y = shape.left, shape.top
    w, h = shape.width, shape.height
    if None in (x, y, w, h):
        return None
    return T.to_cm(x), T.to_cm(y), T.to_cm(w), T.to_cm(h)


def pick(src_slide, y_min=None, y_max=None, x_min=None, x_max=None):
    """가져올 최상위 도형을 고른다. 원고의 라벨·타이틀은 y로 잘라낸다."""
    got = []
    for sh in src_slide.shapes:
        r = _rect(sh)
        if r is None:
            continue
        x, y, w, h = r
        if y_min is not None and y + h <= y_min:
            continue
        if y_max is not None and y >= y_max:
            continue
        if x_min is not None and x + w <= x_min:
            continue
        if x_max is not None and x >= x_max:
            continue
        got.append(sh)
    return got


def bbox(shapes):
    rs = [_rect(sh) for sh in shapes]
    rs = [r for r in rs if r]
    if not rs:
        raise LookupError("가져올 도형을 찾지 못했다")
    x0 = min(r[0] for r in rs)
    y0 = min(r[1] for r in rs)
    x1 = max(r[0] + r[2] for r in rs)
    y1 = max(r[1] + r[3] for r in rs)
    return x0, y0, x1 - x0, y1 - y0


# ── 이식 ─────────────────────────────────────────────────────────

def transplant(dst_slide, src_path, slide_no, *, y_from=3.3, y_to=None,
               area=None, align="top", recolor=True, font=None):
    """원고 slide_no(1-base)의 도식을 dst_slide 안쪽 영역에 맞춰 이식한다.

    area: (x, y, w, h) cm. 기본은 가이드라인 안쪽 본문 영역.
    비율은 유지한다 — 도식은 늘리면 바로 어색해진다.
    """
    src = open_source(src_path)
    if not (1 <= slide_no <= len(src.slides)):
        raise ValueError(f"원고는 {len(src.slides)}장인데 {slide_no}번을 찾는다")
    src_slide = src.slides[slide_no - 1]

    shapes = pick(src_slide, y_min=y_from, y_max=y_to)
    if not shapes:
        raise LookupError(f"원고 {slide_no}번에서 y≥{y_from} 도형을 찾지 못했다")

    sx, sy, sw, sh = bbox(shapes)
    ax, ay, aw, ah = area if area else (T.CONTENT_X, T.FIGURE_Y,
                                        T.CONTENT_W, T.CONTENT_BOTTOM - T.FIGURE_Y)
    scale = min(aw / sw, ah / sh)
    ox = ax + (aw - sw * scale) / 2                      # 가로는 가운데
    oy = ay if align == "top" else ay + (ah - sh * scale) / 2

    group = _new_group()
    for shape in shapes:
        el = copy.deepcopy(shape._element)
        _rescale(el, (sx, sy), (ox, oy), scale)
        group.append(el)

    _fit_group(group, ox, oy, sw * scale, sh * scale)
    dst_slide.shapes._spTree.append(group)

    _copy_rels(src_slide.part, dst_slide.part, group)
    _restyle(group, scale, recolor=recolor, font=font or T.F_REGULAR)
    return group


def _new_group():
    """빈 그룹 도형. 이식한 도형을 한 덩어리로 묶어 표시해 둔다."""
    from pptx.oxml import parse_xml
    from pptx.oxml.ns import nsdecls
    return parse_xml(
        f'<p:grpSp {nsdecls("p", "a")}>'
        f'  <p:nvGrpSpPr>'
        f'    <p:cNvPr id="900" name="{MARK}"/><p:cNvGrpSpPr/><p:nvPr/>'
        f'  </p:nvGrpSpPr>'
        f'  <p:grpSpPr><a:xfrm>'
        f'    <a:off x="0" y="0"/><a:ext cx="0" cy="0"/>'
        f'    <a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/>'
        f'  </a:xfrm></p:grpSpPr>'
        f'</p:grpSp>')


def _fit_group(group, x, y, w, h):
    """그룹 자체는 **배율 1**로 둔다 (자식 좌표를 이미 절대값으로 고쳐 썼다)."""
    xfrm = group.find(qn("p:grpSpPr")).find(qn("a:xfrm"))
    for tag, a, b in (("a:off", "x", "y"), ("a:chOff", "x", "y")):
        el = xfrm.find(qn(tag))
        el.set(a, str(T.cm(x)))
        el.set(b, str(T.cm(y)))
    for tag in ("a:ext", "a:chExt"):
        el = xfrm.find(qn(tag))
        el.set("cx", str(T.cm(w)))
        el.set("cy", str(T.cm(h)))


def _rescale(el, src_origin, dst_origin, scale):
    """최상위 도형 하나의 위치·크기를 옮긴다. 자식(그룹 안)은 부모를 따라간다."""
    xfrm = None
    for tag in _XFRM:
        xfrm = el.find(tag)
        if xfrm is not None:
            break
    if xfrm is None:                       # p:pic 등은 spPr 안에 있다
        for child in el:
            xfrm = child.find(qn("a:xfrm"))
            if xfrm is not None:
                break
    if xfrm is None:
        return
    off, ext = xfrm.find(qn("a:off")), xfrm.find(qn("a:ext"))
    if off is None or ext is None:
        return
    x = T.to_cm(int(off.get("x")))
    y = T.to_cm(int(off.get("y")))
    off.set("x", str(T.cm(dst_origin[0] + (x - src_origin[0]) * scale)))
    off.set("y", str(T.cm(dst_origin[1] + (y - src_origin[1]) * scale)))
    ext.set("cx", str(int(int(ext.get("cx")) * scale)))
    ext.set("cy", str(int(int(ext.get("cy")) * scale)))
    # 그룹이면 자식 좌표계(chOff/chExt)는 그대로 둔다 — 자식이 알아서 따라 줄어든다


# ── 스타일만 이노그리드로 ────────────────────────────────────────

def _restyle(root, scale, *, recolor, font):
    for el in root.iter():
        tag = el.tag
        if tag in (qn("a:latin"), qn("a:ea"), qn("a:cs")):
            face = el.get("typeface") or ""
            if "Pretendard" not in face:
                el.set("typeface", font)
        elif tag in (qn("a:rPr"), qn("a:defRPr"), qn("a:endParaRPr")):
            sz = el.get("sz")
            if sz and scale < 0.999:
                el.set("sz", str(max(int(_MIN_PT * 100), int(int(sz) * scale))))
        elif recolor and tag == qn("a:srgbClr"):
            new = RECOLOR.get((el.get("val") or "").upper())
            if new:
                el.set("val", new)


def _copy_rels(src_part, dst_part, root):
    """이식한 도형이 참조하는 그림·차트 관계만 옮기고 rId를 다시 쓴다."""
    used = set()
    for el in root.iter():
        for attr in _RID_ATTRS:
            v = el.get(attr)
            if v:
                used.add(v)
    if not used:
        return
    mapping = {}
    for rId in used:
        rel = src_part.rels.get(rId)
        if rel is None:
            continue
        if rel.is_external:
            mapping[rId] = dst_part.relate_to(rel.target_ref, rel.reltype, is_external=True)
        elif rel.reltype == RT.CHART:
            from .clone import _clone_chart_part
            mapping[rId] = dst_part.relate_to(_clone_chart_part(rel.target_part), rel.reltype)
        else:
            mapping[rId] = dst_part.relate_to(rel.target_part, rel.reltype)
    for el in root.iter():
        for attr in _RID_ATTRS:
            v = el.get(attr)
            if v in mapping:
                el.set(attr, mapping[v])
