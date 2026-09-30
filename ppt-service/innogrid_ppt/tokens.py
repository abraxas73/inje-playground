# -*- coding: utf-8 -*-
"""이노그리드 PPT 템플릿 v1.0 최신본 (2026-09 · 디자인가이드 병합본 · 106장) 디자인 토큰.

수치는 전부 템플릿 실측값이고, 좌표는 **절대(화면) 좌표**다 — `geom.py`가 그룹
변환을 풀어 주므로 XML 좌표를 따로 외울 필요가 없다.

이 파일의 수치를 바꾸려면 템플릿을 먼저 바꾸고 다시 측정해야 한다.

템플릿 구성 (106장)
  1~21    디자인 가이드 (컬러·서체·로고·가이드라인·컴포넌트 — 21번 KPI형 컴포넌트가 새로 들어왔다)
  22~25   표지 · 목차 · 간지 · 간지+하위섹션
  26      핵심 메시지 (검정)
  27~92   본문 레이아웃 66종 (+ 카드 5·6단, flow-4 변형)   ← LAYOUTS
  85~87   표 전용 / 자유 배치 (라벨만 · 라벨+타이틀)
  93~105  제품 소개 페이지 13종                             ← PRODUCTS
  106     뒷표지
"""

from pptx.util import Emu

EMU_CM = 360000
TEMPLATE_VERSION = "v1.0 최신본 (2026-09-17 갱신, 106장)"
TEMPLATE_SLIDES = 106


def cm(v):
    """cm -> EMU"""
    return Emu(int(round(v * EMU_CM)))


def to_cm(emu):
    return emu / EMU_CM


# ── 색 (디자인 가이드 p.2~3) ──────────────────────────────────────
ACCENT = "0150FF"          # Primary — 강조·하이라이트·라벨·표 헤더
NAVY = "002060"            # 타이틀 바·배경
TEXT = "000000"            # Text Basic — 타이틀·강조 글
TEXT_DARK = "0D0D0D"       # 본문 강조
TEXT_MUTED = "7F7F7F"      # 카드 상세(detail)
WHITE = "FFFFFF"
BLUE_200 = "3FC4FF"        # 포인트 강조 (표지 부제목)
SKY_01 = "DDEBFF"          # 설명 박스 · 은은한 구분
SKY_02 = "EBF3FF"          # 화이트 배경 설명 박스
SKY_03 = "F3F8FF"          # 장표 배경 (레이아웃 내장)
CHIP_BG = "EBF4FF"         # 키워드 칩 배경 (실측)
BLUE_075 = "E5F0FF"        # 표 구분열
ACCENT_TABLE = ACCENT      # 표 헤더 (= Primary)
TABLE_LINE = "C9DFFF"      # 표 내부선
HILIGHT = "FF7500"         # 표 열 강조 테두리 기본값 (= IaaS 제품색)

BACKGROUND = SKY_03
CARD = WHITE

# 제품 지정색 — 제품 소개 장표에서만 Primary를 대체한다 (가이드 p.3)
PRODUCT_COLORS = {
    "iaas": "FF7500",      # 오픈스택잇
    "paas": "6268FF",      # SE클라우드잇
    "cmp": "A43EF4",       # 탭클라우드잇
    "hcp": "70DE68",       # 옵티머스잇
    "devops": "00BEC8",    # 데브옵스잇
    "mlops": "00C18C",     # AI큐브잇
}
PRODUCT_COLORS["aiops"] = PRODUCT_COLORS["mlops"]   # 이전 이름 호환

# ── 폰트 (가이드 p.4) ────────────────────────────────────────────
# 굵기는 반드시 폰트 이름으로. b="1"(굵게 버튼) 사용 금지
F_SEMIBOLD = "Pretendard SemiBold"
F_MEDIUM = "Pretendard Medium"
F_REGULAR = "Pretendard"
F_LIGHT = "Pretendard Light"
F_EXTRABOLD = "Pretendard ExtraBold"   # 핵심 메시지 40pt에만

FONTS = (F_SEMIBOLD, F_MEDIUM, F_REGULAR, F_LIGHT, F_EXTRABOLD)

# ── 본문 글자 크기 — 프롬프트 "본문의 내용이 너무 많을 경우 8pt까지 줄여도 됨" ──
BODY_PT = 9.0
BODY_PT_MIN = 8.0          # 이 밑으로는 절대 줄이지 않는다

# ── 슬라이드 · 콘텐츠 경계 (가이드 p.7~8) ─────────────────────────
SLIDE_W, SLIDE_H = 29.70, 16.70
CONTENT_X, CONTENT_W = 1.35, 27.00
CONTENT_TOP = 4.55          # 타이틀 2줄일 때 콘텐츠 시작
CONTENT_BOTTOM = 15.35
FIGURE_Y = 4.20             # 원고 도식을 이식할 때 시작 y (타이틀 2줄 아래)

# 콘텐츠 케이스 → (시작 y, 높이). 타이틀 줄 수가 결정한다 — 가이드 p.7~8
CASE = {
    1: (4.55, 10.80),   # 타이틀 2줄
    2: (4.55, 10.80),   # 타이틀 1줄 + 설명글
    3: (3.55, 11.80),   # 타이틀 1줄
    4: (2.35, 13.00),   # 타이틀 없음
}

# ── 표 (85~92 실측) ──────────────────────────────────────────────
#   템플릿 노트 85~87: "각 열의 너비는 글자수에 따라 달라집니다. 가장 긴 줄을 기준으로
#   각 열의 너비를 산정 (긴 글 > 넓게 / 짧은 글 > 좁게). 한 줄로 부족하면 줄갈이하고
#   그 행의 높이는 여백을 유지하며 커집니다. 모든 표형식에 적용."
TABLE_CELL_MARGIN = 0.40    # cm, 좌우. 글상자 여백 0 원칙의 유일한 예외
TABLE_LINE_W = 9525         # EMU = 0.75pt
TABLE_FONT = 8.0
TABLE_FONT_TIGHT = 7.5
TABLE_HEADER_H = 1.00
TABLE_ROW_H = 1.00          # 한 줄짜리 행. 줄이 늘면 TABLE_ROW_PAD 를 유지하며 커진다
TABLE_ROW_PAD = 0.30        # 행 위·아래 여백 (1.00 - 8pt 한 줄 0.40)
TABLE_DIVIDER_W = 2.80      # 구분열 폭 기본값 (글자수 산정 결과가 이보다 작아도 이 폭은 지킨다)
TABLE_COL_MIN_W = 2.00      # 열 최소 폭
TABLE_BULLET_MARL = 107950  # 서술형 셀 글머리 들여쓰기 (0.30cm)
TABLE_BULLET_SPC_AFT = 5.0  # pt

# ── 키워드 칩 기하 — 글자 폭에 맞춰 가로만 바꾼다 (노트 9) ───────
CHIP_FONT_PT = 10.0
CHIP_PAD = 0.45          # 좌우 여백
CHIP_GAP = 0.16          # 칩 사이 간격
CHIP_MIN_W = 1.20        # 짧은 단어도 이보다 좁아지지 않는다

# ── 차트 항목 수 (템플릿 노트 82~84 "최대 5개 항목으로 정리해야 합니다") ──
CHART_DONUT_MAX = 5
CHART_BAR_MAX = 5
CHART_BAR_ADVISE = 5

# ── 마무리 메시지(메세지형) — 두 줄까지 (가이드 12·13) ─────────────
#   "메세지형은 너무 긴 서술형 문장을 지양", "본문이 두 줄이면 박스도 같이 커져야 합니다",
#   "하단 텍스트 박스는 하단고정입니다 (높이값이 변해도 위쪽으로 커짐)"
CLOSING_MAX_LINES = 2

# ── 골격 장표 ────────────────────────────────────────────────────
COVER, TOC, DIVIDER, DIVIDER_SUB, MESSAGE, BACK = 22, 23, 24, 25, 26, 106

SKELETON = {
    # 표지 노트: "부제목은 제목과 항상 같은 간격 — 제목이 3줄이면 그만큼 아래로, 1줄이면 위로"
    COVER: dict(title=2.17, subtitle=6.82, ver=13.35, date=14.23, title_lines=2),
    TOC: dict(heading=2.24,
              items=[8.58, 9.85, 11.10, 12.48, 13.75],
              lines=[8.16, 9.45, 10.75, 12.04, 13.35, 14.65],
              pitch=1.29,            # 6개 이상이면 이 간격으로 **위쪽에** 행을 추가한다 (노트 23)
              top_limit=4.25),       # "Contents" 글자(48pt) 밑. 이 위로는 못 올라간다
    DIVIDER: dict(section=2.24),
    DIVIDER_SUB: dict(section=2.24,
                      items=[8.58, 9.85, 11.10, 12.48, 13.75],
                      lines=[8.16, 9.45, 10.75, 12.04, 13.35, 14.65]),
    MESSAGE: dict(headline=6.75, detail=8.63),
    BACK: dict(),
}

TOC_PER_PAGE = 5        # 목차 한 장 기본 5개. 남는 위쪽은 지운다
TOC_MAX = 8             # 템플릿 노트 "섹션은 최대 8개" — 6~8개는 위쪽으로 행을 추가한다
SUBSECTION_MAX = 5      # 템플릿 노트 "하위 섹션은 최대 5개"
DEFAULT_DEPT = "부서명"  # 표지 노트: "부서명 파악이 힘들면 '부서명'이라고만 표기"

# 본문 장표 공통 슬롯
LABEL_Y = 1.17          # 섹션 라벨 "01. 섹션명 : 하위 섹션명"
TITLE_Y = 2.27          # 페이지 타이틀 (1행 검정 / 2행 파랑)

# 부가 설명 — 타이틀이 **한 줄**일 때 그 밑에 한 줄 (가이드 8)
LEAD_Y, LEAD_X, LEAD_W, LEAD_H = 3.20, 1.37, 21.29, 0.43
LEAD_SOURCE = 8         # 이 슬롯을 복제해 올 템플릿 슬라이드


def _L(slide, **kw):
    """레이아웃 스펙. label/title 기본값을 채운다."""
    spec = dict(slide=slide, label=LABEL_Y, title=TITLE_Y)
    spec.update(kw)
    return spec


def _G(key, n, **slots):
    """반복 그룹 — 같은 역할이 n개 나란한 묶음. slots는 {역할: y} 또는 {역할: (y, xmin, xmax)}."""
    return dict(key=key, n=n, slots=slots)


# 마무리 문구 자리 — 템플릿 메세지형 컴포넌트와 1:1 (가이드 12·13)
#   bar16  = 메세지형 02-1  16pt 흰 글자 그라데이션 바 (2줄용 h 2.99)        강조색 불가
#   bar13  = 메세지형 01-x  13pt 흰 글자 바 (h 2.08)                          강조색 불가
#   msg    = 메세지형 02-3  16pt 검정 글자 테두리 상자 (h 1.79)                [[강조]] 가능
#   key    = 메세지형 02-2  16pt 흰 글자 한 줄 바 (h 1.87~1.91)                강조색 불가
#   split  = 바 도형과 글상자가 분리된 형태 (75·76)
# 줄 수별 박스 높이 (실측). 없는 줄 수는 그 상자의 줄간격만큼 더하거나 뺀다
CLOSING_HEIGHTS = {
    "bar16": {1: 1.87, 2: 2.99},     # 한 줄이면 메세지형 02-2(1.87)와 같은 모양이 된다 (노트 28·29)
    "key": {1: 1.87},
    "msg": {1: 1.79},
    "bar13": {2: 2.08},
    "split": {1: 1.62},              # 바 도형 기준 (글상자는 함께 움직인다)
}


def _C(y, style, **kw):
    d = dict(y=y, style=style, max_lines=CLOSING_MAX_LINES, heights=CLOSING_HEIGHTS.get(style, {}))
    d.update(kw)
    return d


# ══════════════════════════════════════════════════════════════════
#  본문 레이아웃 (템플릿 27~92)
#
#  좌표는 절대(화면) 좌표 cm. 그룹 안 도형도 geom.py가 풀어 낸 값이다.
# ══════════════════════════════════════════════════════════════════

LAYOUTS = {

# ── 아젠다 ───────────────────────────────────────────────────────
"agenda-5": _L(27, desc="아젠다 1단 (최대 5행) + 마무리 바",
    use="안건·항목의 짧은 목록. 표가 아닌 한 줄짜리 (노트: 최대 5개)",
    agenda=dict(ys=[4.96, 6.33, 7.69, 9.05, 10.42], cols=1),
    closing=_C(13.47, "bar13"), closing_required=True),

# ── 카드형 (병렬 나열) ───────────────────────────────────────────
"card-4": _L(28, arity=4, desc="카드 4장 + 마무리 바",
    use="서로 독립한 4가지를 나란히 놓고 한 줄로 맺을 때",
    groups=[_G("cards", 4, num=5.05, title=5.92, body=7.80)],
    closing=_C(12.56, "bar16"), closing_required=True),

"card-3": _L(29, arity=3, desc="카드 3장 + 마무리 바",
    use="서로 독립한 3가지. 카드가 넓어 설명을 더 길게 쓸 수 있다",
    groups=[_G("cards", 3, num=5.05, title=5.92, body=7.80)],
    closing=_C(12.56, "bar16"), closing_required=True),

"card-5": _L(28, arity=5, desc="카드 5장 + 마무리 바",
    use="독립한 5가지. 가이드 20·21의 5단 그리드로 다시 깐다",
    regrid=5,
    groups=[_G("cards", 5, num=5.05, title=5.92, body=7.80)],
    closing=_C(12.56, "bar16"), closing_required=True),

"card-6": _L(28, arity=6, desc="카드 6장 + 마무리 바",
    use="독립한 6가지. 한 칸이 가장 좁으니 본문을 짧게",
    regrid=6,
    groups=[_G("cards", 6, num=5.05, title=5.92, body=7.80)],
    closing=_C(12.56, "bar16"), closing_required=True),

"card-3-chips": _L(30, arity=3, desc="긴 카드 3장 + 카드마다 키워드 칩",
    use="본문 항목이 6개 이상으로 길 때만 (노트 30: 3~4개면 card-3). 마무리 바가 없다",
    groups=[_G("cards", 3, num=5.05, title=5.92, body=7.80)],
    chips=dict(y=14.34, per=3, row_w=7.69, anchor="cards"),
    min_body_items=6),

# ── 이미지형 ─────────────────────────────────────────────────────
"image-3": _L(31, arity=3, desc="카드 3장 + 아래 이미지",
    use="항목마다 그림·스크린샷이 붙을 때",
    groups=[_G("cards", 3, num=5.06, title=5.93, body=7.27)],
    images=dict(y=11.38, n=3)),

"image-4": _L(32, arity=4, desc="카드 4장 + 아래 이미지",
    use="항목마다 그림이 붙고 4가지일 때",
    groups=[_G("cards", 4, num=5.05, title=5.92, body=7.32)],
    images=dict(y=12.47, n=4)),

"image-3-top": _L(33, arity=3, desc="위 이미지 3 + 소제목·설명 + 마무리 메시지",
    use="그림이 주인공이고 아래에 짧은 해설을 다는 구성",
    groups=[_G("cards", 3, title=10.53, body=11.22)],
    images=dict(y=4.86, n=3),
    closing=_C(13.68, "key"), closing_required=True),

"image-4-top": _L(34, arity=4, desc="위 이미지 4 + 소제목·설명 + 설명 박스",
    use="그림 4개와 해설, 아래에 부연 상자",
    groups=[_G("cards", 4, title=9.00, body=9.69)],
    images=dict(y=4.86, n=4),
    box=dict(title=12.60, body=13.61)),

"image-4-kpi": _L(35, arity=4, desc="위 이미지 4 + 해설 + KPI 4 + 설명 박스 (한 줄)",
    use="그림 4개 아래에 수치(KPI)를 붙이고 한 줄 단서를 달 때 (가이드 19 KPI형)",
    groups=[_G("cards", 4, title=8.37, body=9.06),
            _G("kpis", 4, desc=11.06, value=11.98)],
    images=dict(y=4.86, n=4),
    box=dict(title=13.73, body=14.74)),

"image-4-kpi-msg": _L(36, arity=4, desc="위 이미지 4 (카드 없음) + 해설 + KPI 4 + 마무리 메시지",
    use="그림 4개 + 수치 + 한 줄 결론",
    groups=[_G("cards", 4, title=8.07, body=8.77),
            _G("kpis", 4, desc=11.06, value=11.98)],
    images=dict(y=4.57, n=4),
    closing=_C(13.70, "msg"), closing_required=True),

# ── 원형 (대등 개념) ─────────────────────────────────────────────
"circle-4": _L(37, arity=4, desc="원형 4 + 마무리 메시지",
    use="한두 단어짜리 대등 개념 4가지. 본문 칸이 가장 좁다 (노트 18: 본문이 많지 않을 때)",
    groups=[_G("cards", 4, num=6.64, title=7.70, body=9.09)],
    closing=_C(13.70, "msg"), closing_required=True),

"circle-3": _L(38, arity=3, desc="원형 3 + 마무리 메시지",
    use="대등 개념 3가지",
    groups=[_G("cards", 3, num=6.64, title=7.70, body=9.09)],
    closing=_C(13.70, "msg"), closing_required=True),

"circle-4-line": _L(39, arity=4, desc="원형 4 (연결선형) + 마무리 메시지",
    use="원형 4가지가 순서·연결로 이어질 때",
    groups=[_G("cards", 4, num=6.64, title=7.70, body=9.09)],
    closing=_C(13.70, "msg"), closing_required=True),

"circle-3-line": _L(40, arity=3, desc="원형 3 (연결선형) + 마무리 메시지",
    use="원형 3가지가 순서·연결로 이어질 때",
    groups=[_G("cards", 3, num=6.64, title=7.70, body=9.09)],
    closing=_C(13.70, "msg"), closing_required=True),

# ── 헤드라인 + 카드 (결론 먼저) ──────────────────────────────────
"lead-3-chips": _L(41, arity=3, desc="헤드라인 바 + 칩·두 줄 제목 카드 3 + 마무리 메시지",
    use="결론 한 줄 + 근거 3가지. 카드마다 키워드 칩 하나와 두 줄짜리 제목",
    single=dict(headline=4.57),
    groups=[_G("cards", 3, title=8.58, body=10.42)],
    chips=dict(y=7.32, per=1, row_w=7.69, anchor="cards"),
    closing=_C(13.70, "msg"), closing_required=True,
    required=["headline"]),

"lead-4": _L(42, arity=4, desc="헤드라인 바 + 카드 4 + 마무리 메시지",
    use="결론을 먼저 한 줄로 못 박고 근거 4가지를 붙일 때",
    single=dict(headline=4.57),
    groups=[_G("cards", 4, title=7.58, body=8.64)],
    closing=_C(13.70, "msg"), closing_required=True,
    required=["headline"]),

"lead-3": _L(43, arity=3, desc="헤드라인 바 + 카드 3 + 마무리 메시지",
    use="결론 먼저 + 근거 3가지",
    single=dict(headline=4.57),
    groups=[_G("cards", 3, title=7.58, body=8.64)],
    closing=_C(13.70, "msg"), closing_required=True,
    required=["headline"]),

# ── 열 헤더 + 카드 ───────────────────────────────────────────────
"columns-3-chips": _L(44, arity=3, desc="열 헤더 바 3 + 카드 3 + 키워드 칩 + 마무리 메시지",
    use="3가지 축(헤더)마다 설명과 키워드를 달고 한 줄로 맺을 때",
    groups=[_G("cards", 3, header=4.55, title=6.63, body=7.69)],
    chips=dict(y=11.23, per=3, row_w=7.69, anchor="cards"),
    closing=_C(13.76, "msg"), closing_required=True),

"columns-3x3": _L(45, arity=3, desc="열 헤더 바 3 + 3행 × 3열 소제목·설명",
    use="3가지 축을 같은 관점 3개로 나눠 격자로 비교할 때. 마무리 문구가 없다",
    groups=[_G("panels", 3, header=4.55)],
    rows_groups=[_G("row1", 3, title=6.63, body=7.43),
                 _G("row2", 3, title=9.53, body=10.34),
                 _G("row3", 3, title=12.42, body=13.23)]),

# ── KPI형 (가이드 19) ────────────────────────────────────────────
"kpi-4-cards-3": _L(46, arity=3, desc="KPI 4 (위) + 칩·카드 3 (아래) + 마무리 메시지",
    use="수치 4개를 먼저 보이고 그 의미를 카드 3장으로 풀 때",
    groups=[_G("kpis", 4, desc=4.94, value=6.81),
            _G("cards", 3, title=11.05, body=11.72)],
    chips=dict(y=9.47, per=1, row_w=7.69, anchor="cards"),
    closing=_C(13.70, "msg"), closing_required=True),

"kpi-3-cards-3": _L(47, arity=3, desc="KPI 3 (위) + 카드 3 (아래) + 마무리 메시지",
    use="수치 3개와 각 수치의 해설 카드",
    groups=[_G("kpis", 3, desc=4.87, value=6.42),
            _G("cards", 3, title=9.39, body=10.45)],
    closing=_C(13.70, "msg"), closing_required=True),

"cards-3-kpi-4": _L(48, arity=3, desc="칩·카드 3 (위) + KPI 4 (아래) + 마무리 메시지",
    use="설명을 먼저 하고 그 결과 수치 4개를 아래에 놓을 때",
    groups=[_G("cards", 3, title=6.64, body=7.31),
            _G("kpis", 4, desc=9.88, value=10.99)],
    chips=dict(y=5.12, per=1, row_w=7.69, anchor="cards"),
    closing=_C(13.70, "msg"), closing_required=True),

# ── 변화 설명 (좌: 현행 / 우: 개선) ──────────────────────────────
"change-2-notes": _L(49, arity=2, desc="넓은 카드 2 (칩+제목+설명) + 아래 제목·설명 박스 2",
    use="변화 전/후를 두 칸으로 놓고 각각 아래에 부연을 달 때",
    groups=[_G("panels", 2, title=6.35, body=8.19),
            _G("notes", 2, label=11.36, title=12.63, body=13.65)],
    chips=dict(y=5.09, per=1, row_w=12.0, anchor="panels")),

"change-2-note": _L(50, arity=2, desc="넓은 카드 2 (칩+제목+설명) + 아래 설명 박스 1",
    use="변화 전/후 두 칸 + 공통 단서 한 덩어리",
    groups=[_G("panels", 2, title=6.35, body=8.19)],
    chips=dict(y=5.09, per=1, row_w=12.0, anchor="panels"),
    box=dict(title=12.06, body=13.08)),

# ── 2단 구성 (위 카드 + 아래 카드) ───────────────────────────────
"stack-3": _L(51, arity=3, desc="칩+카드 3 (위) · 구분 타이틀 + 카드 3 (아래) + 마무리 바",
    use="같은 3가지를 두 층위로 나눠 보여줄 때 (현황 → 대응 등)",
    chips=dict(y=5.12, per=1, row_w=7.69, anchor="cards"),
    groups=[_G("cards", 3, title=6.60, body=7.27),
            _G("lower", 3, title=10.72, body=11.55)],
    single=dict(panel_title=9.32),
    closing=_C(13.68, "key"), closing_required=True),

# ── 항목 Pill + 키워드 칩 ────────────────────────────────────────
"pill-4": _L(52, arity=4, desc="Pill 4 + 키워드 칩 2 + 아래 요약",
    use="항목마다 '설명 → 그래서 결론'이 따로 있을 때",
    groups=[_G("items", 4, pill=4.84, title=6.65, detail=7.66, summary=12.55)],
    chips=dict(y=9.74, per=2, row_w=5.29, anchor="items")),

"pill-3": _L(53, arity=3, desc="Pill 3 + 본문 + 키워드 칩 2 + 아래 요약",
    use="항목 3가지, 항목마다 요약 한 줄",
    groups=[_G("items", 3, pill=4.84, title=6.65, body=7.66, summary=13.61)],
    chips=dict(y=10.72, per=2, row_w=7.12, anchor="items")),

"pill-3-summary-note": _L(54, arity=3, desc="Pill 3 + 본문 + 작은 꼬리표 + 요약 박스 + 설명 박스",
    use="항목 3가지 → 각 결론 → 공통 단서 한 줄",
    groups=[_G("items", 3, pill=4.84, body=6.70, tag=10.01, summary=11.65)],
    box=dict(title=13.73, body=14.74)),

"pill-4-msg": _L(61, arity=4, desc="Pill 4 + 키워드 칩 2 + 마무리 메시지",
    use="항목 4가지를 한 줄 결론으로 맺을 때",
    groups=[_G("items", 4, pill=4.84, title=6.65, detail=7.66)],
    chips=dict(y=11.16, per=2, row_w=5.29, anchor="items"),
    closing=_C(13.70, "msg"), closing_required=True),

"pill-3-msg": _L(62, arity=3, desc="Pill 3 + 본문 + 키워드 칩 2 + 마무리 메시지",
    use="항목 3가지를 한 줄 결론으로 맺을 때",
    groups=[_G("items", 3, pill=4.84, title=6.65, body=7.66)],
    chips=dict(y=11.16, per=2, row_w=7.12, anchor="items"),
    closing=_C(13.70, "msg"), closing_required=True),

"pill-3-note": _L(63, arity=3, desc="Pill 3 + 키워드 칩 2 + 설명 박스",
    use="항목 3가지 + 아래에 단서·주석을 다는 구성",
    groups=[_G("items", 3, pill=4.84, title=6.65, detail=7.66)],
    chips=dict(y=9.82, per=2, row_w=7.12, anchor="items"),
    box=dict(title=12.06, body=13.08)),

# ── 여러 칸 카드 (6·8·10) ────────────────────────────────────────
"cards-6": _L(55, arity=6, desc="카드 6 (3+3, 큰 번호) + 마무리 메시지",
    use="6가지를 두 줄로 놓고 한 줄로 맺을 때",
    groups=[_G("steps", 3, num=5.06, title=6.42, body=7.21),
            _G("steps2", 3, num=9.63, title=10.98, body=11.77)],
    merge_groups=("steps", "steps2"),
    closing=_C(13.70, "msg"), closing_required=True),

"cards-8": _L(56, arity=8, desc="카드 8 (4+4, 큰 번호) + 마무리 메시지",
    use="8가지를 두 줄로 놓고 한 줄로 맺을 때",
    groups=[_G("steps", 4, num=5.04, title=6.42, body=7.21),
            _G("steps2", 4, num=9.57, title=10.95, body=11.74)],
    merge_groups=("steps", "steps2"),
    closing=_C(13.70, "msg"), closing_required=True),

"cards-10": _L(57, arity=10, desc="카드 10 (5+5) + 마무리 메시지",
    use="10가지. 칸이 좁아 본문은 한두 줄",
    groups=[_G("steps", 5, num=5.07, title=6.24, body=7.15),
            _G("steps2", 5, num=9.46, title=10.64, body=11.54)],
    merge_groups=("steps", "steps2"),
    closing=_C(13.70, "msg"), closing_required=True),

"steps-6": _L(58, arity=6, desc="6항목 (3+3, '01. 제목') + 설명 박스",
    use="6가지를 두 줄로 놓고 아래에 부연을 다는 구성. 제목 앞에 번호가 붙는다",
    groups=[_G("steps", 3, title=5.17, body=6.23),
            _G("steps2", 3, title=8.90, body=9.96)],
    merge_groups=("steps", "steps2"), numbered_title=True,
    box=dict(title=12.60, body=13.61)),

"cards-8-note": _L(59, arity=8, desc="8항목 (4+4, '01. 제목') + 설명 박스",
    use="8가지 + 아래 단서 한 덩어리",
    groups=[_G("steps", 4, title=5.17, body=6.23),
            _G("steps2", 4, title=8.90, body=9.96)],
    merge_groups=("steps", "steps2"), numbered_title=True,
    box=dict(title=12.60, body=13.61)),

"cards-10-note": _L(60, arity=10, desc="10항목 (5+5, '01. 제목') + 설명 박스",
    use="10가지 + 아래 단서 한 덩어리",
    groups=[_G("steps", 5, title=5.17, body=6.23),
            _G("steps2", 5, title=8.86, body=9.92)],
    merge_groups=("steps", "steps2"), numbered_title=True,
    box=dict(title=12.60, body=13.61)),

"steps-8": _L(65, arity=8, desc="8단계 (4+4, 큰 번호) + 마무리 메시지",
    use="절차가 8단계일 때. 위 4 → 아래 4 순서로 읽는다",
    groups=[_G("steps", 4, num=5.04, title=6.45, body=7.21),
            _G("steps2", 4, num=9.59, title=11.00, body=11.76)],
    merge_groups=("steps", "steps2"),
    closing=_C(13.70, "msg"), closing_required=True),

"steps-10": _L(66, arity=10, desc="10단계 (5+5, '01. 제목') + 설명 박스. 본문 8pt",
    use="절차가 10단계일 때. 가장 촘촘하다",
    groups=[_G("steps", 5, title=5.15, body=6.20),
            _G("steps2", 5, title=8.71, body=9.76)],
    merge_groups=("steps", "steps2"), numbered_title=True,
    box=dict(title=12.06, body=13.08)),

"timeline-4-notes-3": _L(64, arity=4, desc="단계 카드 4 (날짜/번호+제목+설명) + 아래 '01. 제목' 카드 3 + 마무리 바",
    use="4단계 일정·경과를 위에 놓고 아래에 정리 3가지를 붙일 때",
    groups=[_G("steps", 4, num=5.04, title=6.20, body=7.51),
            _G("lower", 3, title=10.44, body=11.50)],
    numbered_title_groups=("lower",),
    closing=_C(13.47, "bar13"), closing_required=True),

# ── 방사형 ───────────────────────────────────────────────────────
"radial-4": _L(67, arity=4, desc="중심 개념 + 사방 4항목",
    use="하나가 나머지를 지배하는 구조 (중심-주변)",
    groups=[_G("panels", 2, title=5.29, body=6.50),
            _G("panels2", 2, title=10.96, body=12.17)],
    merge_groups=("panels", "panels2"),
    single=dict(center=7.51),
    required=["center"]),

# ── 2단 비교 ─────────────────────────────────────────────────────
"compare-rows": _L(68, arity=2, desc="2단 비교 · 패널마다 소제목 3행 + 요약",
    use="두 안을 항목별로 맞세우고 각각 한 줄로 맺을 때",
    groups=[_G("panels", 2, header=4.86, summary=13.68)],
    rows_groups=[_G("row1", 2, title=6.72, body=7.38),
                 _G("row2", 2, title=9.08, body=9.74),
                 _G("row3", 2, title=11.45, body=12.11)],
    required=["summary"]),

"compare-cards": _L(69, arity=2, desc="2단 비교 · 카드 + 요약 칩 3 + 공통 마무리 문구",
    use="두 안을 카드로 비교하고 하나의 결론으로 합칠 때",
    groups=[_G("panels", 2, header=4.86, sub=4.96, title=6.65, detail=7.66)],
    sub_boxes=dict(y=10.27, per=3, anchor="panels"),
    closing=_C(13.68, "key"), closing_required=True),

"compare-vs": _L(70, arity=2, desc="2단 비교 · VS 대결형",
    use="두 안을 정면으로 맞세우고 하나로 결론지을 때 (노트 70: 본문 항목 3~4개 권장)",
    groups=[_G("panels", 2, header=4.86, sub=4.96, title=6.88, body=8.16)],
    body_items_range=(3, 4),
    closing=_C(13.66, "msg"), closing_required=True),

# ── 혼합 (좌우 비대칭) ───────────────────────────────────────────
"split-3": _L(71, arity=3, desc="왼쪽 카드 1 + 오른쪽 소제목 4행 + 설명 박스",
    use="큰 개념 하나를 왼쪽에 두고 오른쪽에 세부를 나열할 때 (노트 71: 행이 적으면 위부터 채운다)",
    single=dict(panel_head=(4.87, 14.0, None), main_title=(5.07, None, 14.0)),
    main_body=(6.26, None, 14.0),
    rows_groups=[_G("rows", 1, title=(6.72, 14.0, None), body=(7.31, 14.0, None)),
                 _G("rows2", 1, title=(8.89, 14.0, None), body=(9.48, 14.0, None)),
                 _G("rows3", 1, title=(11.06, 14.0, None), body=(11.64, 14.0, None)),
                 _G("rows4", 1, title=(13.22, 14.0, None), body=(13.81, 14.0, None))],
    box=dict(title=(12.49, None, 14.0), body=(13.50, None, 14.0))),

"wing-rows": _L(72, arity=4, desc="좌우 요약 날개 5 + 가운데 소제목 4행",
    use="가운데 흐름을 좌우 요약이 감싸는 구성",
    single=dict(panel_left=(4.55, None, 8.0), panel_right=(4.55, 20.0, None),
                center_head=(4.87, 9.0, 21.0)),
    wings=dict(left_x=(None, 8.0), right_x=(20.0, None),
               ys=[5.92, 7.88, 9.84, 11.79, 13.75]),
    rows_groups=[_G("rows", 1, title=(6.72, 9.0, 21.0), body=(7.31, 9.0, 21.0)),
                 _G("rows2", 1, title=(8.89, 9.0, 21.0), body=(9.48, 9.0, 21.0)),
                 _G("rows3", 1, title=(11.06, 9.0, 21.0), body=(11.64, 9.0, 21.0)),
                 _G("rows4", 1, title=(13.22, 9.0, 21.0), body=(13.81, 9.0, 21.0))]),

"wing-circle": _L(73, desc="좌우 제목·설명 카드 4 + 가운데 원형 1",
    use="가운데 핵심 개념 하나를 좌우 카드가 감쌀 때",
    single=dict(panel_left=(4.55, None, 8.0), panel_right=(4.55, 20.0, None),
                center_num=(8.12, 9.0, 21.0), center_title=(9.18, 9.0, 21.0),
                center_body=(10.57, 9.0, 21.0)),
    wings=dict(left_x=(None, 8.0), right_x=(20.0, None),
               ys=[6.34, 8.76, 11.19, 13.61], body_ys=[6.98, 9.41, 11.83, 14.25])),

"wing-message": _L(74, desc="좌우 제목·설명 카드 4 + 가운데 핵심 메시지",
    use="가운데 한마디를 좌우 카드가 감쌀 때",
    single=dict(panel_left=(4.55, None, 8.0), panel_right=(4.55, 20.0, None),
                headline=(9.23, 9.0, 21.0)),
    wings=dict(left_x=(None, 8.0), right_x=(20.0, None),
               ys=[6.34, 8.76, 11.19, 13.61], body_ys=[6.98, 9.41, 11.83, 14.25]),
    required=["headline"]),

# ── 화살표 흐름 ──────────────────────────────────────────────────
"flow-8": _L(75, arity=8, desc="화살표 흐름 8 (2열 × 4행) + 마무리 바",
    use="좌우 두 갈래로 흐르는 8단계. 가운데 화살표에 설명을 달 수 있다",
    groups=[_G("items", 2, title=5.00, body=5.67),
            _G("items2", 2, title=7.14, body=7.81),
            _G("items3", 2, title=9.28, body=9.95),
            _G("items4", 2, title=11.42, body=12.09)],
    merge_groups=("items", "items2", "items3", "items4"),
    x_gap=(10.5, 19.0),
    mid_notes=dict(ys=[4.98, 7.01, 9.25, 11.32], x_min=10.5, x_max=19.0),
    closing=_C(14.58, "split"), closing_required=True),

"flow-6": _L(76, arity=6, desc="화살표 흐름 6 (2열 × 3행) + 마무리 바",
    use="좌우 두 갈래로 흐르는 6단계",
    groups=[_G("items", 2, title=5.15, body=6.05),
            _G("items2", 2, title=8.03, body=8.93),
            _G("items3", 2, title=10.90, body=11.81)],
    merge_groups=("items", "items2", "items3"),
    x_gap=(10.5, 19.0),
    mid_notes=dict(ys=[5.33, 8.07, 11.07], x_min=10.5, x_max=19.0),
    closing=_C(14.58, "split"), closing_required=True),

"flow-4": _L(76, arity=4, desc="화살표 흐름 4 (2열 × 2행) + 마무리 바",
    use="4단계. 노트 75·76 '박스 개수는 내용에 따라 조정(4·3·2개)' — 셋째 줄을 지운다",
    groups=[_G("items", 2, title=5.15, body=6.05),
            _G("items2", 2, title=8.03, body=8.93)],
    merge_groups=("items", "items2"),
    x_gap=(10.5, 19.0),
    mid_notes=dict(ys=[5.33, 8.07], x_min=10.5, x_max=19.0),
    drop_bands=[(10.20, 13.00)],
    stretch_rows=dict(row_ys=[4.55, 7.43], top=4.55, bottom=13.53),   # 남은 두 줄이 자리를 나눠 갖는다
    closing=_C(14.58, "split"), closing_required=True),

# ── 왼쪽 강조 패널 + 오른쪽 ──────────────────────────────────────
"panel-cards-3": _L(77, desc="왼쪽 강조 패널(큰 타이틀) + 오른쪽 카드 3 + 요약 3",
    use="하나의 큰 주장을 왼쪽에 크게 걸고 오른쪽에 근거 카드 3장을 놓을 때",
    single=dict(panel_head=(5.42, None, 9.5), big_title=(6.83, None, 9.5),
                panel_body=(8.35, None, 9.5), caption=(14.48, None, 9.5)),
    groups=[_G("cards", 3, num=(5.07, 10.0, None), title=(5.94, 10.0, None),
               body=(7.82, 10.0, None)),
            _G("summaries", 3, text=(13.42, 10.0, None))],
    required=["big_title"]),

"panel-2-cards-3-note": _L(78, desc="왼쪽 패널(큰 타이틀 2단) + 오른쪽 카드 3 + 설명 박스",
    use="왼쪽 패널에 지표 두 덩어리, 오른쪽에 카드 3장과 단서",
    single=dict(panel_head=(5.42, None, 9.5), big_title=(6.83, None, 9.5),
                panel_body=(7.96, None, 9.5), big_title2=(10.00, None, 9.5),
                panel_body2=(11.13, None, 9.5), caption=(14.48, None, 9.5)),
    groups=[_G("cards", 3, num=(5.07, 10.0, None), title=(5.94, 10.0, None),
               body=(7.82, 10.0, None))],
    box=dict(title=(12.49, 10.0, None), body=(13.50, 10.0, None)),
    required=["big_title"]),

"panel-rows-note": _L(79, desc="왼쪽 수치 패널(4행) + 오른쪽 카드 3 + 설명 박스",
    use="수치 몇 개가 주인공이고 아래에 단서를 달 때",
    single=dict(panel_head=(5.42, None, 9.5), caption=(14.48, None, 9.5)),
    rows=dict(ys=[6.83, 8.41, 10.03, 11.65], x_max=9.5, per=2),
    groups=[_G("cards", 3, num=(5.07, 10.0, None), title=(5.94, 10.0, None),
               body=(7.82, 10.0, None))],
    box=dict(title=(12.49, 10.0, None), body=(13.50, 10.0, None))),

"panel-rows": _L(80, desc="왼쪽 수치 패널(4행) + 오른쪽 카드 3 + 요약 3",
    use="수치 몇 개가 주인공일 때 (전환 전/후 등)",
    single=dict(panel_head=(5.42, None, 9.5), caption=(14.48, None, 9.5)),
    rows=dict(ys=[6.83, 8.41, 10.03, 11.65], x_max=9.5, per=2),
    groups=[_G("cards", 3, num=(5.07, 10.0, None), title=(5.94, 10.0, None),
               body=(7.82, 10.0, None)),
            _G("summaries", 3, text=(13.42, 10.0, None))]),

"panel-cards-6": _L(81, desc="왼쪽 강조 패널 + 오른쪽 카드 6 (3+3, 본문 8pt)",
    use="주장 하나 + 근거 6가지. 본문이 8pt라 짧게",
    single=dict(panel_head=(5.42, None, 8.0), big_title=(6.83, None, 8.0),
                panel_body=(7.96, None, 8.0), caption=(14.48, None, 8.0)),
    groups=[_G("cards", 3, num=(5.03, 8.0, None), title=(5.81, 8.0, None),
               body=(7.80, 8.0, None)),
            _G("cards2", 3, num=(10.59, 8.0, None), title=(11.38, 8.0, None),
               body=(13.37, 8.0, None))],
    merge_groups=("cards", "cards2"),
    required=["big_title"]),

# ── 차트 ─────────────────────────────────────────────────────────
"chart-donut": _L(82, desc="도넛 차트 + 오른쪽 해석 패널",
    use="비율·구성(전체 중 몫). 항목 5개 이하",
    single=dict(chart_title=(8.99, None, 14.0), header=(4.96, 16.0, None),
                body=(7.08, 15.0, None), summary=(12.86, 15.0, None)),
    chart=dict(kind="donut", max=CHART_DONUT_MAX),
    required=["summary"]),

"chart-bar": _L(83, desc="막대 차트 + 오른쪽 제목·설명 카드 4",
    use="시계열·항목별 크기 비교. 항목 5개 이하",
    single=dict(panel_title=(4.55, 21.0, None)),
    wings=dict(right_x=(21.0, None), ys=[6.32, 8.74, 11.17, 13.59],
               body_ys=[6.96, 9.39, 11.81, 14.23]),
    chart=dict(kind="bar", max=CHART_BAR_MAX)),

"chart-notes": _L(84, desc="넓은 막대 차트 + 아래 설명 박스 2",
    use="차트를 크게 보이고 아래에 관점 두 가지를 덧붙일 때",
    groups=[_G("notes", 2, title=12.04, body=13.05)],
    chart=dict(kind="bar", max=CHART_BAR_MAX)),

# ── 표 ───────────────────────────────────────────────────────────
"table-full": _L(87, desc="타이틀 + 전면 표 (마무리 없음)",
    use="행이 많은 표. 가이드라인 안을 표가 다 쓴다",
    table=dict(y=4.55, x=CONTENT_X, w=CONTENT_W, max_bottom=CONTENT_BOTTOM)),

"table": _L(88, desc="표 + 마무리 바",
    use="행·열이 있는 진짜 데이터. 표를 읽은 결론을 아래 바에 적는다",
    table=dict(y=4.55, x=CONTENT_X, w=CONTENT_W, max_bottom=12.06),
    closing=_C(12.56, "bar16"), closing_required=True),

"table-flow": _L(89, desc="표 + as-is → to-be 흐름 박스",
    use="표를 읽은 결론이 '현행 → 개선'인 흐름일 때 (노트 89: 하단 포맷은 다른 장표에도 활용 가능)",
    table=dict(y=4.55, x=CONTENT_X, w=CONTENT_W, max_bottom=12.31),
    groups=[_G("flow", 2, text=12.81)],
    required=["flow"]),

"table-lower": _L(90, desc="위 설명 박스 2 + 구분 타이틀 + 아래 표",
    use="설명을 먼저 하고 표로 뒷받침할 때",
    groups=[_G("notes", 2, title=4.90, body=5.92)],
    single=dict(panel_title=9.03),
    table=dict(y=10.05, x=CONTENT_X, w=CONTENT_W, max_bottom=CONTENT_BOTTOM)),

"table-notes": _L(91, desc="표 + 아래 설명 박스 2",
    use="표 아래에 관점 두 가지를 나란히 덧붙일 때",
    table=dict(y=4.55, x=CONTENT_X, w=CONTENT_W, max_bottom=11.18),
    groups=[_G("notes", 2, title=12.04, body=13.05)]),

"table-note": _L(92, desc="표 + 아래 설명 박스 1",
    use="표 아래에 단서·주석을 한 덩어리로 붙일 때",
    table=dict(y=4.55, x=CONTENT_X, w=CONTENT_W, max_bottom=11.67),
    box=dict(title=12.60, body=13.61)),

# ── 자유 배치 ────────────────────────────────────────────────────
"free-title": _L(87, desc="타이틀만 있는 빈 장표 (자유 배치)",
    use="템플릿으로 표현하기 어려운 내용. 원고 레이아웃을 살려야 할 때",
    free=True),

"free": _L(85, title=None, desc="섹션 라벨만 있는 빈 장표 (자유 배치)",
    use="타이틀 없이 화면 전체를 쓰는 도식·표",
    free=True),
}

# 같은 원본 장표를 쓰는 이전 이름 — 그대로 받아 준다
ALIASES = {
    "compare-cards-msg": "compare-cards",
    "panel-note": "panel-cards-3",
    "panel-rows-pill": "panel-rows",
    "message": "message",
}

# ── 제품 소개 페이지 (93~105) ────────────────────────────────────
#
# 브랜드 그래픽이 많아 **복제 후 글자만** 갈아끼운다. 제품을 고르면 그 제품의
# 소개(intro) / 주요 기능(features) 장표가 그대로 들어간다.
PRODUCTS = {
    "openstackit": dict(name="오픈스택잇", en="Openstackit", color="iaas",
                        intro=96, features=97),
    "secloudit": dict(name="SE클라우드잇", en="SECloudit", color="paas",
                      intro=98, features=99),
    "devopsit": dict(name="데브옵스잇", en="DevOpsit", color="devops",
                     intro=100, features=101),
    "aicubeit": dict(name="AI큐브잇", en="AICubeit", color="mlops",
                     intro=102, features=103),
    "tabcloudit": dict(name="탭클라우드잇", en="TabCloudit", color="cmp",
                       intro=104, features=105),
}
# TAFA 개요 · TAFA 솔루션 계층(신규 94) · 제품 라인업
PRODUCT_OVERVIEW = {"tafa": 93, "tafa-layers": 94, "lineup": 95}

# 제품 장표의 글자 슬롯 (실측). intro/features 두 형태가 제품마다 같다.
PRODUCT_SLOTS = {
    "intro": dict(headline=2.27, lead=6.52,
                  cards=_G("cards", 3, title=11.38, body=13.05)),
    "features": dict(headline=2.27, lead=6.52,
                     groups=[_G("items", 3, num=5.03, title=5.81, body=7.89),
                             _G("items2", 3, num=10.59, title=11.38, body=13.46)]),
}

# ── 장표 이름 별칭 — 템플릿 슬라이드 번호로도 부를 수 있다 ───────
BY_SLIDE = {}
for _n, _s in LAYOUTS.items():
    BY_SLIDE.setdefault(_s["slide"], _n)      # 같은 원본을 쓰는 변형(card-5·6, flow-4)은 첫 이름이 정본

# 단 수가 이름의 일부인 계열. 개수를 틀리면 안내한다.
ARITY_FAMILIES = {
    "card": ("card-3", "card-4", "card-5", "card-6", "card-3-chips"),
    "cards": ("cards-6", "cards-8", "cards-10", "cards-8-note", "cards-10-note"),
    "image": ("image-3", "image-4", "image-3-top", "image-4-top", "image-4-kpi", "image-4-kpi-msg"),
    "circle": ("circle-4", "circle-3", "circle-4-line", "circle-3-line"),
    "lead": ("lead-4", "lead-3", "lead-3-chips"),
    "columns": ("columns-3-chips", "columns-3x3"),
    "kpi": ("kpi-4-cards-3", "kpi-3-cards-3", "cards-3-kpi-4"),
    "change": ("change-2-notes", "change-2-note"),
    "pill": ("pill-4", "pill-3", "pill-4-msg", "pill-3-msg", "pill-3-note", "pill-3-summary-note"),
    "steps": ("steps-6", "steps-8", "steps-10"),
    "flow": ("flow-4", "flow-6", "flow-8"),
    "compare": ("compare-rows", "compare-cards", "compare-vs"),
    "panel": ("panel-cards-3", "panel-2-cards-3-note", "panel-rows", "panel-rows-note", "panel-cards-6"),
    "wing": ("wing-rows", "wing-circle", "wing-message"),
    "table": ("table", "table-full", "table-flow", "table-lower", "table-notes", "table-note"),
    "agenda": ("agenda-5",),
    "chart": ("chart-donut", "chart-bar", "chart-notes"),
}

# 이전 템플릿(v1.1 86장 / v1.0 33장) 이름 → 지금 이름. 자동 변환하지 않고 안내만 한다.
RENAMED = {
    # v1.1 → 최신본에서 사라진 것
    "agenda-8": "agenda-5 두 장 (1/2)(2/2) 또는 cards-8 — 최신본은 아젠다 최대 5개",
    "compare-cards-msg": "compare-cards (같은 장표. 별칭으로도 받는다)",
    "panel-note": "panel-cards-3 (오른쪽이 설명 → 카드 3장으로 바뀌었다. 별칭으로도 받는다)",
    "panel-pill-3": "panel-cards-3 또는 panel-rows",
    "panel-rows-pill": "panel-rows (별칭으로도 받는다)",
    # v1.0 (33장)
    "box-4": "card-4", "box-3": "card-3", "box-3-keywords": "card-3-chips",
    "steps-4": "pill-4-msg 또는 steps-8", "steps-3": "pill-3-msg 또는 steps-6",
    "radial": "radial-4",
    "compare-bullets": "compare-rows", "compare-keywords": "compare-cards",
    "compare-tables": "table-lower 또는 compare-rows",
    "focus-3": "panel-cards-3", "kpi-3": "panel-rows 또는 kpi-3-cards-3",
    "table-highlight": "table (highlight_cols 지정)",
    "agenda": "agenda-5 (최대 5행)",
}

# ── 슬롯 용량 ────────────────────────────────────────────────────
# 글자수 상한은 여기 적지 않는다. `innogrid_ppt/capacity.py` 가 템플릿 상자를 실제로
# 재서 (줄당 글자 수, 줄 수)로 갖고 있고, `tools/measure.py` 로 다시 만든다.
