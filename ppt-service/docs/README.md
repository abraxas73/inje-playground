# 이노그리드 표준 PPT 자동 생성 — 템플릿 v1.0 최신본 (2026-09 · 106장) · 도구 v3.1

원고를 `deck.yaml`로 옮기면 이노그리드 디자인 규칙을 지킨 PPT가 나온다.

색·폰트·좌표·여백은 **템플릿에서 상속**한다. 코드가 새로 그리는 것은 표와 키워드 칩 폭뿐이라
브랜드 위반이 구조적으로 발생하지 않는다. 템플릿 **슬라이드 노트에 적힌 준수사항은 전부 코드에 옮겨져 있다**
(대응표: `TEMPLATE_ANALYSIS.md` §3-1).

Windows · macOS · Linux 공통. 파이썬 3.9 이상.

---

## 빠르게 시작

```bash
python3 setup.py                        # 가상환경·의존성·폰트·렌더 도구 준비
.venv/bin/python build.py sample.deck.yaml out.pptx
.venv/bin/python check.py out.pptx      # 브랜드 검사
.venv/bin/python render.py out.pptx     # 슬라이드 이미지로 눈 확인
```

Windows는 `python setup.py` · `.venv\Scripts\python`.

**AI 에이전트가 이 폴더에서 작업한다면 `CLAUDE.md`를 먼저 읽는다.** 장표 선택 기준과
편집 규칙이 전부 거기 있다.

---

## 템플릿 구성 (106장)

| 범위 | 내용 |
|---|---|
| 1~21 | 디자인 가이드 (컬러·서체·로고 표기법·가이드라인·컴포넌트 — KPI형 컴포넌트 추가) |
| 22~25 | 표지 · 목차 · 간지 · 간지+하위섹션 |
| 26 | 핵심 메시지 (검정) |
| **27~92** | **본문 레이아웃 66종** (표 전용·자유 배치 85~87 포함) |
| 93~105 | 제품 소개 13종 (TAFA 솔루션 계층 추가) |
| 106 | 뒷표지 |

디자인 가이드와 템플릿은 **한 파일로 병합**되어 있다. 산출물에는 가이드 장표가 들어가지 않고,
템플릿의 슬라이드 구역(section)도 제거된다.

---

## 장표 이름표

표지·목차·간지·뒷표지는 `meta`·`sections`에서 자동 생성된다. 아래는 본문에서 고르는 이름이다.
**템플릿 슬라이드 번호로도 부를 수 있다** (`layout: 40` = `pill-4`).

| 계열 | 이름 |
|---|---|
| 카드형 | `card-3` `card-4` `card-5` `card-6` `card-3-chips` |
| 여러 칸 카드 | `cards-6` `cards-8` `cards-10` `cards-8-note` `cards-10-note` |
| 이미지형 | `image-3` `image-4` `image-3-top` `image-4-top` `image-4-kpi` `image-4-kpi-msg` |
| 원형 | `circle-4` `circle-3` `circle-4-line` `circle-3-line` |
| 결론 먼저 | `lead-4` `lead-3` `lead-3-chips` |
| 열 헤더 | `columns-3-chips` `columns-3x3` |
| KPI형 | `kpi-4-cards-3` `kpi-3-cards-3` `cards-3-kpi-4` |
| 변화 전/후 | `change-2-notes` `change-2-note` |
| 두 층위 | `stack-3` |
| 항목 Pill | `pill-4` `pill-3` `pill-4-msg` `pill-3-msg` `pill-3-note` `pill-3-summary-note` |
| 단계 | `steps-6` `steps-8` `steps-10` `timeline-4-notes-3` |
| 화살표 흐름 | `flow-4` `flow-6` `flow-8` |
| 방사형 | `radial-4` |
| 2단 비교 | `compare-rows` `compare-cards` `compare-vs` |
| 좌우 비대칭 | `split-3` `wing-rows` `wing-circle` `wing-message` |
| 강조 패널 | `panel-cards-3` `panel-2-cards-3-note` `panel-rows` `panel-rows-note` `panel-cards-6` |
| 차트 | `chart-donut` `chart-bar` `chart-notes` |
| 표 | `table-full` `table` `table-flow` `table-lower` `table-notes` `table-note` |
| 아젠다 | `agenda-5` |
| 한 줄 메시지 | `message` |
| 자유 배치 | `free-title` `free` |
| 제품 소개 | `product` / `product-features` + `product: openstackit` 등 · `tafa` `tafa-layers` `lineup` |

`sample.deck.yaml`이 66종(+변형)을 전부 한 번씩 쓴다 — 작성법은 거기서 베끼는 게 가장 빠르다.

---

## 설계 원칙

**1. 복제하고 텍스트만 갈아끼운다.** 도형을 새로 그리지 않으므로 좌표·색·그라데이션·
모서리·그룹 배율이 원본 그대로 유지된다. 예외는 몇 곳뿐 — 목차/간지의 항목 삭제·추가,
표(엔진이 새로 그림), 차트(데이터만 교체), 키워드 칩(글자 폭에 맞춰 가로만 조정), 상자 높이(노트대로).

**2. 슬롯은 좌표로 찾는다.** 도형 이름은 못 믿는다(`"Text 3"`이 슬라이드마다 다른 역할이고
중복도 된다). y 좌표가 곧 역할이고, 같은 밴드에서 x 순서가 항목 인덱스다.
좌표는 **절대(화면) 좌표** — `geom.py`가 그룹 변환(`chOff`/`chExt`)을 풀어 준다.

**3. 66종을 손으로 짜지 않는다.** `tokens.LAYOUTS`에 선언적 스펙을 적고 한 벌의 엔진이 채운다.
새 장표를 붙이는 비용이 스펙 한 덩어리다.

**4. 넘치는 것은 만들기 전에 막는다.** `capacity.py`가 템플릿 상자를 실측해
"한 줄 몇 자 × 몇 줄"을 갖고 있고, 빌드가 **줄 수 기준**으로 판정한다
(불릿 3개는 짧아도 3줄을 먹는다 — 글자 총수로는 못 잡는다).

**5. 모자라면 지운다.** 키워드 칩·캡션·수치 행·화살표 설명은 원고에 없으면 도형째 지운다.
단 마무리 문구·요약 문장은 예외 — **반드시 채운다.**

**6. 템플릿 노트가 정한 "늘어나는" 동작을 따른다.** 카드는 3~6단으로 다시 깔리고
(가이드 20·21), 본문이 길면 박스가 같은 줄의 형제와 함께 아래로 커지며 (가이드 14~16),
하단 마무리 박스는 바닥을 고정한 채 위로 커지고 (노트 "하단 텍스트 박스는 하단고정"),
표는 열 폭·행 높이가 글자수를 따르고 (노트 85~87), 원고에 그림이 있으면 비율을 유지한 채 가져다 쓴다 (가이드 17).
그래도 모자라면 본문을 8pt까지 줄인다 (표준 프롬프트).

---

## 알려진 한계

- **제품 장표의 그림은 교체되지 않는다.** 브랜드 그래픽이라 그대로 둔다.
  이미지형 본문 장표는 `images`로 원고 그림을 넘기면 자동으로 들어간다.
- **글자 크기는 8pt 밑으로 줄이지 않는다.** 상자를 늘릴 자리가 없을 때만 본문을 8pt로 줄이고 (프롬프트 허용치),
  그래도 넘치면 장표를 바꾸거나 글을 줄인다 (표는 7.5pt까지).
- **`free-title`·`free`에 `source`를 주면 원고 PPT의 도식을 도형째 가져온다**
  (글꼴·브랜드색만 이노그리드로 바꾸고 가이드라인 안쪽에 맞춘다). 주지 않으면 껍데기만 만들고
  안쪽 구성은 사용자가 한다.
- **템플릿 원본 결함**: AI큐브잇 주요 기능 장표(원본 103)에 `KoPub돋움체 Medium` 런이
  두 군데 남아 있다. 그 제품 장표를 쓰면 따라온다 — 디자인센터에 수정 요청 필요.
- **렌더 확인에는 Pretendard 시스템 설치가 필요하다.** LibreOffice가 임베드 폰트를 못 읽어
  시스템 폰트로 그린다. 산출물 pptx 자체는 폰트가 임베드되므로 받는 쪽에서는 정상이다.

---

## 파일 지도

```
build.py              deck.yaml → pptx
check.py              브랜드 검사기
render.py             pptx → 슬라이드 이미지
setup.py              환경 준비
tools/measure.py      템플릿 실측 → capacity.py 생성
tools/make_sample.py  sample.deck.yaml 생성
sample.deck.yaml      본문 66종 예제
CLAUDE.md             작업 절차 · 장표 선택 기준 · 편집 규칙   ← 가장 먼저 읽을 것
CHANGELOG.md          v2.2(86장) → v3.0 → v3.1(106장 갱신판) 변경과 이름 대응표
TEMPLATE_ANALYSIS.md  템플릿 구조 분석 (모든 수치의 근거)
innogrid_ppt/
  tokens.py     색·폰트 + 장표 66종 선언적 스펙
  reflow.py     카드 3~6단 재배치 · 가변 박스 · 하단 고정 박스 · 행 늘려 깔기
  media.py      원고 그림 추출·이식
  geom.py       그룹 변환을 푼 절대 좌표
  slots.py      좌표로 슬롯 찾기 · 오버플로 판정 · 상자 용량
  capacity.py   슬롯 용량 (생성물)
  builders.py   스펙을 읽어 채우는 엔진
  table.py      표 엔진 (열 폭·행 높이 = 글자수)
  oxml.py       OOXML 조작 헬퍼
  textwidth.py  글자 폭 측정 (칩 폭 계산)
  clone.py      슬라이드 복제 · 슬라이드 구역 제거
  deck.py       덱 조립 · 이름 해석
  template.py   템플릿 파일 탐색
template/       디자인 원본 (수정 금지)
```
