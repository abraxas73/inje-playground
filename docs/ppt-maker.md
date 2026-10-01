# PPT 만들기 — 런북

스펙 `docs/superpowers/specs/2026-09-30-ppt-maker-design.md`. 화면 `/ppt`, 공유 `/ppt/s/{token}`(로그인 필요).

## 1. 구성
- Next.js(innogrid-playground): 인증·DB·Storage·LLM 호출(`after()`, 300초)·공유·Teams·SharePoint. 코드 `frontend/src/lib/ppt/`, `frontend/src/app/api/ppt/`.
- ppt-service(Vercel 프로젝트 `innogrid-ppt-service`, `ppt-service/`): 디자인센터 패키지 `innogrid_ppt`(python-pptx) + FastAPI. `/health`·`/catalog`·`/extract`·`/build`. 패키지 원본·템플릿 수정 금지.
- 데이터: `ppt_decks`, `ppt_deck_versions`(삭제 없음, 토큰 사용량 포함), 버킷 `ppt`. SQL `docs/sql/2026-09-30-ppt-maker.sql`.

## 2. 환경변수
| 프로젝트 | 변수 | 설명 |
|---|---|---|
| 둘 다 | `PPT_SERVICE_TOKEN` | `openssl rand -hex 32`. 같은 값 |
| innogrid-playground | `PPT_SERVICE_URL` | `https://innogrid-ppt-service.vercel.app` |
| innogrid-playground | `PPT_LLM_MODEL`(선택) | 폼에서 안 고를 때의 기본(기본값 `claude-sonnet-5-5`). 폼은 Sonnet 5.5·Opus 5.5 중 선택(`types/ppt.ts` `PPT_MODEL_OPTIONS`), 재생성·재시도는 기준 버전 모델을 잇는다 |
| innogrid-playground | `ANTHROPIC_API_KEY` | 없으면 화면이 안내문만 보인다 |
| innogrid-ppt-service | `SUPABASE_URL` | 서명 URL 호스트 제한용 |

## 3. 배포
- 프론트: 평소처럼 `frontend/`에서 `NODE_OPTIONS= vercel deploy --prod --yes`.
- ppt-service(Python이 바뀔 때만): `cd ppt-service && vercel deploy --prod --yes`, 이어서 `curl -H "x-ppt-token: $TOKEN" https://innogrid-ppt-service.vercel.app/health`가 `{"ok":true,"templateSlides":106,"layouts":69,…}`.
- 템플릿 갱신: `ppt-service/template/`의 pptx 교체 → `python tools/measure.py` → `pytest` → 배포. 마무리 문구 글상자의 안쪽 여백(`service/catalog.py` `CLOSING_TEXT_INSET_CM`, bar16 6cm·key 3cm·msg 0.25cm·bar13 0.6cm)도 다시 잰다 — 패키지 `capacity.py`는 여백을 빼지 않아 bar16을 47자/줄로 잡지만 실제는 26자(디자인센터 보고 대상). 표 셀의 `[[ ]]`는 패키지가 지원하지 않아 서비스가 빌드 전에 지운다. `/catalog`는 프로세스 캐시라 프론트 재배포 없이 새 인스턴스부터 반영된다. 카탈로그의 `capacity`(장표별 슬롯 용량)는 `capacity.py`에서 나오므로 measure.py를 돌리면 프롬프트도 같이 바뀐다.

## 3-1. 규칙·템플릿 바꾸기 (배포 없이)
- **LLM 규칙**: 관리자 > 시스템 설정 > "PPT 만들기 — 생성 규칙". settings 키 `ppt_llm_rules`. 비어 있으면 코드 기본본(`frontend/src/lib/ppt/rules-default.ts`)이 쓰인다. "기본 규칙 불러오기"로 가져와 고치고 저장하면 다음 생성부터 적용(프롬프트 캐시는 새로 만들어진다). 장표 목록·용량 카탈로그는 ppt-service가 템플릿에서 자동 생성하므로 규칙에 적지 않는다.
- **템플릿 업로드**: 같은 화면 "PPT 만들기 — 템플릿"에서 디자인센터 배포 pptx를 올린다. 흐름: 서명 URL로 `ppt/templates/<uuid>.pptx` 업로드 → `POST /api/admin/ppt/templates` → ppt-service `POST /template/validate`(장 수 106 확인 + `sample.deck.yaml` 전체 빌드 + 브랜드 검사) → 통과하면 `ppt_templates` 행(active). 실패하면 파일을 지우고 사유를 보여 준다. **내장본과 같은 106장 구성**(장표 번호·슬롯 좌표)이어야 한다 — 패키지 `tokens.py`가 좌표를 고정하고 있어 다른 구성은 통과하지 못한다.
- **선택·기본**: 생성 폼에 템플릿 선택이 뜬다(업로드 템플릿이 하나 이상 활성일 때). "기본으로"를 지정하면 폼의 기본값이 되고, 없으면 내장이 기본. 재생성·재시도는 기준 버전의 템플릿(`ppt_deck_versions.template_id`)을 그대로 쓴다. 비활성화해도 기존 버전 재생성은 가능하다. 삭제는 없다.
- **버전 기록**: 버전 카드 "템플릿" 행에 사용 템플릿 이름이 남는다(내장은 "내장 템플릿(이노그리드 v1.0 최신본)").
- ppt-service는 업로드 템플릿을 `/tmp/ppt-templates/<id>.pptx`에 인스턴스 캐시한다(웜 인스턴스 재사용, 콜드면 21MB 다시 내려받음). 용량표(`capacity.py`)와 마무리 여백 상수는 내장본 실측값이라, 업로드 템플릿의 상자 크기가 바뀌었다면 LLM 안내가 조금 어긋날 수 있다(빌드 자체는 상자 늘리기·8pt 축소로 흡수).

## 4. 생성이 실패하면
| 화면 오류 | 원인·조치 |
|---|---|
| `PPT 서비스에 연결할 수 없습니다` | ppt-service 배포·`PPT_SERVICE_URL`·토큰 확인(`/health`) |
| `'…'는 항목 N개 고정인데 …` / `슬롯이 넘친다` | LLM이 카탈로그 용량표(글자/줄)를 보고도 4회 수정 뒤 실패. 빌드는 첫 오류에서 멈춰 장표마다 한 회가 든다. 실패 버전 행 `deck_json`에 마지막 덱이 남고 Vercel 로그에 `[ppt] 빌드 오류 수정 n/4 …`가 회차별로 찍힌다. 완료된 버전이 있으면 피드백("N장을 card-3으로", "제목을 짧게")으로 재생성, 없으면 프롬프트에 "카드 제목·수치는 짧게"를 넣어 새로 만든다 |
| `[table-…] 표가 N cm 로 자리(M cm)를 넘친다` | 행이 표 자리(table-note 한 줄 행 6개·두 줄 행 4개, table-full 9개 — 카탈로그 `table`)보다 많다. 카탈로그가 행 예산을 알려 주고, 같은 장표가 다시 넘치면 수정 지시가 행 수 축소·table-full 교체·`{"slides":[…]}` 장 분리로 올라간다. 그래도 실패하면 프롬프트에 "표는 행 5개 이하, 길면 나눠서" |
| `템플릿이 106장이어야 하는데` | 내장 템플릿 파일 손상·교체 오류(`template/` 확인) 또는 업로드 템플릿이 다른 구성 — 업로드 시 검증에서 걸러지므로 운영 중 뜨면 Storage 파일 손상 의심 |
| `템플릿(…)을 찾을 수 없습니다` | 버전이 가리키는 `ppt_templates` 행·Storage 파일이 없다. 템플릿은 삭제하지 않는 것이 원칙 |
| `시간 초과(15분)` | Vercel 함수 800초 초과(원고가 매우 길 때). 원고를 줄이거나 나눠서 |
| 생성 실패(v1 포함) | '같은 입력으로 다시 시도' 버튼이 같은 원고·프롬프트로 새 버전을 만든다 |
| `응답에 JSON 객체가 없습니다` | 모델 출력 이상. 다시 시도, 반복되면 `PPT_LLM_MODEL` 변경 |
| `max_tokens(64000)에 잘렸습니다` | 원고 PPT 장 수가 매우 많음. 원고를 나누거나 프롬프트로 장 수를 제한 |
- Vercel 로그: 프론트 `[ppt] 생성 실패 deck=… v…`, ppt-service는 함수 로그에 스택.
- 토큰 사용량과 **추정 비용(USD)** 은 버전 카드에서 본다. 단가표는 `frontend/src/lib/ppt/pricing.ts`(Anthropic API 공시가, 2026-09 기준) — 단가가 바뀌면 이 표만 고친다. 표에 없는 모델은 "단가 미등록". 캐시 적중이 0이면 규칙·카탈로그 블록이 바뀌었거나 5분 넘게 지난 재시도다.

## 5. 공유·Teams·SharePoint
- 공유 링크는 덱마다 하나, 켜고 끌 수 있다. 토큰은 로그·감사에 남지 않는다. 열람은 로그인 필요(소유자·admin은 꺼져 있어도 열림). guest 계정은 403.
- Teams: 개인 알림 채널(설정 → 알림 채널)이 있으면 그리로, 없으면 관리자 채널. 채널 미설정이면 400 `no_channel`. 공유 링크는 전송이 성공한 뒤에만 켜진다. Teams 전송은 성공했지만 공유 켜기에 실패하면 응답에 `warning`이 실리고 화면이 함께 표시한다.
- SharePoint: Microsoft 연결(설정) + 기본 폴더(설정 → SharePoint 업로드 기본 폴더) 필요. RFP와 같은 오류 코드(`not_connected`·`reconnect`·`no_folder`). 업로드 뒤 링크 저장이 실패하면 응답에 `warning`이 담긴다.

## 6. 후속 후보
미리보기 이미지(ppt-service 컨테이너 런타임 + LibreOffice), 레이아웃 갤러리, deck.yaml 직접 편집 후 재빌드, 버전 차이 보기, 관리자 템플릿 교체, Confluence 원고, 공유 열람 기록, Vercel Services GA 시 프로젝트 통합.
