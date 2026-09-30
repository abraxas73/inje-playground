# -*- coding: utf-8 -*-
"""슬라이드 복제 / 삭제.

python-pptx에는 슬라이드 복제 API가 없다. 여기서 최소한으로 구현한다.

전제 (템플릿 실측):
  · 레이아웃 1~5에는 placeholder가 없어 add_slide()가 빈 슬라이드를 만든다
  · notesSlide는 디자이너 안내문이라 산출물에 실을 이유가 없고,
    복제하면 "notes slide referenced by multiple slides" 검증에 걸린다 → 버린다
  · 그림 참조는 슬라이드 1(로고)과 33(뒷표지)뿐이다
  · 차트 참조는 25(도넛)·26(막대). 차트 파트를 그대로 공유하면 한 덱에 같은 차트 장표를
    두 번 쓸 때 데이터가 서로 덮어써지므로 **차트 파트를 복제**한다. 복제본에서는
    <c:externalData>(내장 xlsx 참조)를 떼어낸다 — chart.replace_data()가 새 xlsx를 만든다
"""

import copy

from pptx.opc.constants import RELATIONSHIP_TYPE as RT
from pptx.oxml.ns import qn

_SKIP_RELTYPES = ("/slideLayout", "/notesSlide")


def clone_slide(prs, src):
    """src 슬라이드를 프레젠테이션 끝에 복제하고 새 슬라이드를 돌려준다."""
    new = prs.slides.add_slide(src.slide_layout)

    # add_slide()가 레이아웃에서 끌어온 도형이 있으면 전부 비운다
    for sh in list(new.shapes):
        sh._element.getparent().remove(sh._element)

    spTree = new.shapes._spTree
    for sh in src.shapes:
        spTree.append(copy.deepcopy(sh._element))

    _copy_rels(src.part, new.part, spTree)
    return new


_RID_ATTRS = (qn("r:embed"), qn("r:id"), qn("r:link"), qn("r:pict"))


def _copy_rels(src_part, dst_part, spTree):
    """그림·하이퍼링크 관계를 옮기고 새 rId로 다시 쓴다."""
    mapping = {}
    for rId, rel in src_part.rels.items():
        if any(rel.reltype.endswith(s) for s in _SKIP_RELTYPES):
            continue
        if rel.is_external:
            mapping[rId] = dst_part.relate_to(rel.target_ref, rel.reltype, is_external=True)
        elif rel.reltype == RT.CHART:
            mapping[rId] = dst_part.relate_to(_clone_chart_part(rel.target_part), rel.reltype)
        else:
            mapping[rId] = dst_part.relate_to(rel.target_part, rel.reltype)
    if not mapping:
        return
    for el in spTree.iter():
        for attr in _RID_ATTRS:
            v = el.get(attr)
            if v in mapping:
                el.set(attr, mapping[v])


def _clone_chart_part(src):
    """차트 파트를 새 partname으로 복제한다. 내장 xlsx 참조는 떼어낸다."""
    package = src.package
    partname = package.next_partname("/ppt/charts/chart%d.xml")
    el = copy.deepcopy(src._element)
    for ext in el.findall(qn("c:externalData")):
        el.remove(ext)
    from pptx.parts.chart import ChartPart
    return ChartPart(partname, src.content_type, package, el)


def drop_slides(prs, keep_from):
    """keep_from 인덱스(0-base) 앞의 슬라이드를 전부 제거한다.

    원본 장표를 복제해 뒤에 쌓은 뒤, 앞의 원본을 잘라내는 용도.
    관계를 끊으면 해당 슬라이드 part와 그 notesSlide가 저장에서 빠진다.
    """
    sldIdLst = prs.slides._sldIdLst
    for el in list(sldIdLst)[:keep_from]:
        prs.part.drop_rel(el.get(qn("r:id")))
        sldIdLst.remove(el)


_P14 = "http://schemas.microsoft.com/office/powerpoint/2010/main"


def drop_sections(prs):
    """템플릿의 슬라이드 구역(section) 정의를 통째로 지운다.

    프롬프트 참고 사항: "디자인 적용 완료된 PPT에서는 템플릿상의 슬라이드 구역을 제거하고 파일 생성".
    구역은 presentation.xml 의 <p:extLst> 안 <p14:sectionLst> 에 있다. 원본 장을 잘라낸 뒤에는
    구역이 가리키는 슬라이드 id도 전부 사라지므로 남겨 두면 파워포인트가 빈 구역을 그린다.
    """
    root = prs.part._element
    removed = 0
    for ext in list(root.iter(qn("p:ext"))):
        if ext.find("{%s}sectionLst" % _P14) is not None:
            ext.getparent().remove(ext)
            removed += 1
    # ext가 하나도 남지 않은 extLst는 지운다 (비어 있으면 스키마 위반)
    for lst in list(root.iter(qn("p:extLst"))):
        if len(lst) == 0:
            lst.getparent().remove(lst)
    return removed
