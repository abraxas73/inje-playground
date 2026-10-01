# -*- coding: utf-8 -*-
"""pptx 원고 → 장표별 텍스트·그림 정보. LLM이 장표 순서를 지키며 레이아웃을 고르는 재료.

ponytail: 타이틀은 "상단 25% 안에서 글자가 가장 큰 상자"로 잡는 휴리스틱. 그룹 안 도형의 좌표는 그룹 기준 상대값을 그대로 쓴다 —
틀리면 이식 도식이 타이틀과 겹칠 수 있고, 사용자는 피드백으로 고친다.
"""
import zipfile

from pptx import Presentation
from pptx.exc import PackageNotFoundError
from pptx.enum.shapes import MSO_SHAPE_TYPE

EMU_CM = 360000


class ExtractError(ValueError):
    """pptx를 열 수 없음(손상 또는 pptx 아님)."""


def _walk(shapes):
    for sh in shapes:
        if sh.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from _walk(sh.shapes)
        else:
            yield sh


def _text_of(shape):
    return "\n".join(p.text for p in shape.text_frame.paragraphs).strip()


def _max_font_pt(shape):
    sizes = [r.font.size.pt for p in shape.text_frame.paragraphs for r in p.runs if r.font.size is not None]
    return max(sizes) if sizes else 0.0


def extract_slides(path: str):
    try:
        prs = Presentation(path)
    except (PackageNotFoundError, zipfile.BadZipFile, KeyError) as e:
        raise ExtractError("pptx 파일을 열 수 없습니다") from e
    top_band = (prs.slide_height or 0) * 0.25
    band_floor = (prs.slide_height or 0) * 0.40  # 제목 띠에 속하려면 바닥이 여기 위여야 한다(본문 글상자 제외)
    wide_w = (prs.slide_width or 0) * 0.5       # 제목은 폭이 넓다 — '01.' 같은 큰 번호와 구분
    out = []
    for no, slide in enumerate(prs.slides, 1):
        texts, pictures, has_table, has_chart = [], 0, False, False
        best = None  # (font_pt, bottom_cm, text)
        band = []  # 상단 띠 글상자 (top, bottom, pt, width, text)
        for sh in _walk(slide.shapes):
            if sh.shape_type == MSO_SHAPE_TYPE.PICTURE:
                pictures += 1
            if getattr(sh, "has_table", False) and sh.has_table:
                has_table = True
            if getattr(sh, "has_chart", False) and sh.has_chart:
                has_chart = True
            if not getattr(sh, "has_text_frame", False) or not sh.has_text_frame:
                continue
            t = _text_of(sh)
            if not t:
                continue
            top, left = sh.top or 0, sh.left or 0
            texts.append((top, left, t))
            pt = _max_font_pt(sh)
            bottom = top + (sh.height or 0)
            if top < top_band and bottom <= band_floor:
                band.append((top, bottom, pt, sh.width or 0, t))
            if top < top_band and (best is None or pt > best[0]):
                best = (pt, round(bottom / EMU_CM, 2), t)
        texts.sort(key=lambda x: (x[0], x[1]))
        # 제목 = 상단 띠에서 폭이 넓은 글상자 중 글자가 가장 큰 것(없으면 글자가 가장 큰 것). 띠의 바닥 = 제목 바닥보다 위에서 시작하는 띠 글상자들의 최대 바닥.
        wide = [b for b in band if b[3] >= wide_w]
        if wide:
            title_b = max(wide, key=lambda b: b[2])
            limit = max(b[1] for b in wide)
            band_bottom = max(b[1] for b in band if b[0] <= limit)
            best = (title_b[2], round(band_bottom / EMU_CM, 2), title_b[4])
        out.append({
            "no": no,
            "title": best[2].splitlines()[0] if best else None,
            "texts": [t for _, _, t in texts],
            "pictures": pictures,
            "hasTable": has_table,
            "hasChart": has_chart,
            # 이식(source.from)의 기준선 — '01.' 같은 큰 번호 밑에 제목이 더 있을 때 제목이 도식에 딸려 오지 않게 띠 바닥을 쓴다
            "titleBottomCm": best[1] if best else None,
        })
    return out
