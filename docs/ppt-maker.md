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
| innogrid-playground | `PPT_LLM_MODEL`(선택) | 기본 `claude-sonnet-5-5` |
| innogrid-playground | `ANTHROPIC_API_KEY` | 없으면 화면이 안내문만 보인다 |
| innogrid-ppt-service | `SUPABASE_URL` | 서명 URL 호스트 제한용 |

## 3. 배포
- 프론트: 평소처럼 `frontend/`에서 `NODE_OPTIONS= vercel deploy --prod --yes`.
- ppt-service(Python이 바뀔 때만): `cd ppt-service && vercel deploy --prod --yes`, 이어서 `curl -H "x-ppt-token: $TOKEN" https://innogrid-ppt-service.vercel.app/health`가 `{"ok":true,"templateSlides":106,"layouts":69,…}`.
- 템플릿 갱신: `ppt-service/template/`의 pptx 교체 → `python tools/measure.py` → `pytest` → 배포. `/catalog`는 프로세스 캐시라 프론트 재배포 없이 새 인스턴스부터 반영된다.

## 4. 생성이 실패하면
| 화면 오류 | 원인·조치 |
|---|---|
| `PPT 서비스에 연결할 수 없습니다` | ppt-service 배포·`PPT_SERVICE_URL`·토큰 확인(`/health`) |
| `'…'는 항목 N개 고정인데 …` / `슬롯이 넘친다` | LLM이 2회 수정 뒤에도 실패. 피드백으로 "N장을 card-3으로", "불릿을 줄여" 등 지시해 재생성 |
| `템플릿이 106장이어야 하는데` | ppt-service 템플릿 파일 손상·교체 오류. `template/` 확인 |
| `시간 초과(6분)` | Vercel 함수 300초 초과(원고가 매우 길 때). 원고를 줄이거나 나눠서 |
| `응답에 JSON 객체가 없습니다` | 모델 출력 이상. 다시 시도, 반복되면 `PPT_LLM_MODEL` 변경 |
- Vercel 로그: 프론트 `[ppt] 생성 실패 deck=… v…`, ppt-service는 함수 로그에 스택.
- 토큰 사용량은 버전 카드(입력·출력·캐시 적중)에서 본다. 캐시 적중이 0이면 규칙·카탈로그 블록이 바뀌었거나 5분 넘게 지난 재시도다.

## 5. 공유·Teams·SharePoint
- 공유 링크는 덱마다 하나, 켜고 끌 수 있다. 토큰은 로그·감사에 남지 않는다. 열람은 로그인 필요(소유자·admin은 꺼져 있어도 열림). guest 계정은 403.
- Teams: 개인 알림 채널(설정 → 알림 채널)이 있으면 그리로, 없으면 관리자 채널. 채널 미설정이면 400 `no_channel`. 공유 링크는 전송이 성공한 뒤에만 켜진다. Teams 전송은 성공했지만 공유 켜기에 실패하면 응답에 `warning`이 실리고 화면이 함께 표시한다.
- SharePoint: Microsoft 연결(설정) + 기본 폴더(설정 → SharePoint 업로드 기본 폴더) 필요. RFP와 같은 오류 코드(`not_connected`·`reconnect`·`no_folder`). 업로드 뒤 링크 저장이 실패하면 응답에 `warning`이 담긴다.

## 6. 후속 후보
미리보기 이미지(ppt-service 컨테이너 런타임 + LibreOffice), 레이아웃 갤러리, deck.yaml 직접 편집 후 재빌드, 버전 차이 보기, 관리자 템플릿 교체, Confluence 원고, 공유 열람 기록, Vercel Services GA 시 프로젝트 통합.
