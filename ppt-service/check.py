#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""브랜드 검사기 — 산출물이 템플릿 v1.0 최신본(2026-09 · 106장) 규칙을 지키는지 정적 검사.

    python3 check.py out.pptx

검사 항목과 예외는 전부 **템플릿 실측 근거**가 있다. 아래 예외를 넣지 않으면
템플릿 원본조차 통과하지 못한다.

  · Arial 은 <a:buFont>(글머리 기호 글리프)로만 쓰인다 — 위반 아님
  · <a:lstStyle> 안의 테마 폰트(+mn-*)는 실제 글자에 적용되지 않는 기본값 정의다.
    실제 런(<a:rPr>)의 폰트만 검사한다
  · 본문 장표는 줄간격 130%, 표지(22)는 100%, 제품 장표(93~105)는 90·110·120% 를 쓴다 — 템플릿 원본 그대로다
  · 제품 소개 장표는 제품 지정색과 7pt 이하 작은 글자를 쓴다 (가이드 p.3 허용).
    제품 장표인지는 제품명·로고로 판별하고, 그 밖의 장표에서 제품색이 나오면 위반이다
  · 차트 파트도 같은 규칙으로 검사한다. 도넛 5색(0150FF·000F3A·3ECFFF·6595FF·97B7FF)은
    템플릿 차트 실물 색이라 팔레트에 올렸다

알려진 템플릿 자체 결함 (산출물이 아니라 원본의 문제다):
  · AI큐브잇 주요 기능 장표(원본 103)에 'KoPub돋움체 Medium' 런이 두 군데 남아 있다.
    제품 장표를 쓰면 그대로 따라온다 — 디자인센터에 수정 요청할 것.
"""

import re
import sys
import zipfile
from collections import defaultdict

# ── 본문·골격 장표(22~92)에서 실제로 쓰이는 색 (템플릿 실측) ─────
PALETTE = {
    "000000", "FFFFFF",
    "0150FF", "0066FF", "006EFF", "0541FF",          # Primary 계열
    "3ECFFF", "3FC4FF", "3FD1FF", "6595FF", "7DA8FF", "97B7FF",
    "000D46", "000F3A", "001156",                    # 브랜드 그라데이션 정지점
    "C9DFFF", "D3E4FF", "DDEBFF", "E5F0FF", "EBF3FF", "EBF4FF",
    "7F7F7F",
    "5BA5FF",                                        # 변화 설명 장표(49·50) 카드 배경
}

# ── 제품 소개 장표에서만 허용 (가이드 p.3 제품 지정색 + 제품 일러스트) ──
PRODUCT_PALETTE = {
    "FF7500", "6268FF", "A43EF4", "A53FF4", "70DE68", "00BEC8", "00C18C",
    "001950", "0042FF", "0065D3", "0081FF", "00AAFF", "00BCE8", "00BFC9",
    "00D0C6", "01C3FF", "0A2348", "0E57FF", "64DCFF", "81E27A", "00B4C8",
    "6B71FF", "268EFF", "D1F4FF", "D8FCFB", "E5EDFF", "E7E8FF", "EDD7FD",
    "EFEFFF", "F5F5F6", "FFE6D1", "F3F8FF", "404040", "DDECFF",
    # TAFA 솔루션 계층 장표(94) 계층별 색
    "0045D0", "00B0A8", "00C4BB", "185FFF", "1E3559", "333DFF", "3377FF", "3B78FF", "820DD9", "DE6400",
}

FONTS = {"Pretendard", "Pretendard SemiBold", "Pretendard Medium",
         "Pretendard Light", "Pretendard ExtraBold"}
# 템플릿 원본이 안고 있는 결함. 위반으로 세되 '원본 탓'임을 밝힌다
TEMPLATE_BUG_FONTS = {"KoPub돋움체 Medium"}

SIZES = {48, 40, 36, 34, 28, 26, 24, 20, 16, 14, 13, 12, 11, 10, 9, 8, 7}
#   28·26 = KPI 수치·패널 큰 타이틀 (46·47·77), 7 = 작은 꼬리표 칩 (54) — 최신본 실측
PRODUCT_SIZES = {8.5, 7.5, 7, 6, 5.5, 10.5, 32}

# 제품 장표 판별 — 글자가 아니라 **구조**로 본다.
# 제품 소개 장표(원본 96~105)는 왼쪽 끝에 세로로 꽉 찬 제품 패널 그림을 갖고 있다:
#   x ≈ 1.35cm, 폭 ≈ 6.5cm, 높이 ≈ 11cm. 본문 이미지형 장표(31~36)의 그림과 크기가 확연히 다르다.
# 기능 소개 장표(97·99·101·103·105)에는 제품명 글자가 아예 없어서 문구로는 못 가른다.
_EMU = 360000
_PANEL_X = (1.20 * _EMU, 1.55 * _EMU)
_PANEL_W = (6.20 * _EMU, 6.90 * _EMU)
_PANEL_H = 10.5 * _EMU
_PIC = re.compile(r"<p:pic>.*?</p:pic>", re.S)
_OFF = re.compile(r'<a:off x="(-?\d+)" y="(-?\d+)"/><a:ext cx="(\d+)" cy="(\d+)"')

# 그림이 없는 제품 개요 장표(93 TAFA · 94 TAFA 계층 · 95 라인업)는 문구로 가른다
PRODUCT_MARKERS = ("INNOGRID TAFA", "제품 라인업", "Extension Service", "AI Control Plane")


def _is_product(xml, body):
    for m in PRODUCT_MARKERS:
        if m in body:
            return True
    for pic in _PIC.findall(xml):
        g = _OFF.search(pic)
        if not g:
            continue
        x, _y, cx, cy = (int(v) for v in g.groups())
        if _PANEL_X[0] <= x <= _PANEL_X[1] and _PANEL_W[0] <= cx <= _PANEL_W[1] and cy >= _PANEL_H:
            return True
    return False

# 줄간격 % 허용값 — 본문 130%, 표지 100%, 제품 장표 90·110·120% (템플릿 원본 그대로)
PCT_OK = {90.0, 100.0, 110.0, 120.0, 130.0}

LEFTOVER = [
    "섹션명이 들어갑니다", "윗줄부터 삭제", "제목을 입력하세요", "부제목을 입력하세요",
    "타이틀이 들어갑니다", "내용이 들어갑니다", "제목을 적습니다", "제목이 들어갑니다",
    "항목에 대한 제목", "항목에 대한 상세", "항목에 대한 내용이 들어갑니다",
    "요약 문장을 적습니다", "요약 문장을 두줄로", "요약문구가 들어갑니다",
    "키워드 1", "키워드 2", "키워드 3", "또는 키워드",
    "핵심 메시지가 들어갑니다", "핵심메세지", "장표를 마무리하는", "부가 설명글",
    "본문 설명을 여기에", "단락 구분은 유지", "본문 내용이 들어갑니다",
    "본문글이 서술형으로", "카드형 03의 본문글", "카드형 06의 본문글",
    "설명이 들어갑니다", "KPI 수치", "수치 또는 내용", "내용에 맞게 한줄", "핵심 메시지를",
    "타이틀 텍스트", "01. 타이틀이 들어갑니다", "내용이 들어갑니다.", "화살표와 설명이 필요할",
    "0,000원", "캡션이 들어갑니다", "차트 제목", "항목이 들어갑니다",
    "소제목이 들어갑니다", "화살표와 설명이 필요할", "레이아웃입니다",
    "lorem", "ipsum", "xxxx",
]

_SKIP = re.compile(r"<p:extLst>.*?</p:extLst>|<a:lstStyle>.*?</a:lstStyle>", re.S)


# ── 원고에서 이식한 도식 ─────────────────────────────────────────
#
# 표준 프롬프트 "원고가 PPT 파일일 경우" 3항은 템플릿으로 표현하기 어려운 도식을
# **원고의 레이아웃 그대로** 두라고 한다. 원고 도식의 색(빨강 화살표·주황 강조 등)은
# 이노그리드 팔레트에 없지만 그것이 원고의 내용이다 — 팔레트 검사에서 뺀다.
# 대신 몇 개를 이식했는지 밝혀 눈에 띄게 한다. 글꼴은 이식할 때 Pretendard로 바꾼다.

TRANSPLANT_MARK = 'name="원고 이식 도식"'


_GRP = re.compile(r"</?p:grpSp[ />]")


def _cut_transplanted(xml):
    """이식한 도식 그룹을 XML에서 잘라내고 (남은 XML, 개수)를 돌려준다.

    그룹 안에 그룹이 또 들어 있으므로 여는 태그·닫는 태그를 세어 짝을 찾는다.
    """
    n = 0
    while True:
        at = xml.find(TRANSPLANT_MARK)
        if at < 0:
            return xml, n
        starts = [m.start() for m in _GRP.finditer(xml[:at]) if xml[m.start() + 1] != "/"]
        if not starts:
            return xml, n
        start, depth, i = starts[-1], 0, starts[-1]
        end = None
        for m in _GRP.finditer(xml, i):
            depth += -1 if m.group().startswith("</") else 1
            if depth == 0:
                end = xml.find(">", m.start()) + 1
                break
        if end is None:
            return xml[:start], n + 1
        xml = xml[:start] + xml[end:]
        n += 1


def _slides_in_order(z):
    """발표 순서대로 슬라이드 파트 경로를 돌려준다.

    복제된 슬라이드는 파트 이름이 원본 번호를 물려받아 파일명 순서 ≠ 발표 순서다.
    sldIdLst를 따라가야 한다.
    """
    pres = z.read("ppt/presentation.xml").decode("utf-8")
    rels = z.read("ppt/_rels/presentation.xml.rels").decode("utf-8")
    target = dict(re.findall(r'Id="([^"]+)"[^>]*Target="([^"]+)"', rels))
    order = re.findall(r'<p:sldId[^>]*r:id="([^"]+)"', pres)
    return ["ppt/" + target[rid].lstrip("/").replace("../", "") for rid in order]


def _charts_of(z, slide_name):
    rels_name = slide_name.replace("slides/", "slides/_rels/") + ".rels"
    if rels_name not in z.namelist():
        return []
    rels = z.read(rels_name).decode("utf-8")
    return ["ppt/" + t.replace("../", "")
            for t in re.findall(r'Type="[^"]*/chart"[^>]*Target="([^"]+)"', rels)]


def check(path):
    issues = defaultdict(list)
    grafted = {}
    with zipfile.ZipFile(path) as z:
        slides = _slides_in_order(z)
        for i, name in enumerate(slides, 1):
            key = f"slide{i}"
            raw = z.read(name).decode("utf-8")
            for chart in _charts_of(z, name):
                raw += z.read(chart).decode("utf-8")
            x = _SKIP.sub("", raw)
            x, n_src = _cut_transplanted(x)         # 원고 이식 도식은 팔레트 검사 제외
            if n_src:
                grafted[key] = n_src
            body = " ".join(re.findall(r"<a:t>([^<]*)</a:t>", x))
            is_product = _is_product(x, body)
            allowed_colors = PALETTE | (PRODUCT_PALETTE if is_product else set())
            allowed_sizes = SIZES | (PRODUCT_SIZES if is_product else set())

            for c in {v.upper() for v in re.findall(r'srgbClr val="([0-9A-Fa-f]{6})"', x)}:
                if c in allowed_colors:
                    continue
                if c in PRODUCT_PALETTE:
                    issues[key].append(f"제품 지정색 #{c}은 제품 소개 장표에만 허용 (가이드 p.3)")
                else:
                    issues[key].append(f"팔레트 밖 색 #{c}")

            # <a:cs>(복합 스크립트) 슬롯의 테마 폰트는 한글·영문 렌더에 영향이 없다 —
            # 템플릿 원본(74번 TAFA)이 갖고 있고 실제 글자는 Pretendard로 그려진다.
            for f in set(re.findall(r'<a:(?:latin|ea) typeface="([^"]*)"', x)):
                if f.startswith("+"):
                    issues[key].append(f"테마 폰트 참조 {f} (Calibri/맑은 고딕으로 렌더됨)")
                elif f in TEMPLATE_BUG_FONTS:
                    issues[key].append(f"Pretendard 아닌 폰트 '{f}' — 템플릿 원본 결함. 디자인센터 문의")
                elif f not in FONTS:
                    issues[key].append(f"Pretendard 아닌 폰트 '{f}'")

            for pct in {int(p) / 1000 for p in re.findall(r'<a:lnSpc><a:spcPct val="(\d+)"', x)}:
                if pct not in PCT_OK:
                    issues[key].append(f"줄간격 {pct:g}% (템플릿에 없는 값)")

            if re.search(r'<a:rPr[^>]*\bb="1"', x):
                issues[key].append('굵게(b="1") 사용 — 굵기는 폰트 이름으로 (가이드 p.4)')

            for sz in {int(s) / 100 for s in re.findall(r'<a:rPr[^>]*\bsz="(\d+)"', x)}:
                if sz not in allowed_sizes:
                    issues[key].append(f"허용 밖 글자 크기 {sz:g}pt")

            for frag in LEFTOVER:
                if frag.lower() in body.lower():
                    issues[key].append(f"템플릿 잔여 문구 '{frag}' — 슬롯을 안 채웠다")
    return slides, issues, grafted


def main():
    if len(sys.argv) < 2:
        print("사용: python3 check.py out.pptx", file=sys.stderr)
        return 2
    path = sys.argv[1]
    slides, issues, grafted = check(path)
    print(f"검사 대상: {path}  ({len(slides)}장)\n")
    if grafted:
        where = ", ".join(f"{k[5:]}장" for k in sorted(grafted, key=lambda s: int(s[5:])))
        print(f"원고에서 이식한 도식 {sum(grafted.values())}개 ({where}) — "
              f"원고 레이아웃 유지분이라 팔레트 검사에서 제외했다\n")
    if not issues:
        print("통과 — 위반 없음")
        return 0
    total = 0
    for k in sorted(issues, key=lambda s: int(s[5:])):
        print(f"  {k}")
        for msg in sorted(set(issues[k])):
            print(f"     · {msg}")
            total += 1
    print(f"\n{len(issues)}장에서 {total}건")
    return 1


if __name__ == "__main__":
    sys.exit(main())
