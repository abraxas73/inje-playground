# -*- coding: utf-8 -*-
"""패키지 transplant(원고 도식 이식)의 결과를 보정한다 — 패키지는 손대지 않고 함수를 감싼다.

① 테마색(a:schemeClr)은 원고 테마 기준으로 보이던 색인데 템플릿 테마에서 다른 색으로 바뀐다 → 원고 테마·clrMap으로 풀어 고정색(a:srgbClr)으로 바꾼다.
② 복사한 도형의 cNvPr id가 템플릿 장표의 도형 id와 겹치면 PowerPoint가 '복구'를 띄우고 도형을 깨뜨린다 → 겹치는 id를 새 번호로 바꾸고 연결선 참조(stCxn/endCxn)도 따라 고친다.
"""
from lxml import etree
from pptx.oxml.ns import qn

from innogrid_ppt import transplant as TR

_CLR_SCHEME_KEYS = ("dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink")
_CNX_REF_TAGS = (qn("a:stCxn"), qn("a:endCxn"))


def theme_colors(src_slide):
    """원고 슬라이드의 마스터 테마 {schemeClr val → 'RRGGBB'} (clrMap으로 bg1→lt1 등도 푼다)."""
    master = src_slide.slide_layout.slide_master
    theme_part = next((r.target_part for r in master.part.rels.values() if r.reltype.endswith("/theme")), None)
    out = {}
    if theme_part is None:
        return out
    root = etree.fromstring(theme_part.blob)
    cs = root.find(".//" + qn("a:clrScheme"))
    if cs is None:
        return out
    for el in cs:
        key = etree.QName(el).localname
        if key not in _CLR_SCHEME_KEYS or len(el) == 0:
            continue
        c = el[0]
        val = c.get("lastClr") if etree.QName(c).localname == "sysClr" else c.get("val")
        if val:
            out[key] = val.upper()
    cmap = master._element.find(".//" + qn("p:clrMap"))
    if cmap is not None:
        for alias, target in cmap.attrib.items():
            if target in out:
                out[alias] = out[target]
    return out


def resolve_scheme_colors(group, colors):
    """group 안의 a:schemeClr를 고정색으로. lumMod·lumOff·alpha 같은 자식은 그대로 옮긴다(srgbClr도 같은 자식을 허용)."""
    n = 0
    for el in list(group.iter(qn("a:schemeClr"))):
        hexv = colors.get(el.get("val") or "")
        if not hexv:
            continue
        new = etree.Element(qn("a:srgbClr"))
        new.set("val", hexv)
        for child in list(el):
            new.append(child)
        el.getparent().replace(el, new)
        n += 1
    return n


def dedupe_shape_ids(dst_slide, group):
    """group 안 도형 id가 슬라이드의 다른 도형과 겹치거나 group 안에서 중복이면 새 번호를 준다."""
    spTree = dst_slide.shapes._spTree
    all_ids = [int(e.get("id")) for e in spTree.iter(qn("p:cNvPr")) if (e.get("id") or "").isdigit()]
    outside = [int(e.get("id")) for e in spTree.iter(qn("p:cNvPr")) if (e.get("id") or "").isdigit() and not _inside(e, group)]
    taken = set(outside)
    nxt = (max(all_ids) if all_ids else 1) + 1
    remap = {}
    for e in group.iter(qn("p:cNvPr")):
        raw = e.get("id")
        if not (raw or "").isdigit():
            continue
        old = int(raw)
        if old in taken:
            remap[(old, id(e))] = nxt
            e.set("id", str(nxt))
            taken.add(nxt)
            nxt += 1
        else:
            taken.add(old)
    if not remap:
        return 0
    # 연결선이 가리키는 도형 id도 따라간다(같은 그룹 안의 연결만 — 바깥 도형을 가리킬 일은 없다)
    by_old = {}
    for (old, _), new in remap.items():
        by_old.setdefault(old, new)
    for tag in _CNX_REF_TAGS:
        for ref in group.iter(tag):
            v = ref.get("id")
            if v and v.isdigit() and int(v) in by_old:
                ref.set("id", str(by_old[int(v)]))
    return len(remap)


def _inside(el, group):
    p = el
    while p is not None:
        if p is group:
            return True
        p = p.getparent()
    return False


_ORIGINAL = TR.transplant


def transplant_fixed(dst_slide, src_path, slide_no, **kw):
    group = _ORIGINAL(dst_slide, src_path, slide_no, **kw)
    src_slide = TR.open_source(src_path).slides[slide_no - 1]
    resolve_scheme_colors(group, theme_colors(src_slide))
    dedupe_shape_ids(dst_slide, group)
    return group


def install():
    """빌더가 호출하는 transplant.transplant를 보정판으로 바꾼다(모듈 속성 교체 — 패키지 파일은 그대로)."""
    if TR.transplant is not transplant_fixed:
        TR.transplant = transplant_fixed
