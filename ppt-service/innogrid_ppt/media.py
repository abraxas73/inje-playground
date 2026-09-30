# -*- coding: utf-8 -*-
"""이미지 이식 — 원고의 그림을 이미지형 레이아웃의 그림 자리에 넣는다.

템플릿 노트(가이드 16)가 정한 규칙을 그대로 따른다.

  · 가이드 상의 이미지 상자에 **Crop 해서** 적용하되 **원본 비율은 유지**하고 **중앙 배치**
  · 이미지 박스에는 **라운드를 적용**
  · **원본 파일에 이미지가 있다면 원본에서 가져다 쓴다 (임의 삭제 금지)**

마지막 항목이 중요하다. 원고가 PPT면 그림을 뽑아 그대로 옮겨야 하고, 임의로 빼고
다른 장표로 대체해서는 안 된다. `extract_images()` 가 그 추출을 맡는다.
"""

from pathlib import Path

from lxml import etree
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn

from . import tokens as T
from .geom import walk_abs

ROUND_ADJ = 6000        # 이미지 박스 모서리 (템플릿 카드 라운드와 같은 결)


def extract_images(src_pptx, out_dir, slide_no=None):
    """원고 PPT에서 그림을 뽑아 파일로 저장하고 경로를 돌려준다.

    slide_no를 주면 그 장의 그림만, 없으면 전부. 왼쪽→위쪽 순으로 정렬한다.
    """
    from pptx import Presentation
    prs = Presentation(str(src_pptx))
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    made = []
    for i, slide in enumerate(prs.slides, 1):
        if slide_no and i != slide_no:
            continue
        pics = [nd for nd in walk_abs(slide.shapes)
                if nd.shape.shape_type == MSO_SHAPE_TYPE.PICTURE]
        pics.sort(key=lambda nd: (round(nd.y, 1), nd.x))
        for j, nd in enumerate(pics, 1):
            img = nd.shape.image
            path = out_dir / f"slide{i:02d}_{j:02d}.{img.ext}"
            path.write_bytes(img.blob)
            made.append(str(path))
    return made


def _round_corners(pic):
    """그림에 라운드 모서리를 준다 (가이드 16)."""
    spPr = pic._element.find(qn("p:spPr"))
    if spPr is None:
        return
    for tag in ("a:prstGeom", "a:custGeom"):
        for e in spPr.findall(qn(tag)):
            spPr.remove(e)
    geom = etree.SubElement(spPr, qn("a:prstGeom"))
    geom.set("prst", "roundRect")
    av = etree.SubElement(geom, qn("a:avLst"))
    gd = etree.SubElement(av, qn("a:gd"))
    gd.set("name", "adj")
    gd.set("fmla", f"val {ROUND_ADJ}")


def _center_crop(pic, w_cm, h_cm):
    """상자를 꽉 채우되 **원본 비율을 유지**하도록 가운데만 남기고 잘라 낸다."""
    try:
        px_w, px_h = pic.image.size
    except Exception:
        return
    if not px_w or not px_h:
        return
    target = w_cm / h_cm
    source = px_w / px_h
    if source > target:                     # 원본이 더 넓다 → 좌우를 자른다
        keep = target / source
        c = (1 - keep) / 2
        pic.crop_left = c
        pic.crop_right = c
    elif source < target:                   # 원본이 더 높다 → 위아래를 자른다
        keep = source / target
        c = (1 - keep) / 2
        pic.crop_top = c
        pic.crop_bottom = c


def fill_images(slide, paths, *, y, expect=None):
    """y 밴드의 그림 자리를 원고 이미지로 갈아끼운다.

    자리의 위치·크기·개수는 템플릿 그대로 두고 내용만 바꾼다.
    주지 않은 자리는 **템플릿 그림을 그대로 둔다** — 비우면 디자인이 무너진다.
    """
    if not paths:
        return 0
    slots = [nd for nd in walk_abs(slide.shapes)
             if nd.shape.shape_type == MSO_SHAPE_TYPE.PICTURE and abs(nd.y - y) <= 0.35]
    slots.sort(key=lambda nd: nd.x)
    if expect and len(slots) != expect:
        raise LookupError(f"그림 자리가 {expect}개여야 하는데 {len(slots)}개다 (y={y})")

    spTree = slide.shapes._spTree
    used = 0
    for nd, path in zip(slots, paths):
        if not path:
            continue
        old = nd.shape._element
        pos = list(spTree).index(old)       # 그리기 순서를 그대로 물려받는다
        pic = slide.shapes.add_picture(
            str(path), T.cm(nd.x), T.cm(nd.y), T.cm(nd.w), T.cm(nd.h))
        _center_crop(pic, nd.w, nd.h)
        _round_corners(pic)
        spTree.remove(pic._element)
        spTree.insert(pos, pic._element)
        spTree.remove(old)
        used += 1
    return used
