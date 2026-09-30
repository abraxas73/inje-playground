# PPT 만들기 — 설계

> 2026-09-30. 사용자가 원고(텍스트·문서·PPT)와 프롬프트를 넣고 **생성**을 누르면 이노그리드 표준 템플릿(v1.0 최신본, 106장) 규칙을 지킨 PPTX가 나온다. 생성 엔진은 디자인센터가 배포한 Python 패키지(`innogrid-ppt-automation-v1.0`, python-pptx)를 **포팅 없이** Vercel의 별도 FastAPI 프로젝트로 올려 쓴다. 결과물은 서버(Supabase Storage)에 남고, 로그인 사용자용 공유 링크·Teams 공유·SharePoint 업로드로 전달한다. 미리보기 이미지·HTML 다운로드는 이번 범위에서 뺀다(§14).

## 1. 목적과 성공 기준

- **대상**: 로그인한 사내 사용자(user 이상). 제안·보고·소개 자료를 표준 디자인으로 빨리 만들고 싶은 사람.
- **성공 기준**: 원고와 프롬프트를 넣고 생성을 누르면 3분 안에 브랜드 검사(`check.py`)를 통과한 PPTX를 내려받을 수 있고, "3장을 표로 바꿔줘" 같은 피드백으로 다시 만들 수 있으며, 링크·Teams·SharePoint로 동료에게 전달할 수 있다. 모든 생성·재생성은 버전으로 남는다.
- **확정된 값**: 원고 60,000자 상한 · 파일 50MB · 사용자당 동시 생성 1건 · 빌드 오류 자동 수정 최대 4회(2026-10-01, 2회에서 상향 — 빌드가 첫 오류에서 멈춰 장표마다 한 회가 든다) · 상태 폴링 3초 · 14분 넘게 `generating`이면 "멈춘 것 같습니다" 안내(stale 정리 15분, 라우트 maxDuration 800초) · 기본 모델 `claude-sonnet-5-5`(`PPT_LLM_MODEL`로 교체) · 출력 `max_tokens` 64,000(2026-10-01 상향) · 공유 링크는 로그인 필요.
- **비목표**: 슬라이드 이미지 미리보기, HTML 내보내기, 템플릿 파일 편집, 원고 PPT의 장표 순서 변경(패키지 규칙상 금지).

## 2. 범위

포함:
1. 원고 입력 — 텍스트/마크다운 붙여넣기, 문서 파일(docx·pdf·hwp·hwpx·md·txt), **PPT 원고**(장표별 텍스트·그림 추출, 도식 이식).
2. LLM이 원고 → **deck JSON**(패키지의 deck.yaml과 같은 구조) → ppt-service가 빌드·브랜드 검사 → Storage 저장.
3. 빌드 오류(넘침·항목 수 불일치·마무리 문구 누락) 시 **오류난 장표만** 다시 요청(최대 4회, 카탈로그의 그 장표 슬롯 용량표를 붙여서).
4. 피드백 재생성 — 바꾸지 않는 장표는 `{"keep": true}`로 돌려받아 이전 버전에서 채움.
5. 화면 `/ppt`(내 덱), `/ppt/[id]`(버전·구성 보기·다운로드·피드백·공유·Teams·SharePoint), `/ppt/s/[token]`(공유 뷰).
6. 다운로드 PPTX · deck.yaml. 공유 링크(켜기/끄기), Teams 채널 공유, SharePoint 기본 폴더 업로드.
7. 버전 이력(삭제 없음), 호출별 토큰 사용량 표시, 감사 로그(카테고리 `ppt`).

제외(후속 후보, §14): 미리보기 이미지, HTML 다운로드, 레이아웃 갤러리, deck.yaml 직접 편집 후 재빌드, 버전 간 차이 보기, 관리자 템플릿 교체, Confluence 원고 가져오기, 공유 열람 기록·만료, 발표자 노트, 비용 관리 합산.

## 3. 현재 상태와 재사용하는 것

- **패키지**(`innogrid-ppt-automation-v1.0`, 도구 v3.1): `innogrid_ppt/deck.py`의 `build(template_path, spec: dict)`가 dict를 받아 `Deck`을 돌려주고 `deck.save(path)`가 pptx를 쓴다. 본문 장표 **69종**(`tokens.LAYOUTS`, 이름·`desc`·`use`·`arity`·그룹 키·칩 수·마무리 문구 규칙), 제품 장표 5종 + 개요 3종, 별칭 4개. `check.py`의 `check(path)`는 `(slides, issues, grafted)`를 돌려준다(위반 없으면 `issues`가 빈 dict). 권고(`[권고] …`)는 stderr로 찍힌다. 빌드 실패는 `ValueError`/`slots.Overflow`로 한국어 메시지를 낸다. 실측: 83장 3.8초, 산출물 9.8MB(폰트 임베드), 검사 통과. **템플릿 pptx 21MB**는 패키지가 `template/` 아래에서 자동 탐색한다. 빌드에 LibreOffice·폰트 설치는 필요 없다(렌더 확인용).
- **함정**: YAML로 주면 `date: 2026-09-30`이 date 객체로 파싱돼 빌드가 죽는다 → 우리는 JSON으로 주고받는다. `build.py`의 `_resolve_paths`는 yaml 파일 기준 상대경로를 푼다 → 서비스는 절대경로를 넣는다. `T.LAYOUTS`에는 `message`가 없다(별칭으로만 존재, `deck._emit`이 직접 처리).
- **Vercel**: 팀 플랜 Pro. FastAPI zero-config 배포 정식 지원(엔트리포인트 `main.py`의 `app`, `requirements.txt`, 번들 500MB, Python 3.12 기본). 한 프로젝트에 Next.js와 Python을 함께 두는 **Services는 Beta**(2026-08 문서) → 이번엔 쓰지 않는다. Next.js 프로젝트 루트 `api/`에 `.py`를 두면 `/api/*` 전체가 Python으로 가는 충돌이 알려져 있어 쓰지 않는다.
- **재사용**: 문서 파서 `lib/rfp/parse.ts`의 `parseDocumentAsync(buf, fileName)` → `DocumentModel` → `documentText(doc)`(hwp·hwpx·docx·pdf); 서명 업로드 `createSignedUploadUrl` 흐름(`api/rfp/uploads/route.ts`, `lib/rfp/client-upload.ts`); 공유 토큰 `lib/rfp/share.ts`의 `newShareToken()`·`isShareToken(v)`·`shareOrigin(req)`; 권한 `lib/rfp/require-user.ts`의 `requireUser()`; Teams `lib/notify`의 `getNotifier(supabase, "notify", personalNotifyOverrides(userSettings))`·`loadUserSettings(supabase, userId, USER_NOTIFIER_SETTING_KEYS)`; SharePoint `lib/ms/route-token.ts`의 `graphTokenForRoute(admin, userId)`, `lib/rfp/user-folder.ts`의 `loadUserDefaultFolder(admin, userId)`, `lib/ms/graph-drive.ts`의 `uploadFile(token, {driveId, itemId, fileName, buffer, contentType})`, 오류 매핑 `lib/rfp/sharepoint.ts`의 `mapGraphUploadError`; LLM 호출 패턴 `lib/rfp/extract-llm.ts`(`@anthropic-ai/sdk`, `messages.stream` → `finalMessage()`); 감사 `lib/audit.ts`의 `logAudit`; 상태 폴링 패턴 `app/rfp/[id]/page.tsx`(3초 `setInterval`, `after()`로 후속 처리).

## 4. 아키텍처

```
브라우저 ── /ppt ──▶ Next.js (innogrid-playground, Vercel 프로젝트 #1)
                       │ 인증·권한·DB·Storage·공유·Teams·SharePoint
                       │ LLM 호출(after(), maxDuration 300)
                       │ fetch(PPT_SERVICE_URL, { headers: { "x-ppt-token": PPT_SERVICE_TOKEN } })
                       ▼
                    ppt-service (Vercel 프로젝트 #2, FastAPI, Python 3.12, 저장소 ppt-service/)
                       │ innogrid_ppt/ + template/*.pptx + sample.deck.yaml 그대로 번들
                       │ GET /health · GET /catalog · POST /extract · POST /build
                       ▼
                    Supabase Storage 버킷 ppt (비공개) ← 서명 업로드 URL로 직접 PUT
```

- **Next.js가 지휘**한다. 사용자 요청을 받으면 버전 행을 만들고(`status=generating`) 즉시 201을 돌려준 뒤 `after()`에서 원고 정리 → LLM → `/build` → 상태 갱신을 이어 간다. 화면은 3초마다 상태만 묻는다.
- **ppt-service는 무상태**다. 입력은 JSON과 서명 URL(다운로드·업로드), 출력은 작은 JSON. 파일은 Vercel 함수 본문 한도(4.5MB)를 타지 않고 Storage와 직접 주고받는다. 공개 프로젝트지만 `x-ppt-token`이 없거나 다르면 401.
- 미리보기를 나중에 넣을 때는 ppt-service만 컨테이너 런타임(LibreOffice 포함)으로 바꾸면 된다. Services가 GA 되면 두 프로젝트를 하나로 합치는 것도 후속 과제.

## 5. 데이터

### 5.1 `ppt_decks` — 덱(공유 단위)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK default gen_random_uuid() | |
| owner_id | uuid → auth.users(id) on delete set null | 사용자 삭제 뒤에도 덱·버전은 남는다(소유자 없음 → admin만 관리) |
| owner_email | text not null | 목록·공유 화면 표시용 |
| title | text not null | `meta.title` 줄을 공백으로 이은 값. 재생성으로 바뀌면 갱신 |
| share_token | text not null unique | `newShareToken()` — 생성 시 부여 |
| share_enabled | boolean not null default false | 소유자가 켜면 `/ppt/s/[token]` 열람 가능 |
| current_version | int not null default 0 | 마지막 `done` 버전 번호 |
| created_at / updated_at | timestamptz not null default now() | |

### 5.2 `ppt_deck_versions` — 생성·재생성 1회 = 1행(삭제하지 않음)

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | uuid PK | |
| deck_id | uuid not null → ppt_decks(id) on delete cascade | |
| no | int not null | 덱 안 1부터. unique(deck_id, no) |
| status | text not null check in ('generating','building','done','failed') default 'generating' | |
| source_kind | text not null check in ('text','file','pptx') | |
| source_text | text | 붙여넣은 원고 또는 파일에서 추출한 텍스트(60,000자 상한). pptx는 `/extract` 결과 JSON을 문자열로 |
| source_path | text | Storage 경로 `source/{uuid}.{ext}`(파일·pptx) |
| source_name | text | 원본 파일명 |
| prompt | text | 사용자 프롬프트(목적·분량·톤) |
| feedback | text | 재생성 지시(no ≥ 2) |
| base_version | int | 재생성의 기준 버전 번호 |
| deck_json | jsonb | LLM 최종 결과(수정 반영 후) |
| pptx_path | text | `decks/{deck_id}/v{no}/deck.pptx` |
| yaml_path | text | `decks/{deck_id}/v{no}/deck.yaml`(서비스가 JSON→YAML로 함께 저장) |
| slide_count | int | |
| advisories | jsonb | 빌드가 낸 `[권고]` 목록(문자열 배열) |
| check_issues | jsonb | `check.py` 위반 `{slide: [메시지]}` |
| llm_model | text | |
| llm_calls | int not null default 0 | 생성 1 + 수정 재시도 횟수 |
| tokens_in / tokens_out / tokens_cache_read / tokens_cache_write | int not null default 0 | 호출 합계 |
| duration_ms | int | 요청→done/failed |
| error | text | failed 사유(사용자에게 그대로 보임) |
| sharepoint_url / sharepoint_at | text / timestamptz | SharePoint 업로드 결과(§10.3) |
| created_at / finished_at | timestamptz | |

### 5.3 Storage 버킷 `ppt`(비공개, 파일 50MB)

`decks/{deck_id}/v{no}/deck.pptx`, `decks/{deck_id}/v{no}/deck.yaml`, `source/{uuid}.{ext}`(업로드 티켓으로 브라우저가 직접 올림). 읽기는 서버가 300초 서명 URL(`download` 파일명 지정)로만 낸다.

### 5.4 RLS·권한

- 두 테이블 RLS: 소유자 `select`(`owner_id = auth.uid()`), admin 전체 `select`(기존 규약 `exists(select 1 from user_profiles where id = auth.uid() and role = 'admin')`). 쓰기는 service_role만(라우트가 `createAdminClient()`로 처리).
- 페이지 카탈로그(`lib/page-access.ts`): `PAGES`에 `{ key: "ppt", href: "/ppt", label: "PPT 만들기", group: "work", minRole: "user" }`, `pagesForPath`의 routes에 `["/api/ppt", ["ppt"]]`, 그보다 **앞에** `/ppt/s`·`/api/ppt/shared`는 `return []`(프록시는 통과, 라우트가 세션 확인). 홈 `FEATURES` 카드 추가. 감사 카테고리 `ppt`(라벨 "PPT 만들기").

## 6. ppt-service API (FastAPI, `ppt-service/main.py`)

모든 요청은 헤더 `x-ppt-token`이 env `PPT_SERVICE_TOKEN`과 같아야 한다(다르면 401 `{"detail":"unauthorized"}`).

| 메서드·경로 | 입력 | 출력 |
|---|---|---|
| `GET /health` | — | `{ok:true, template_slides:106, layouts:69, package:"v3.1"}` |
| `GET /catalog` | — | §7.2 카탈로그 JSON(프로세스에 캐시) |
| `POST /extract` | `{source_url}`(pptx 서명 다운로드 URL) | `{slides:[{no, texts:[…], title, pictures, has_table, has_chart, title_bottom_cm}]}` |
| `POST /build` | `{spec, source_url?, upload:{pptx_url, yaml_url}, file_name}` | 성공 `{ok:true, slides, advisories:[…], issues:{…}, bytes}` / 실패 422 `{ok:false, kind:"spec"|"overflow"|"template"|"internal", message, section?, slide?}` |

- `/extract`: `Presentation(path)`로 장표마다 텍스트 프레임을 위→아래·좌→우로 모아 `texts`, 첫 텍스트(가장 큰 글자)를 `title`, 그림 수·표·차트 유무, `title_bottom_cm`(상단 25% 안에서 가장 큰 글자 상자의 아래 y, 없으면 `null`)를 낸다. `ponytail: 타이틀 경계는 글자 크기 휴리스틱 — 틀리면 이식 도식이 타이틀과 겹친다. 사용자가 피드백으로 고치는 것을 1차 대응으로 둔다.`
- `/build` 절차: (1) `source_url`이 있으면 `/tmp/{job}/source.pptx`로 받는다. (2) spec 안의 `images: ["src:15:1", …]`("원고 15장의 1번째 그림")를 `media.extract_images(src, out_dir, slide_no=15)`로 뽑은 파일 경로로 바꾸고, `source: {slide: N}`에 `file`(절대경로)과 `from`(`/extract`가 준 `title_bottom_cm`, 없으면 3.2)을 채운다. (3) `deck.build`의 루프를 서비스가 직접 돌린다(§7.5 — 오류난 장표 위치를 알기 위해). stderr를 잡아 `[권고]` 줄을 `advisories`로 모은다. (4) `deck.save`, `check.check` → `issues`. (5) `yaml.safe_dump(spec, allow_unicode=True, sort_keys=False)`를 deck.yaml로. (6) 두 파일을 `upload.*_url`에 PUT(Content-Type pptx MIME / `text/yaml`). (7) `/tmp/{job}` 삭제.
- 오류 종류: 패키지 `ValueError`(항목 수·모르는 장표·필수값) → `spec`, `slots.Overflow` → `overflow`, 템플릿 장 수 불일치 → `template`, 나머지 → `internal`(로그에 스택). `message`는 패키지 메시지 원문(한국어, LLM 수정 요청에 그대로 들어간다).
- 파일: `main.py`, `service/`(`catalog.py`, `extract.py`, `builder.py`, `storage.py`), `innogrid_ppt/`(패키지 원본, 수정 금지), `check.py`, `tools/measure.py`(템플릿 갱신 시 capacity 재생성), `template/INNOGRID_PPT_Template_v1_0_latest.pptx`, `sample.deck.yaml`, `docs/`(패키지 README·에이전트 가이드·TEMPLATE_ANALYSIS·CHANGELOG 이동 — `CLAUDE.md` 이름은 쓰지 않아 자동 로드되지 않게), `requirements.txt`(fastapi, python-pptx, PyYAML, httpx), `.python-version`(3.12), `vercel.json`(`{"framework":"fastapi","regions":["icn1"]}` — `functions` 키는 CLI가 api/ 디렉터리 기준으로 검증해 FastAPI 엔트리에 쓰면 배포가 거부된다), `.vercelignore`(.venv, tests, __pycache__), `tests/test_service.py`, `README.md`(로컬 실행·배포). 폰트 zip·render.py·setup.py·make_sample.py는 넣지 않는다.

## 7. 생성 파이프라인

### 7.1 원고 정리(Next.js, `lib/ppt/source.ts`)

| 입력 | 처리 | `source_text` |
|---|---|---|
| 텍스트/마크다운 | 그대로(60,000자 초과 시 400) | 본문 |
| docx·pdf·hwp·hwpx | `parseDocumentAsync` → `documentText` | 추출 텍스트 |
| md·txt | UTF-8 디코드 | 본문 |
| pptx | `/extract` | `{slides:[…]}` JSON 문자열. LLM에는 "장표 N: 제목 / 본문 줄들 / 그림 k개" 형태로 펼쳐 넣는다 |
| xlsx | 미지원(415 "PPT 원고로 xlsx는 지원하지 않습니다") | — |

파일은 브라우저가 `POST /api/ppt/uploads`로 티켓을 받아 Storage `source/{uuid}.{ext}`에 직접 올리고, 생성 요청에 `storagePath`·`fileName`을 넘긴다(RFP와 동일).

### 7.2 프롬프트와 토큰 최적화(`lib/ppt/prompt.ts`)

시스템 프롬프트는 두 캐시 블록으로 나눈다(`system: [{type:"text", text, cache_control:{type:"ephemeral"}}, …]`).

1. **규칙 블록**(고정, ~2k 토큰): 패키지 CLAUDE.md §2·§3의 편집 규칙을 압축한 것 — 장표 고르기 3단계(무엇을 보여주는가 → 항목 관계 → 단 수는 이름의 일부), 타이틀 두 줄 "~합니다." 규칙, 불릿 3~4개·마침표 없음·"~니다" 금지, `closing`·`summary` 필수 두 줄 이내, `[[강조]]`, 표는 행·열 데이터에만, 차트 항목 ≤5, 목차 있으면 변경 금지, 섹션 ≤8·하위 섹션 ≤5, 원고가 PPT면 장 수·순서 유지 + 도식 장표는 `free-title` + `source` + 요약 장 한 장, 이미지형은 그림 있을 때만(`images`는 `"src:장:번호"`), 출력은 JSON 하나·설명 없음.
2. **카탈로그 블록**(고정, ~8~10k 토큰): `GET /catalog`가 만든다. 장표마다 `name · slide · arity · desc · use · closing(필수 여부·최대 줄) · chips(칩 수) · example`. `example`은 `sample.deck.yaml`에서 그 장표의 슬라이드를 꺼내 문자열을 `"…"`, 문자열 리스트를 `["…","…"]`(길이 유지), 숫자는 그대로 둔 **골격**이다 — 키와 개수만 남아 정확하고 짧다. 제품 장표(`product`·`product-features` + 제품 5종, `tafa`·`tafa-layers`·`lineup`)와 `message`도 포함. Next.js는 카탈로그를 프로세스 메모리에 캐시하고 실패 시 요청마다 다시 받는다.

사용자 메시지도 두 블록: **원고 블록**(캐시 — 재시도·재생성이 같은 원고를 다시 쓴다)과 **지시 블록**(프롬프트·메타 힌트: 제목·부서·오늘 날짜 `YYYY. MM. DD`·`ver "01"`). 캐시 TTL은 5분이라 재시도는 대부분 적중하고, 피드백은 시간이 지나면 원고 블록이 미스라도 규칙·카탈로그는 적중한다.

패키지 CLAUDE.md 원문(41KB)·sample.deck.yaml 원문(74KB)은 넣지 않는다. `thinking: {type:"adaptive"}`, `max_tokens: 16000`. 응답 `usage`의 `input_tokens`·`output_tokens`·`cache_read_input_tokens`·`cache_creation_input_tokens`를 버전 행에 누적한다.

### 7.3 deck JSON(`lib/ppt/deck-json.ts`)

```ts
type DeckJson = {
  meta: { title: string[]; subtitle?: string; ver?: string; date?: string; dept?: string; author?: string; body_only?: boolean };
  sections: { name: string; subs?: string[]; label?: string; slides: SlideJson[] }[];
};
type SlideJson = { layout: string; sub?: string; [key: string]: unknown } | { keep: true };
```

zod는 이 골격만 검사한다(`layout` 문자열, `sections` 1~8개, 각 `slides` 1개 이상). 장표별 키 검증은 ppt-service 빌드가 한다 — 패키지가 이미 정확한 메시지를 내므로 중복 구현하지 않는다. `meta.date`는 문자열로 강제, 없으면 서버가 오늘 날짜를 넣는다.

### 7.4 첫 생성 흐름(`lib/ppt/generate.ts`)

1. `POST /api/ppt/decks` → `requireUser()` → 동시 생성 검사(`status in ('generating','building')`인 내 버전이 있으면 409) → `ppt_decks` + `ppt_deck_versions(no=1, status=generating)` insert → 201 `{deckId}` → `after(run)`.
2. `run`: 원고 정리(§7.1) → LLM 호출 → JSON 파싱·zod → `status=building` → `/build`(서명 업로드 URL 2개는 Next.js가 `createSignedUploadUrl`로 발급).
3. `/build`가 422 `spec`·`overflow`를 돌려주면 **수정 호출**: 같은 캐시 프리픽스 + `assistant`(이전 JSON) + `user`("섹션 i 장표 j에서 빌드 오류: <message>. 이 장표만 고쳐 `{\"slide\": {...}}`로 답하라. 항목 수를 바꿔야 하면 카탈로그의 같은 계열 다른 단 수 장표를 쓰라") → 해당 위치만 교체 → 다시 `/build`. 최대 4회, 그래도 실패면 `status=failed, error=message`, 마지막 덱은 `deck_json`에 남긴다.
4. 성공: `deck_json`·경로·`slide_count`·`advisories`·`check_issues`·토큰·`duration_ms` 저장, `status=done`, `ppt_decks.title`·`current_version` 갱신, 감사 "PPT 생성"(detail: deckId, no, slides, tokens).
5. 예외는 모두 `status=failed, error`로 남기고 감사 "PPT 생성 실패".

### 7.5 ppt-service의 빌드 루프(`service/builder.py`)

`deck.build()`와 같은 순서(표지 → 목차 → 섹션마다 간지 → 장표 → 뒷표지 → `_lint`)를 서비스가 돌리되 장표마다 `try/except`로 `(section_index, slide_index)`를 붙여 다시 던진다. `body_only`·라벨 규칙(`01. 섹션명 : 하위섹션명`)·`message`·`product` 분기는 `deck._emit`·`deck.resolve`를 그대로 호출해 규칙 구현을 중복하지 않는다. `ponytail: deck.build 20줄과 같은 루프를 한 번 복제한 것 — 패키지가 슬라이드 위치를 예외에 담아 주면 지운다.`

### 7.6 피드백 재생성

1. `POST /api/ppt/decks/[id]/regenerate` `{feedback, baseVersion?}` → 소유자 확인 → 동시 생성 검사 → 새 버전 행(`no = max+1`, `base_version`, `source_*`는 기준 버전에서 복사) → 201 → `after(run)`.
2. LLM 메시지: 규칙·카탈로그(캐시) + 원고 블록(캐시) + `assistant`(기준 버전 `deck_json`) + `user`("다음 지시를 반영해 전체 덱 JSON을 다시 내라. **바꾸지 않는 장표는 `{\"keep\": true}`로만** 적어라(같은 섹션의 같은 순번을 유지한다는 뜻). 섹션을 추가·삭제·순서 변경했다면 그 섹션 안의 장표는 전부 다시 적어라.").
3. 서버가 `keep`을 기준 버전의 같은 `(section, slide)` 위치로 채운다. 위치가 없으면(섹션 수가 달라진 경우) 한 번 더 "keep 없이 전체를" 요청한다. 이후는 §7.4의 3~5와 같다.

## 8. 화면

### 8.1 `/ppt` — 내 덱

- 상단 카드 "새로 만들기": 탭 **텍스트**(textarea, 글자 수 표시) / **파일**(드롭존, docx·pdf·hwp·hwpx·pptx·md·txt, 50MB), 공통 입력 **프롬프트**(placeholder: "경영진 보고용, 12장 이내, 결론 먼저"), 선택 입력 제목·부서(비우면 LLM이 원고에서 정하고, 부서는 "부서명"으로 남는다는 안내). 버튼 **생성** → 201 후 `/ppt/[id]`로 이동.
- 아래 표: 내 덱 목록(제목·최신 버전·장 수·상태·수정일·공유 켜짐 배지). admin은 "전체 보기" 토글.

### 8.2 `/ppt/[id]` — 덱 상세

- 헤더: 제목, 소유자, 버전 탭(v1·v2…, 상태 배지 `생성 중`/`빌드 중`/`완료`/`실패`).
- 진행 중이면 3초 폴링(`GET /api/ppt/decks/[id]?fields=status`), 6분 넘으면 안내문.
- **구성 보기**(이미지 미리보기 대체): `deck_json`을 장표 카드로 렌더 — 섹션 간지, 각 장표의 레이아웃 배지·타이틀 두 줄·항목(cards/items/steps/panels/rows/kpis/notes/lower/tables/chart)·headline/closing/summary/note. `lib/ppt/storyboard.ts`가 알려진 키를 순서대로 뽑는 제너릭 뷰 모델(`{ layout, title, groups: {label, items: {title?, body: string[]}[]}[], footer: string[] }`).
- 오른쪽 패널: **다운로드**(PPTX·deck.yaml — 300초 서명 URL), **권고**(`advisories`)·**브랜드 검사**(`check_issues`, 비어 있으면 "통과"), **토큰**(입력·출력·캐시 적중·호출 수·소요 시간), **공유**(스위치 + 링크 복사), **Teams로 공유**, **SharePoint 업로드**(기본 폴더 이름 표시, 없으면 `/settings` 링크).
- 하단: **피드백** textarea + "이 지시로 다시 만들기"(기준 = 보고 있는 버전).
- 실패 버전: `error` 원문 + "같은 입력으로 다시 시도" 버튼(새 버전, feedback 없음).

### 8.3 `/ppt/s/[token]` — 공유 뷰(로그인 필요)

제목·소유자·장 수·구성 보기·PPTX 다운로드. 세션 없으면 `/login?returnTo=…`로 보낸다. `share_enabled=false`면 404("공유가 꺼져 있습니다"). 소유자·admin은 항상 열 수 있다.

## 9. API (Next.js, 모두 `runtime="nodejs"`)

| 메서드·경로 | 권한 | 동작 |
|---|---|---|
| `POST /api/ppt/uploads` | user | `{fileName, sizeBytes}` → `{storagePath, token, signedUrl}`(버킷 ppt, `source/…`) |
| `GET /api/ppt/decks?all=1` | user(admin은 all) | 내 덱 목록 + 최신 버전 요약 |
| `POST /api/ppt/decks` | user | `{sourceKind, text?, storagePath?, fileName?, prompt, title?, dept?}` → 201 `{deckId}`; `maxDuration=300` |
| `GET /api/ppt/decks/[id]?fields=status` | 소유자·admin | 덱 + 버전 목록(`fields=status`면 상태만) |
| `DELETE /api/ppt/decks/[id]` | 소유자·admin | 덱·버전·Storage 파일 삭제, 감사 "PPT 삭제" |
| `POST /api/ppt/decks/[id]/regenerate` | 소유자 | `{feedback, baseVersion?}` → 201 `{no}`; `maxDuration=300` |
| `GET /api/ppt/decks/[id]/versions/[no]/file?kind=pptx\|yaml` | 소유자·admin | 300초 서명 URL(파일명 `{title}_v{no}.pptx`) |
| `PUT /api/ppt/decks/[id]/share` | 소유자 | `{enabled}` → 감사 "PPT 공유 켬/끔" |
| `POST /api/ppt/decks/[id]/teams` | 소유자 | §10.2 |
| `POST /api/ppt/decks/[id]/sharepoint` | 소유자 | §10.3; `maxDuration=60` |
| `GET /api/ppt/shared/[token]` | 세션 필수 | 덱 요약 + `deck_json`(내부 필드 제거) |
| `GET /api/ppt/shared/[token]/file` | 세션 필수 | 최신 버전 PPTX 서명 URL |

## 10. 공유·Teams·SharePoint

### 10.1 공유 링크
덱 생성 시 `share_token`을 부여하고 `share_enabled=false`로 둔다. 소유자가 켜면 `{origin}/ppt/s/{token}`(origin은 `shareOrigin(req)`). 토큰은 로그·감사 detail에 남기지 않는다. 프록시는 `/ppt/s`·`/api/ppt/shared`를 통과시키고, 라우트가 `createServerSupabase().auth.getUser()`로 세션을 확인해 없으면 401 `{code:"login_required"}`(페이지는 로그인으로 리디렉션).

### 10.2 Teams 공유
`loadUserSettings(supabase, userId, USER_NOTIFIER_SETTING_KEYS)` → `getNotifier(supabase, "notify", personalNotifyOverrides(userSettings))`. `channelConfigured`가 아니면 400 "Teams 알림 채널이 설정되지 않았습니다(설정 → 알림 채널)". 메시지 `{title: "PPT 만들기", text: "[PPT] {제목} ({장 수}장, v{no}) — {소유자}\n{공유 링크 또는 '공유 링크가 꺼져 있습니다'}\n{SharePoint 링크가 있으면 한 줄}"}`. 공유가 꺼져 있으면 보내기 전에 켤지 확인 대화상자를 띄운다(기본: 켜고 보냄). 감사 "PPT Teams 공유".

### 10.3 SharePoint 업로드
`graphTokenForRoute(admin, userId)` → 실패 응답 그대로(`not_connected`/`reconnect`/설정 누락) → `loadUserDefaultFolder(admin, userId)`가 null이면 400 `{code:"no_folder", error:"SharePoint 기본 폴더를 먼저 설정하세요(설정)"}` → Storage에서 PPTX 다운로드 → `uploadFile(token, {driveId, itemId, fileName: "{title}_v{no}.pptx", buffer, contentType: "application/vnd.openxmlformats-officedocument.presentationml.presentation"})` → `{webUrl, name}` 응답, 버전 행 `sharepoint_url`·`sharepoint_at`(컬럼 2개 추가) 저장, 감사 "PPT SharePoint 업로드"(detail: deckId, no, fileName). Graph 오류는 `mapGraphUploadError`. 화면은 RFP `SharePointSection`처럼 `not_connected`→연결 버튼, `reconnect`→재연결 버튼, `no_folder`→설정 링크.

## 11. 오류 처리

| 상황 | 처리 |
|---|---|
| `ANTHROPIC_API_KEY` 없음 | `GET /api/ppt/decks`가 `llmAvailable:false` → 화면은 생성 카드 대신 "관리자에게 문의" 안내(기존 규칙: 비활성 버튼 금지) |
| ppt-service 미응답·5xx | 버전 `failed`, error "PPT 서비스에 연결할 수 없습니다" ; 30초 타임아웃(`AbortSignal.timeout`) |
| LLM 응답이 JSON이 아님·`stop_reason=max_tokens` | 1회 재요청("JSON만"), 다시 실패면 `failed` |
| 빌드 오류 4회 수정 후에도 실패 | `failed`, error = 패키지 메시지 원문 → 사용자는 피드백으로 재생성(예: "3장을 card-3으로") |
| 원고 pptx가 106장 템플릿 원본 | 그대로 진행(원고일 뿐). 산출물 템플릿 검증은 패키지가 함 |
| 동시 생성 | 409 "진행 중인 생성이 끝난 뒤 다시 시도하세요" |
| Storage 서명 URL 발급 실패 | 500, 버전 `failed` |
| `after()`가 300초를 넘김 | 버전이 `generating`으로 남음 → 화면은 6분 뒤 안내, 다음 생성 요청 때 6분 넘은 `generating`은 `failed("시간 초과")`로 정리(RFP reextract 규칙) |

## 12. 보안

- ppt-service: 토큰 헤더 비교(`hmac.compare_digest`), 요청 본문 2MB 제한, `source_url`·`upload.*_url`은 `NEXT_PUBLIC_SUPABASE_URL` 호스트만 허용, `/tmp` 작업 폴더는 요청 끝에 삭제.
- Next.js: 소유자·admin만 덱 조회, 공유 뷰는 세션 필수, 서명 URL 300초, 토큰·서명 URL은 감사 detail에 넣지 않음. 원고 텍스트는 DB에 저장(RLS 소유자·admin).
- 환경변수: Vercel 프로젝트 #1 `PPT_SERVICE_URL`, `PPT_SERVICE_TOKEN`, `PPT_LLM_MODEL`(선택); 프로젝트 #2 `PPT_SERVICE_TOKEN`(같은 값, `openssl rand -hex 32`). 로컬 `frontend/.env.local`에 `PPT_SERVICE_URL=http://localhost:8091`.

## 13. 테스트

- vitest(`frontend/src/lib/__tests__/ppt-*.test.ts`): 카탈로그 골격 변환(문자열→"…", 리스트 길이 유지), 규칙 블록에 금지어·필수 규칙 문구 포함, 시스템 블록 2개에 `cache_control`, 원고 펼치기(pptx extract → 텍스트), zod 골격 검증(섹션 0개·9개 거부), `keep` 병합(정상·위치 없음), 수정 응답 교체(`{slide}` → 해당 위치), 스토리보드 뷰 모델(card-4·table·chart-donut·message 입력), 요청 검증(60,000자·xlsx 415·동시 생성 409), 공유 라우트(세션 없음 401·꺼짐 404), Teams 메시지 문구, SharePoint 파일명.
- pytest(`ppt-service/tests/test_service.py`, 로컬 venv): `/health`, `/catalog`에 69종+message+product, 최소 덱 `/build` 성공(업로드 URL은 로컬 파일 핸들러로 대체), 항목 수 불일치 spec 오류에 `section`·`slide` 위치, `x-ppt-token` 없으면 401, `/extract`가 샘플 pptx의 장표 수·title을 낸다.
- 수동: 운영 배포 후 텍스트 원고 1건 생성 → PPTX 열어 확인 → 피드백 재생성 → Teams·SharePoint 1회.

## 14. 후속 후보(이번 범위 밖)

1. **미리보기 이미지** — ppt-service를 컨테이너 런타임(LibreOffice·Pretendard)으로 바꾸고 `/render` 추가. 브라우저 갤러리 + 이미지 뷰어 HTML 다운로드.
2. **레이아웃 갤러리** — 66종 썸네일(1회 렌더해 정적 이미지로 저장)로 "이 장표로 바꿔줘" 피드백을 돕는다.
3. **deck.yaml 직접 편집 → 재빌드** — LLM 없이 `/build`만 호출(토큰 0).
4. **버전 간 차이 보기**, **관리자 템플릿 교체**(업로드 → `tools/measure.py` 재실행), **Confluence 페이지 URL 원고**(Atlassian 연동 재사용), **공유 열람 기록·만료**, **발표자 노트 생성**, **덱별 토큰 비용을 비용 관리 화면에 합산**, **Vercel Services GA 시 두 프로젝트 통합**.

## 15. 결정 사항 요약

| 결정 | 이유 |
|---|---|
| 별도 Vercel FastAPI 프로젝트(Fly 아님) | 상시 비용 0, 기존 인프라 안, Python 패키지 무포팅. Services는 Beta라 운영 배포 경로에 걸지 않음 |
| 미리보기·HTML 제외 | LibreOffice가 필요한 유일한 단계. 컨테이너 런타임으로 후속 |
| JSON 주고받기 | YAML date 파싱 함정 회피, zod 검증, 패키지는 dict를 받음 |
| 카탈로그 = sample.deck.yaml 골격 자동 생성 + 캐시 | 69종 키를 손으로 안 적음, 템플릿 갱신 시 자동 반영, 캐시로 매 호출 비용 미미 |
| 오류 장표만 수정 · keep 패치 | 출력 토큰(가장 비쌈)을 줄임 |
| 공유 링크 로그인 필요 | 고객 정보가 든 덱의 외부 유출 방지. 외부 전달은 SharePoint |
| 버전 행 삭제 없음 | 이력·토큰 사용량 추적 |
