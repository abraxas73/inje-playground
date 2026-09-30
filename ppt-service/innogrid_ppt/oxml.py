# -*- coding: utf-8 -*-
"""python-pptx가 제공하지 않는 OOXML 조작 헬퍼.

여기 있는 함수들은 전부 "템플릿이 실제로 쓰는 XML 모양"을 재현한다.
추측한 값은 없다 — 원본에서 읽어낸 것만 쓴다.
"""

import copy

from lxml import etree
from pptx.oxml.ns import qn

from .tokens import TABLE_LINE, TABLE_LINE_W

XML_SPACE = "{http://www.w3.org/XML/1998/namespace}space"


def sub(parent, tag, **attrs):
    return etree.SubElement(parent, qn(tag), **{k: str(v) for k, v in attrs.items()})


# ── run 서식 ──────────────────────────────────────────────────────

# rPr 자식 순서 (ECMA-376). solidFill은 a:ln 다음, a:latin 앞.
_RPR_ORDER = [
    "a:ln", "a:noFill", "a:solidFill", "a:gradFill", "a:blipFill", "a:pattFill",
    "a:grpFill", "a:effectLst", "a:effectDag", "a:highlight", "a:uLnTx", "a:uLn",
    "a:uFillTx", "a:uFill", "a:latin", "a:ea", "a:cs", "a:sym",
    "a:hlinkClick", "a:hlinkMouseOver", "a:rtl", "a:extLst",
]


def _insert_ordered(parent, child, tag):
    idx = _RPR_ORDER.index(tag)
    for existing in parent:
        etag = etree.QName(existing).localname
        ename = f"a:{etag}"
        if ename in _RPR_ORDER and _RPR_ORDER.index(ename) > idx:
            existing.addprevious(child)
            return
    parent.append(child)


def set_run_color(rPr, hex_color):
    """rPr의 글자색을 srgbClr로 교체한다."""
    for tag in ("a:noFill", "a:solidFill", "a:gradFill", "a:blipFill", "a:pattFill", "a:grpFill"):
        for e in rPr.findall(qn(tag)):
            rPr.remove(e)
    fill = etree.Element(qn("a:solidFill"))
    sub(fill, "a:srgbClr", val=hex_color)
    _insert_ordered(rPr, fill, "a:solidFill")


def set_run_font(rPr, name):
    """latin/ea/cs 세 곳을 모두 바꾼다. 한글은 ea를 안 바꾸면 적용되지 않는다."""
    for tag in ("a:latin", "a:ea", "a:cs"):
        for e in rPr.findall(qn(tag)):
            rPr.remove(e)
        el = etree.Element(qn(tag))
        el.set("typeface", name)
        _insert_ordered(rPr, el, tag)


def set_run_size(rPr, pt):
    rPr.set("sz", str(int(round(pt * 100))))


# ── 문단 재구성 ───────────────────────────────────────────────────

def _split_emphasis(text):
    """'... [[강조어]] ...' -> [(문자열, 강조여부), ...]"""
    out, buf, i = [], "", 0
    while i < len(text):
        if text.startswith("[[", i):
            j = text.find("]]", i + 2)
            if j != -1:
                if buf:
                    out.append((buf, False))
                    buf = ""
                out.append((text[i + 2:j], True))
                i = j + 2
                continue
        buf += text[i]
        i += 1
    if buf:
        out.append((buf, False))
    return out or [("", False)]


def _paragraph_templates(txBody, bullet):
    """원본 문단에서 (pPr, rPr) 서식 원형을 뽑는다.

    bullet=True면 글머리 기호가 붙은 첫 문단 하나를 모든 줄의 원형으로 쓴다.
    bullet=False면 줄 번호에 대응하는 문단을 각각 원형으로 쓴다
    (페이지 타이틀의 '1행 검정 / 2행 파랑'이 이 경로로 자동 유지된다).
    """
    paras = txBody.findall(qn("a:p"))
    tmpl = []
    for p in paras:
        pPr = p.find(qn("a:pPr"))
        r = p.find(qn("a:r"))
        rPr = r.find(qn("a:rPr")) if r is not None else None
        if rPr is None:
            end = p.find(qn("a:endParaRPr"))
            if end is not None:
                rPr = end
        tmpl.append((pPr, rPr))
    if not tmpl:
        raise ValueError("문단이 없는 상자에는 텍스트를 넣을 수 없다")
    if bullet:
        for pPr, rPr in tmpl:
            if pPr is not None and pPr.find(qn("a:buChar")) is not None:
                return [(pPr, rPr)]
    return tmpl


def set_text(shape, lines, *, bullet=False, accent=None, size=None):
    """상자의 문단을 통째로 다시 만든다. 서식은 원본에서 상속한다.

    lines : 문자열 또는 문자열 리스트. 각 원소가 한 문단.
    bullet: True면 글머리 기호 문단 서식을 모든 줄에 적용
    accent: [[...]] 로 감싼 부분에 줄 색 (없으면 강조 무시)
    size  : 글자 크기(pt)를 바꿀 때만. 프롬프트 "본문이 많으면 8pt까지" 의 유일한 통로다
    """
    if isinstance(lines, str):
        lines = [lines]
    lines = [x for x in lines if x is not None]
    txBody = shape.text_frame._txBody
    tmpl = _paragraph_templates(txBody, bullet)

    for p in txBody.findall(qn("a:p")):
        txBody.remove(p)

    for i, line in enumerate(lines):
        pPr_t, rPr_t = tmpl[min(i, len(tmpl) - 1)]
        p = etree.SubElement(txBody, qn("a:p"))
        if pPr_t is not None:
            p.append(copy.deepcopy(pPr_t))
        for text, emph in _split_emphasis(str(line)):
            r = etree.SubElement(p, qn("a:r"))
            if rPr_t is not None:
                rPr = copy.deepcopy(rPr_t)
                if rPr.tag == qn("a:endParaRPr"):
                    rPr.tag = qn("a:rPr")
                if emph and accent:
                    set_run_color(rPr, accent)
                if size:
                    set_run_size(rPr, size)
                r.append(rPr)
            t = etree.SubElement(r, qn("a:t"))
            t.text = text
            if text != text.strip():
                t.set(XML_SPACE, "preserve")
    return shape


# ── 표 ────────────────────────────────────────────────────────────

def clear_table_style(table):
    """python-pptx가 붙이는 firstRow/bandRow/tableStyleId를 제거한다.

    템플릿의 표는 <a:tblPr/> 로 완전히 비어 있고 셀마다 직접 서식을 준다.
    이걸 비우지 않으면 줄무늬가 생겨 템플릿과 달라진다.
    """
    tblPr = table._tbl.find(qn("a:tblPr"))
    if tblPr is None:
        return
    for k in list(tblPr.attrib):
        del tblPr.attrib[k]
    for child in list(tblPr):
        tblPr.remove(child)


_LN_TAGS = ("a:lnL", "a:lnR", "a:lnT", "a:lnB")


def _make_line(tag, style):
    """style: None(선 없음) | 'solid' | 'sysDot'

    v1.0 템플릿은 가로·세로 모두 실선 0.75pt #C9DFFF 다 (v1.4의 세로 점선은 사라졌다).
    """
    ln = etree.Element(qn(tag))
    ln.set("cap", "flat")
    ln.set("cmpd", "sng")
    ln.set("algn", "ctr")
    if style is None:
        ln.set("w", "0")
        etree.SubElement(ln, qn("a:noFill"))
    else:
        ln.set("w", str(TABLE_LINE_W))
        fill = etree.SubElement(ln, qn("a:solidFill"))
        sub(fill, "a:srgbClr", val=TABLE_LINE)
        if style == "sysDot":
            sub(ln, "a:prstDash", val="sysDot")
        else:
            sub(ln, "a:prstDash", val="solid")
        etree.SubElement(ln, qn("a:round"))
    return ln


def set_cell_borders(cell, left, right, top, bottom):
    """tcPr 맨 앞에 lnL/lnR/lnT/lnB를 순서대로 넣는다 (스키마 순서 필수)."""
    tc = cell._tc
    tcPr = tc.find(qn("a:tcPr"))
    if tcPr is None:
        tcPr = etree.SubElement(tc, qn("a:tcPr"))
    for tag in _LN_TAGS:
        for e in tcPr.findall(qn(tag)):
            tcPr.remove(e)
    for idx, (tag, style) in enumerate(
        zip(_LN_TAGS, (left, right, top, bottom))
    ):
        tcPr.insert(idx, _make_line(tag, style))


# ── 직접 그리기 ──────────────────────────────────────────────────
#
# v1.0에서는 어떤 장표도 글상자를 새로 그리지 않는다 (2단 비교 18·19·20이 채워져
# 제공되고, 17번 빈 패널에는 표 엔진이 표를 그린다). 아래 헬퍼는 확장 대비로 남겨 둔다.
# 값은 전부 카드 본문·항목 제목에서 실측한 것이다.

_BULLET_MARL = 108000     # 0.30cm
_BULLET_INDENT = -108000  # -0.30cm


def make_pPr(*, bullet, line_pt, align=None, space_after=None):
    """문단 서식. 자식 순서는 스키마를 따른다: lnSpc → spcAft → buFont → buChar."""
    pPr = etree.Element(qn("a:pPr"))
    if bullet:
        pPr.set("marL", str(_BULLET_MARL))
        pPr.set("indent", str(_BULLET_INDENT))
    else:
        pPr.set("marL", "0")
        pPr.set("indent", "0")
    if align:
        pPr.set("algn", align)
    lnSpc = etree.SubElement(pPr, qn("a:lnSpc"))
    sub(lnSpc, "a:spcPts", val=int(round(line_pt * 100)))   # 고정 pt. % 금지
    if space_after:
        spcAft = etree.SubElement(pPr, qn("a:spcAft"))
        sub(spcAft, "a:spcPts", val=int(round(space_after * 100)))
    if bullet:
        sub(pPr, "a:buFont", typeface="Arial", pitchFamily=34, charset=0)
        sub(pPr, "a:buChar", char="•")
    else:
        etree.SubElement(pPr, qn("a:buNone"))
    return pPr


def make_rPr(*, size_pt, font, color):
    rPr = etree.Element(qn("a:rPr"))
    rPr.set("lang", "ko-KR")
    rPr.set("altLang", "en-US")
    rPr.set("dirty", "0")
    set_run_size(rPr, size_pt)
    set_run_color(rPr, color)      # 순서는 _insert_ordered가 지킨다
    set_run_font(rPr, font)
    return rPr


def fill_textbox(shape, lines, *, size_pt, font, color,
                 bullet=False, line_pt=12.0, align=None, space_after=None,
                 accent=None):
    """새로 만든 상자에 서식을 직접 지정해 글을 넣는다."""
    if isinstance(lines, str):
        lines = [lines]
    tf = shape.text_frame
    tf.word_wrap = True
    for m in ("margin_left", "margin_top", "margin_right", "margin_bottom"):
        setattr(tf, m, 0)          # 글상자 안쪽 여백 0 — 명세 §0-4
    txBody = tf._txBody
    for p in txBody.findall(qn("a:p")):
        txBody.remove(p)
    for line in lines:
        p = etree.SubElement(txBody, qn("a:p"))
        p.append(make_pPr(bullet=bullet, line_pt=line_pt,
                          align=align, space_after=space_after))
        for text, emph in _split_emphasis(str(line)):
            r = etree.SubElement(p, qn("a:r"))
            r.append(make_rPr(size_pt=size_pt, font=font,
                              color=accent if (emph and accent) else color))
            t = etree.SubElement(r, qn("a:t"))
            t.text = text
            if text != text.strip():
                t.set(XML_SPACE, "preserve")
    return shape
