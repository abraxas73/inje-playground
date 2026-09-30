# -*- coding: utf-8 -*-
"""글자 폭 측정 — 키워드 칩의 가로 크기를 글자에 맞출 때 쓴다.

template/사용서체.zip 안의 Pretendard OTF를 직접 읽어 실제 글리프 진행폭으로 계산한다.
Pillow가 없거나 폰트를 못 찾으면 글자 종류별 어림값으로 대신한다 (한글 0.36cm/자 @10pt).
"""

import io
import zipfile
from pathlib import Path

_FONT_FILES = {
    "Pretendard SemiBold": "Pretendard-SemiBold.otf",
    "Pretendard Medium": "Pretendard-Medium.otf",
    "Pretendard": "Pretendard-Regular.otf",
    "Pretendard Light": "Pretendard-Light.otf",
}
_cache = {}


def _find_zip(template_path):
    cands = []
    if template_path:
        cands.append(Path(template_path).parent / "사용서체.zip")
    cands += [Path("template/사용서체.zip"), Path("사용서체.zip")]
    for c in cands:
        if c.is_file():
            return c
    return None


def _font(name, template_path=None):
    key = (name, str(template_path))
    if key in _cache:
        return _cache[key]
    font = None
    try:
        from PIL import ImageFont
        zp = _find_zip(template_path)
        if zp:
            with zipfile.ZipFile(zp) as z:
                font = ImageFont.truetype(io.BytesIO(z.read(_FONT_FILES[name])), size=1000)
    except Exception:            # Pillow 없음 · zip 깨짐 등 — 어림값으로 간다
        font = None
    _cache[key] = font
    return font


def _rough(text, pt):
    w = 0.0
    for ch in text:
        o = ord(ch)
        if 0xAC00 <= o <= 0xD7A3 or 0x3130 <= o <= 0x318F or 0x4E00 <= o <= 0x9FFF:
            w += 1.00                       # 한글·한자 = 1em
        elif ch == " ":
            w += 0.26
        elif ch.isdigit():
            w += 0.58
        elif ch.isupper():
            w += 0.68
        else:
            w += 0.52
    return w * pt / 72 * 2.54


def width_cm(text, pt, font_name="Pretendard SemiBold", template_path=None):
    """text를 font_name pt 크기로 한 줄에 썼을 때의 폭(cm)."""
    f = _font(font_name, template_path)
    if f is None:
        return _rough(text, pt)
    return f.getlength(text) / 1000 * pt / 72 * 2.54
