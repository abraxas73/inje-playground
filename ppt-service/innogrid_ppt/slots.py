# -*- coding: utf-8 -*-
"""슬롯 해석 — 절대 좌표로 도형을 찾는다.

도형 이름은 못 믿는다 ("Text 3"이 슬라이드마다 다른 역할이고 중복도 된다).
대신 **화면상의 y 좌표가 곧 역할**이고, 같은 y 밴드 안에서 **절대 x 오름차순이 카드
인덱스**다. 좌표는 `geom.walk_abs()` 가 그룹 변환을 풀어 낸 값이라 `tokens.LAYOUTS` 의
수치는 전부 "화면에서 잰 값"이다 — XML 좌표를 따로 외울 필요가 없다.

같은 y 밴드에 역할이 섞이면(59·60번의 왼쪽 패널 vs 오른쪽 카드) `x_min`/`x_max` 로 가른다.
"""

from .geom import walk_abs

TOL = 0.25   # cm. 원형 카드가 1mm, 4단 그리드가 2mm까지 어긋나므로 넉넉히 잡는다.
             # 밴드끼리 0.10cm 밖에 안 떨어진 곳도 있어(50~52번 4.86 vs 4.96) 허용오차만으로는
             # 가를 수 없다 — 그래서 `all_ys`(그 장표가 선언한 모든 밴드)를 받아
             # **가장 가까운 밴드**에만 도형을 귀속시킨다. 허용오차는 그물, all_ys가 심판이다.


def _has_text(sh):
    try:
        return sh.has_text_frame and sh.text_frame.text.strip() != ""
    except (AttributeError, ValueError):
        return False


def nodes(slide):
    return list(walk_abs(slide.shapes))


def band_nodes(slide, y, *, text=True, x_min=None, x_max=None, x_gap=None,
               all_ys=None, _nodes=None):
    """y 밴드에 걸린 노드를 절대 x 오름차순으로 돌려준다.

    text=True면 글자가 있는 상자만 — 같은 자리에 겹친 배경 도형을 걸러낸다
    (마무리 바는 '그라데이션 도형 + 텍스트 상자'가 완전히 겹쳐 있다).
    """
    found = []
    for nd in (_nodes if _nodes is not None else nodes(slide)):
        if abs(nd.y - y) > TOL:
            continue
        # 이 장표가 선언한 밴드 중 가장 가까운 것이 아니면 남의 슬롯이다
        if all_ys and min(all_ys, key=lambda t: abs(nd.y - t)) != y:
            continue
        # 미리 훑어 둔 목록은 그 사이 지워진 도형을 품고 있을 수 있다 (분리된 원소)
        if nd.shape._element.getparent() is None:
            continue
        if text and not _has_text(nd.shape):
            continue
        if x_min is not None and nd.x < x_min - 0.02:
            continue
        if x_max is not None and nd.x > x_max + 0.02:
            continue
        # 가운데 열(화살표 설명 등)을 건너뛴다
        if x_gap is not None and x_gap[0] <= nd.x <= x_gap[1]:
            continue
        found.append(nd)
    found.sort(key=lambda n: (round(n.x, 2), round(n.y, 2)))
    return found


def band(slide, y, **kw):
    """band_nodes()의 도형만."""
    return [n.shape for n in band_nodes(slide, y, **kw)]


def one(slide, y, **kw):
    got = band(slide, y, **kw)
    if not got:
        raise LookupError(f"y={y} 슬롯을 찾지 못했다")
    return got[0]


def many(slide, y, expect=None, **kw):
    got = band(slide, y, **kw)
    if expect is not None and len(got) != expect:
        raise LookupError(f"y={y} 슬롯이 {expect}개여야 하는데 {len(got)}개다")
    return got


def opt(slide, y, **kw):
    """없으면 빈 리스트. 템플릿마다 있고 없고가 갈리는 슬롯용."""
    try:
        return band(slide, y, **kw)
    except LookupError:
        return []


def delete(shape):
    shape._element.getparent().remove(shape._element)


def delete_many(shapes):
    for sh in shapes:
        delete(sh)


def delete_at(slide, y, **kw):
    delete_many(band(slide, y, **kw))


class Overflow(ValueError):
    """슬롯이 넘친다. CLAUDE.md §5 순서로 대응해야 한다."""


def text_units(s):
    """글자 폭을 '한글 한 글자 = 1' 기준으로 센다. 영문·숫자·공백은 절반쯤."""
    n = 0.0
    for ch in str(s):
        o = ord(ch)
        if 0xAC00 <= o <= 0xD7A3 or 0x3130 <= o <= 0x318F or 0x4E00 <= o <= 0x9FFF:
            n += 1.0
        elif ch == " ":
            n += 0.35
        else:
            n += 0.55
    return n


def check_fit(layout, role, value, capacity):
    """상자에 들어가는지 **줄 수로** 따진다.

    글자 총수로는 못 잡는다 — 불릿 3개짜리 본문은 짧아도 최소 3줄을 먹는다.
    각 문단이 몇 줄로 접히는지 더해서 상자의 줄 수와 비교한다.
    """
    cap = capacity.get((layout, role))
    if cap is None:
        return
    cpl, max_lines = cap
    items = list(value) if isinstance(value, (list, tuple)) else [value]
    need = 0
    for it in items:
        w = text_units(it)
        need += max(1, int(w / cpl) + (1 if w % cpl else 0))
    if need > max_lines:
        sample = str(items[0])[:34]
        raise Overflow(
            f"[{layout}] '{role}' 슬롯이 넘친다 — {need}줄이 필요한데 상자는 {max_lines}줄이다 "
            f"(한 줄 약 {cpl}자).\n"
            f"  → {sample}…\n"
            f"  대응: ① 글 줄이기 ② 항목 수 줄이기 ③ 더 넓은 장표로 교체 ④ 장 분리"
        )


# ── 상자 용량 계산 (tools/measure.py 와 빌더가 같은 식을 쓴다) ────

LINE_RATIO = 1.3          # 줄 높이 / 글자 크기 (템플릿 줄간격 130%)


def font_pt(shape, fallback=9.0):
    try:
        for para in shape.text_frame.paragraphs:
            for r in para.runs:
                if r.font.size:
                    return r.font.size.pt
    except Exception:
        pass
    return fallback


def capacity_of(node, pt=None):
    """이 상자에 들어가는 (줄당 글자 수, 줄 수). pt 를 주면 그 글자 크기로 다시 잰다.

    줄 높이는 **그 상자가 실제로 쓰는 줄간격**으로 잰다 — 어떤 상자는 `lnSpc`에 14.5pt를
    못 박아 두고 어떤 상자는 `spcAft`로 문단을 띄운다. 글자를 8pt로 줄일 때는 `lnSpc`가
    절대값(pt)이면 줄 높이가 그대로라 줄 수가 늘지 않는다 — 그것도 그대로 반영된다.
    """
    from . import reflow
    base_pt = font_pt(node.shape)
    pt = pt or base_pt
    em = pt / 72 * 2.54
    cpl = max(1, int(node.w / em))
    pitch, _ = reflow.para_metrics(node.shape, pt)
    if pt != base_pt:
        # 백분율 줄간격이면 글자 크기에 비례해 줄어들고, 절대값이면 그대로다
        pitch_base, _ = reflow.para_metrics(node.shape, base_pt)
        if abs(pitch_base - reflow.line_height_cm(base_pt, reflow.TEXT_LINE_RATIO)) < 1e-6:
            pitch = reflow.line_height_cm(pt, reflow.TEXT_LINE_RATIO)
        else:
            pitch = pitch_base
    lines = max(1, int(node.h / max(pitch, em * LINE_RATIO) + 0.15))
    return cpl, lines


def lines_needed(value, cpl):
    """각 문단이 몇 줄로 접히는지 더한다."""
    items = list(value) if isinstance(value, (list, tuple)) else [value]
    need = 0
    for it in items:
        w = text_units(it)
        need += max(1, int(w / cpl) + (1 if w % cpl else 0))
    return need
