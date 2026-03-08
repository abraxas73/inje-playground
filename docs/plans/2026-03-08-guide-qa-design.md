# 사내 가이드 Q&A — "이럴때는 어떻게 하지?"

> **Status:** ✅ 구현 완료 (2026-03-08) — `feat/guide-qa` 브랜치

**Goal:** Google NotebookLM 기반 사내 규정/가이드 Q&A 시스템 구축 — 어드민이 노트북/소스 관리, 사용자가 탭별 Q&A

**Architecture:** 독립 FastAPI nlm-service(fly.io) + Next.js API Routes 프록시 + Supabase DB. nlm-service는 notebooklm-py로 NotebookLM 연동, Next.js가 프록시하며 Supabase에 메타/이력 저장.

**Tech Stack:** FastAPI, notebooklm-py (Python 3.9+), fly.io, Next.js 16 App Router, Supabase, shadcn/ui, Tailwind CSS 4

## 구현 결과 요약

### 디렉토리 구조 (monorepo)
```
inje-playground/
├── frontend/                  # Next.js 프론트엔드
│   ├── src/app/guide/         # 사용자 Q&A 페이지
│   ├── src/app/guide/admin/   # 어드민 관리 페이지
│   ├── src/app/api/guide/     # API Routes (NLM 프록시 + Supabase)
│   ├── src/components/guide/  # ChatPanel, NotebookTabs, NotebookManager, SourceManager
│   ├── src/lib/nlm-service.ts # NLM 서비스 HTTP 헬퍼
│   └── src/types/guide.ts     # TypeScript 타입 정의
├── nlm-service/               # FastAPI 백엔드 (14 엔드포인트)
│   ├── src/main.py            # FastAPI 앱
│   ├── src/auth.py            # 쿠키 기반 인증 관리
│   └── scripts/               # restart-nlm-service.sh, nlm-login.sh
└── docs/plans/                # 이 문서
```

### Supabase 테이블
- `nlm_notebooks` — 노트북 메타 (is_visible, sort_order)
- `nlm_chat_messages` — 사용자별 대화 이력 (citations JSONB)
- `nlm_sources` — 소스 메타 캐시

### 배포 필요 사항
1. `fly launch` + `fly volumes create nlm_data` + `fly deploy` (nlm-service)
2. `./nlm-service/scripts/nlm-login.sh` (NotebookLM 인증)
3. Vercel에 `NLM_SERVICE_URL=https://inje-nlm-service.fly.dev` 환경 변수 추가

---

## Implementation Plan (아래는 구현 시 사용한 태스크 목록)

---

## Task 1: nlm-service 프로젝트 scaffolding

**Files:**
- Create: `nlm-service/src/__init__.py`
- Create: `nlm-service/src/main.py`
- Create: `nlm-service/src/auth.py`
- Create: `nlm-service/requirements.txt`
- Create: `nlm-service/Dockerfile`
- Create: `nlm-service/fly.toml`
- Create: `nlm-service/scripts/nlm-login.sh`

**Step 1: Create directory structure**

```bash
mkdir -p nlm-service/src nlm-service/scripts
```

**Step 2: Create requirements.txt**

```
fastapi==0.115.0
uvicorn[standard]==0.30.6
httpx==0.27.0
notebooklm-py>=0.1.1
```

**Step 3: Create `nlm-service/src/__init__.py`**

Empty file.

**Step 4: Create `nlm-service/src/auth.py`**

Port from `/Repos/sstva/backend/nlm-service/src/auth.py` — identical logic:
- `NOTEBOOKLM_HOME` env with fallback to project root
- `STORAGE_PATH` = `{NOTEBOOKLM_HOME}/storage_state.json`
- `is_authenticated()` — check SID cookie in storage_state.json
- `get_status()` — return auth status dict
- `get_nlm_client()` — singleton NotebookLMClient from storage
- `reset_client()` — clear singleton
- `disconnect()` — delete storage_state.json

**Step 5: Create `nlm-service/src/main.py`**

FastAPI app with these endpoints (port from sstva reference, keep all existing endpoints):

```python
# Models
class NotebookCreateRequest(BaseModel):
    title: str
    sources: list = []           # [{ sourceName, content }]
    file_sources: list[FileSource] = []
    is_public: bool = False

class ChatRequest(BaseModel):
    notebook_id: str
    question: str
    conversation_id: str | None = None

class AddTextSourceRequest(BaseModel):
    title: str
    content: str

class AddFileFromUrlRequest(BaseModel):
    url: str
    file_name: str = "upload.pdf"

class AddUrlRequest(BaseModel):
    url: str

# Endpoints — same as sstva reference
GET  /health
GET  /auth/status
POST /auth/disconnect
POST /notebook                              # create notebook
DELETE /notebook/{notebook_id}               # NEW: delete notebook
GET  /notebook/{notebook_id}/description     # AI summary + topics
POST /chat                                   # ask question
GET  /notebook/{notebook_id}/history         # conversation history
GET  /notebook/{notebook_id}/sources         # list sources
POST /notebook/{notebook_id}/sources/add-text     # NEW: add text source to existing notebook
POST /notebook/{notebook_id}/sources/add-file     # add file from URL
POST /notebook/{notebook_id}/sources/add-url      # add URL source
DELETE /notebook/{notebook_id}/sources/{source_id} # delete source
```

New endpoints vs sstva:
- `DELETE /notebook/{notebook_id}` — delete notebook via `client.notebooks.delete()`
- `POST /notebook/{notebook_id}/sources/add-text` — add text source to existing notebook

All other endpoints: port directly from sstva `main.py` with minimal changes (rename app title to "Inje NLM Service").

**Step 6: Create `nlm-service/Dockerfile`**

```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Playwright 브라우저 의존성 (notebooklm-py 필요)
RUN pip install playwright && python -m playwright install --with-deps chromium

COPY src/ src/

EXPOSE 8090
CMD ["python", "-m", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8090"]
```

**Step 7: Create `nlm-service/fly.toml`**

```toml
app = "inje-nlm-service"
primary_region = "nrt"

[build]
  dockerfile = "Dockerfile"

[env]
  NOTEBOOKLM_HOME = "/data/nlm-cookies"

[http_service]
  internal_port = 8090
  force_https = true
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

[http_service.concurrency]
  type = "connections"
  hard_limit = 25
  soft_limit = 20

[mounts]
  source = "nlm_data"
  destination = "/data/nlm-cookies"

[[vm]]
  cpu_kind = "shared"
  cpus = 1
  memory = "1024mb"
```

**Step 8: Create `nlm-service/scripts/nlm-login.sh`**

```bash
#!/usr/bin/env bash
# NotebookLM 로그인 — storage_state.json 생성
# 사용: ./scripts/nlm-login.sh [storage_dir]
set -e

STORAGE_DIR="${1:-$(dirname "$0")/..}"
echo "NotebookLM 로그인을 시작합니다..."
echo "Storage directory: $STORAGE_DIR"

NOTEBOOKLM_HOME="$STORAGE_DIR" python -c "
import asyncio
from notebooklm import NotebookLMClient

async def login():
    client = NotebookLMClient()
    async with client:
        print('로그인 성공! storage_state.json이 저장되었습니다.')

asyncio.run(login())
"
```

**Step 9: Verify local startup**

```bash
cd nlm-service
pip install -r requirements.txt
python -m uvicorn src.main:app --host 0.0.0.0 --port 8090 --reload
# GET http://localhost:8090/health → {"status":"ok","service":"nlm"}
```

**Step 10: Commit**

```bash
git add nlm-service/
git commit -m "feat: nlm-service FastAPI scaffolding with notebooklm-py"
```

---

## Task 2: Supabase DB 스키마

**Note:** 이미 migration 적용 완료. 이 태스크는 검증만 수행.

**Files:**
- Verify: Supabase dashboard에서 `nlm_notebooks`, `nlm_chat_messages`, `nlm_sources` 테이블 존재 확인

**Step 1: Verify tables exist**

```sql
SELECT table_name FROM information_schema.tables
WHERE table_schema = 'public' AND table_name LIKE 'nlm_%';
-- Expected: nlm_notebooks, nlm_chat_messages, nlm_sources
```

**Step 2: Commit (skip — already applied via MCP)**

---

## Task 3: Next.js API Routes — 노트북 CRUD

**Files:**
- Create: `src/app/api/guide/notebooks/route.ts`
- Create: `src/app/api/guide/notebooks/[id]/route.ts`
- Create: `src/lib/nlm-service.ts` (NLM service HTTP helper)

**Step 1: Create `src/lib/nlm-service.ts`**

Helper for calling nlm-service (similar pattern to existing `src/lib/dooray.ts`):

```typescript
const NLM_SERVICE_URL = process.env.NLM_SERVICE_URL || "http://localhost:8090";

export async function nlmFetch(path: string, options?: RequestInit) {
  const res = await fetch(`${NLM_SERVICE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.detail || `NLM service error: ${res.status}`);
  }
  return res.json();
}
```

**Step 2: Create `src/app/api/guide/notebooks/route.ts`**

```typescript
// GET  — list notebooks from Supabase (visible only or all for admin)
// POST — create notebook via NLM + save meta to Supabase
```

- `GET`: Query `nlm_notebooks` ordered by `sort_order`. Accept `?visible=true` param for user page.
- `POST`: Call `POST /notebook` on nlm-service → get `notebook_id` → insert into `nlm_notebooks` table with `nlm_notebook_id`, `title`, `description`.

**Step 3: Create `src/app/api/guide/notebooks/[id]/route.ts`**

```typescript
// PATCH — update notebook meta (title, description, is_visible, sort_order) in Supabase
// DELETE — delete notebook from NLM + Supabase
```

- `PATCH`: Update `nlm_notebooks` row. Only Supabase (NLM has no update API).
- `DELETE`: Get `nlm_notebook_id` from Supabase → call `DELETE /notebook/{nlm_notebook_id}` on nlm-service → delete from `nlm_notebooks` (cascade deletes messages + sources).

**Step 4: Commit**

```bash
git add src/lib/nlm-service.ts src/app/api/guide/
git commit -m "feat: Next.js API routes for notebook CRUD"
```

---

## Task 4: Next.js API Routes — 소스 관리

**Files:**
- Create: `src/app/api/guide/notebooks/[id]/sources/route.ts`

**Step 1: Create sources route**

```typescript
// GET    — list sources from NLM (proxy) + sync to Supabase cache
// POST   — add source (text/url/file) to NLM + cache in Supabase
// DELETE — remove source from NLM + Supabase
```

- `GET`: Fetch `nlm_notebook_id` from Supabase → call `GET /notebook/{nlm_id}/sources` on nlm-service → return list. Optionally sync to `nlm_sources` table.
- `POST`: Accept `{ type: "text"|"url"|"file", ...data }`. Route to appropriate nlm-service endpoint (`add-text`, `add-url`, `add-file`). Insert into `nlm_sources`.
- `DELETE`: Accept `?sourceId=X`. Call `DELETE /notebook/{nlm_id}/sources/{sourceId}` → delete from `nlm_sources`.

**Step 2: Commit**

```bash
git add src/app/api/guide/notebooks/[id]/sources/
git commit -m "feat: API routes for notebook source management"
```

---

## Task 5: Next.js API Routes — 채팅 + 이력

**Files:**
- Create: `src/app/api/guide/chat/route.ts`
- Create: `src/app/api/guide/chat/history/route.ts`
- Create: `src/app/api/guide/auth/status/route.ts`

**Step 1: Create `src/app/api/guide/chat/route.ts`**

```typescript
// POST — send question to NLM + save both Q&A to Supabase
```

- Receive `{ notebookId (UUID), question, conversationId? }`.
- Lookup `nlm_notebook_id` from `nlm_notebooks` by UUID.
- Call `POST /chat` on nlm-service with `{ notebook_id: nlm_notebook_id, question, conversation_id }`.
- Save user message + assistant response to `nlm_chat_messages` (with `citations` JSONB).
- Return answer + conversation_id + citations.

**Step 2: Create `src/app/api/guide/chat/history/route.ts`**

```typescript
// GET ?notebookId=X&userEmail=Y — load chat history from Supabase
```

- Query `nlm_chat_messages` where `notebook_id = X` and `user_email = Y`, ordered by `created_at`.

**Step 3: Create `src/app/api/guide/auth/status/route.ts`**

```typescript
// GET — proxy to nlm-service /auth/status
```

**Step 4: Commit**

```bash
git add src/app/api/guide/chat/ src/app/api/guide/auth/
git commit -m "feat: API routes for chat and auth status"
```

---

## Task 6: TypeScript 타입 정의

**Files:**
- Create: `src/types/guide.ts`

**Step 1: Define types**

```typescript
export interface NlmNotebook {
  id: string;                    // Supabase UUID
  nlm_notebook_id: string;       // NotebookLM ID
  title: string;
  description: string | null;
  is_visible: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface NlmSource {
  id: string;
  nlm_source_id: string;
  title: string;
  source_type: "file" | "url" | "text";
}

export interface ChatMessage {
  id: string;
  notebook_id: string;
  user_email: string;
  conversation_id: string | null;
  role: "user" | "assistant";
  content: string;
  citations: Citation[] | null;
  created_at: string;
}

export interface Citation {
  source_id: string;
  citation_number: number;
  cited_text: string;
}

export interface ChatResponse {
  answer: string;
  conversation_id: string;
  turn_number: number;
  references: Citation[];
}
```

**Step 2: Commit**

```bash
git add src/types/guide.ts
git commit -m "feat: TypeScript types for guide Q&A"
```

---

## Task 7: 사용자 페이지 `/guide`

**Files:**
- Create: `src/app/guide/page.tsx`
- Create: `src/components/guide/ChatPanel.tsx`
- Create: `src/components/guide/NotebookTabs.tsx`

**Step 1: Create `src/components/guide/NotebookTabs.tsx`**

Tabs component for visible notebooks:
- Fetch `GET /api/guide/notebooks?visible=true`
- 1개: 탭 없이 선택된 상태로
- 2개+: 수평 탭 UI (shadcn Tabs 컴포넌트 활용)
- 선택 시 부모에 `notebookId` 전달

**Step 2: Create `src/components/guide/ChatPanel.tsx`**

Chat interface component:
- Props: `notebookId: string`, `userEmail: string`
- State: `messages[]`, `conversationId`, `isLoading`, `input`
- Mount: `GET /api/guide/chat/history?notebookId=X&userEmail=Y` → load previous messages
- Send: `POST /api/guide/chat` → append user + assistant messages
- UI: 메시지 목록 (user 오른쪽, assistant 왼쪽) + 인용 표시 + 입력창(Textarea + Send 버튼)
- 추천 질문: `GET /api/guide/notebooks` description에서 suggested topics 표시 (첫 방문 시)
- Markdown 렌더링: 답변에 간단한 markdown 지원

**Step 3: Create `src/app/guide/page.tsx`**

Page layout following existing pattern (ladder/team):
- Header: `HelpCircle` 아이콘 + "이럴때는 어떻게 하지?" 타이틀
- `NotebookTabs` → 선택된 노트북으로 `ChatPanel` 렌더링
- Color scheme: purple/violet 계열 (`from-violet-500 to-purple-600`)
- `animate-fade-up` 등 기존 애니메이션 패턴 적용

**Step 4: Commit**

```bash
git add src/app/guide/ src/components/guide/
git commit -m "feat: guide Q&A user page with chat interface"
```

---

## Task 8: 어드민 페이지 `/guide/admin`

**Files:**
- Create: `src/app/guide/admin/page.tsx`
- Create: `src/components/guide/NotebookManager.tsx`
- Create: `src/components/guide/SourceManager.tsx`

**Step 1: Create `src/components/guide/NotebookManager.tsx`**

Notebook CRUD component:
- List: 모든 노트북 표시 (Card 리스트)
- Create: 제목 + 설명 입력 → `POST /api/guide/notebooks`
- Delete: 확인 다이얼로그 → `DELETE /api/guide/notebooks/[id]`
- Toggle visibility: `is_visible` 토글 스위치 → `PATCH /api/guide/notebooks/[id]`
- Sort order: 드래그 or 숫자 입력 → `PATCH /api/guide/notebooks/[id]`
- 노트북 클릭 시 SourceManager로 전환

**Step 2: Create `src/components/guide/SourceManager.tsx`**

Source CRUD component:
- Props: `notebookId: string`
- List: `GET /api/guide/notebooks/[id]/sources` → 소스 목록 (타입 아이콘 + 제목)
- Add text: 제목 + 내용 텍스트에어리어 → `POST` with `type: "text"`
- Add URL: URL 입력 → `POST` with `type: "url"`
- Add file: 파일 업로드 → Supabase Storage에 업로드 → signed URL 생성 → `POST` with `type: "file"`
- Delete: 확인 → `DELETE`

**Step 3: Create `src/app/guide/admin/page.tsx`**

Admin page:
- superOnly 체크 (기존 패턴: Supabase auth → email === SUPER_USER)
- 2단 레이아웃: 왼쪽 NotebookManager, 선택 시 오른쪽 SourceManager
- 또는 모바일: NotebookManager → 선택 → SourceManager 전환

**Step 4: Commit**

```bash
git add src/app/guide/admin/ src/components/guide/NotebookManager.tsx src/components/guide/SourceManager.tsx
git commit -m "feat: guide admin page for notebook/source management"
```

---

## Task 9: Navigation + Home 페이지 통합

**Files:**
- Modify: `src/components/layout/Navigation.tsx`
- Modify: `src/app/page.tsx`

**Step 1: Update Navigation**

Add to `NAV_ITEMS`:
```typescript
import { HelpCircle } from "lucide-react";
// ...
{ href: "/guide", label: "가이드", icon: HelpCircle },
{ href: "/guide/admin", label: "가이드 관리", icon: HelpCircle, superOnly: true },
```

**Step 2: Update Home page**

Add to `FEATURES`:
```typescript
{
  href: "/guide",
  title: "이럴때는 어떻게 하지?",
  description: "사내 규정, 가이드에 대해 AI에게 질문하고 답변을 받아보세요.",
  icon: HelpCircle,
  gradient: "from-violet-500 to-purple-600",
  bgAccent: "bg-violet-50",
  iconColor: "text-violet-600",
  delay: "delay-300",
  superOnly: false,
},
```

기존 food의 delay를 `delay-[400ms]`로, settings는 `delay-[500ms]`로 조정.

**Step 3: Commit**

```bash
git add src/components/layout/Navigation.tsx src/app/page.tsx
git commit -m "feat: add guide to navigation and home page"
```

---

## Task 10: 환경 변수 + fly.io 배포

**Files:**
- Modify: `.env.local` (add NLM_SERVICE_URL)
- Deploy: `nlm-service/` to fly.io

**Step 1: Add environment variable**

`.env.local`:
```
NLM_SERVICE_URL=http://localhost:8090
```

Production (Vercel):
```
NLM_SERVICE_URL=https://inje-nlm-service.fly.dev
```

**Step 2: Deploy nlm-service to fly.io**

```bash
cd nlm-service
fly launch --name inje-nlm-service --region nrt --no-deploy
fly volumes create nlm_data --region nrt --size 1
fly deploy
```

**Step 3: Run login script on fly.io**

```bash
fly ssh console -C "cd /app && python -c \"
import asyncio
from notebooklm import NotebookLMClient
asyncio.run(NotebookLMClient().login())
\""
```

Or mount storage_state.json via `fly sftp`.

**Step 4: Verify health**

```bash
curl https://inje-nlm-service.fly.dev/health
# {"status":"ok","service":"nlm"}
```

**Step 5: Commit env changes**

```bash
git add .env.example
git commit -m "feat: add NLM_SERVICE_URL env config"
```

---

## Task Summary

| # | Task | Dependencies |
|---|------|-------------|
| 1 | nlm-service scaffolding | — |
| 2 | DB schema verification | — (already done) |
| 3 | API Routes — notebook CRUD | 1, 2 |
| 4 | API Routes — source management | 3 |
| 5 | API Routes — chat + history | 3 |
| 6 | TypeScript types | — |
| 7 | User page `/guide` | 5, 6 |
| 8 | Admin page `/guide/admin` | 3, 4, 6 |
| 9 | Navigation + Home integration | 7, 8 |
| 10 | Env + fly.io deployment | 1 |

**Parallelizable:** Tasks 1, 2, 6 can run in parallel. Tasks 3-5 depend on 1. Tasks 7-8 depend on 3-6. Task 9 depends on 7-8.
