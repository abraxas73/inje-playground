# -*- coding: utf-8 -*-
"""장표 빌더 (템플릿 v1.0 최신본 · 2026-09 · 106장).

원칙: **도형을 새로 그리지 않는다.** 원본 슬라이드를 복제하고 텍스트만 갈아끼운다.
좌표·색·그라데이션·모서리·그룹 배율을 건드리지 않으므로 브랜드 위반이 발생할 수 없다.

예외는 이것뿐:
  · 목차·간지  — 남는 항목·구분선을 삭제 (6~8개면 위쪽에 행을 복제해 추가한다 — 노트 23)
  · 표         — 프레임만 복제하고 표는 엔진이 새로 그린다 (열 폭·행 높이는 글자수 기준 — 노트 85~87)
  · 차트       — 차트 파트의 데이터(항목·값)만 갈아끼운다. 색·글꼴은 그대로
  · 키워드 칩  — 글자 폭에 맞춰 가로만 조정하고 왼쪽부터 다시 늘어놓는다 (노트 9)
  · 상자 높이  — 본문이 길면 카드가 아래로, 하단 마무리 박스는 **바닥을 고정한 채 위로** 커진다
                (노트 11·13·14·28~64 "본문이 길어지면 박스도 같이", "하단 텍스트 박스는 하단고정")
  · 글자 크기  — 상자를 늘릴 자리도 없을 때만 본문을 8pt까지 줄인다 (프롬프트 필수 준수 사항)

"모자라면 지운다"도 원칙이다. 키워드 칩·캡션·수치 행이 원고에 없으면 텍스트를
비우지 않고 **도형째 지운다**. 단 **마무리 문구·요약 문장은 예외 — 반드시 채운다.**

66종 장표를 각각 손으로 짜지 않는다. `tokens.LAYOUTS` 의 선언적 스펙을 읽어
한 벌의 엔진이 채운다 — 새 장표를 붙일 때도 스펙 한 덩어리면 된다.
"""

import copy
import re
import sys

from . import slots as S
from . import tokens as T
from .oxml import set_text
from .table import render_table
from . import media, reflow, transplant
from .capacity import CAPACITY

TEMPLATE_PATH = None   # deck.py가 채운다. 칩 폭 계산용 폰트를 찾는 데 쓴다
TEMPLATE_PRS = None    # deck.py가 채운다. 부가 설명 슬롯을 복제해 오는 데 쓴다


def _advise(msg):
    print(f"[권고] {msg}", file=sys.stderr)


# ── 편집 규칙 검사 (프롬프트 필수 준수 사항) ─────────────────────

_POLITE = re.compile(r"(니다|세요|십니다)\s*[.。!]?\s*$")
_TRAIL_PERIOD = re.compile(r"\s*[.。]+\s*$")
_NUMBERED = re.compile(r"^\s*\d{1,2}\s*[.)]\s*")


def _style_title(layout, lines):
    """타이틀은 두 줄이 이어져 한 문장이 되고 '~합니다.'로 끝난다 (프롬프트: 타이틀은 ~합니다. 문장형)."""
    if len(lines) == 2:
        first = str(lines[0]).rstrip()
        if first.endswith((".", "다", "것", "점", "명")):
            _advise(f"[{layout}] 타이틀 1행이 문장을 끊는다 ('{first[-6:]}'). "
                    f"1행은 2행으로 이어지는 수식구로 쓸 것")
    last = str(lines[-1]).rstrip()
    if not _POLITE.search(last):
        _advise(f"[{layout}] 타이틀이 '~합니다.'로 끝나지 않는다 ('…{last[-10:]}')")


def _no_period(layout, role, body):
    """**블릿형** 본문만 마침표를 뗀다.

    템플릿 노트(가이드 10·14~16, 본문 28~81): "블릿형 본문은 마침표를 사용하지 않습니다. (서술형은 사용)",
    "박스안의 본문의 마침표는 넣지 말아주세요". yaml에서 리스트로 준 것이 블릿형,
    문자열 하나로 준 것이 서술형이다. 마무리 문구·요약 문장도 문장이라 여기 해당하지 않는다.
    """
    if isinstance(body, str):
        return body                      # 서술형 — 마침표를 그대로 둔다
    out, hit = [], False
    for b in body:
        t = _TRAIL_PERIOD.sub("", str(b))
        hit |= t != str(b)
        out.append(t)
    if hit:
        _advise(f"[{layout}] '{role}': 불릿 끝 마침표를 지웠다 (박스 안 본문은 마침표 없음)")
    return out


def _style_bullets(layout, role, body, *, max_items=4):
    """불릿은 '~니다'로 맺지 않는다 — 명사형·'~하는 것'·'~할 것'으로 끝낸다 (프롬프트)."""
    if not isinstance(body, (list, tuple)):
        return
    for b in body:
        if _POLITE.search(str(b)):
            _advise(f"[{layout}] '{role}' 불릿이 '~니다'로 끝난다: '{str(b)[:28]}…'. "
                    f"'~하는 것' '~할 것' 명사형으로 맺을 것")
            break
    if len(body) > max_items:
        _advise(f"[{layout}] '{role}': 불릿 {len(body)}개. 템플릿 노트는 '박스의 본문은 3개까지'라 한다 — "
                f"문단을 합치거나 장을 나눌 것")


def _lines(v):
    return [v] if isinstance(v, str) else list(v)


def _num(i):
    return f"{i + 1:02d}"


# ── 슬롯 좌표 표기 풀기 ──────────────────────────────────────────

def _yxx(v):
    """y 또는 (y, x_min, x_max) → (y, x_min, x_max)"""
    if isinstance(v, (tuple, list)):
        y = v[0]
        xmin = v[1] if len(v) > 1 else None
        xmax = v[2] if len(v) > 2 else None
        return y, xmin, xmax
    return v, None, None


def declared_ys(spec):
    """스펙이 선언한 모든 밴드 y. 도형을 '가장 가까운 밴드'에 귀속시키는 데 쓴다."""
    ys = set()

    def add(v):
        if v is None:
            return
        ys.add(_yxx(v)[0] if isinstance(v, (tuple, list)) else v)

    add(spec.get("label"))
    add(spec.get("title"))
    for g in (spec.get("groups") or []) + (spec.get("rows_groups") or []):
        for v in g["slots"].values():
            add(v)
    for v in (spec.get("single") or {}).values():
        add(v)
    if "main_body" in spec:
        add(spec["main_body"])
    cfg = spec.get("box")
    if cfg:
        add(cfg["title"]), add(cfg["body"])
    for key in ("chips", "closing", "sub_boxes", "row_labels"):
        cfg = spec.get(key)
        if cfg:
            add(cfg.get("y"))
    for key in ("rows", "agenda", "wings", "mid_notes"):
        cfg = spec.get(key)
        if cfg:
            for v in cfg.get("ys", []):
                add(v)
            for v in cfg.get("body_ys", []):
                add(v)
    return sorted(ys)


def _add_lead(slide, text):
    """타이틀 한 줄 밑에 부가 설명 한 줄을 붙인다 (가이드 8).

    본문 장표에는 이 상자가 없으므로 가이드 8번에서 **복제**해 온다.
    """
    if TEMPLATE_PRS is None:
        raise RuntimeError("TEMPLATE_PRS가 없다 (deck.py가 채워야 한다)")
    src = TEMPLATE_PRS.slides[T.LEAD_SOURCE - 1]
    proto = None
    for nd in S.nodes(src):
        if abs(nd.y - T.LEAD_Y) <= 0.15 and nd.shape.has_text_frame:
            proto = nd.shape
            break
    if proto is None:
        raise LookupError("가이드 8번에서 부가 설명 상자를 찾지 못했다")
    el = copy.deepcopy(proto._element)
    slide.shapes._spTree.append(el)
    new = next(sh for sh in slide.shapes if sh._element is el)
    new.left, new.top = T.cm(T.LEAD_X), T.cm(T.LEAD_Y)
    new.width, new.height = T.cm(T.LEAD_W), T.cm(T.LEAD_H)
    set_text(new, [text])
    return new


# ── 텍스트 채우기 ────────────────────────────────────────────────

def _put(slide, spec_v, value, *, layout, role, accent=None, bullet=False,
         nodes=None, index=0, required=False, all_ys=None):
    """단일 슬롯을 채운다. value가 None이면 도형을 지운다(required면 예외)."""
    y, xmin, xmax = _yxx(spec_v)
    got_nodes = S.band_nodes(slide, y, x_min=xmin, x_max=xmax, all_ys=all_ys, _nodes=nodes)
    if not got_nodes:
        raise LookupError(f"[{layout}] '{role}' 슬롯(y={y})을 찾지 못했다")
    if index >= len(got_nodes):
        raise LookupError(f"[{layout}] '{role}' 슬롯이 {len(got_nodes)}개뿐인데 {index + 1}번째를 찾는다")
    nd = got_nodes[index]
    sh = nd.shape
    if value is None:
        if required:
            raise ValueError(f"[{layout}] '{role}'은 필수다")
        S.delete(sh)
        return None
    grew = _autofit_chip_title(nd, value if isinstance(value, str) else " ".join(map(str, value)))
    size = None
    if not grew:                      # 칩은 줄바꿈 대신 우측으로 늘어난다 — 줄 수로 막지 않는다
        size = _fit_or_grow(slide, layout, role, value, sh, nodes, shrink_ok=bullet or role in _SHRINKABLE)
    set_text(sh, _lines(value), bullet=bullet, accent=accent, size=size)
    return sh


# ── 칩 — 글자수에 맞춰 여백을 유지하며 우측으로만 늘어난다 (노트 9) ──

CHIP_TITLE_MAX_W = 5.0   # 이보다 넓으면 '바 타이틀'이다. 바 타이틀은 "연계되는 컨텐츠에 따라
                         # 좌우 크기가 결정"되므로 건드리지 않는다


def _is_pill(shape):
    """글자를 담은 채워진 둥근 사각형 = 칩."""
    from pptx.oxml.ns import qn
    spPr = shape._element.find(qn("p:spPr"))
    if spPr is None:
        return False
    g = spPr.find(qn("a:prstGeom"))
    if g is None or g.get("prst") not in ("roundRect", "pill", "stadium"):
        return False
    return spPr.find(qn("a:solidFill")) is not None


def _run_font(shape, default_pt=9.0):
    for para in shape.text_frame.paragraphs:
        for r in para.runs:
            return (r.font.size.pt if r.font.size else default_pt,
                    r.font.name or T.F_SEMIBOLD)
    return default_pt, T.F_SEMIBOLD


CHIP_SAFETY = 0.04       # 글자 폭의 4%
CHIP_SAFETY_MIN = 0.10   # cm


def _chip_slack(node):
    """그 칩이 지금 쓰고 있는 **글자 밖 여백 총량**(cm)과 글꼴."""
    from .textwidth import width_cm
    text = node.shape.text_frame.text.strip()
    if not text:
        return None
    pt, font = _run_font(node.shape)
    return max(0.0, node.w - width_cm(text, pt, font, TEMPLATE_PATH)), pt, font


def _chip_target_w(text, slack, pt, font):
    from .textwidth import width_cm
    w = width_cm(str(text), pt, font, TEMPLATE_PATH)
    return max(T.CHIP_MIN_W, w + slack + max(CHIP_SAFETY_MIN, w * CHIP_SAFETY))


def _no_wrap(shape):
    """칩은 절대 줄바꿈하지 않는다 — 높이는 고정이다 (노트 9 "위아래 고정").

    폭은 우리가 글자 폭으로 직접 정하므로 상자의 자동 맞춤(spAutoFit)은 뗀다 — 남겨 두면
    렌더러마다 폭을 다시 계산해 칩이 제멋대로 줄어든다.
    """
    from pptx.oxml.ns import qn
    try:
        shape.text_frame.word_wrap = False
        bodyPr = shape.text_frame._txBody.find(qn("a:bodyPr"))
        if bodyPr is not None:
            for fit in bodyPr.findall(qn("a:spAutoFit")) + bodyPr.findall(qn("a:normAutofit")):
                bodyPr.remove(fit)
    except Exception:
        pass


def _autofit_chip_title(node, text):
    """칩 타이틀의 가로 폭만 글자에 맞춘다. **왼쪽·위·높이는 그대로 둔다.**"""
    sh = node.shape
    if not _is_pill(sh) or node.w > CHIP_TITLE_MAX_W:
        return False
    got = _chip_slack(node)
    if not got:
        return False
    slack, pt, font = got
    sh.width = T.cm(_chip_target_w(text, slack, pt, font) / (node.sx or 1.0))
    _no_wrap(sh)
    return True


def _fill_chips(slide, layout, spec, items, nodes):
    """키워드 칩 — 글자 폭에 맞춰 가로만 바꾸고 왼쪽부터 다시 늘어놓는다.

    칩은 자기 항목(카드)의 x 범위로 귀속시킨다. 템플릿마다 항목별 칩 개수가
    달라서(30번은 2·3·2) 균등 분할로는 맞지 않는다.
    """
    cfg = spec.get("chips")
    if not cfg:
        return
    chips = S.band_nodes(slide, cfg["y"], all_ys=spec.get("_ys"), _nodes=nodes)
    if not chips:
        return
    anchors_by = spec.get("_anchors") or {}
    anchors = anchors_by.get(cfg.get("anchor")) or (next(iter(anchors_by.values()), None) if anchors_by else None)
    if not anchors:
        S.delete_many([c.shape for c in chips])
        return

    # 칩 → 항목 귀속: 칩의 왼쪽이 넘지 않은 **마지막 앵커**(카드 시작 x)의 항목이다.
    # 앵커 사이 중점으로 가르면 칩 3개짜리 카드(30·44번 가운데)의 셋째 칩이 옆 카드로 넘어간다.
    # 칩이 앵커보다 살짝 왼쪽에 있는 경우(61·62번 Pill)가 있어 0.5cm 여유를 둔다.
    anchors = sorted(anchors)
    buckets = [[] for _ in anchors]
    for ch in chips:
        idx = 0
        for i, ax in enumerate(anchors):
            if ch.x + 0.5 >= ax:
                idx = i
        buckets[idx].append(ch)

    for i, bucket in enumerate(buckets):
        bucket.sort(key=lambda n: n.x)
        words = []
        if i < len(items) and isinstance(items[i], dict):
            words = items[i].get("keywords") or items[i].get("chips") or []
            if isinstance(words, str):
                words = [words]
        words = [str(w) for w in words if str(w).strip()]
        if not words:
            S.delete_many([c.shape for c in bucket])
            continue
        if len(words) > len(bucket):
            raise S.Overflow(
                f"[{layout}] {i + 1}번째 항목 키워드가 {len(words)}개인데 "
                f"칩은 {len(bucket)}개까지다 — 개수를 줄일 것")
        meas = _chip_slack(bucket[0])
        slack, pt, font = meas if meas else (2 * T.CHIP_PAD, T.CHIP_FONT_PT, T.F_SEMIBOLD)
        widths = [_chip_target_w(w, slack, pt, font) for w in words]   # 절대 폭(cm)
        total = sum(widths) + T.CHIP_GAP * (len(words) - 1)
        row_w = cfg.get("row_w")
        if row_w and total > row_w + 0.02:
            raise S.Overflow(
                f"[{layout}] {i + 1}번째 항목 키워드 칩 폭 합계 {total:.2f}cm > "
                f"{row_w:.2f}cm — 키워드를 짧게 하거나 개수를 줄일 것")
        sx = bucket[0].sx or 1.0
        x_local = min(T.to_cm(c.shape.left) for c in bucket)
        for j, w in enumerate(words):
            sh = bucket[j].shape
            local_w = widths[j] / sx
            sh.left = T.cm(x_local)
            sh.width = T.cm(local_w)
            _no_wrap(sh)
            set_text(sh, [w])
            x_local += local_w + T.CHIP_GAP / sx
        S.delete_many([c.shape for c in bucket[len(words):]])


# ── 그룹(카드·항목·단계) 채우기 ─────────────────────────────────

_ALIAS = {
    "title": ("title", "name", "head"),
    "body": ("body", "bullets", "text", "lines", "detail", "desc"),
    "detail": ("detail", "desc", "sub", "body", "text"),
    "num": ("num", "no", "label", "date"),
    "pill": ("pill", "tag", "label"),
    "summary": ("summary", "result", "conclusion"),
    "header": ("header", "title", "name"),
    "sub": ("sub", "subtitle", "sub_title"),
    "closing": ("closing", "conclusion"),
    "text": ("text", "body", "line"),
    "label": ("label", "header", "head", "heading"),
    "desc": ("desc", "label", "title", "name"),      # KPI 설명 (수치 위 한 줄)
    "value": ("value", "kpi", "number"),              # KPI 수치
    "tag": ("tag", "chip", "keyword"),
}

# 본문 성격의 역할 — 불릿 규칙·마침표 제거·박스 늘리기·8pt 축소가 적용된다
_BODY_ROLES = ("body", "text", "bullets", "panel_body", "panel_body2", "main_body", "note_body")
_SHRINKABLE = set(_BODY_ROLES) | {"detail"}


def _get(item, role, i, single_role=False):
    """항목에서 역할에 해당하는 값을 꺼낸다."""
    if not isinstance(item, dict):
        if item is None:
            return None
        return item if single_role else None
    for k in _ALIAS.get(role, (role,)):
        if item.get(k) is not None:
            return item[k]
    if role in ("num", "pill"):
        return _num(i)          # 생략하면 01·02…
    return None


def _draw_order(shape):
    """슬라이드 전체 기준의 그리기 순서를 (조상 인덱스…) 튜플로 돌려준다."""
    from pptx.oxml.ns import qn
    path, el = [], shape._element
    while True:
        parent = el.getparent()
        if parent is None:
            break
        path.append(list(parent).index(el))
        if parent.tag == qn("p:spTree"):
            break
        el = parent
    return tuple(reversed(path))


def _topmost(shapes):
    """같은 자리에 겹친 도형 중 **맨 위에 그려지는 것**을 고른다."""
    return max(shapes, key=_draw_order)


def _pt_of(shape, default=9.0):
    return S.font_pt(shape, default)


def _node_of(shape, nodes):
    return next((nd for nd in nodes if nd.shape is shape), None)


def _fit_or_grow(slide, layout, role, value, shape, nodes, *, shrink_ok=True):
    """상자에 안 들어가면 ① 상자를 아래로 키우고 ② 그래도 안 되면 본문을 8pt까지 줄인다.

    ① 노트 11·14~16·28~50: "본문이 길어지면 박스도 아래로 같이 커집니다 (여백·라운드 유지)",
       "형제 박스는 가장 큰 박스 기준으로 맞춤"
    ② 프롬프트 필수 준수 사항: "본문의 내용이 너무 많을 경우 폰트 크기를 8pt까지 줄여도 됨"
    둘 다 안 되면 오버플로로 막는다. 돌려주는 값은 적용할 글자 크기(없으면 None).
    """
    cap = CAPACITY.get((layout, role))
    if cap is None:
        return None
    cpl, max_lines = cap
    need = S.lines_needed(value, cpl)
    if need <= max_lines:
        return None
    pitch, _ = reflow.para_metrics(shape, _pt_of(shape))     # 그 상자의 실제 줄 높이
    extra = (need - max_lines) * pitch
    if reflow.grow(slide, shape, extra, nodes):
        _advise(f"[{layout}] '{role}'이 {need}줄이라 상자를 {extra:.2f}cm 늘렸다 "
                f"(템플릿 노트: 본문이 길어지면 박스도 같이 커진다)")
        return None
    # 늘릴 자리가 없다 — 글자를 줄여 본다 (8pt 밑으로는 절대 안 된다)
    nd = _node_of(shape, nodes)
    base_pt = _pt_of(shape)
    if shrink_ok and nd is not None and base_pt > T.BODY_PT_MIN:
        pt = T.BODY_PT_MIN
        cpl2, lines2 = S.capacity_of(nd, pt)
        need2 = S.lines_needed(value, cpl2)
        if need2 <= lines2:
            _advise(f"[{layout}] '{role}'이 {need}줄로 넘치고 상자를 늘릴 자리도 없어 "
                    f"본문을 {pt:g}pt로 줄였다 (프롬프트: 내용이 많으면 8pt까지 허용)")
            return pt
        # 8pt로 줄인 뒤 다시 상자를 키워 본다
        pitch2, _ = reflow.para_metrics(shape, pt)
        extra2 = (need2 - lines2) * pitch2
        if reflow.grow(slide, shape, extra2, nodes):
            _advise(f"[{layout}] '{role}': 본문을 {pt:g}pt로 줄이고 상자를 {extra2:.2f}cm 늘렸다")
            return pt
    try:
        S.check_fit(layout, role, value, CAPACITY)     # 늘릴 자리도 없다 → 막는다
    except S.Overflow as e:
        raise S.Overflow(f"{e}\n  (상자를 아래로 늘리기와 8pt 축소까지 시도했지만 자리가 없다)") from None
    return None


def _fill_group(slide, layout, group, items, nodes, *, accent=None, anchors_out=None,
                all_ys=None, x_gap=None, index_base=0, numbered=False, max_items=4):
    n = group["n"]
    single_role = len(group["slots"]) == 1
    for role, yv in group["slots"].items():
        y, xmin, xmax = _yxx(yv)
        got_nodes = S.band_nodes(slide, y, x_min=xmin, x_max=xmax, x_gap=x_gap,
                                 all_ys=all_ys, _nodes=nodes)
        if len(got_nodes) < n:
            raise LookupError(
                f"[{layout}] '{role}' 슬롯이 {n}개여야 하는데 {len(got_nodes)}개다 (y={y})")
        got_nodes = got_nodes[:n]
        if anchors_out is not None and not anchors_out:
            anchors_out.extend(nd.x for nd in got_nodes)     # 절대 x
        got = [nd.shape for nd in got_nodes]
        for i, sh in enumerate(got):
            item = items[i] if i < len(items) else {}
            val = _get(item, role, index_base + i, single_role)
            if val is None:
                S.delete(sh)
                continue
            if numbered and role == "title" and isinstance(val, str) and not _NUMBERED.match(val):
                val = f"{_num(index_base + i)}. {val}"        # '01. 제목' 형 카드 (58~60·64·66)
            grew = _autofit_chip_title(got_nodes[i],
                                       val if isinstance(val, str) else " ".join(map(str, val)))
            is_body = role in _BODY_ROLES
            size = None
            if is_body:
                _style_bullets(layout, role, val, max_items=max_items)
                val = _no_period(layout, role, val)
                size = _fit_or_grow(slide, layout, role, val, sh, nodes)
            elif not grew:            # 칩은 우측으로 늘어난다 — 줄 수로 막지 않는다
                size = _fit_or_grow(slide, layout, role, val, sh, nodes,
                                    shrink_ok=role in _SHRINKABLE)
            set_text(sh, _lines(val), bullet=is_body and isinstance(val, (list, tuple)),
                     accent=accent if role in ("summary", "closing", "text") else None,
                     size=size)


# ── 가운데 화살표 설명 (75·76) ──────────────────────────────────

def _fill_mid_notes(slide, layout, spec, data, nodes):
    """열 사이 화살표에 붙는 설명. 원고에 없으면 **자리표시 문구를 지운다**."""
    cfg = spec.get("mid_notes")
    if not cfg:
        return
    values = data.get("arrows") or data.get("mid_notes") or []
    for i, y in enumerate(cfg["ys"]):
        got = S.band(slide, y, x_min=cfg.get("x_min"), x_max=cfg.get("x_max"),
                     all_ys=spec.get("_ys"), _nodes=nodes)
        if not got:
            continue
        if i < len(values) and values[i]:
            set_text(got[0], _lines(values[i]))
            S.delete_many(got[1:])
        else:
            S.delete_many(got)


# ── 설명 박스 맞추기 (내용에 맞춰 줄이고 하단선에 붙인다) ────────

def _lines_needed(layout, role, text):
    cap = CAPACITY.get((layout, role))
    items = text if isinstance(text, (list, tuple)) else [text]
    if not cap:
        return len(items)
    return S.lines_needed(items, cap[0])


def _fit_note_boxes(slide, layout, spec, nodes):
    """설명 박스를 지금 들어 있는 글에 맞춰 줄이고, 하단 블록이면 가이드라인에 맞춘다."""
    ys = spec.get("_ys")

    def band(yv):
        y, xmin, xmax = _yxx(yv)
        return S.band_nodes(slide, y, x_min=xmin, x_max=xmax, all_ys=ys, _nodes=nodes)

    pairs = []
    if spec.get("box"):
        pairs.append((spec["box"]["title"], spec["box"]["body"], "note_body"))
    for g in (spec.get("groups") or []):
        if g["key"] == "notes" and "title" in g["slots"] and "body" in g["slots"]:
            pairs.append((g["slots"]["title"], g["slots"]["body"], "body"))

    for tyv, byv, role in pairs:
        titles, bodies = band(tyv), band(byv)
        if not titles or not bodies:
            continue
        fresh = S.nodes(slide)
        by_el = _index(fresh)
        triples, need = [], 1
        for tn, bn in zip(titles, bodies):
            tn = by_el.get(id(tn.shape._element), tn)
            bn = by_el.get(id(bn.shape._element), bn)
            box = reflow._container_of(bn, fresh)
            if box is None or not bn.shape.text_frame.text.strip():
                continue
            paras = [q.text for q in bn.shape.text_frame.paragraphs if q.text.strip()]
            need = max(need, _lines_needed(layout, role, paras))
            triples.append((box, tn, bn, len(paras)))
        if not triples:
            continue
        # 나란한 설명 박스는 **같은 높이** (노트: "형제 박스는 가장 큰 박스 기준으로 맞춤")
        before = [(t[0].y, t[0].y + t[0].h) for t in triples]
        want = [reflow.measure_note_box(box, tn, bn, need, np) for box, tn, bn, np in triples]
        box_h = max([h for h in want if h], default=None)
        for box, tn, bn, np in triples:
            reflow.fit_note_box(box, tn, bn, need, paras=np, box_h=box_h)
        _shift_between(slide, triples, before, fresh)


def _index(nodes):
    return {id(nd.shape._element): nd for nd in nodes}


def _shift_between(slide, triples, before, nodes):
    """박스 사이에 놓인 장식(화살표 등)을 박스가 움직인 만큼 함께 옮긴다."""
    if not before:
        return
    old_top = min(b[0] for b in before)
    old_bottom = max(b[1] for b in before)
    after = _index(S.nodes(slide))
    new_boxes = [after.get(id(t[0].shape._element), t[0]) for t in triples]
    delta = ((min(n.y for n in new_boxes) + max(n.y + n.h for n in new_boxes)) / 2
             - (old_top + old_bottom) / 2)
    if abs(delta) < 0.02:
        return
    kept = {id(t[i].shape._element) for t in triples for i in (0, 1, 2)}
    spans = [(t[0].x, t[0].x + t[0].w) for t in triples]
    for nd in nodes:
        if id(nd.shape._element) in kept:
            continue
        if nd.y < old_top - 0.1 or nd.y + nd.h > old_bottom + 0.1:
            continue
        if any(x0 - 0.05 <= nd.x and nd.x + nd.w <= x1 + 0.05 for x0, x1 in spans):
            continue
        cur = after.get(id(nd.shape._element))
        if cur is None:
            continue
        reflow._move(cur, cur.y + delta, cur.h)


# ── 원고 도식 이식 (자유 배치 장표) ──────────────────────────────

def _transplant(slide, layout, data):
    """`source`를 주면 원고 PPT의 도식을 그대로 가져와 가이드라인 안에 넣는다."""
    src = data.get("source")
    # 자유 배치 장표의 자리표시 표(직접 채우라고 깔아 둔 격자)는 지운다
    for sh in list(slide.shapes):
        if sh.has_table:
            sh._element.getparent().remove(sh._element)
    if not src:
        return
    if not isinstance(src, dict) or "file" not in src or "slide" not in src:
        raise ValueError(f"[{layout}] source는 {{file: 원고.pptx, slide: 1}} 형태여야 한다")
    area = src.get("area")
    if area and len(area) != 4:
        raise ValueError(f"[{layout}] source.area는 [x, y, 폭, 높이] 4개다")
    transplant.transplant(
        slide, src["file"], int(src["slide"]),
        y_from=float(src.get("from", 3.3)),
        y_to=(float(src["to"]) if src.get("to") is not None else None),
        area=tuple(area) if area else None,
        align=src.get("align", "top"),
        recolor=src.get("recolor", True))


# ── 마무리 문구 (메세지형 컴포넌트) ──────────────────────────────

_DARK_SCHEME = ("tx1", "dk1", "dk2")


def _luma(hexcolor):
    r, g, b = (int(hexcolor[i:i + 2], 16) for i in (0, 2, 4))
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255


def _on_dark_bar(y, nodes):
    """마무리 문구 자리에 어두운 바(그라데이션·검정·Primary)가 깔려 있는가."""
    from pptx.oxml.ns import qn
    for nd in nodes:
        if nd.w < 18 or not (y - 1.4 <= nd.y <= y + 0.4):
            continue
        spPr = nd.shape._element.find(qn("p:spPr"))
        if spPr is None:
            continue
        if spPr.find(qn("a:gradFill")) is not None:
            return True
        solid = spPr.find(qn("a:solidFill"))
        if solid is None:
            continue
        srgb = solid.find(qn("a:srgbClr"))
        if srgb is not None and _luma(srgb.get("val")) < 0.55:
            return True
        scheme = solid.find(qn("a:schemeClr"))
        if scheme is not None and scheme.get("val") in _DARK_SCHEME:
            return True
    return False


# 메세지형 컴포넌트의 **설계 줄 수** — 템플릿 상자가 몇 줄 기준으로 그려졌는가 (가이드 12·13 실측)
_CLOSING_DESIGN_LINES = {"bar16": 2, "bar13": 2, "key": 1, "msg": 1, "split": 1, "bar": 2}


def _fill_closing(slide, layout, spec, data, nodes):
    cfg = spec.get("closing")
    if not cfg:
        return
    value = data.get("closing")
    if value is None:
        if spec.get("closing_required"):
            raise ValueError(
                f"[{layout}] 하단 마무리 문구(closing)가 필수다.\n"
                f"  → 원고에 없으면 장표 내용을 분석해 한두 줄로 만들어 넣을 것")
        S.delete_at(slide, cfg["y"], all_ys=spec.get("_ys"), _nodes=nodes)
        return
    style = cfg.get("style", "bar")
    dark = style in ("bar", "bar16", "bar13", "key", "split") or _on_dark_bar(cfg["y"], nodes)
    accent = None if dark else T.ACCENT
    got_nodes = S.band_nodes(slide, cfg["y"], all_ys=spec.get("_ys"), _nodes=nodes)
    if not got_nodes:
        raise LookupError(f"[{layout}] closing 슬롯(y={cfg['y']})을 찾지 못했다")
    node = got_nodes[0]
    S.delete_many([n.shape for n in got_nodes[1:]])

    # 줄 수 — 메세지형은 두 줄까지 (가이드 12·13). 프롬프트: "메세지형 컴포넌트 문장은 긴 서술형 지양"
    lines = _lines(value)
    cap = CAPACITY.get((layout, "closing"))
    need = S.lines_needed(lines, cap[0]) if cap else len(lines)
    max_lines = cfg.get("max_lines", T.CLOSING_MAX_LINES)
    if need > max_lines:
        raise S.Overflow(
            f"[{layout}] 마무리 문구가 {need}줄이다 — 메세지형 컴포넌트는 {max_lines}줄까지다 "
            f"(가이드 12·13). 문장을 줄일 것:\n  → {str(lines[0])[:40]}…")
    set_text(node.shape, lines, accent=accent)

    # 하단 고정 — 줄 수가 설계와 다르면 바닥을 고정한 채 높이를 맞춘다
    #   노트: "하단 텍스트 박스는 하단고정 (높이값이 변해도 위쪽으로 커짐)",
    #        "본문이 두 줄이면 박스도 같이 커져야 합니다",
    #        "마무리 문장이 한 줄일 경우 메세지형 02-2를 사용" (= 두 줄 바를 한 줄 높이로)
    design = _CLOSING_DESIGN_LINES.get(style, 1)
    if need != design:
        pitch, _ = reflow.para_metrics(node.shape, _pt_of(node.shape, 16.0))
        fresh = S.nodes(slide)
        me = _index(fresh).get(id(node.shape._element), node)
        box = reflow._container_of(me, fresh)
        outer = box if box is not None else me
        target = (cfg.get("heights") or {}).get(need)
        delta = (target - outer.h) if target else (need - design) * pitch
        ok = reflow.resize_bottom_fixed(me, delta, fresh, containers=(box,))
        if ok:
            what = "늘렸다" if delta > 0 else "줄였다"
            _advise(f"[{layout}] 마무리 문구가 {need}줄이라 하단 박스를 바닥 고정으로 {abs(delta):.2f}cm {what} "
                    f"(템플릿 노트: 하단 텍스트 박스는 하단고정, 위쪽으로 커짐)")
        elif delta > 0:
            raise S.Overflow(
                f"[{layout}] 마무리 문구가 {need}줄인데 박스를 위로 키울 자리가 없다 — 한 줄로 줄일 것")


def _fill_box(slide, layout, spec, data, nodes):
    """아래 설명 박스 (타이틀 + 본문). 여러 개면 notes 그룹이 처리한다."""
    cfg = spec.get("box")
    if not cfg:
        return
    box = data.get("note") or data.get("box")
    ys = spec.get("_ys")

    def slot(role):
        y, xmin, xmax = _yxx(cfg[role])
        return S.band_nodes(slide, y, x_min=xmin, x_max=xmax, all_ys=ys, _nodes=nodes)

    if box is None:
        for role in ("title", "body"):
            S.delete_many([n.shape for n in slot(role)])
        return
    if isinstance(box, str):
        box = {"body": box}
    for role, key in (("title", "title"), ("body", "body")):
        got = slot(role)
        if not got:
            raise LookupError(f"[{layout}] 설명 박스 '{role}' 슬롯을 찾지 못했다")
        val = box.get(key)
        if val is None:
            S.delete_many([n.shape for n in got])
            continue
        if role == "body":
            val = _no_period(layout, "note_body", val)
        top = _topmost([n.shape for n in got])
        node = next(n for n in got if n.shape is top)
        size = None
        if role == "title":
            # 설명 박스 타이틀은 칩 타이틀이다 — 글자수에 맞춰 우측으로만 늘린다 (노트 9)
            if not _autofit_chip_title(node, val if isinstance(val, str) else " ".join(map(str, val))):
                S.check_fit(layout, "note_title", val, CAPACITY)
        else:
            size = _fit_or_grow(slide, layout, "note_body", val, top, nodes)
        set_text(top, _lines(val), bullet=(role == "body" and isinstance(val, (list, tuple))),
                 accent=T.ACCENT if role == "body" else None, size=size)
        S.delete_many([n.shape for n in got if n.shape is not top])


# ── 좌우 요약 날개 (72~74 · 83) ─────────────────────────────────

def _fill_wings(slide, layout, spec, data, nodes):
    """좌우 날개. 최신본은 날개가 '제목 + 설명' 카드인 장표(73·74·83)와 한 줄 요약(72)이 섞여 있다.

    항목은 문자열(제목만) 또는 {title, body} 로 준다. body_ys 가 있는 장표에서 문자열만 주면
    설명 상자를 지운다.
    """
    cfg = spec.get("wings")
    if not cfg:
        return
    body_ys = cfg.get("body_ys")
    for side, key in (("left_x", "left"), ("right_x", "right")):
        if side not in cfg:
            continue
        xmin, xmax = cfg[side]
        values = data.get(key) or data.get("summaries" if side == "right_x" else "left") or []
        for i, y in enumerate(cfg["ys"]):
            got = S.band(slide, y, x_min=xmin, x_max=xmax, all_ys=spec.get("_ys"), _nodes=nodes)
            bodies = (S.band(slide, body_ys[i], x_min=xmin, x_max=xmax, all_ys=spec.get("_ys"),
                             _nodes=nodes) if body_ys and i < len(body_ys) else [])
            val = values[i] if i < len(values) else None
            if val is None:
                S.delete_many(got + bodies)
                continue
            if isinstance(val, dict):
                title, body = val.get("title"), val.get("body")
            else:
                title, body = val, None
            if got:
                if title is None:
                    S.delete_many(got)
                else:
                    S.check_fit(layout, "wing", title, CAPACITY)
                    set_text(got[0], _lines(title), accent=T.ACCENT)
                    S.delete_many(got[1:])
            if bodies:
                if body is None:
                    S.delete_many(bodies)
                else:
                    body = _no_period(layout, "wing_body", body)
                    S.check_fit(layout, "wing_body", body, CAPACITY)
                    set_text(bodies[0], _lines(body), bullet=isinstance(body, (list, tuple)))
                    S.delete_many(bodies[1:])


# ── 왼쪽 수치 패널 (79·80) ──────────────────────────────────────

def _fill_rows(slide, layout, spec, data, nodes):
    cfg = spec.get("rows")
    if not cfg:
        return
    rows = data.get("rows") or []
    for i, y in enumerate(cfg["ys"]):
        got = S.band(slide, y, x_max=cfg.get("x_max"), all_ys=spec.get("_ys"), _nodes=nodes)
        if not got:
            continue
        if i >= len(rows):
            S.delete_many(got)
            continue
        pair = rows[i]
        pair = list(pair) if isinstance(pair, (list, tuple)) else [pair]
        for j, sh in enumerate(got):
            if j < len(pair):
                S.check_fit(layout, "row_value", pair[j], CAPACITY)
                set_text(sh, [str(pair[j])])
            else:
                S.delete(sh)


# ── 아젠다 (27) ─────────────────────────────────────────────────

def _fill_agenda(slide, layout, spec, data, nodes):
    cfg = spec.get("agenda")
    if not cfg:
        return
    rows = data.get("rows") or []
    cols, ys = cfg["cols"], cfg["ys"]
    cap = len(ys) * cols
    if len(rows) > cap:
        raise ValueError(f"[{layout}] 아젠다 행이 {len(rows)}개다 — 최대 {cap}행 (템플릿 노트 27: 최대 5개)")
    order = [(r, c) for c in range(cols) for r in range(len(ys))]
    seen = {}
    for r, c in order:
        got = S.band(slide, ys[r], all_ys=spec.get("_ys"), _nodes=nodes)
        per = max(1, len(got) // cols) if cols > 1 else len(got)
        chunk = got[c * per:(c + 1) * per] if cols > 1 else got
        seen[(r, c)] = chunk
    for idx, (r, c) in enumerate(order):
        chunk = seen[(r, c)]
        if not chunk:
            continue
        if idx >= len(rows):
            S.delete_many(chunk)
            # 행 아래 구분선도 함께 지운다 (글자 없는 선)
            for ln in S.band(slide, ys[r] + 0.96, text=False, _nodes=nodes):
                if ln.has_text_frame and ln.text_frame.text.strip():
                    continue
                if ln.width > T.cm(20):
                    S.delete(ln)
            continue
        row = rows[idx]
        label = row.get("label") if isinstance(row, dict) else None
        text = row.get("text") if isinstance(row, dict) else str(row)
        if len(chunk) >= 2:
            S.check_fit(layout, "label", label or "", CAPACITY)
            set_text(chunk[0], [f"{idx + 1:02d}. {label}" if label else f"{idx + 1:02d}."])
            S.check_fit(layout, "text", text, CAPACITY)
            set_text(chunk[1], [text])
            S.delete_many(chunk[2:])
        else:
            set_text(chunk[0], [text])


# ── 표 ───────────────────────────────────────────────────────────

def _fill_table(slide, layout, spec, data, nodes):
    cfg = spec.get("table")
    if not cfg:
        return
    tables = data.get("tables")
    if not tables:
        raise ValueError(f"[{layout}] 표 데이터(tables)가 필요하다")
    for sh in list(slide.shapes):
        if sh.has_table:
            S.delete(sh)
    if len(tables) != 1:
        raise ValueError(f"[{layout}] 한 장에 표는 1개다 ({len(tables)}개가 왔다)")
    t = tables[0]
    avail = cfg["max_bottom"] - cfg["y"]
    # 열 폭은 글자수, 행 높이는 줄 수로 정한다 (노트 85~87). 넘치면 7.5pt까지만 줄여 본다
    for size in (t.get("font_size", T.TABLE_FONT), T.TABLE_FONT_TIGHT):
        gf, widths, total_h = render_table(
            slide, t["header"], t["rows"],
            x=cfg["x"], y=cfg["y"], w=cfg["w"], max_h=avail,
            divider_cols=t.get("divider_cols", 1),
            divider_w=t.get("divider_w", T.TABLE_DIVIDER_W),
            col_widths=t.get("col_widths"),
            font_size=size,
            bullets=t.get("bullets", False),
            template_path=TEMPLATE_PATH,
        )
        if total_h <= avail + 0.02:
            if size != t.get("font_size", T.TABLE_FONT):
                _advise(f"[{layout}] 표가 높아 글자를 {size:g}pt로 줄였다")
            return
        S.delete(gf)
    raise S.Overflow(
        f"[{layout}] 표가 {total_h:.1f}cm 로 자리({avail:.1f}cm)를 넘친다 — "
        f"행을 나누어 두 장으로 하거나 셀 글을 줄일 것")


# ── 차트 ─────────────────────────────────────────────────────────

def _fill_chart(slide, layout, spec, data, nodes):
    cfg = spec.get("chart")
    if not cfg:
        return
    chart = data.get("chart")
    if not chart:
        raise ValueError(f"[{layout}] 차트 데이터(chart)가 필요하다")
    cats = list(chart["categories"])
    vals = list(chart["values"])
    if len(cats) != len(vals):
        raise ValueError(f"[{layout}] 차트 항목 수({len(cats)})와 값 개수({len(vals)})가 다르다")
    if len(cats) > cfg["max"]:
        raise ValueError(f"[{layout}] 차트 항목이 {len(cats)}개다 — 최대 {cfg['max']}개 "
                         f"(템플릿 노트 82~84: 최대 5개 항목으로 정리)")
    from pptx.chart.data import CategoryChartData
    target = None
    for sh in slide.shapes:
        if getattr(sh, "has_chart", False):
            target = sh.chart
            break
    if target is None:
        raise LookupError(f"[{layout}] 차트를 찾지 못했다")
    cd = CategoryChartData()
    cd.categories = cats
    cd.add_series(chart.get("series", "s"), vals)
    target.replace_data(cd)


# ── 항목 수·본문 수 권고 (장표별 노트) ───────────────────────────

def _advise_counts(layout, spec, data):
    items = data.get("cards") or data.get("items") or data.get("panels") or []
    lens = [len(it.get("body")) for it in items
            if isinstance(it, dict) and isinstance(it.get("body"), (list, tuple))]
    if spec.get("min_body_items") and lens and max(lens) < spec["min_body_items"]:
        _advise(f"[{layout}] 본문 항목이 최대 {max(lens)}개다 — 이 장표는 항목이 "
                f"{spec['min_body_items']}개 이상일 때만 쓴다 (템플릿 노트 30). card-3 를 쓸 것")
    rng = spec.get("body_items_range")
    if rng and lens and not all(rng[0] <= n <= rng[1] for n in lens):
        _advise(f"[{layout}] 본문 항목 개수는 {rng[0]}~{rng[1]}개를 권한다 (템플릿 노트 70)")


def _drop_bands(slide, spec):
    """스펙이 지정한 y 구간의 도형을 글자 유무와 무관하게 지운다 (flow-4 의 셋째 줄 등)."""
    for y0, y1 in spec.get("drop_bands") or []:
        for nd in S.nodes(slide):
            if y0 - 0.02 <= nd.y <= y1 + 0.02 and nd.y + nd.h <= y1 + 0.3:
                if nd.shape._element.getparent() is not None:
                    S.delete(nd.shape)


# ══════════════════════════════════════════════════════════════════
#  본문 장표 빌더 — 스펙 한 벌로 66종을 모두 처리한다
# ══════════════════════════════════════════════════════════════════

def build_body(slide, name, data):
    """LAYOUTS[name] 스펙대로 복제된 슬라이드를 채운다."""
    spec = T.LAYOUTS[name]
    if spec.get("regrid"):
        reflow.regrid_cards(slide, spec["regrid"])
    _drop_bands(slide, spec)
    nodes = S.nodes(slide)
    ys = declared_ys(spec)
    gap = spec.get("x_gap")
    max_items = spec.get("max_body_items", 4)

    # 1. 섹션 라벨 · 페이지 타이틀
    if spec.get("label") is not None:
        label = data.get("section_label") or data.get("label")
        if label:
            _put(slide, spec["label"], label, layout=name, role="section_label", nodes=nodes,
                 all_ys=ys)
        else:
            S.delete_at(slide, spec["label"], all_ys=ys, _nodes=nodes)

    if spec.get("title") is not None:
        title = data.get("title")
        if title is not None:
            lines = _lines(title)
            if len(lines) > 2:
                raise ValueError(f"[{name}] 페이지 타이틀은 최대 2줄")
            _style_title(name, lines)
            _put(slide, spec["title"], lines, layout=name, role="page_title", nodes=nodes,
                 all_ys=ys)
        else:
            S.delete_at(slide, spec["title"], all_ys=ys, _nodes=nodes)

    # 부가 설명 — 타이틀이 한 줄일 때만 (가이드 8)
    lead = data.get("lead")
    if lead:
        lines = _lines(data.get("title") or [])
        if len(lines) > 1:
            _advise(f"[{name}] 부가 설명은 타이틀이 한 줄일 때 쓴다 (가이드 8) — "
                    f"타이틀이 {len(lines)}줄이라 겹칠 수 있다")
        _add_lead(slide, lead)

    if spec.get("free"):
        _transplant(slide, name, data)
        return          # 자유 배치 장표 — 나머지는 건드리지 않는다

    _advise_counts(name, spec, data)

    # 2. 필수 단일 슬롯 검사
    for role in spec.get("required", []):
        if data.get(role) is None and role not in ("summary", "closing", "flow"):
            raise ValueError(f"[{name}] '{role}'은 필수다")

    # 3. 반복 그룹
    merge = spec.get("merge_groups") or ()
    groups = spec.get("groups") or []
    anchors = {}
    numbered_all = bool(spec.get("numbered_title"))
    numbered_groups = set(spec.get("numbered_title_groups") or ())
    off = 0
    for g in groups:
        key = g["key"]
        numbered = numbered_all or key in numbered_groups
        out = []
        if key in merge:
            # steps-8 처럼 두 줄로 나뉜 그룹을 하나의 논리 목록으로 본다
            head = merge[0]
            items = data.get(head) or data.get("items") or data.get("cards") or data.get("steps") or []
            _fill_group(slide, name, g, items[off:off + g["n"]], nodes,
                        anchors_out=out, all_ys=ys, x_gap=gap, index_base=off,
                        numbered=numbered, max_items=max_items)
            if off == 0:
                anchors[head] = out
            off += g["n"]
        else:
            items = data.get(key)
            if items is None and key in ("cards", "items", "steps", "panels"):
                items = data.get("cards") or data.get("items") or data.get("steps") or []
            if items is None and key == "kpis":
                items = data.get("kpi") or []
            if items is None and key == "lower":
                items = data.get("lower_cards") or []
            items = items or []
            _fill_group(slide, name, g, items, nodes, accent=T.ACCENT,
                        anchors_out=out, all_ys=ys, x_gap=gap,
                        numbered=numbered, max_items=max_items)
            anchors[key] = out

    # 행 단위로 쪼개진 그룹 (compare-rows·columns-3x3·split-3·wing-rows)
    for gi, g in enumerate(spec.get("rows_groups") or []):
        rows = data.get("rows") or []
        if gi < len(rows):
            row = rows[gi]
            payload = row if isinstance(row, list) else [row]
        else:
            payload = []
        _fill_group(slide, name, g, payload, nodes, all_ys=ys, x_gap=gap, max_items=max_items)

    spec = dict(spec)
    spec["_anchors"] = anchors
    spec["_ys"] = ys

    # 4. 나머지 컴포넌트
    chip_items = data.get((spec.get("chips") or {}).get("anchor") or "cards") \
        or data.get("items") or data.get("cards") or data.get("panels") or []
    _fill_chips(slide, name, spec, chip_items, nodes)
    _fill_rows(slide, name, spec, data, nodes)
    _fill_agenda(slide, name, spec, data, nodes)
    _fill_wings(slide, name, spec, data, nodes)
    _fill_table(slide, name, spec, data, nodes)
    _fill_chart(slide, name, spec, data, nodes)

    # 5. 단일 슬롯
    for role, yv in (spec.get("single") or {}).items():
        val = data.get(role)
        is_body = role in _BODY_ROLES
        if val is not None and is_body:
            val = _no_period(name, role, val)
        _put(slide, yv, val, layout=name, role=role,
             accent=T.ACCENT, nodes=nodes, all_ys=ys, bullet=is_body and isinstance(val, (list, tuple)),
             required=role in spec.get("required", []))

    if "main_body" in spec:
        val = data.get("main_body")
        if val is not None:
            val = _no_period(name, "main_body", val)
        _put(slide, spec["main_body"], val, layout=name, role="main_body",
             bullet=isinstance(val, (list, tuple)), nodes=nodes, all_ys=ys)

    if "row_labels" in spec:
        cfg = spec["row_labels"]
        labels = data.get("row_labels") or []
        got = S.band(slide, cfg["y"], x_min=cfg.get("x_min"), all_ys=spec.get("_ys"), _nodes=nodes)
        for i, sh in enumerate(got):
            if i < len(labels):
                set_text(sh, [str(labels[i])])
            else:
                S.delete(sh)

    if "sub_boxes" in spec:
        cfg = spec["sub_boxes"]
        got = S.band(slide, cfg["y"], all_ys=spec.get("_ys"), _nodes=nodes)
        panels = data.get("panels") or []
        per = cfg["per"]
        for pi in range(len(got) // per if per else 0):
            chunk = got[pi * per:(pi + 1) * per]
            vals = (panels[pi].get("summaries") if pi < len(panels) else None) or []
            for j, sh in enumerate(chunk):
                if j < len(vals):
                    S.check_fit(layout=name, role="sub_box", value=vals[j], capacity=CAPACITY)
                    set_text(sh, _lines(vals[j]), accent=T.ACCENT)
                else:
                    S.delete(sh)

    if spec.get("images") and data.get("images"):
        cfg = spec["images"]
        media.fill_images(slide, data["images"], y=cfg["y"])

    _fill_mid_notes(slide, name, spec, data, nodes)
    _fill_box(slide, name, spec, data, nodes)
    _fill_closing(slide, name, spec, data, nodes)
    _fit_note_boxes(slide, name, spec, nodes)
    # 행이 줄어든 장표(flow-4)는 **다 채운 뒤** 남은 행이 자리를 나눠 갖는다 (노트 75·76)
    if spec.get("stretch_rows"):
        reflow.stretch_rows(slide, **spec["stretch_rows"])


# ══════════════════════════════════════════════════════════════════
#  골격 장표 (표지 · 목차 · 간지 · 핵심 메시지 · 뒷표지)
# ══════════════════════════════════════════════════════════════════

def build_cover(slide, *, title, subtitle="", ver="01", date="", dept="", author=""):
    """표지. 노트 22: "부제목은 제목과 항상 같은 간격 — 제목이 3줄이면 그만큼 아래로, 1줄이면 위로"."""
    s = T.SKELETON[T.COVER]
    nodes = S.nodes(slide)
    lines = _lines(title)
    if len(lines) > 3:
        raise ValueError("표지 제목은 최대 3줄")
    title_sh = S.one(slide, s["title"], _nodes=nodes)
    set_text(title_sh, lines)
    sub = S.band(slide, s["subtitle"], _nodes=nodes)
    if subtitle:
        set_text(sub[0], [subtitle])
        shift = len(lines) - s.get("title_lines", 2)
        if shift:
            pitch, _ = reflow.para_metrics(title_sh, _pt_of(title_sh, 36.0))
            for sh in sub:
                sh.top = T.cm(T.to_cm(sh.top) + shift * pitch)
            _advise(f"표지 제목이 {len(lines)}줄이라 부제목을 {shift * pitch:+.2f}cm 옮겼다 "
                    f"(템플릿 노트 22: 제목과 같은 간격 유지)")
    else:
        S.delete_many(sub)
    set_text(S.one(slide, s["ver"], _nodes=nodes), [f"Ver. {ver}"])
    tail = " / ".join(x for x in (date, dept or T.DEFAULT_DEPT, author) if x)
    set_text(S.one(slide, s["date"], _nodes=nodes), [tail])


def build_toc(slide, names):
    """목차 — 기본 5행. 적으면 **위쪽을 지우고**, 6~8개면 **위쪽에 행을 추가한다** (템플릿 노트 23).

    "섹션이 5개 이하일 경우 아래쪽 기준으로 줄여주시고 5개 이상일 경우 위쪽으로 추가해주세요.
     섹션은 최대 8개입니다."
    """
    s = T.SKELETON[T.TOC]
    nodes = S.nodes(slide)
    n = len(names)
    if n > T.TOC_MAX:
        raise ValueError(f"섹션은 최대 {T.TOC_MAX}개다 ({n}개가 왔다)")
    base = T.TOC_PER_PAGE
    if n <= base:
        blank = base - n
        for i in range(blank):                      # 위쪽 여분 삭제
            S.delete_at(slide, s["items"][i], _nodes=nodes)
            S.delete_at(slide, s["lines"][i], text=False, _nodes=nodes)
        for j, name in enumerate(names):
            set_text(S.one(slide, s["items"][blank + j], _nodes=nodes), [f"{j + 1:02d}. {name}"])
        return
    # 6~8개: 첫 행(글상자 + 그 위 구분선)을 원형으로 위쪽에 복제한다
    extra = n - base
    pitch = s.get("pitch", 1.29)
    proto_item = S.one(slide, s["items"][0], _nodes=nodes)
    proto_line = S.band(slide, s["lines"][0], text=False, _nodes=nodes)
    proto_line = [sh for sh in proto_line if not (sh.has_text_frame and sh.text_frame.text.strip())]
    spTree = slide.shapes._spTree
    new_items = []
    for k in range(1, extra + 1):
        y_item = s["items"][0] - pitch * k
        y_line = s["lines"][0] - pitch * k
        if y_line < s.get("top_limit", 4.6) - 0.05:
            raise ValueError("목차 행을 더 올릴 자리가 없다 (Contents 제목과 겹친다)")
        el = copy.deepcopy(proto_item._element)
        spTree.append(el)
        sh = next(x for x in slide.shapes if x._element is el)
        sh.top = T.cm(y_item)
        new_items.append(sh)
        for ln in proto_line:
            el2 = copy.deepcopy(ln._element)
            spTree.append(el2)
            sh2 = next(x for x in slide.shapes if x._element is el2)
            sh2.top = T.cm(y_line)
    rows = list(reversed(new_items)) + [S.one(slide, y, _nodes=nodes) for y in s["items"]]
    for j, (sh, name) in enumerate(zip(rows, names)):
        set_text(sh, [f"{j + 1:02d}. {name}"])
    _advise(f"섹션이 {n}개라 목차 위쪽에 {extra}행을 추가했다 (템플릿 노트 23)")


def build_divider(slide, *, index, name):
    s = T.SKELETON[T.DIVIDER]
    set_text(S.one(slide, s["section"]), [f"{index + 1:02d}. {name}"])


def build_divider_sub(slide, *, index, name, subs):
    """하위 섹션이 있는 간지. 하위 섹션도 아래쪽부터 채운다 (템플릿 노트 25)."""
    s = T.SKELETON[T.DIVIDER_SUB]
    nodes = S.nodes(slide)
    set_text(S.one(slide, s["section"], _nodes=nodes), [f"{index + 1:02d}. {name}"])
    subs = list(subs or [])
    if len(subs) > T.SUBSECTION_MAX:
        raise ValueError(f"하위 섹션은 최대 {T.SUBSECTION_MAX}개다 ({len(subs)}개가 왔다)")
    blank = T.SUBSECTION_MAX - len(subs)
    for i in range(blank):
        S.delete_at(slide, s["items"][i], _nodes=nodes)
        S.delete_at(slide, s["lines"][i], text=False, _nodes=nodes)
    for j, sub in enumerate(subs):
        set_text(S.one(slide, s["items"][blank + j], _nodes=nodes), [f"{j + 1:02d}. {sub}"])


def build_message(slide, *, headline, detail=None):
    """핵심 메시지 (검정 배경 40pt 한 줄). 섹션 라벨·타이틀이 없다. 필수 장표는 아니다 (노트 26)."""
    s = T.SKELETON[T.MESSAGE]
    nodes = S.nodes(slide)
    if len(str(headline)) > 20:
        _advise(f"핵심 메시지가 {len(str(headline))}자다 — 40pt 한 줄이라 20자 이내를 권한다")
    set_text(S.one(slide, s["headline"], _nodes=nodes), [headline])
    got = S.band(slide, s["detail"], _nodes=nodes)
    if detail:
        set_text(got[0], [detail])
    else:
        S.delete_many(got)


# ══════════════════════════════════════════════════════════════════
#  제품 소개 장표 (93~105)
# ══════════════════════════════════════════════════════════════════

def build_product(slide, kind, data):
    spec = T.PRODUCT_SLOTS[kind]
    nodes = S.nodes(slide)

    if data.get("label"):
        got = S.band(slide, T.LABEL_Y, _nodes=nodes)
        if got:
            set_text(got[0], [data["label"]])
    if data.get("headline"):
        got = S.band(slide, spec["headline"], _nodes=nodes)
        if got:
            set_text(got[0], _lines(data["headline"]))
    if data.get("lead"):
        got = S.band(slide, spec["lead"], _nodes=nodes)
        if got:
            set_text(got[0], _lines(data["lead"]))

    items = data.get("items") or data.get("cards") or []
    if not items:
        return
    groups = spec.get("groups") or ([spec["cards"]] if "cards" in spec else [])
    off = 0
    for g in groups:
        chunk = items[off:off + g["n"]]
        for role, y in g["slots"].items():
            got = S.band(slide, y, _nodes=nodes)[:g["n"]]
            for i, sh in enumerate(got):
                if i >= len(chunk):
                    continue            # 제품 장표는 남은 슬롯을 지우지 않는다
                val = _get(chunk[i], role, off + i)
                if val is not None:
                    set_text(sh, _lines(val))
        off += g["n"]
