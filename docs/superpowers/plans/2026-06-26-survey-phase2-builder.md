The actual `admin/layout.tsx` (4-item `ADMIN_NAV`, no `ClipboardList`) confirms the critique: the import line and nav array are exactly what both Phase1 Task8 and Phase2 Task5 target. I'm resolving the high-severity conflict by making Task5 idempotent (grep-gated, no line-number assumptions), so it works whether or not Phase1 already registered the nav, and updating the footer to acknowledge the shared ownership. All other tasks already conform to the frozen contract and writing-plans format. Here is the final plan.

# Phase 2 — 관리자 설문 빌더 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Execute each Task in order, one subagent per Task. Track progress with the checkboxes (`- [ ]`) inside each Task — check a box only after its step's stated command produces the stated expected output. Every code step contains the full literal code to write; never summarize, never write "as in Task N". Commit at the end of every Task. Do not start a Task until the previous Task's final `npm run build` + `npm run lint` pass.

**Goal:** 관리자가 `/admin/surveys`에서 설문을 생성하고, 문항을 추가·타입편집·config편집·순서변경·섹션지정·삭제하고, 상태를 `draft → open`으로 전환해 응답을 받을 수 있게 한다. 이 Phase가 끝나면 관리 API 6엔드포인트(설문 CRUD + 문항 CRUD/reorder)와 범용 빌더 UI(타입선택기·인라인편집·config편집기·드래그/버튼 순서변경)가 동작하고, Playwright E2E로 "새 설문 생성 → 문항 3종 추가 → 순서변경 → open 전환 → 노출 확인" 플로우가 통과한다.

**Architecture:** Next.js 16 App Router(React 19) `"use client"` 페이지 + Route Handler API. 서버 인증은 `createServerSupabase()` + `auth.getUser()` + `user_profiles.role` admin 게이트(`app/api/admin/chat-history/route.ts` 패턴 그대로, 401/403). 동적 라우트는 `{ params }: { params: Promise<{ id: string }> }` + `await params`. 쓰기는 Supabase JS 직접 INSERT/UPDATE/DELETE(관리 테이블 RLS는 `private.is_admin()`로 통제). 빌더는 신규 라이브러리 0개 — HTML5 native drag + 보조 up/down 버튼. 모든 타입/시그니처는 동결 계약(`@/types/survey`, `@/lib/survey`)을 글자 그대로 Consumes.

**Tech Stack:** Next.js 16.1.6 · React 19.2.3 · TypeScript strict · Tailwind CSS 4 · shadcn/ui(button, input, label, textarea, select, switch, checkbox, card, badge, separator, dialog, alert-dialog) · lucide-react · Supabase(@supabase/ssr) · Vitest(순수로직, Phase1 도입) · Playwright(E2E, Phase1 도입).

## Global Constraints

- config 키는 **snake_case만** — `min_label`/`max_label`/`mid_label`/`before_label`/`after_label`/`allow_other`/`analysis_metric`/`top_box`/`segment`/`ordinal`/`target`/`option_midpoints`.
- 쓰기는 응답계열만 `submit_survey_response` RPC 단일 경로(Phase1). **관리 테이블(`surveys`/`survey_questions`) 쓰기는 admin 게이트 통과 후 Supabase JS 직접 호출**(RLS `private.is_admin()`가 2차 통제).
- row 타입은 전부 `updated_at` 포함, timestamptz는 ISO `string`, nullable은 `| null`.
- admin 게이트는 `chat-history/route.ts` 패턴 그대로(`auth.getUser()` 없음 → 401 `{error}`, `user_profiles.role !== "admin"` → 403 `{error}`). 동적 라우트 `await params` 필수. 에러 응답 공통 shape `{ error: string }`.
- slug 형식 `^[a-z0-9][a-z0-9-]*$`(DB check 일치). slug 중복 → 409. status 전이 위반 → 409.
- status 전이 허용: `draft→{draft,open}`, `open→{open,closed}`, `closed→{closed,open}`. 그 외 409.
- 제출 완료 응답 불변(결정 #10) — 본 Phase는 관리 메타/문항만 다루며 응답행은 건드리지 않는다.
- 신규 차트/dnd/엑셀 라이브러리 **0개**. 순서변경은 HTML5 native drag + up/down 버튼.
- 문항 기본 config는 `default_config_for(type)`(Phase1 `@/lib/survey`) 단일 출처. 타입 선택기·렌더러 분기는 `QUESTION_TYPE_META`(Phase1) 참조.
- `config.analysis_metric` 미태깅 문항은 분석에서 "미설정"(Phase3). 본 Phase는 태깅 UI만 제공.
- **진입점 멱등성:** `admin/layout.tsx`의 `ADMIN_NAV` "설문 관리" 항목 + `ClipboardList` import는 Phase1 Task8과 본 Phase Task5가 공동 후보다. 단일 소유자를 가정하지 않고, **Task5는 grep으로 기존 등록 여부를 먼저 확인한 뒤 미등록일 때만 추가하는 멱등 절차**로 수행한다(라인 번호 앵커 금지). 이미 Phase1이 등록했으면 Task5는 nav/import를 건드리지 않고 목록 페이지 생성만 한다.
- 모든 npm 명령은 `frontend/` 기준. 타입 `npm run build`, 품질 `npm run lint`, E2E `npm run test:e2e`.

**Phase 1 Consumes (전제 — 이미 존재):**
- `/Users/seunguk.kang/Repos/inje-playground/frontend/src/types/survey.ts` — §1 전체 타입 계약(`Survey`, `SurveyQuestion`, `SurveyWithQuestions`, `QuestionType`, `QuestionConfig`, `SurveyStatus`, `SurveyAccessMode`).
- `/Users/seunguk.kang/Repos/inje-playground/frontend/src/lib/survey.ts` — `QUESTION_TYPE_META`, `default_config_for(type)`.
- DB 마이그레이션 `survey_system_init` 적용 완료(`surveys`/`survey_questions`/`survey_responses`/`survey_answers` + RLS + RPC).
- `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/surveys/[slug]/route.ts` — 공개 조회 API(노출 확인 E2E에서 Consumes).
- `vitest.config.ts`, `playwright.config.ts`, `package.json` scripts(`test`, `test:e2e`).
- **(가능) `admin/layout.tsx` 진입점 일부:** Phase1 Task8이 `ClipboardList` import + `ADMIN_NAV` "설문 관리" 항목을 이미 추가했을 수 있다. Task5는 이를 멱등하게 처리한다.

---

## Task 1: 관리 API — `GET/POST /api/admin/surveys` (목록 + 생성)

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/surveys/route.ts`

**Interfaces**
- Consumes: `Survey`, `SurveyAccessMode` from `@/types/survey`; `createServerSupabase()` from `@/lib/supabase-server`.
- Produces:
  - `GET /api/admin/surveys?status=draft|open|closed` → `200 { items: SurveyListItem[] }`, `SurveyListItem = Survey & { response_count: number; complete_count: number }`.
  - `POST /api/admin/surveys` body `{ slug: string; title: string; description?: string; access_mode?: SurveyAccessMode; is_anonymous?: boolean }` → `200 Survey`; `400` slug 형식, `409` slug 중복.

**Steps**

- [ ] 1.1 — 최소 구현: 라우트 파일 작성.

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/surveys/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { SurveyAccessMode } from "@/types/survey";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** GET /api/admin/surveys — 설문 목록 + 응답 카운트 (admin only) */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const { data: caller } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (caller?.role !== "admin") {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const status = request.nextUrl.searchParams.get("status");

    let query = supabase
      .from("surveys")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (status) {
      query = query.eq("status", status);
    }

    const { data: surveys, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const ids = (surveys ?? []).map((s) => s.id);
    const counts: Record<string, { response_count: number; complete_count: number }> = {};
    if (ids.length > 0) {
      const { data: responses } = await supabase
        .from("survey_responses")
        .select("survey_id, is_complete")
        .in("survey_id", ids);
      for (const r of responses ?? []) {
        const c =
          counts[r.survey_id] ??
          (counts[r.survey_id] = { response_count: 0, complete_count: 0 });
        c.response_count += 1;
        if (r.is_complete) c.complete_count += 1;
      }
    }

    const items = (surveys ?? []).map((s) => ({
      ...s,
      response_count: counts[s.id]?.response_count ?? 0,
      complete_count: counts[s.id]?.complete_count ?? 0,
    }));

    return NextResponse.json({ items });
  } catch (err) {
    const message = err instanceof Error ? err.message : "설문 목록 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/admin/surveys — 설문 생성 (admin only) */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabase();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
    }
    const { data: caller } = await supabase
      .from("user_profiles")
      .select("role")
      .eq("user_id", user.id)
      .single();
    if (caller?.role !== "admin") {
      return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
    }

    const body = await request.json();
    const slug = String(body.slug ?? "").trim();
    const title = String(body.title ?? "").trim();
    const description: string | null = body.description ? String(body.description) : null;
    const accessMode: SurveyAccessMode =
      body.access_mode === "public" ? "public" : "authenticated";
    const isAnonymous: boolean = body.is_anonymous === true;

    if (!slug || !SLUG_RE.test(slug)) {
      return NextResponse.json(
        { error: "slug는 영소문자/숫자/하이픈만 가능하며 영숫자로 시작해야 합니다." },
        { status: 400 }
      );
    }
    if (!title) {
      return NextResponse.json({ error: "title은 필수입니다." }, { status: 400 });
    }

    const { data: existing } = await supabase
      .from("surveys")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ error: "이미 사용 중인 slug입니다." }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("surveys")
      .insert({
        slug,
        title,
        description,
        access_mode: accessMode,
        is_anonymous: isAnonymous,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "이미 사용 중인 slug입니다." }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "설문 생성에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] 1.2 — 타입 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build`. 기대: `✓ Compiled successfully`, 에러 0.
- [ ] 1.3 — 품질 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run lint`. 기대: 신규 에러 0.
- [ ] 1.4 — 커밋: `cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/app/api/admin/surveys/route.ts && git commit -m "feat(survey): admin surveys list/create API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. 기대: 1 file changed.

---

## Task 2: 관리 API — `GET·PATCH·DELETE /api/admin/surveys/[id]`

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/surveys/[id]/route.ts`

**Interfaces**
- Consumes: `SurveyWithQuestions`, `SurveyStatus`, `SurveyAccessMode` from `@/types/survey`.
- Produces:
  - `GET` → `200 SurveyWithQuestions`; `404` 미존재.
  - `PATCH` body 부분 `{ title?; description?; status?: SurveyStatus; access_mode?; is_anonymous?; opens_at?; closes_at?; slug?; sort_order? }` → `200 Survey`; `409` status 전이/slug 중복.
  - `DELETE` → `200 { ok: true }`(cascade).

**Steps**

- [ ] 2.1 — 최소 구현: 라우트 파일 작성.

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/surveys/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { SurveyStatus } from "@/types/survey";

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

const ALLOWED_STATUS_TRANSITIONS: Record<SurveyStatus, SurveyStatus[]> = {
  draft: ["draft", "open"],
  open: ["open", "closed"],
  closed: ["closed", "open"],
};

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

async function requireAdmin(
  supabase: SupabaseClient
): Promise<{ ok: true; userId: string } | { ok: false; response: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }),
    };
  }
  const { data: caller } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (caller?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }),
    };
  }
  return { ok: true, userId: user.id };
}

/** GET /api/admin/surveys/[id] — 설문 + 문항 (admin only) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const { data: survey, error } = await supabase
      .from("surveys")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!survey) {
      return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    }

    const { data: questions, error: qErr } = await supabase
      .from("survey_questions")
      .select("*")
      .eq("survey_id", id)
      .order("order_index", { ascending: true });
    if (qErr) {
      return NextResponse.json({ error: qErr.message }, { status: 500 });
    }

    return NextResponse.json({ ...survey, questions: questions ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "설문 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PATCH /api/admin/surveys/[id] — 설문 메타/상태 수정 (admin only) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const { data: current, error: curErr } = await supabase
      .from("surveys")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (curErr) {
      return NextResponse.json({ error: curErr.message }, { status: 500 });
    }
    if (!current) {
      return NextResponse.json({ error: "설문을 찾을 수 없습니다." }, { status: 404 });
    }

    const body = await request.json();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) updates.title = String(body.title);
    if (body.description !== undefined)
      updates.description = body.description ? String(body.description) : null;
    if (body.access_mode !== undefined)
      updates.access_mode = body.access_mode === "public" ? "public" : "authenticated";
    if (body.is_anonymous !== undefined) updates.is_anonymous = body.is_anonymous === true;
    if (body.opens_at !== undefined) updates.opens_at = body.opens_at || null;
    if (body.closes_at !== undefined) updates.closes_at = body.closes_at || null;
    if (body.sort_order !== undefined) updates.sort_order = Number(body.sort_order);

    if (body.slug !== undefined) {
      const slug = String(body.slug).trim();
      if (!slug || !SLUG_RE.test(slug)) {
        return NextResponse.json(
          { error: "slug는 영소문자/숫자/하이픈만 가능합니다." },
          { status: 400 }
        );
      }
      if (slug !== current.slug) {
        const { data: dup } = await supabase
          .from("surveys")
          .select("id")
          .eq("slug", slug)
          .neq("id", id)
          .maybeSingle();
        if (dup) {
          return NextResponse.json({ error: "이미 사용 중인 slug입니다." }, { status: 409 });
        }
      }
      updates.slug = slug;
    }

    if (body.status !== undefined) {
      const next = body.status as SurveyStatus;
      const allowed = ALLOWED_STATUS_TRANSITIONS[current.status as SurveyStatus] ?? [];
      if (!allowed.includes(next)) {
        return NextResponse.json(
          { error: `'${current.status}' → '${next}' 상태 전이는 허용되지 않습니다.` },
          { status: 409 }
        );
      }
      updates.status = next;
    }

    const { data, error } = await supabase
      .from("surveys")
      .update(updates)
      .eq("id", id)
      .select()
      .single();
    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({ error: "이미 사용 중인 slug입니다." }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "설문 수정에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/admin/surveys/[id] — 설문 삭제 (cascade, admin only) */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const { error } = await supabase.from("surveys").delete().eq("id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "설문 삭제에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] 2.2 — 타입 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build`. 기대: 에러 0.
- [ ] 2.3 — 품질 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run lint`. 기대: 신규 에러 0.
- [ ] 2.4 — 커밋: `cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/app/api/admin/surveys/'[id]'/route.ts && git commit -m "feat(survey): admin survey detail/update/delete API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. 기대: 1 file changed.

---

## Task 3: 관리 API — `GET·POST·PUT /api/admin/surveys/[id]/questions`

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/surveys/[id]/questions/route.ts`

**Interfaces**
- Consumes: `SurveyQuestion`, `QuestionType`, `QuestionConfig` from `@/types/survey`; `default_config_for` from `@/lib/survey`.
- Produces:
  - `GET` → `200 { items: SurveyQuestion[] }`(order_index 정렬).
  - `POST` body `{ type: QuestionType; title: string; section?; description?; required?; config?: QuestionConfig; order_index? }` → `200 SurveyQuestion`.
  - `PUT` body `{ items: { id: string; order_index: number; section?: string | null }[] }` → `200 { items: SurveyQuestion[] }`.

**Steps**

- [ ] 3.1 — 최소 구현: 라우트 파일 작성.

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/surveys/[id]/questions/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { default_config_for } from "@/lib/survey";
import type { QuestionType } from "@/types/survey";

const QUESTION_TYPES: QuestionType[] = [
  "single_choice",
  "multi_choice",
  "scale",
  "nps",
  "number",
  "text",
  "textarea",
  "pre_post_scale",
];

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

async function requireAdmin(
  supabase: SupabaseClient
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }),
    };
  }
  const { data: caller } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (caller?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }),
    };
  }
  return { ok: true };
}

/** GET /api/admin/surveys/[id]/questions — 문항 목록 (admin only) */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const { data, error } = await supabase
      .from("survey_questions")
      .select("*")
      .eq("survey_id", id)
      .order("order_index", { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "문항 조회에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST /api/admin/surveys/[id]/questions — 문항 추가 (admin only) */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const type = body.type as QuestionType;
    if (!QUESTION_TYPES.includes(type)) {
      return NextResponse.json({ error: "유효하지 않은 문항 타입입니다." }, { status: 400 });
    }
    const title = String(body.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "title은 필수입니다." }, { status: 400 });
    }

    let orderIndex: number;
    if (body.order_index !== undefined) {
      orderIndex = Number(body.order_index);
    } else {
      const { data: last } = await supabase
        .from("survey_questions")
        .select("order_index")
        .eq("survey_id", id)
        .order("order_index", { ascending: false })
        .limit(1)
        .maybeSingle();
      orderIndex = last ? Number(last.order_index) + 1 : 0;
    }

    const config = body.config && typeof body.config === "object" ? body.config : default_config_for(type);

    const { data, error } = await supabase
      .from("survey_questions")
      .insert({
        survey_id: id,
        type,
        title,
        section: body.section ? String(body.section) : null,
        description: body.description ? String(body.description) : null,
        required: body.required === true,
        config,
        order_index: orderIndex,
      })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "문항 추가에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** PUT /api/admin/surveys/[id]/questions — 일괄 reorder/section 재배치 (admin only) */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const items = Array.isArray(body.items) ? body.items : [];
    const nowIso = new Date().toISOString();

    for (const it of items) {
      const updates: Record<string, unknown> = {
        order_index: Number(it.order_index),
        updated_at: nowIso,
      };
      if (it.section !== undefined) {
        updates.section = it.section ? String(it.section) : null;
      }
      const { error } = await supabase
        .from("survey_questions")
        .update(updates)
        .eq("id", it.id)
        .eq("survey_id", id);
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }

    const { data, error } = await supabase
      .from("survey_questions")
      .select("*")
      .eq("survey_id", id)
      .order("order_index", { ascending: true });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ items: data ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : "문항 순서 변경에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] 3.2 — 타입 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build`. 기대: 에러 0.
- [ ] 3.3 — 품질 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run lint`. 기대: 신규 에러 0.
- [ ] 3.4 — 커밋: `cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/app/api/admin/surveys/'[id]'/questions/route.ts && git commit -m "feat(survey): admin questions list/create/reorder API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. 기대: 1 file changed.

---

## Task 4: 관리 API — `PATCH·DELETE /api/admin/surveys/[id]/questions/[questionId]`

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/surveys/[id]/questions/[questionId]/route.ts`

**Interfaces**
- Consumes: `SurveyQuestion`, `QuestionType`, `QuestionConfig` from `@/types/survey`.
- Produces:
  - `PATCH` body 부분 `{ title?; type?: QuestionType; section?; description?; required?; config?: QuestionConfig; order_index? }` → `200 SurveyQuestion`.
  - `DELETE` → `200 { ok: true }`.

**Steps**

- [ ] 4.1 — 최소 구현: 라우트 파일 작성.

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/app/api/admin/surveys/[id]/questions/[questionId]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import type { QuestionType } from "@/types/survey";

const QUESTION_TYPES: QuestionType[] = [
  "single_choice",
  "multi_choice",
  "scale",
  "nps",
  "number",
  "text",
  "textarea",
  "pre_post_scale",
];

type SupabaseClient = Awaited<ReturnType<typeof createServerSupabase>>;

async function requireAdmin(
  supabase: SupabaseClient
): Promise<{ ok: true } | { ok: false; response: NextResponse }> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 }),
    };
  }
  const { data: caller } = await supabase
    .from("user_profiles")
    .select("role")
    .eq("user_id", user.id)
    .single();
  if (caller?.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 }),
    };
  }
  return { ok: true };
}

/** PATCH /api/admin/surveys/[id]/questions/[questionId] — 문항 수정 (admin only) */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  try {
    const { id, questionId } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const body = await request.json();
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (body.title !== undefined) updates.title = String(body.title);
    if (body.type !== undefined) {
      const type = body.type as QuestionType;
      if (!QUESTION_TYPES.includes(type)) {
        return NextResponse.json({ error: "유효하지 않은 문항 타입입니다." }, { status: 400 });
      }
      updates.type = type;
    }
    if (body.section !== undefined)
      updates.section = body.section ? String(body.section) : null;
    if (body.description !== undefined)
      updates.description = body.description ? String(body.description) : null;
    if (body.required !== undefined) updates.required = body.required === true;
    if (body.config !== undefined) updates.config = body.config;
    if (body.order_index !== undefined) updates.order_index = Number(body.order_index);

    const { data, error } = await supabase
      .from("survey_questions")
      .update(updates)
      .eq("id", questionId)
      .eq("survey_id", id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ error: "문항을 찾을 수 없습니다." }, { status: 404 });
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "문항 수정에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** DELETE /api/admin/surveys/[id]/questions/[questionId] — 문항 삭제 (admin only) */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; questionId: string }> }
) {
  try {
    const { id, questionId } = await params;
    const supabase = await createServerSupabase();
    const gate = await requireAdmin(supabase);
    if (!gate.ok) return gate.response;

    const { error } = await supabase
      .from("survey_questions")
      .delete()
      .eq("id", questionId)
      .eq("survey_id", id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "문항 삭제에 실패했습니다.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
```

- [ ] 4.2 — 타입 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build`. 기대: 에러 0.
- [ ] 4.3 — 품질 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run lint`. 기대: 신규 에러 0.
- [ ] 4.4 — 커밋: `cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/app/api/admin/surveys/'[id]'/questions/'[questionId]'/route.ts && git commit -m "feat(survey): admin single question update/delete API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. 기대: 1 file changed.

---

## Task 5: 진입점 — ADMIN_NAV 멱등 등록 + 설문 관리 목록 페이지

> **충돌 회피(필수):** `admin/layout.tsx`의 `ClipboardList` import와 `ADMIN_NAV` "설문 관리" 항목은 Phase1 Task8이 이미 추가했을 수 있다. **라인 번호로 교체하지 말 것.** 아래 5.1·5.2는 grep으로 기존 등록 여부를 먼저 확인하고, **미등록일 때만** 추가하는 멱등 절차다. 이미 등록돼 있으면 해당 스텝은 no-op로 통과 처리한다(중복 import/중복 nav 금지).

**Files**
- Modify (멱등) `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/admin/layout.tsx`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/admin/surveys/page.tsx`

**Interfaces**
- Consumes: `GET /api/admin/surveys` → `{ items: SurveyListItem[] }`; `Survey`, `SurveyStatus` from `@/types/survey`.
- Produces: `/admin/surveys` 페이지(상태배지·응답수·생성 진입·편집 진입). `ADMIN_NAV`에 `{ href:"/admin/surveys", label:"설문 관리", icon: ClipboardList }` 보장(이미 존재 시 유지).

**Steps**

- [ ] 5.1 — `ClipboardList` import 멱등 보장. 먼저 등록 여부 확인:
  `cd /Users/seunguk.kang/Repos/inje-playground/frontend && grep -n "ClipboardList" src/app/admin/layout.tsx`.
  - **출력에 `ClipboardList`가 이미 있으면**(Phase1이 추가함) 이 스텝은 no-op — import 수정하지 말고 통과.
  - **출력이 없으면**, `src/app/admin/layout.tsx`의 lucide-react import에서 다음 정확한 문자열을 교체한다.
    - old_string: `import { Shield, Users, Settings, HelpCircle, MessageSquare, Loader2, ShieldAlert } from "lucide-react";`
    - new_string: `import { Shield, Users, Settings, HelpCircle, MessageSquare, Loader2, ShieldAlert, ClipboardList } from "lucide-react";`

- [ ] 5.2 — `ADMIN_NAV` "설문 관리" 항목 멱등 보장. 먼저 등록 여부 확인:
  `cd /Users/seunguk.kang/Repos/inje-playground/frontend && grep -n "/admin/surveys" src/app/admin/layout.tsx`.
  - **출력에 `/admin/surveys` 항목이 이미 있으면**(Phase1이 추가함) 이 스텝은 no-op — `ADMIN_NAV` 수정하지 말고 통과.
  - **출력이 없으면**, `ADMIN_NAV` 배열의 `chat-history` 항목 줄(정확 문자열) 뒤에 설문 항목을 추가한다.
    - old_string:
      ```typescript
        { href: "/admin/chat-history", label: "질의/응답 관리", icon: MessageSquare },
      ];
      ```
    - new_string:
      ```typescript
        { href: "/admin/chat-history", label: "질의/응답 관리", icon: MessageSquare },
        { href: "/admin/surveys", label: "설문 관리", icon: ClipboardList },
      ];
      ```

- [ ] 5.3 — 멱등 검증: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && grep -c "ClipboardList" src/app/admin/layout.tsx && grep -c "/admin/surveys" src/app/admin/layout.tsx`. 기대: 첫 값 `2`(import 1 + nav icon 1), 둘째 값 `1`(nav href 1). 어느 값이든 이를 초과하면 중복 등록이므로 5.1/5.2 중복분을 제거.

- [ ] 5.4 — 최소 구현: 설문 목록 페이지 작성.

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/app/admin/surveys/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, ClipboardList, Pencil } from "lucide-react";
import type { Survey, SurveyStatus } from "@/types/survey";

type SurveyListItem = Survey & { response_count: number; complete_count: number };

const STATUS_BADGE: Record<SurveyStatus, { label: string; className: string }> = {
  draft: { label: "초안", className: "bg-slate-100 text-slate-600 border-slate-200" },
  open: { label: "진행중", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { label: "마감", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

export default function AdminSurveysPage() {
  const [items, setItems] = useState<SurveyListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSurveys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/surveys");
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "조회에 실패했습니다.");
      }
      const data = await res.json();
      setItems(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSurveys();
  }, [fetchSurveys]);

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-base font-semibold">설문 목록</h2>
          <Badge variant="secondary" className="text-xs">
            {items.length}개
          </Badge>
        </div>
        <Link href="/admin/surveys/new">
          <Button size="sm" className="h-8 gap-1.5">
            <Plus className="h-3.5 w-3.5" />새 설문
          </Button>
        </Link>
      </div>

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">로딩 중...</span>
        </div>
      ) : items.length === 0 ? (
        <div className="text-center py-12 text-sm text-muted-foreground">
          아직 설문이 없습니다. 새 설문을 만들어 보세요.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((s) => {
            const badge = STATUS_BADGE[s.status];
            return (
              <Card key={s.id} className="hover:bg-muted/30 transition-colors">
                <CardContent className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{s.title}</p>
                      <Badge variant="outline" className={`text-[10px] h-5 ${badge.className}`}>
                        {badge.label}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 font-mono">/{s.slug}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold">
                      {s.complete_count}
                      <span className="text-muted-foreground font-normal"> / {s.response_count}</span>
                    </p>
                    <p className="text-[10px] text-muted-foreground">완료 / 응답</p>
                  </div>
                  <Link href={`/admin/surveys/${s.id}/edit`}>
                    <Button variant="outline" size="sm" className="h-8 gap-1.5">
                      <Pencil className="h-3.5 w-3.5" />
                      편집
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
```

- [ ] 5.5 — 타입 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build`. 기대: 에러 0.
- [ ] 5.6 — 품질 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run lint`. 기대: 신규 에러 0.
- [ ] 5.7 — 커밋: `cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/app/admin/layout.tsx frontend/src/app/admin/surveys/page.tsx && git commit -m "feat(survey): admin nav (idempotent) + surveys list page" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. 기대: Phase1이 nav를 이미 등록했으면 1 file changed(목록 페이지만), 아니면 2 files changed.

---

## Task 6: 설문 메타 생성 페이지 `/admin/surveys/new`

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/admin/surveys/new/page.tsx`

**Interfaces**
- Consumes: `POST /api/admin/surveys` → `200 Survey` | `409 { error }`.
- Produces: 메타 입력 폼(slug·title·description·access_mode·is_anonymous) → 생성 성공 시 `/admin/surveys/{id}/edit`로 라우팅.

**Steps**

- [ ] 6.1 — 최소 구현: 생성 페이지 작성.

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/app/admin/surveys/new/page.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ChevronLeft } from "lucide-react";
import type { SurveyAccessMode } from "@/types/survey";

export default function NewSurveyPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accessMode, setAccessMode] = useState<SurveyAccessMode>("authenticated");
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          title: title.trim(),
          description: description.trim() || undefined,
          access_mode: accessMode,
          is_anonymous: isAnonymous,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "생성에 실패했습니다.");
      }
      const survey = await res.json();
      router.push(`/admin/surveys/${survey.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <Link
        href="/admin/surveys"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        설문 목록
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">새 설문 만들기</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">제목</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: Claude Code 생산성 설문"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slug">slug (URL 경로)</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="claude-code-productivity"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              영소문자·숫자·하이픈만. 응답 URL은 /survey/{slug || "<slug>"} 입니다.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">설명 (선택)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="설문 목적·안내 문구"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>접근 모드</Label>
            <Select
              value={accessMode}
              onValueChange={(v) => setAccessMode(v as SurveyAccessMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="authenticated">로그인 사용자 전용</SelectItem>
                <SelectItem value="public">공개 (익명 링크)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="anon" className="text-sm">
                익명 집계
              </Label>
              <p className="text-xs text-muted-foreground">
                보고 단계에서 개인 식별 정보를 분리합니다.
              </p>
            </div>
            <Switch id="anon" checked={isAnonymous} onCheckedChange={setIsAnonymous} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Link href="/admin/surveys">
              <Button variant="outline" disabled={saving}>
                취소
              </Button>
            </Link>
            <Button
              onClick={handleCreate}
              disabled={saving || !slug.trim() || !title.trim()}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              생성 후 문항 편집
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] 6.2 — 타입 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build`. 기대: 에러 0.
- [ ] 6.3 — 품질 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run lint`. 기대: 신규 에러 0.
- [ ] 6.4 — 커밋: `cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/app/admin/surveys/new/page.tsx && git commit -m "feat(survey): survey meta create page" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. 기대: 1 file changed.

---

## Task 7: 빌더 리프 컴포넌트 — `QuestionTypePicker` + `QuestionConfigEditor`

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/QuestionTypePicker.tsx`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/QuestionConfigEditor.tsx`

**Interfaces**
- Consumes: `QUESTION_TYPE_META` from `@/lib/survey`; `QuestionType`, `QuestionConfig`, `QuestionOption` from `@/types/survey`.
- Produces:
  - `QuestionTypePicker` props `{ value?: QuestionType; onSelect: (type: QuestionType) => void }`.
  - `QuestionConfigEditor` props `{ type: QuestionType; config: QuestionConfig; onChange: (config: QuestionConfig) => void }`.

**Steps**

- [ ] 7.1 — 최소 구현: `QuestionTypePicker` 작성. (타입↔아이콘 매핑은 컴포넌트 로컬에서 안정적으로 보유하여 `meta.icon` 문자열 의존성을 제거)

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/QuestionTypePicker.tsx
"use client";

import {
  CircleDot,
  ListChecks,
  SlidersHorizontal,
  Gauge,
  Hash,
  Type,
  AlignLeft,
  GitCompareArrows,
  type LucideIcon,
} from "lucide-react";
import { QUESTION_TYPE_META } from "@/lib/survey";
import type { QuestionType } from "@/types/survey";

export interface QuestionTypePickerProps {
  value?: QuestionType;
  onSelect: (type: QuestionType) => void;
}

const TYPE_ICON: Record<QuestionType, LucideIcon> = {
  single_choice: CircleDot,
  multi_choice: ListChecks,
  scale: SlidersHorizontal,
  nps: Gauge,
  number: Hash,
  text: Type,
  textarea: AlignLeft,
  pre_post_scale: GitCompareArrows,
};

const TYPE_ORDER: QuestionType[] = [
  "single_choice",
  "multi_choice",
  "scale",
  "nps",
  "number",
  "text",
  "textarea",
  "pre_post_scale",
];

export default function QuestionTypePicker({ value, onSelect }: QuestionTypePickerProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {TYPE_ORDER.map((type) => {
        const meta = QUESTION_TYPE_META[type];
        const Icon = TYPE_ICON[type];
        const active = value === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onSelect(type)}
            title={meta.description}
            className={`flex flex-col items-start gap-1 rounded-lg border p-2.5 text-left transition-colors ${
              active
                ? "border-primary bg-primary/5 ring-1 ring-primary"
                : "hover:bg-muted/40"
            }`}
          >
            <Icon className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs font-medium">{meta.label}</span>
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] 7.2 — 최소 구현: `QuestionConfigEditor` 작성. (타입별 config 폼 + 분석메타 토글. snake_case 키만 사용)

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/QuestionConfigEditor.tsx
"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2 } from "lucide-react";
import type { QuestionType, QuestionConfig, QuestionOption } from "@/types/survey";

export interface QuestionConfigEditorProps {
  type: QuestionType;
  config: QuestionConfig;
  onChange: (config: QuestionConfig) => void;
}

const HAS_OPTIONS: QuestionType[] = ["single_choice", "multi_choice"];
const HAS_SCALE: QuestionType[] = ["scale", "pre_post_scale"];

export default function QuestionConfigEditor({
  type,
  config,
  onChange,
}: QuestionConfigEditorProps) {
  const set = <K extends keyof QuestionConfig>(key: K, value: QuestionConfig[K]) => {
    onChange({ ...config, [key]: value });
  };

  const options: QuestionOption[] = config.options ?? [];
  const setOptions = (next: QuestionOption[]) => onChange({ ...config, options: next });

  const numOrUndef = (raw: string): number | undefined =>
    raw === "" ? undefined : Number(raw);

  return (
    <div className="space-y-3">
      {/* ── 옵션 (single/multi) ── */}
      {HAS_OPTIONS.includes(type) && (
        <div className="space-y-2">
          <Label className="text-xs">선택지</Label>
          {options.map((opt, idx) => (
            <div key={idx} className="flex items-center gap-2">
              <Input
                value={opt.value}
                onChange={(e) => {
                  const next = [...options];
                  next[idx] = { ...next[idx], value: e.target.value };
                  setOptions(next);
                }}
                placeholder="value"
                className="h-8 w-28 font-mono text-xs"
              />
              <Input
                value={opt.label}
                onChange={(e) => {
                  const next = [...options];
                  next[idx] = { ...next[idx], label: e.target.value };
                  setOptions(next);
                }}
                placeholder="표시 라벨"
                className="h-8 flex-1 text-sm"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setOptions(options.filter((_, i) => i !== idx))}
              >
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() =>
              setOptions([...options, { value: `opt${options.length + 1}`, label: "" }])
            }
          >
            <Plus className="h-3.5 w-3.5" />
            선택지 추가
          </Button>
          <div className="flex items-center justify-between pt-1">
            <Label htmlFor="allow_other" className="text-xs">
              기타 직접입력 허용
            </Label>
            <Switch
              id="allow_other"
              checked={config.allow_other ?? false}
              onCheckedChange={(v) => set("allow_other", v)}
            />
          </div>
        </div>
      )}

      {/* ── 척도 (scale/pre_post) ── */}
      {HAS_SCALE.includes(type) && (
        <div className="space-y-2">
          <Label className="text-xs">척도 범위</Label>
          <div className="grid grid-cols-3 gap-2">
            <Input
              type="number"
              value={config.min ?? ""}
              onChange={(e) => set("min", numOrUndef(e.target.value))}
              placeholder="min"
              className="h-8 text-sm"
            />
            <Input
              type="number"
              value={config.max ?? ""}
              onChange={(e) => set("max", numOrUndef(e.target.value))}
              placeholder="max"
              className="h-8 text-sm"
            />
            <Input
              type="number"
              value={config.step ?? ""}
              onChange={(e) => set("step", numOrUndef(e.target.value))}
              placeholder="step"
              className="h-8 text-sm"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Input
              value={config.min_label ?? ""}
              onChange={(e) => set("min_label", e.target.value || undefined)}
              placeholder="최소 라벨"
              className="h-8 text-sm"
            />
            <Input
              value={config.mid_label ?? ""}
              onChange={(e) => set("mid_label", e.target.value || undefined)}
              placeholder="중간 라벨"
              className="h-8 text-sm"
            />
            <Input
              value={config.max_label ?? ""}
              onChange={(e) => set("max_label", e.target.value || undefined)}
              placeholder="최대 라벨"
              className="h-8 text-sm"
            />
          </div>
          {type === "pre_post_scale" && (
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={config.before_label ?? ""}
                onChange={(e) => set("before_label", e.target.value || undefined)}
                placeholder="이전 라벨 (기본: 도입 전)"
                className="h-8 text-sm"
              />
              <Input
                value={config.after_label ?? ""}
                onChange={(e) => set("after_label", e.target.value || undefined)}
                placeholder="이후 라벨 (기본: 현재)"
                className="h-8 text-sm"
              />
            </div>
          )}
        </div>
      )}

      {/* ── 숫자 ── */}
      {type === "number" && (
        <div className="space-y-2">
          <Label className="text-xs">숫자 입력</Label>
          <div className="grid grid-cols-3 gap-2">
            <Input
              type="number"
              value={config.min ?? ""}
              onChange={(e) => set("min", numOrUndef(e.target.value))}
              placeholder="min"
              className="h-8 text-sm"
            />
            <Input
              type="number"
              value={config.max ?? ""}
              onChange={(e) => set("max", numOrUndef(e.target.value))}
              placeholder="max"
              className="h-8 text-sm"
            />
            <Input
              value={config.unit ?? ""}
              onChange={(e) => set("unit", e.target.value || undefined)}
              placeholder="단위 (예: 시간/주)"
              className="h-8 text-sm"
            />
          </div>
        </div>
      )}

      {/* ── 텍스트 ── */}
      {(type === "text" || type === "textarea") && (
        <div className="space-y-2">
          <Label className="text-xs">텍스트 입력</Label>
          <Input
            value={config.placeholder ?? ""}
            onChange={(e) => set("placeholder", e.target.value || undefined)}
            placeholder="placeholder"
            className="h-8 text-sm"
          />
          <Input
            type="number"
            value={config.max_length ?? ""}
            onChange={(e) => set("max_length", numOrUndef(e.target.value))}
            placeholder="최대 글자수"
            className="h-8 text-sm"
          />
        </div>
      )}

      {/* ── 분석 메타 (전 타입 공통) ── */}
      <Separator />
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">분석 메타</Label>
        <div className="flex items-center justify-between">
          <span className="text-xs">세그먼트 필터 후보</span>
          <Switch
            checked={config.segment ?? false}
            onCheckedChange={(v) => set("segment", v)}
          />
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs">순서형 (평균·상관 포함)</span>
          <Switch
            checked={config.ordinal ?? false}
            onCheckedChange={(v) => set("ordinal", v)}
          />
        </div>
        <Input
          value={config.analysis_metric ?? ""}
          onChange={(e) => set("analysis_metric", e.target.value || undefined)}
          placeholder="analysis_metric 키 (예: nps)"
          className="h-8 text-sm font-mono"
        />
        <Input
          value={(config.top_box ?? []).join(", ")}
          onChange={(e) =>
            set(
              "top_box",
              e.target.value.trim()
                ? e.target.value.split(",").map((v) => v.trim()).filter(Boolean)
                : undefined
            )
          }
          placeholder="top_box 값 (쉼표 구분, 예: 4, 5)"
          className="h-8 text-sm"
        />
        <Input
          type="number"
          value={config.target ?? ""}
          onChange={(e) => set("target", numOrUndef(e.target.value))}
          placeholder="target (신호등 벤치마크)"
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}
```

- [ ] 7.3 — 타입 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build`. 기대: 에러 0.
- [ ] 7.4 — 품질 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run lint`. 기대: 신규 에러 0.
- [ ] 7.5 — 커밋: `cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/components/admin/surveys/QuestionTypePicker.tsx frontend/src/components/admin/surveys/QuestionConfigEditor.tsx && git commit -m "feat(survey): question type picker + config editor" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. 기대: 2 files changed.

---

## Task 8: 빌더 컴포넌트 — `QuestionEditor` + `SurveyBuilder`

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/QuestionEditor.tsx`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/SurveyBuilder.tsx`

**Interfaces**
- Consumes: `QuestionEditorProps`, `SurveyBuilderProps` 시그니처(동결); `default_config_for`, `QUESTION_TYPE_META` from `@/lib/survey`; `SurveyQuestion`, `QuestionType` from `@/types/survey`; Task 7 컴포넌트.
- Produces:
  - `QuestionEditor` props `{ question: SurveyQuestion; onChange: (patch: Partial<SurveyQuestion>) => void; onDelete: () => void }`.
  - `SurveyBuilder` props `{ surveyId: string; questions: SurveyQuestion[]; onReorder: (items: { id: string; order_index: number; section?: string | null }[]) => void; onQuestionChange: (id: string, patch: Partial<SurveyQuestion>) => void; onAddQuestion: (type: QuestionType, section?: string) => void; onDeleteQuestion: (id: string) => void }`.

**Steps**

- [ ] 8.1 — 최소 구현: `QuestionEditor` 작성. (타입 변경 시 `default_config_for`로 config 리셋)

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/QuestionEditor.tsx
"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, ChevronDown, ChevronRight, Settings2 } from "lucide-react";
import { default_config_for, QUESTION_TYPE_META } from "@/lib/survey";
import type { SurveyQuestion, QuestionType, QuestionConfig } from "@/types/survey";
import QuestionTypePicker from "./QuestionTypePicker";
import QuestionConfigEditor from "./QuestionConfigEditor";

export interface QuestionEditorProps {
  question: SurveyQuestion;
  onChange: (patch: Partial<SurveyQuestion>) => void;
  onDelete: () => void;
}

export default function QuestionEditor({ question, onChange, onDelete }: QuestionEditorProps) {
  const [open, setOpen] = useState(false);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const meta = QUESTION_TYPE_META[question.type];

  const handleTypeChange = (type: QuestionType) => {
    if (type === question.type) {
      setShowTypePicker(false);
      return;
    }
    onChange({ type, config: default_config_for(type) });
    setShowTypePicker(false);
  };

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-start gap-2 p-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-1.5 shrink-0 text-muted-foreground"
          aria-label="펼치기"
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-[10px] h-5 shrink-0">
              {meta.label}
            </Badge>
            {question.required && (
              <Badge variant="outline" className="text-[10px] h-5 shrink-0 text-rose-600 border-rose-200">
                필수
              </Badge>
            )}
            {question.section && (
              <Badge variant="outline" className="text-[10px] h-5 shrink-0">
                {question.section}
              </Badge>
            )}
          </div>
          <Input
            value={question.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="문항 제목"
            className="h-9 text-sm font-medium"
          />
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>문항을 삭제할까요?</AlertDialogTitle>
              <AlertDialogDescription>
                이 작업은 되돌릴 수 없습니다. 문항과 관련 응답이 함께 삭제됩니다.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>취소</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>삭제</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {open && (
        <div className="space-y-4 border-t px-3 py-3 pl-9">
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs">문항 타입</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={() => setShowTypePicker((v) => !v)}
              >
                <Settings2 className="h-3.5 w-3.5" />
                타입 변경
              </Button>
            </div>
            {showTypePicker && (
              <QuestionTypePicker value={question.type} onSelect={handleTypeChange} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor={`section-${question.id}`} className="text-xs">
                섹션
              </Label>
              <Input
                id={`section-${question.id}`}
                value={question.section ?? ""}
                onChange={(e) => onChange({ section: e.target.value || null })}
                placeholder="예: S0. 배경"
                className="h-8 text-sm"
              />
            </div>
            <div className="flex items-end justify-between rounded-lg border px-3 pb-1.5 pt-2">
              <Label htmlFor={`req-${question.id}`} className="text-xs">
                필수 응답
              </Label>
              <Switch
                id={`req-${question.id}`}
                checked={question.required}
                onCheckedChange={(v) => onChange({ required: v })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={`desc-${question.id}`} className="text-xs">
              설명 (선택)
            </Label>
            <Textarea
              id={`desc-${question.id}`}
              value={question.description ?? ""}
              onChange={(e) => onChange({ description: e.target.value || null })}
              placeholder="문항 보조 설명"
              rows={2}
              className="text-sm"
            />
          </div>

          <QuestionConfigEditor
            type={question.type}
            config={question.config}
            onChange={(config: QuestionConfig) => onChange({ config })}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] 8.2 — 최소 구현: `SurveyBuilder` 작성. (HTML5 native drag + up/down 버튼 둘 다 제공)

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/components/admin/surveys/SurveyBuilder.tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { GripVertical, ChevronUp, ChevronDown, Plus } from "lucide-react";
import type { SurveyQuestion, QuestionType } from "@/types/survey";
import QuestionEditor from "./QuestionEditor";
import QuestionTypePicker from "./QuestionTypePicker";

export interface SurveyBuilderProps {
  surveyId: string;
  questions: SurveyQuestion[];
  onReorder: (items: { id: string; order_index: number; section?: string | null }[]) => void;
  onQuestionChange: (id: string, patch: Partial<SurveyQuestion>) => void;
  onAddQuestion: (type: QuestionType, section?: string) => void;
  onDeleteQuestion: (id: string) => void;
}

export default function SurveyBuilder({
  questions,
  onReorder,
  onQuestionChange,
  onAddQuestion,
  onDeleteQuestion,
}: SurveyBuilderProps) {
  const [dragId, setDragId] = useState<string | null>(null);
  const ordered = [...questions].sort((a, b) => a.order_index - b.order_index);

  const emitReorder = (next: SurveyQuestion[]) => {
    onReorder(next.map((q, i) => ({ id: q.id, order_index: i, section: q.section })));
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      return;
    }
    const from = ordered.findIndex((q) => q.id === dragId);
    const to = ordered.findIndex((q) => q.id === targetId);
    if (from < 0 || to < 0) {
      setDragId(null);
      return;
    }
    const next = [...ordered];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    emitReorder(next);
    setDragId(null);
  };

  const move = (id: string, dir: -1 | 1) => {
    const i = ordered.findIndex((q) => q.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const next = [...ordered];
    [next[i], next[j]] = [next[j], next[i]];
    emitReorder(next);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {ordered.length === 0 ? (
          <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
            아직 문항이 없습니다. 아래에서 타입을 선택해 추가하세요.
          </div>
        ) : (
          ordered.map((q, idx) => (
            <div
              key={q.id}
              draggable
              onDragStart={() => setDragId(q.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(q.id)}
              className={`flex items-stretch gap-1 ${dragId === q.id ? "opacity-50" : ""}`}
              data-testid="survey-question-row"
            >
              <div className="flex flex-col items-center justify-start gap-1 pt-3 text-muted-foreground">
                <GripVertical className="h-4 w-4 cursor-grab" aria-label="드래그 핸들" />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={idx === 0}
                  onClick={() => move(q.id, -1)}
                  aria-label="위로"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  disabled={idx === ordered.length - 1}
                  onClick={() => move(q.id, 1)}
                  aria-label="아래로"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="flex-1">
                <QuestionEditor
                  question={q}
                  onChange={(patch) => onQuestionChange(q.id, patch)}
                  onDelete={() => onDeleteQuestion(q.id)}
                />
              </div>
            </div>
          ))
        )}
      </div>

      <div className="rounded-lg border bg-muted/20 p-3">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <Plus className="h-3.5 w-3.5" />
          문항 추가
        </p>
        <QuestionTypePicker onSelect={(type) => onAddQuestion(type)} />
      </div>
    </div>
  );
}
```

- [ ] 8.3 — 타입 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build`. 기대: 에러 0.
- [ ] 8.4 — 품질 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run lint`. 기대: 신규 에러 0.
- [ ] 8.5 — 커밋: `cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/components/admin/surveys/QuestionEditor.tsx frontend/src/components/admin/surveys/SurveyBuilder.tsx && git commit -m "feat(survey): question editor + survey builder" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. 기대: 2 files changed.

---

## Task 9: 빌더 호스트 페이지 `/admin/surveys/[id]/edit`

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/src/app/admin/surveys/[id]/edit/page.tsx`

**Interfaces**
- Consumes: `GET /api/admin/surveys/[id]` → `SurveyWithQuestions`; `POST·PUT /api/admin/surveys/[id]/questions`; `PATCH·DELETE /api/admin/surveys/[id]/questions/[questionId]`; `PATCH /api/admin/surveys/[id]`; `SurveyBuilder`(Task 8); `Survey`, `SurveyQuestion`, `SurveyStatus`, `SurveyWithQuestions` from `@/types/survey`.
- Produces: 빌더 페이지 — 메타 헤더(제목·slug·상태 전환 버튼) + `SurveyBuilder` 와이어링.

**Steps**

- [ ] 9.1 — 최소 구현: 빌더 호스트 페이지 작성.

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/src/app/admin/surveys/[id]/edit/page.tsx
"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, ChevronLeft, Play, Square, ExternalLink } from "lucide-react";
import SurveyBuilder from "@/components/admin/surveys/SurveyBuilder";
import { default_config_for } from "@/lib/survey";
import type {
  Survey,
  SurveyQuestion,
  SurveyStatus,
  SurveyWithQuestions,
  QuestionType,
} from "@/types/survey";

const STATUS_BADGE: Record<SurveyStatus, { label: string; className: string }> = {
  draft: { label: "초안", className: "bg-slate-100 text-slate-600 border-slate-200" },
  open: { label: "진행중", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  closed: { label: "마감", className: "bg-amber-50 text-amber-700 border-amber-200" },
};

export default function SurveyEditPage() {
  const params = useParams<{ id: string }>();
  const surveyId = params.id;

  const [survey, setSurvey] = useState<Survey | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}`);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "조회에 실패했습니다.");
      }
      const data: SurveyWithQuestions = await res.json();
      const { questions: qs, ...meta } = data;
      setSurvey(meta as Survey);
      setQuestions(qs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }, [surveyId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddQuestion = async (type: QuestionType) => {
    setError(null);
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}/questions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          title: "새 문항",
          required: false,
          config: default_config_for(type),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "문항 추가 실패");
      }
      const created: SurveyQuestion = await res.json();
      setQuestions((prev) => [...prev, created]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    }
  };

  const handleQuestionChange = async (id: string, patch: Partial<SurveyQuestion>) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, ...patch } : q)));
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}/questions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "문항 수정 실패");
      }
      const updated: SurveyQuestion = await res.json();
      setQuestions((prev) => prev.map((q) => (q.id === id ? updated : q)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      load();
    }
  };

  const handleReorder = async (
    items: { id: string; order_index: number; section?: string | null }[]
  ) => {
    const orderMap = new Map(items.map((it) => [it.id, it.order_index]));
    setQuestions((prev) =>
      [...prev]
        .map((q) => ({ ...q, order_index: orderMap.get(q.id) ?? q.order_index }))
        .sort((a, b) => a.order_index - b.order_index)
    );
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}/questions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "순서 변경 실패");
      }
      const data = await res.json();
      setQuestions(data.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      load();
    }
  };

  const handleDeleteQuestion = async (id: string) => {
    setQuestions((prev) => prev.filter((q) => q.id !== id));
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}/questions/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "삭제 실패");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      load();
    }
  };

  const changeStatus = async (status: SurveyStatus) => {
    if (!survey) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/surveys/${surveyId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "상태 변경 실패");
      }
      const updated: Survey = await res.json();
      setSurvey(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">로딩 중...</span>
      </div>
    );
  }

  if (!survey) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        {error || "설문을 찾을 수 없습니다."}
      </div>
    );
  }

  const badge = STATUS_BADGE[survey.status];

  return (
    <div className="max-w-2xl">
      <Link
        href="/admin/surveys"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        설문 목록
      </Link>

      <Card className="mb-4">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <CardTitle className="text-base flex items-center gap-2">
                {survey.title}
                <Badge variant="outline" className={`text-[10px] h-5 ${badge.className}`}>
                  {badge.label}
                </Badge>
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1 font-mono">/survey/{survey.slug}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {survey.status !== "open" && (
                <Button size="sm" className="h-8 gap-1.5" disabled={busy} onClick={() => changeStatus("open")}>
                  <Play className="h-3.5 w-3.5" />
                  공개
                </Button>
              )}
              {survey.status === "open" && (
                <>
                  <Link href={`/survey/${survey.slug}`} target="_blank">
                    <Button variant="outline" size="sm" className="h-8 gap-1.5">
                      <ExternalLink className="h-3.5 w-3.5" />
                      미리보기
                    </Button>
                  </Link>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1.5"
                    disabled={busy}
                    onClick={() => changeStatus("closed")}
                  >
                    <Square className="h-3.5 w-3.5" />
                    마감
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardHeader>
        {survey.description && (
          <CardContent className="pt-0">
            <p className="text-sm text-muted-foreground">{survey.description}</p>
          </CardContent>
        )}
      </Card>

      {error && <p className="text-sm text-destructive mb-3">{error}</p>}

      <SurveyBuilder
        surveyId={surveyId}
        questions={questions}
        onReorder={handleReorder}
        onQuestionChange={handleQuestionChange}
        onAddQuestion={handleAddQuestion}
        onDeleteQuestion={handleDeleteQuestion}
      />
    </div>
  );
}
```

- [ ] 9.2 — 타입 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build`. 기대: 에러 0.
- [ ] 9.3 — 품질 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run lint`. 기대: 신규 에러 0.
- [ ] 9.4 — 커밋: `cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/app/admin/surveys/'[id]'/edit/page.tsx && git commit -m "feat(survey): builder host page wiring CRUD/reorder/status" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. 기대: 1 file changed.

---

## Task 10: Playwright E2E — `survey-builder.spec.ts`

**Files**
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/e2e/helpers/auth.ts`
- Create `/Users/seunguk.kang/Repos/inje-playground/frontend/e2e/survey-builder.spec.ts`

**Interfaces**
- Consumes: 실행 중인 앱(`playwright.config.ts` webServer, baseURL `http://localhost:3003`, Phase1); 환경변수 `E2E_ADMIN_EMAIL`/`E2E_ADMIN_PASSWORD`(관리자 계정); `GET /api/surveys/[slug]`(Phase1, 노출 확인).
- Produces: 빌더 풀플로우 E2E(생성 → 문항 3종 추가 → 순서변경 → open 전환 → 노출 확인).

**Steps**

- [ ] 10.1 — 최소 구현: 로그인 헬퍼 작성. (앱 `/login` 폼 기반 인증; 자격증명 없으면 호출부에서 skip)

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/e2e/helpers/auth.ts
import { type Page, expect } from "@playwright/test";

export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? "";

export const hasAdminCreds = ADMIN_EMAIL !== "" && ADMIN_PASSWORD !== "";

/** 앱 /login 폼을 통해 관리자로 로그인하고 홈으로의 이동을 기다린다. */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/이메일|email/i).fill(ADMIN_EMAIL);
  await page.getByLabel(/비밀번호|password/i).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: /로그인|sign in/i }).click();
  await expect(page).toHaveURL(/\/($|admin|food|guide)/, { timeout: 15000 });
}
```

- [ ] 10.2 — 실패 테스트 작성: 빌더 E2E 스펙 작성.

```typescript
// /Users/seunguk.kang/Repos/inje-playground/frontend/e2e/survey-builder.spec.ts
import { test, expect } from "@playwright/test";
import { loginAsAdmin, hasAdminCreds } from "./helpers/auth";

const slug = `e2e-builder-${Date.now()}`;

test.describe("관리자 설문 빌더", () => {
  test.skip(!hasAdminCreds, "E2E_ADMIN_EMAIL/E2E_ADMIN_PASSWORD 미설정");

  test("생성 → 문항 3종 추가 → 순서변경 → open 전환 → 노출", async ({ page, request }) => {
    await loginAsAdmin(page);

    // 1. 새 설문 생성
    await page.goto("/admin/surveys/new");
    await page.getByLabel("제목").fill("E2E 빌더 테스트");
    await page.getByLabel("slug (URL 경로)").fill(slug);
    await page.getByRole("button", { name: "생성 후 문항 편집" }).click();

    // 편집 페이지로 이동 확인
    await expect(page).toHaveURL(/\/admin\/surveys\/[0-9a-f-]+\/edit/, { timeout: 15000 });

    // 2. 문항 3종 추가 (single_choice, scale, nps)
    const addArea = page.locator("text=문항 추가").locator("..");
    await addArea.getByRole("button", { name: "객관식 단일" }).click();
    await expect(page.getByTestId("survey-question-row")).toHaveCount(1);
    await addArea.getByRole("button", { name: "척도" }).click();
    await expect(page.getByTestId("survey-question-row")).toHaveCount(2);
    await addArea.getByRole("button", { name: "NPS" }).click();
    await expect(page.getByTestId("survey-question-row")).toHaveCount(3);

    // 3. 순서변경 — 마지막(3번째) 문항을 위로 이동
    const rows = page.getByTestId("survey-question-row");
    await rows.nth(2).getByRole("button", { name: "위로" }).click();
    // reorder 후에도 3개 유지
    await expect(page.getByTestId("survey-question-row")).toHaveCount(3);

    // 4. open 전환
    await page.getByRole("button", { name: "공개" }).click();
    await expect(page.getByText("진행중")).toBeVisible({ timeout: 10000 });

    // 5. 노출 확인 — 공개 조회 API가 open 설문 + 문항 3개 반환
    const res = await request.get(`/api/surveys/${slug}`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("open");
    expect(body.questions).toHaveLength(3);
  });
});
```

- [ ] 10.3 — 실행해 통과 확인(자격증명 있을 때): `cd /Users/seunguk.kang/Repos/inje-playground/frontend && E2E_ADMIN_EMAIL=$E2E_ADMIN_EMAIL E2E_ADMIN_PASSWORD=$E2E_ADMIN_PASSWORD npm run test:e2e -- survey-builder`. 기대: `1 passed`. 자격증명 미설정 환경이면 `1 skipped` (게이트 통과로 간주).
- [ ] 10.4 — 정합성 확인: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build && npm run lint`. 기대: 둘 다 에러 0.
- [ ] 10.5 — 커밋: `cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/e2e/helpers/auth.ts frontend/e2e/survey-builder.spec.ts && git commit -m "test(survey): e2e builder create/add/reorder/open flow" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"`. 기대: 2 files changed.

---

### Phase 2 완료 기준 (Definition of Done)
- [ ] 6개 관리 API 엔드포인트(설문 GET/POST·GET/PATCH/DELETE, 문항 GET/POST/PUT·PATCH/DELETE) admin 게이트(401/403)·slug 409·status 전이 409 동작.
- [ ] `/admin/surveys` 목록(상태배지·응답수), `/admin/surveys/new`(메타 생성), `/admin/surveys/[id]/edit`(빌더) 라우팅 동작.
- [ ] 빌더에서 타입선택·인라인편집·config(옵션/척도라벨/pre_post라벨/분석메타)·순서변경(드래그+버튼)·섹션·삭제 동작.
- [ ] `admin/layout.tsx`에 `ClipboardList` import 1회·`/admin/surveys` nav 1회만 존재(멱등, Phase1과 무충돌). `grep -c` 검증값: `ClipboardList` 2, `/admin/surveys` 1.
- [ ] `npm run build`(tsc) + `npm run lint` 클린.
- [ ] `survey-builder.spec.ts` E2E 통과(또는 자격증명 부재 시 skip).
- [ ] ADMIN_NAV에 "설문 관리" 노출.

---

**참고 — 본 Phase에서 다루지 않는 동결 계약 항목(후속 Phase):** `roles.ts`/`page.tsx`/`supabase-middleware.ts`의 `/survey` 진입점, 응답 폼(`components/survey/*`), 집계/내보내기 API(`analytics`·`export`), 대시보드/차트/KPI(`components/admin/surveys/charts/*`, `KpiCard`, `SegmentFilterBar`, `QuestionAggregateCard`), `survey-metrics.ts`/`survey-csv.ts`. E2E 5단계의 "노출 확인"은 Phase1 산출물 `GET /api/surveys/[slug]`를 Consumes로 검증한다.

**참고 — 진입점 공동 소유 처리(`admin/layout.tsx`):** `ADMIN_NAV` "설문 관리" 항목 + `ClipboardList` import는 Phase1 Task8과 본 Phase Task5가 공동 후보다. 단일 소유자를 강제하지 않고 Task5를 멱등(grep 확인 후 미등록일 때만 추가)으로 설계해, Phase1이 먼저 등록했든 아니든 라인 번호 앵커 불일치/중복 등록 없이 안전하게 수렴한다. `survey-metrics.ts`의 `isUserResponse`는 본 Phase 산출물이 아니며(후속 Phase), 동결 계약 §3의 value-key(`'never'`/`'rarely'`) 단일 정의를 따른다 — 본 Phase는 이를 참조·재정의하지 않는다.