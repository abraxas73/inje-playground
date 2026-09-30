# -*- coding: utf-8 -*-
"""템플릿 파일 찾기.

디자인 원본(템플릿 pptx·폰트)은 ./template/ 에 들어 있다. 다른 곳의 파일을 쓰려면
아래 순서로 지정한다.

찾는 순서:
  1. 명시한 경로 (build.py --template ...)
  2. 환경변수 INNOGRID_PPT_TEMPLATE
  3. ./template/ 아래
  4. 현재 폴더에서 INNOGRID_PPT_Template*.pptx 탐색 (2단계까지)

디자인 가이드(INNOGRID_PPT_DesignGuide*.pptx)는 같은 폴더에 있어도 템플릿으로
잡히지 않는다 — 패턴이 다르다.
"""

import os
from pathlib import Path

ENV_VAR = "INNOGRID_PPT_TEMPLATE"
CONVENTIONAL_DIR = "template"
PATTERN = "INNOGRID_PPT_Template*.pptx"
EXPECTED = "INNOGRID_PPT_Template_v1_0_latest.pptx"

_HELP = f"""템플릿 pptx를 찾지 못했다.

./{CONVENTIONAL_DIR}/{EXPECTED} 가 지워졌거나 옮겨졌다.
압축본에서 다시 꺼내거나, 사용자에게 사내 배포본을 요청한다.

  "이노그리드 표준 PPT 템플릿({EXPECTED}, 디자인가이드 병합본 106장 · 2026-09 최신본)과
   사용서체.zip 을 주세요. 디자인팀/사내 공유 드라이브에 있습니다."

받았으면 아래 중 한 곳에 둔다.

  1) ./{CONVENTIONAL_DIR}/{EXPECTED}      (권장, 자동 탐색)
  2) 환경변수 {ENV_VAR} 에 파일 경로
  3) build.py ... --template /경로/템플릿.pptx

주의: 86장짜리 v1.1, 33장짜리 v1.0, 26·22장짜리 이전 배포본은 번호·슬롯 좌표가 전부 달라 쓸 수 없다
(build 시 장 수 검사에서 걸린다)."""


class TemplateNotFound(FileNotFoundError):
    pass


def find_template(explicit=None, root="."):
    if explicit:
        p = Path(explicit)
        if not p.is_file():
            raise TemplateNotFound(f"지정한 템플릿이 없다: {p}\n\n{_HELP}")
        return p

    env = os.environ.get(ENV_VAR)
    if env:
        p = Path(env)
        if not p.is_file():
            raise TemplateNotFound(f"{ENV_VAR}가 가리키는 파일이 없다: {p}\n\n{_HELP}")
        return p

    root = Path(root)
    for pattern in (f"{CONVENTIONAL_DIR}/{PATTERN}", PATTERN, f"*/{PATTERN}"):
        hits = sorted(root.glob(pattern))
        if hits:
            return hits[-1]        # 이름순 마지막 = 최신 버전

    raise TemplateNotFound(_HELP)
