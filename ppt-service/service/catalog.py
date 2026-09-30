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

ROOT = Path(__file__).resolve().parent.parent
PACKAGE_VERSION = "v3.1"
ELLIPSIS = "…"


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
            "example": example,
        })
    message = {
        "name": "message", "slide": T.MESSAGE, "arity": None,
        "desc": "핵심 메시지 — 검정 배경, 40pt 한 줄. 섹션 라벨·타이틀 없음",
        "use": "한 문장으로 못 박을 메시지. headline은 20자 이내, detail은 생략 가능",
        "closing": None, "chips": None, "required": ["headline"],
        "example": {"layout": "message", "headline": ELLIPSIS, "detail": ELLIPSIS},
    }
    return {
        "layouts": layouts,
        "message": message,
        "products": sorted(T.PRODUCTS),
        "overview": sorted(T.PRODUCT_OVERVIEW),
        "productExample": [{"layout": "product", "product": "openstackit"}, {"layout": "product-features", "product": "openstackit"}, {"layout": "product", "product": "tafa"}],
        "templateSlides": T.TEMPLATE_SLIDES,
        "package": PACKAGE_VERSION,
    }
