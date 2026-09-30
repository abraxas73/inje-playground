# -*- coding: utf-8 -*-
"""절대 좌표 계산 — 그룹 변환을 풀어 도형의 실제 화면 위치를 구한다.

v1.0 자동화의 가장 큰 함정은 "XML 좌표 ≠ 화면 좌표"였다. 그룹(`p:grpSp`)은
자식 좌표계(`a:chOff`/`a:chExt`)를 자기 좌표계(`a:off`/`a:ext`)로 사상하므로,
그룹 안 도형의 `sh.left`/`sh.top`은 화면 위치가 아니다.

템플릿(최신본)은 카드마다 그룹을 하나씩 두는 구성이 많아(29·33~36·52~54·61~66…)
**그룹 안 형제들이 x를 공유한다** — 27번 카드 3개의 자식 x가 전부 0.75다.
그래서 `sh.left` 로 정렬하면 카드 순서가 뒤섞인다.

여기서는 그룹 변환을 재귀로 합성해 절대 좌표를 낸다. 그 결과:

  · 슬롯 좌표를 **화면에서 자로 잰 값**으로 적을 수 있다 (`tokens.LAYOUTS`)
  · 카드 순서는 절대 x 오름차순 = 읽는 순서로 정확히 맞는다
  · 배율이 걸린 그룹(높이 1.33배 등)도 별도 예외 없이 처리된다

`walk_abs()` 가 돌려주는 `Node.x/y/w/h` 는 cm 단위 float 다.
"""

from collections import namedtuple

from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn

EMU_CM = 360000

Node = namedtuple("Node", "shape x y w h sx sy depth")


def to_cm(emu):
    return emu / EMU_CM


def _group_xfrm(grp):
    """그룹의 (off, ext, chOff, chExt). 없으면 None."""
    pr = grp.element.find(qn("p:grpSpPr"))
    if pr is None:
        return None
    x = pr.find(qn("a:xfrm"))
    if x is None:
        return None
    off, ext = x.find(qn("a:off")), x.find(qn("a:ext"))
    cho, che = x.find(qn("a:chOff")), x.find(qn("a:chExt"))
    if None in (off, ext, cho, che):
        return None
    return (
        int(off.get("x")), int(off.get("y")),
        int(ext.get("cx")), int(ext.get("cy")),
        int(cho.get("x")), int(cho.get("y")),
        int(che.get("cx")), int(che.get("cy")),
    )


def _apply(xfrm, x, y, w, h):
    ox, oy, ex, ey, cx, cy, cw, ch = xfrm
    sx = ex / cw if cw else 1.0
    sy = ey / ch if ch else 1.0
    return ox + (x - cx) * sx, oy + (y - cy) * sy, w * sx, h * sy


def walk_abs(shapes, _xfrms=(), _depth=0):
    """그룹을 뚫고 모든 잎 도형을 절대 좌표(cm)와 함께 돌려준다.

    그룹 자체는 돌려주지 않는다 — 슬롯은 언제나 잎(글상자·도형)이다.
    `sx`/`sy` 는 그 도형에 걸린 **누적 배율**이다. 도형의 크기·위치를 실제로 고칠 때는
    자기 좌표계에 써야 하므로 (절대 길이 ÷ sx) 로 되돌려야 한다 — 키워드 칩이 그 경우다.
    """
    for sh in shapes:
        x, y, w, h = sh.left, sh.top, sh.width, sh.height
        sx = sy = 1.0
        for xf in reversed(_xfrms):
            sx *= xf[2] / xf[6] if xf[6] else 1.0
            sy *= xf[3] / xf[7] if xf[7] else 1.0
        if None not in (x, y, w, h):
            for xf in reversed(_xfrms):
                x, y, w, h = _apply(xf, x, y, w, h)
        if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
            xf = _group_xfrm(sh)
            yield from walk_abs(sh.shapes, _xfrms + ((xf,) if xf else ()), _depth + 1)
        else:
            if None in (x, y, w, h):
                continue
            yield Node(sh, to_cm(x), to_cm(y), to_cm(w), to_cm(h), sx, sy, _depth)
