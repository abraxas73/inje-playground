# -*- coding: utf-8 -*-
"""그리드 재배치와 가변 박스 — 템플릿 노트가 요구하는 "늘어나는" 동작.

템플릿 슬라이드 노트(가이드 13·14·18·19)가 명시하는 규칙 두 가지를 구현한다.

  · **카드는 3단부터 6단까지** 활용 가능하고, 어느 단이든 가이드라인을 가득 채운다.
    템플릿 본문에는 3·4단 장표만 있으므로 4단 장표의 한 열을 복제해 그리드에 다시 깐다.
  · **본문이 길어지면 박스도 아래로 같이 커진다** (여백·라운드 유지).
    글자를 줄이라고 막기 전에 먼저 상자를 키운다.

두 동작 모두 **도형을 새로 그리지 않는다** — 템플릿의 열을 복제하고 좌표만 옮긴다.
색·글꼴·모서리·여백은 원본 그대로다.
"""

import copy

from . import tokens as T
from .geom import walk_abs

# 카드 그리드 — 가이드 18·19 실측 (배경 카드 폭, cm)
CARD_GRID = {3: 8.74, 4: 6.50, 5: 5.17, 6: 4.26}
CARD_INSET = 0.50          # 카드 배경과 안쪽 글상자 사이 좌우 여백 (26번 실측, 단 수와 무관하게 고정)
MIN_GAP_BELOW = 0.40       # 늘어난 박스와 아래 요소 사이에 남길 간격


def grid_x(n, i):
    """n단 그리드에서 i번째 카드의 왼쪽 x (cm)."""
    w = CARD_GRID[n]
    pitch = (T.CONTENT_W - w) / (n - 1) if n > 1 else 0
    return T.CONTENT_X + i * pitch


# ── 카드 열 재배치 ───────────────────────────────────────────────

def _columns(slide, base_y, base_w, cols):
    """카드 열별 도형 묶음을 돌려준다. 열은 배경 카드의 x로 가른다."""
    nodes = [nd for nd in walk_abs(slide.shapes) if nd.y >= base_y - 0.05]
    buckets = [[] for _ in cols]
    for nd in nodes:
        if nd.w > base_w + 1.0:          # 마무리 바처럼 전폭 요소는 건드리지 않는다
            continue
        for i, cx in enumerate(cols):
            if cx - 0.05 <= nd.x <= cx + base_w + 0.05:
                buckets[i].append(nd)
                break
    return buckets


def regrid_cards(slide, n, *, base_y=4.55, base_w=6.50, base_cols=(1.35, 8.18, 15.00, 21.83)):
    """4단 카드 장표를 n단(3~6)으로 다시 깐다.

    첫 열을 원형으로 삼아 n개를 만들고, 배경 카드는 그리드 폭에, 안쪽 글상자는
    **좌우 여백 0.50cm를 유지한 채** 늘리거나 줄인다 (노트 "여백은 항상 준수").
    """
    if n not in CARD_GRID:
        raise ValueError(f"카드는 3~6단만 가능하다 ({n}단이 왔다) — 가이드 18·19")
    buckets = _columns(slide, base_y, base_w, base_cols)
    proto = buckets[0]
    if not proto:
        raise LookupError("카드 열을 찾지 못했다")

    spTree = slide.shapes._spTree
    card_w = CARD_GRID[n]
    inner_w = card_w - 2 * CARD_INSET

    # 원형 열의 도형을 (배경인가?, 원본 x로부터의 상대 위치)로 기억한다
    plan = []
    for nd in proto:
        is_bg = nd.w >= base_w - 0.05
        plan.append((nd.shape, is_bg))

    made = []
    for i in range(n):
        gx = grid_x(n, i)
        if i == 0:
            shapes = [sh for sh, _ in plan]
        else:
            shapes = []
            for sh, _ in plan:
                el = copy.deepcopy(sh._element)
                spTree.append(el)
                shapes.append(_wrap(slide, el))
        for (sh_new, (_, is_bg)) in zip(shapes, plan):
            if is_bg:
                sh_new.left, sh_new.width = T.cm(gx), T.cm(card_w)
            else:
                sh_new.left, sh_new.width = T.cm(gx + CARD_INSET), T.cm(inner_w)
        made.append(shapes)

    # 남은 원본 열은 지운다
    for bucket in buckets[1:]:
        for nd in bucket:
            el = nd.shape._element
            if el.getparent() is not None:
                el.getparent().remove(el)
    return made


def _wrap(slide, element):
    """spTree에 붙인 raw 원소를 python-pptx 도형 객체로 되찾는다."""
    for sh in slide.shapes:
        if sh._element is element:
            return sh
    raise LookupError("복제한 도형을 찾지 못했다")


# ── 가변 박스 ────────────────────────────────────────────────────

def line_height_cm(pt, ratio=1.3):
    return pt / 72 * 2.54 * ratio


# 글 높이 = 줄 수 × 글자 줄높이 + 문단 수 × 문단 뒤 여백.
# 문단 뒤 여백(`a:spcAft`)을 빼놓으면 네 줄짜리 박스가 0.4cm 부족해져 글이 바닥에 붙는다.
TEXT_LINE_RATIO = 1.2      # 줄간격 100%일 때 글자 크기 대비 줄 높이


def _pt_val(node, tag):
    """`a:lnSpc`·`a:spcAft` 안의 값을 pt로. 백분율이면 pt=None을 돌려준다."""
    from pptx.oxml.ns import qn
    if node is None:
        return None, None
    el = node.find(qn(tag))
    if el is None:
        return None, None
    pts = el.find(qn("a:spcPts"))
    if pts is not None:
        return int(pts.get("val")) / 100.0, None
    pct = el.find(qn("a:spcPct"))
    if pct is not None:
        return None, int(pct.get("val")) / 100000.0
    return None, None


def para_metrics(shape, default_pt=9.0):
    """이 도형이 실제로 쓰는 (줄 간격, 문단 뒤 여백)을 cm로 잰다.

    템플릿마다 방식이 다르다 — 어떤 상자는 `lnSpc`에 14.5pt를 못 박아 두고,
    어떤 상자는 줄 간격은 기본값이고 `spcAft`로 4pt를 띄운다. 둘 다 읽는다.
    """
    from pptx.oxml.ns import qn
    pt = _font_pt(shape, default_pt)
    pitch = line_height_cm(pt, TEXT_LINE_RATIO)
    spc = 0.0
    try:
        for para in shape.text_frame.paragraphs:
            pPr = para._p.find(qn("a:pPr"))
            if pPr is None:
                continue
            ln_pt, ln_pct = _pt_val(pPr, "a:lnSpc")
            if ln_pt:
                pitch = max(pitch, ln_pt / 72 * 2.54)
            elif ln_pct:
                pitch = max(pitch, line_height_cm(pt, TEXT_LINE_RATIO) * ln_pct)
            aft_pt, _ = _pt_val(pPr, "a:spcAft")
            if aft_pt:
                spc = max(spc, aft_pt / 72 * 2.54)
    except Exception:
        pass
    return pitch, spc


def text_height_cm(shape, lines, paras=1):
    """이 도형의 줄 간격·문단 여백으로 잰, 줄 수만큼의 글 높이(cm)."""
    pitch, spc = para_metrics(shape)
    return max(1, lines) * pitch + max(0, paras - 1) * spc


def _container_of(node, nodes):
    """글상자를 감싸는 배경 카드(글자 없는 도형)를 찾는다."""
    best = None
    for nd in nodes:
        sh = nd.shape
        try:
            if sh.has_text_frame and sh.text_frame.text.strip():
                continue
        except Exception:
            continue
        if nd.w < node.w or nd.h < node.h:
            continue
        if not (nd.x - 0.1 <= node.x and node.x + node.w <= nd.x + nd.w + 0.1):
            continue
        if not (nd.y - 0.1 <= node.y and node.y <= nd.y + nd.h + 0.1):
            continue
        if best is None or (nd.w * nd.h) < (best.w * best.h):
            best = nd                       # 가장 작게 감싸는 것 = 그 카드
    return best


def room_below(node, nodes, floor=None):
    """node 아래로 넓힐 수 있는 여유(cm). 아래에서 가장 먼저 만나는 요소까지."""
    floor = floor if floor is not None else T.CONTENT_BOTTOM
    bottom = node.y + node.h
    limit = floor
    for nd in nodes:
        if nd.shape is node.shape:
            continue
        if nd.y <= bottom + 0.05:
            continue
        # 가로로 겹치는 것만 방해가 된다
        if nd.x + nd.w <= node.x + 0.05 or nd.x >= node.x + node.w - 0.05:
            continue
        limit = min(limit, nd.y)
    return max(0.0, limit - bottom - MIN_GAP_BELOW)


def grow(slide, shape, extra_cm, nodes):
    """글상자와 그것을 감싸는 카드를 아래로 함께 늘린다.

    늘릴 자리가 없으면 False. 여백과 모서리는 그대로 유지된다 — 높이만 바꾼다.
    """
    node = next((nd for nd in nodes if nd.shape is shape), None)
    if node is None:
        return False
    box = _container_of(node, nodes)
    # 글상자 자신이 넓힐 수 있는 여유와, 카드가 넓힐 수 있는 여유 중 작은 쪽
    avail = room_below(node, nodes)
    if box is not None:
        avail = min(avail, room_below(box, nodes))
    if avail + 1e-6 < extra_cm:
        return False
    shape.height = T.cm(node.h + extra_cm)
    if box is not None:
        box.shape.height = T.cm(box.h + extra_cm)
        _equalize_row(box, extra_cm, nodes)
    return True


def _equalize_row(box, extra_cm, nodes):
    """같은 줄의 형제 카드도 같은 높이로 맞춘다.

    한 칸만 길어져 들쭉날쭉해 보이지 않게 한다 — 노트 "카드 컴포넌트의 여백은 항상 준수".
    자리가 없는 형제는 건드리지 않는다.
    """
    for nd in nodes:
        if nd.shape is box.shape:
            continue
        if abs(nd.y - box.y) > 0.05 or abs(nd.h - box.h) > 0.05:
            continue
        try:
            if nd.shape.has_text_frame and nd.shape.text_frame.text.strip():
                continue
        except Exception:
            continue
        if room_below(nd, nodes) + 1e-6 >= extra_cm:
            nd.shape.height = T.cm(nd.h + extra_cm)


# ── 설명 박스 — 내용에 맞춰 줄이고 하단 가이드라인에 맞춘다 ──────
#
# 노트 13·14는 "본문이 길어지면 박스도 아래로 같이 커집니다"라고만 하지만, 반대도 참이다.
# 본문이 한 줄인데 박스가 다섯 줄 높이면 빈 공간이 그대로 남는다. 늘리기만 하면 반쪽이다.
#
# 그리고 가이드 7: "콘텐츠는 가이드 라인을 준수해서 가이드라인 안쪽으로 배치해 주세요."
# 템플릿의 설명 박스는 전부 하단 가이드라인(15.35)을 0.17~0.21cm 넘겨 놓여 있다.
# 줄인 뒤 **바닥을 가이드라인에 맞춘다**.

FLOOR_SNAP = 1.6         # 바닥이 가이드라인에서 이 안쪽이면 '하단 블록'으로 보고 맞춘다


def measure_note_box(box, title, body, body_lines, paras=1):
    """줄 수에 맞는 박스 높이(cm)를 계산만 한다 — 아직 옮기지 않는다.

    나란한 박스를 **같은 높이**로 맞추려면 먼저 셋 다 재고 가장 큰 값을 골라야 한다.
    """
    off_body = body.y - box.y
    pad_bottom = (box.y + box.h) - (body.y + body.h)
    if off_body <= 0 or pad_bottom < 0:
        return None
    return off_body + text_height_cm(body.shape, body_lines, paras) + pad_bottom


def fit_note_box(box, title, body, body_lines, *, paras=1, floor=None, box_h=None):
    """설명 박스를 내용 높이에 맞추고, 하단 블록이면 바닥을 가이드라인에 맞춘다.

    box/title/body 는 geom.Node. 내부 여백(제목 위, 제목↔본문, 본문 아래)은
    템플릿이 쓰고 있는 값을 그대로 읽어 유지한다.
    `box_h`를 주면 그 높이로 맞춘다 (형제 박스와 높이를 같게 할 때).
    """
    floor = T.CONTENT_BOTTOM if floor is None else floor
    off_title = title.y - box.y
    off_body = body.y - box.y
    pad_bottom = (box.y + box.h) - (body.y + body.h)
    if off_body <= 0 or pad_bottom < 0:
        return None

    new_box_h = box_h if box_h else measure_note_box(box, title, body, body_lines, paras)
    if not new_box_h:
        return None
    new_body_h = new_box_h - off_body - pad_bottom
    if new_body_h <= 0:
        return None

    bottom = box.y + box.h
    if abs(bottom - floor) <= FLOOR_SNAP:
        new_box_y = floor - new_box_h          # 하단 블록 — 바닥을 가이드라인에 붙인다
    else:
        new_box_y = box.y                      # 그 밖 — 위를 고정하고 아래만 줄인다

    _move(box, new_box_y, new_box_h)
    _move(title, new_box_y + off_title, title.h)
    _move(body, new_box_y + off_body, new_body_h)
    return new_box_h


def _font_pt(shape, default=9.0):
    try:
        for para in shape.text_frame.paragraphs:
            for r in para.runs:
                if r.font.size:
                    return r.font.size.pt
    except Exception:
        pass
    return default


def _move(node, abs_y, abs_h):
    """절대 y·높이로 옮긴다. 그룹 안 도형이면 자기 좌표계로 되돌려 쓴다."""
    sy = node.sy or 1.0
    local_top = T.to_cm(node.shape.top)
    node.shape.top = T.cm(local_top + (abs_y - node.y) / sy)
    node.shape.height = T.cm(abs_h / sy)


# ── 하단 고정 상자 — 위쪽으로 커지고 줄어든다 ─────────────────────
#
# 템플릿 노트 (27~64 대부분): "하단 텍스트 박스는 하단고정입니다. (높이값이 변해도 위쪽으로 커짐)"
# 가이드 12·13: "본문이 두 줄이면 박스도 같이 커져야 합니다", 28·29: "마무리 문장이 한 줄일
# 경우 메세지형 02-2를 사용" — 두 줄 바를 한 줄 높이로 줄이는 것과 같다.

def room_above(node, nodes, ceiling=None):
    """node 위로 넓힐 수 있는 여유(cm). 위에서 가장 먼저 만나는 요소까지."""
    ceiling = ceiling if ceiling is not None else T.CONTENT_TOP
    limit = ceiling
    for nd in nodes:
        if nd.shape is node.shape:
            continue
        if nd.shape._element.getparent() is None:
            continue
        bottom = nd.y + nd.h
        if bottom >= node.y + 0.05:       # 같은 높이나 아래에 있는 것
            continue
        if nd.x + nd.w <= node.x + 0.05 or nd.x >= node.x + node.w - 0.05:
            continue                      # 가로로 겹치지 않으면 방해가 아니다
        limit = max(limit, bottom)
    return node.y - limit - MIN_GAP_ABOVE


MIN_GAP_ABOVE = 0.20       # 위로 커지는 하단 박스와 그 위 요소 사이에 남길 간격


def resize_bottom_fixed(node, delta_cm, nodes, *, containers=()):
    """바닥을 고정한 채 높이를 delta 만큼 바꾼다 (양수 = 위로 커짐, 음수 = 줄어듦).

    글상자와 그것을 감싸는 바(containers)를 함께 움직인다. 위에 자리가 없으면 False.
    """
    if abs(delta_cm) < 0.01:
        return True
    targets = [node] + [c for c in containers if c is not None and c.shape is not node.shape]
    if delta_cm > 0:
        for t in targets:
            if room_above(t, [n for n in nodes if all(n.shape is not x.shape for x in targets)]) + 1e-6 < delta_cm:
                return False
    for t in targets:
        _move(t, t.y - delta_cm, t.h + delta_cm)
    return True


# ── 행 늘려 깔기 — 행이 줄었을 때 남은 행이 자리를 나눠 갖는다 ───────
#
# 템플릿 노트 75·76: "박스의 개수는 내용에 따라 조정해주세요 (4개, 3개, 2개).
#                    개수에 따라 박스 크기를 조정해주세요 (다음 장표 참고)"
# 76번(3행)은 75번(4행)보다 카드가 높다. 2행이면 그만큼 더 높아져야 한다.

def stretch_rows(slide, row_ys, *, top, bottom, gap=0.25, x_min=None, x_max=None):
    """row_ys(각 행 카드의 위 y)를 기준으로 행 블록을 찾아 top~bottom 사이에 같은 높이로 다시 깐다.

    행 블록 = 그 행 카드(가장 큰 배경 도형)의 y 범위 안에 든 모든 도형.
    배경은 높이를 바꾸고, 안의 글상자·화살표·꼬리표는 배경 가운데를 기준으로 함께 옮긴다.
    """
    nodes = list(walk_abs(slide.shapes))
    n = len(row_ys)
    if n == 0:
        return
    new_h = (bottom - top - gap * (n - 1)) / n
    for i, ry in enumerate(row_ys):
        bgs = [nd for nd in nodes if abs(nd.y - ry) <= 0.12 and nd.w >= 5.0 and nd.h >= 1.0
               and not _has_text(nd.shape)]
        if x_min is not None:
            bgs = [b for b in bgs if b.x >= x_min - 0.05]
        if x_max is not None:
            bgs = [b for b in bgs if b.x <= x_max + 0.05]
        if not bgs:
            continue
        old_top = min(b.y for b in bgs)
        old_h = max(b.h for b in bgs)
        new_top = top + i * (new_h + gap)
        old_c = old_top + old_h / 2
        new_c = new_top + new_h / 2
        members = [nd for nd in nodes
                   if nd.y >= old_top - 0.1 and nd.y + nd.h <= old_top + old_h + 0.1]
        for nd in members:
            if nd in bgs or (nd.w >= 5.0 and nd.h >= 1.0 and not _has_text(nd.shape)
                             and abs(nd.y - old_top) <= 0.12):
                _move(nd, new_top, new_h)
            else:
                _move(nd, nd.y + (new_c - old_c), nd.h)


def _has_text(sh):
    try:
        return sh.has_text_frame and sh.text_frame.text.strip() != ""
    except Exception:
        return False
