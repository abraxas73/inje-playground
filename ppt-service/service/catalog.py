# -*- coding: utf-8 -*-
"""LLM 프롬프트용 장표 카탈로그.

tokens.LAYOUTS(이름·용도·항목 수·마무리 규칙)와 sample.deck.yaml(장표마다 그 장표가 쓰는 키만 든 예제)을 합쳐
장표별 **골격 예제**를 만든다 — 문자열은 "…", 리스트는 길이를 유지, 숫자는 그대로. 키와 개수만 남아 짧고 정확하다.
"""
import copy
import re
from functools import lru_cache
from pathlib import Path

import yaml

from innogrid_ppt import tokens as T
from innogrid_ppt.capacity import CAPACITY

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_VERSION = "v3.1"
ELLIPSIS = "…"
# 모든 장표가 같은 값이라 카탈로그 상단에 한 번만 싣는 역할
COMMON_ROLES = ("page_title", "section_label")
# 마무리 문구 글상자의 안쪽 여백(좌우 각, cm)과 글자 크기 — 템플릿 실측 2026-10-01.
# 패키지 capacity.py는 여백을 빼지 않고 상자 폭 27cm로 재서 bar16을 47자/줄로 잡지만 실제 글 폭은 15cm(26자)다(디자인센터 보고 대상).
# ponytail: 상수표 — 템플릿이 바뀌면 tools/measure.py와 함께 다시 잰다(런북 §3).
CLOSING_TEXT_INSET_CM = {"bar16": (6.0, 16.0), "key": (3.0, 16.0), "msg": (0.25, 16.0), "bar13": (0.6, 13.0)}


def skeleton(value):
    if isinstance(value, str):
        return ELLIPSIS
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, list):
        return [skeleton(v) for v in value]
    if isinstance(value, dict):
        return {k: skeleton(v) for k, v in value.items()}
    return value


def _sample_examples():
    spec = yaml.safe_load((ROOT / "sample.deck.yaml").read_text(encoding="utf-8"))
    out = {}
    for sec in spec["sections"]:
        for sl in sec.get("slides", []):
            name = str(sl.get("layout", "")).lower()
            if not name or name.startswith("product"):
                continue
            ex = {k: v for k, v in sl.items() if k != "sub"}
            out.setdefault(name, skeleton(ex))
    return out


def _arity_from_name(name):
    m = re.search(r"-(\d+)", name)
    return int(m.group(1)) if m else None


def _capacity(name, spec):
    """장표의 슬롯 용량 {역할: [줄당 글자, 줄 수]} — capacity.py 실측값. closing은 글상자 안쪽 여백을 뺀 실제 한 줄 글자 수로 바꾼다."""
    out = {role: list(cap) for (lay, role), cap in sorted(CAPACITY.items()) if lay == name and role not in COMMON_ROLES}
    style = (spec.get("closing") or {}).get("style", "bar")
    if "closing" in out and style in CLOSING_TEXT_INSET_CM:
        inset, pt = CLOSING_TEXT_INSET_CM[style]
        out["closing"][0] = int((T.CONTENT_W - 2 * inset) // (pt / 72 * 2.54))
    return out


def _table(spec):
    """표 장표의 표 자리 — 높이·폭과 그 안에 드는 행 수(table._auto_row_heights와 같은 식: 행 = 여백 0.6 + 줄 × 8pt 줄높이, 최소 1.0cm)."""
    cfg = spec.get("table")
    if not cfg:
        return None
    avail = cfg["max_bottom"] - cfg["y"]
    pitch = T.TABLE_FONT / 72 * 2.54 * 1.3
    one = max(T.TABLE_ROW_H, 2 * T.TABLE_ROW_PAD + pitch)
    two = max(T.TABLE_ROW_H, 2 * T.TABLE_ROW_PAD + 2 * pitch)
    em = T.TABLE_FONT / 72 * 2.54
    return {
        "widthCm": round(cfg["w"], 1), "heightCm": round(avail, 1),
        "rowsOneLine": int((avail - T.TABLE_HEADER_H) // one), "rowsTwoLine": int((avail - T.TABLE_HEADER_H) // two),
        "charsPerLine": int(cfg["w"] // em),
    }


def _capacity_common():
    return {role: list(min(cap for (_, r), cap in CAPACITY.items() if r == role)) for role in COMMON_ROLES}


def _free_example(name):
    ex = {"layout": name, "title": [ELLIPSIS, ELLIPSIS], "source": {"slide": 1}}
    if name == "free":
        ex.pop("title")
    return ex


@lru_cache(maxsize=1)
def load_catalog():
    examples = _sample_examples()
    layouts = []
    for name in sorted(T.LAYOUTS):
        spec = T.LAYOUTS[name]
        example = copy.deepcopy(examples.get(name)) or _free_example(name)
        example["layout"] = name
        if name.startswith("image-"):
            n = spec.get("arity") or _arity_from_name(name) or 4
            example["images"] = ["src:장:번호"] * n
        closing = spec.get("closing")
        layouts.append({
            "name": name,
            "slide": spec.get("slide"),
            "arity": spec.get("arity"),
            "desc": spec.get("desc", ""),
            "use": spec.get("use", ""),
            "closing": {"required": bool(spec.get("closing_required")), "maxLines": int(closing.get("max_lines", 2))} if closing else None,
            "chips": (spec.get("chips") or {}).get("per"),
            "required": list(spec.get("required") or []),
            "capacity": _capacity(name, spec),
            "table": _table(spec),
            "example": example,
        })
    message = {
        "name": "message", "slide": T.MESSAGE, "arity": None,
        "desc": "핵심 메시지 — 검정 배경, 40pt 한 줄. 섹션 라벨·타이틀 없음",
        "use": "한 문장으로 못 박을 메시지. headline은 20자 이내, detail은 생략 가능",
        "closing": None, "chips": None, "required": ["headline"], "capacity": _capacity("message", {}),
        "example": {"layout": "message", "headline": ELLIPSIS, "detail": ELLIPSIS},
    }
    return {
        "layouts": layouts,
        "message": message,
        "products": sorted(T.PRODUCTS),
        "overview": sorted(T.PRODUCT_OVERVIEW),
        "productExample": [{"layout": "product", "product": "openstackit"}, {"layout": "product-features", "product": "openstackit"}, {"layout": "product", "product": "tafa"}],
        "capacityCommon": _capacity_common(),
        "templateSlides": T.TEMPLATE_SLIDES,
        "package": PACKAGE_VERSION,
    }
