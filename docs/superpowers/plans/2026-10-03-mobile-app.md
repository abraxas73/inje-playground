# 모바일 앱(Flutter 하이브리드) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이노크루가 Android·iOS 폰에서 플레이그라운드 전체 기능을 쓰는 Flutter 앱 — 로그인·탭·뭐 먹지·사다리·커피 타임은 네이티브, 나머지는 앱 안 WebView.

**Architecture:** 저장소 루트의 `mobile/`(Flutter, `frontend/`·`ppt-service/`와 같은 레벨)이 Supabase Microsoft OAuth로 세션을 갖고 기존 `/api/*`를 `Authorization: Bearer`로 호출한다. 서버(`frontend/`)는 Bearer 인증 분기 + 모바일 전용 라우트 2개 + WebView 세션 부트스트랩 페이지 1개만 추가한다. WebView는 서버가 발급한 일회용 토큰(`generateLink` magiclink → `verifyOtp`)으로 **자기 쿠키 세션**을 만들어 앱 세션과 리프레시 회전이 충돌하지 않게 한다.

**Tech Stack:** Flutter 3.44 stable · Dart 3 · `supabase_flutter`·`webview_flutter`·`go_router`·`flutter_riverpod`·`geolocator`·`url_launcher`·`shared_preferences`·`http`·`file_picker` · 서버는 Next.js 16(App Router)·`@supabase/ssr`·vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-mobile-app-design.md`

## Global Constraints

- 앱 코드는 **저장소 루트 `mobile/`** (frontend 아래가 아님). 서버 변경은 `frontend/` 안의 추가분만, 기존 웹 동작 불변(쿠키 경로 그대로).
- Flutter 3.44 stable. 대상 Android 8.0(API 26)+ / iOS 15+. 앱 표시 이름 "이노그리드", 번들/패키지 ID `com.innogrid.playground`, Dart 패키지명 `playground`, 딥링크 `innogrid://login-callback`.
- 로그인은 Microsoft(Azure)만. Supabase 프로젝트 `avooqcxehfeurjhqqgui`, anon 키는 `frontend/.env.local`의 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 값(공개 키). API 기본 주소 `https://inje-playground.vercel.app`(`--dart-define=API_BASE=`로 교체 가능).
- Flutter 의존성은 §Tech Stack의 9개뿐(`file_picker`는 Android WebView 파일 업로드용 — 스펙 §4의 8개에 Task 10에서 추가·스펙 반영). 그 외 추가 금지.
- 네이티브 API 호출은 전부 `lib/api/client.dart` 하나를 거친다: `Authorization: Bearer <accessToken>`, `User-Agent: InnogridApp/<버전> (<platform>)`, 401 → 세션 갱신 → **1회** 재시도 → 또 401이면 로그아웃.
- WebView 세션 토큰은 URL **조각(`#token=`)** 으로만 전달, 1회·1시간. 서버 로그·감사 detail에 토큰을 남기지 않는다. `/auth/mobile`의 `next`는 같은 오리진 경로만(`/`로 시작, `//`·스킴 금지).
- 저장 형식은 웹과 동일: 사다리 `POST /api/ladder-sessions {participants, results, bridges, bridgeDensity, mappings}`, 팀 `POST /api/team-sessions {title, participants, teamCount, cardHolderDistribution, teams}`.
- 커밋 메시지는 한국어 요약 + 저장소 관례의 attribution 트레일러. `git push` 전 `git pull --rebase origin main`. 서버 배포는 `frontend/`에서 `NODE_OPTIONS= vercel deploy --prod --yes` 후 `vercel inspect https://inje-playground.vercel.app`로 alias 확인.
- 비밀값(anon 키 제외)·토큰은 문서·로그·커밋에 쓰지 않는다. `frontend/.env.local`은 읽기만.

## Review Focus

1. **Bearer 토큰이 만료·위조된 요청** — 서버는 401 `{error}`를 주고, 앱은 갱신 1회 뒤 재시도, 또 401이면 로그인 화면으로(무한 재시도 금지). → Task 1(서버 vitest), Task 8(Dart 테스트).
2. **`/auth/mobile?next=` 오픈 리다이렉트** — `//evil.com`, `https://…`, 빈 값은 전부 `/`로. → Task 4.
3. **guest 역할 사용자** — 로그인은 되지만 네이티브 기능·웹 토큰은 막히고 안내 화면만 보여야 한다(`/api/mobile/web-token` 403). → Task 3, Task 7.
4. **WebView 세션 만료 루프** — 토큰 발급 → `/auth/mobile` → 또 `/login`으로 튕기면 두 번째에서 멈추고 오류 상태를 보여야 한다. → Task 10.
5. **사다리 결과 수 ≠ 참가자 수, 팀 설정 불가능 값** — 웹과 같은 문구로 막고 저장하지 않는다; 사다리 다리는 같은 행에 인접 금지·경로는 전단사. → Task 12, Task 13.

---

## Part A — 서버(`frontend/`)

### Task 1: Bearer 인증 분기 (`createServerSupabase` + 미들웨어)

**Files:**
- Modify: `frontend/src/lib/supabase-server.ts`
- Modify: `frontend/src/lib/supabase-middleware.ts:41-63`
- Test: `frontend/src/lib/__tests__/mobile-bearer-auth.test.ts`

**Interfaces:**
- Produces: `bearerToken(h: { get(name: string): string | null }): string | null`, `createBearerSupabase(token: string): SupabaseClient` (둘 다 `@/lib/supabase-server`에서 export). 기존 `createServerSupabase()`는 시그니처 불변 — Bearer가 있으면 그 클라이언트를 돌려준다.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/mobile-bearer-auth.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ auth: "" as string, created: [] as { opts: unknown; getUser: ReturnType<typeof vi.fn> }[] }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(m.auth ? { authorization: m.auth } : {}),
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (_u: string, _k: string, opts: unknown) => {
    const getUser = vi.fn(async (jwt?: string) => ({ data: { user: jwt ? { id: `user-of:${jwt}` } : null }, error: null }));
    m.created.push({ opts, getUser });
    return { auth: { getUser } };
  },
}));
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ kind: "cookie" }) }));
import { bearerToken, createServerSupabase } from "@/lib/supabase-server";

beforeEach(() => { m.auth = ""; m.created.length = 0; });

describe("bearerToken", () => {
  it("Bearer 헤더에서 토큰만 꺼내고, 없거나 형식이 다르면 null", () => {
    expect(bearerToken(new Headers({ authorization: "Bearer abc.def" }))).toBe("abc.def");
    expect(bearerToken(new Headers({ authorization: "bearer x" }))).toBe("x");
    expect(bearerToken(new Headers({ authorization: "Basic x" }))).toBeNull();
    expect(bearerToken(new Headers())).toBeNull();
  });
});

describe("createServerSupabase", () => {
  it("Bearer가 없으면 쿠키 클라이언트", async () => {
    expect(await createServerSupabase()).toEqual({ kind: "cookie" });
    expect(m.created).toHaveLength(0);
  });
  it("Bearer가 있으면 그 토큰을 전역 헤더로 쓰고, 인자 없는 getUser()도 그 토큰으로 검증한다", async () => {
    m.auth = "Bearer tok1";
    const client = await createServerSupabase();
    const { data } = await client.auth.getUser();
    expect(data.user).toEqual({ id: "user-of:tok1" });
    expect(m.created[0].getUser).toHaveBeenCalledWith("tok1");
    expect((m.created[0].opts as { global: { headers: Record<string, string> } }).global.headers.Authorization).toBe("Bearer tok1");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/mobile-bearer-auth.test.ts`
Expected: FAIL — `bearerToken`/export 없음.

- [ ] **Step 3: `supabase-server.ts` 구현**

```ts
// frontend/src/lib/supabase-server.ts
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

/** `Authorization: Bearer <jwt>`의 토큰. 모바일 앱(네이티브 화면)이 쿠키 대신 보낸다. */
export function bearerToken(h: { get(name: string): string | null }): string | null {
  const m = /^Bearer\s+(\S+)$/i.exec(h.get("authorization") ?? "");
  return m ? m[1] : null;
}

/**
 * 쿠키 세션 없이 사용자 JWT로 동작하는 클라이언트. PostgREST는 전역 헤더의 토큰으로 RLS를 적용한다.
 * supabase-js의 `getUser()`는 저장된 세션이 없으면 토큰을 보지 않으므로, 인자 없는 호출에 이 토큰을 기본값으로 넣어
 * 기존 라우트의 `supabase.auth.getUser()`가 그대로 동작하게 한다.
 */
export function createBearerSupabase(token: string): SupabaseClient {
  const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const getUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = (jwt?: string) => getUser(jwt ?? token);
  return client;
}

export async function createServerSupabase() {
  const token = bearerToken(await headers());
  if (token) return createBearerSupabase(token);
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component에서는 쿠키 설정 불가
          }
        },
      },
    }
  );
}
```

- [ ] **Step 4: 미들웨어 분기**

`frontend/src/lib/supabase-middleware.ts`의 `try {` 바로 아래 `const supabase = createServerClient(…)` 블록을 다음으로 바꾼다(나머지 로직은 그대로):

```ts
    // 모바일 앱의 네이티브 화면은 /api/*를 Bearer로 부른다 — 쿠키 갱신 없이 그 토큰으로 사용자·권한을 확인한다.
    const token = api ? bearerToken(request.headers) : null;
    const supabase = token
      ? createBearerSupabase(token)
      : createServerClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            cookies: {
              getAll() {
                return request.cookies.getAll();
              },
              setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value }) =>
                  request.cookies.set(name, value)
                );
                supabaseResponse = NextResponse.next({ request });
                cookiesToSet.forEach(({ name, value, options }) =>
                  supabaseResponse.cookies.set(name, value, options)
                );
              },
            },
          }
        );
```

파일 상단 import에 `import { bearerToken, createBearerSupabase } from "./supabase-server";` 추가.

- [ ] **Step 5: 테스트 통과·회귀 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/mobile-bearer-auth.test.ts && npx tsc --noEmit -p . && npx eslint src/lib/supabase-server.ts src/lib/supabase-middleware.ts`
Expected: 테스트 4개 PASS, tsc 0, eslint 0.

- [ ] **Step 6: 커밋**

```bash
git add frontend/src/lib/supabase-server.ts frontend/src/lib/supabase-middleware.ts frontend/src/lib/__tests__/mobile-bearer-auth.test.ts
git commit -m "feat(auth): /api/*에 Bearer 토큰 인증 분기 — 모바일 앱 네이티브 화면용, 쿠키 경로 불변"
```

---

### Task 2: `POST /api/mobile/login` — 로그인 기록 + 역할·권한

**Files:**
- Create: `frontend/src/app/api/mobile/login/route.ts`
- Test: `frontend/src/lib/__tests__/mobile-login-api.test.ts`

**Interfaces:**
- Produces: `POST /api/mobile/login` → `200 { email: string | null, role: "guest"|"user"|"admin", permissions: Record<string, boolean> }`, 비로그인 `401 {error}`. 역할 무관(guest도 기록·응답).

- [ ] **Step 1: 실패하는 테스트**

```ts
// frontend/src/lib/__tests__/mobile-login-api.test.ts
// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ user: true as boolean, role: "user" as string | null, permissions: null as unknown, login: vi.fn() }));
vi.mock("@/lib/supabase-server", () => ({ createServerSupabase: async () => ({
  auth: { getUser: async () => ({ data: { user: m.user ? { id: "u1", email: "a@innogrid.com" } : null } }) },
  from: (table: string) => ({ select: () => ({ eq: () => ({
    single: async () => ({ data: m.role ? { role: m.role } : null, error: m.role ? null : { message: "no row" } }),
    maybeSingle: async () => ({ data: m.permissions ? { permissions: m.permissions } : null, error: null }),
  }) }), _table: table }),
}) }));
vi.mock("@/lib/audit", () => ({ logLogin: m.login }));
import { POST } from "@/app/api/mobile/login/route";
const req = () => new Request("https://app.test/api/mobile/login", { method: "POST", headers: { "user-agent": "InnogridApp/1.0 (android)" } });
beforeEach(() => { m.user = true; m.role = "user"; m.permissions = null; m.login.mockReset(); });

it("로그인 사용자의 역할·권한을 돌려주고 login_history를 남긴다", async () => {
  m.permissions = { marketing: true };
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ email: "a@innogrid.com", role: "user", permissions: { marketing: true } });
  expect(m.login).toHaveBeenCalledTimes(1);
  expect(m.login.mock.calls[0][2]).toEqual({ userId: "u1", userEmail: "a@innogrid.com" });
});
it("guest도 기록하고 역할을 돌려준다(차단은 앱이 한다)", async () => {
  m.role = "guest";
  expect(await (await POST(req())).json()).toMatchObject({ role: "guest", permissions: {} });
  expect(m.login).toHaveBeenCalledTimes(1);
});
it("프로필이 없으면 guest로 본다", async () => { m.role = null; expect(await (await POST(req())).json()).toMatchObject({ role: "guest" }); });
it("비로그인 401, 기록 없음", async () => { m.user = false; expect((await POST(req())).status).toBe(401); expect(m.login).not.toHaveBeenCalled(); });
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/mobile-login-api.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 라우트 구현**

```ts
// frontend/src/app/api/mobile/login/route.ts
import { NextRequest, NextResponse } from "next/server";
import { logLogin } from "@/lib/audit";
import { isPagePermissions, type PagePermissions } from "@/lib/page-access";
import { createServerSupabase } from "@/lib/supabase-server";
import type { UserRole } from "@/lib/roles";

export const runtime = "nodejs";

/**
 * POST /api/mobile/login — 모바일 앱이 Microsoft OAuth 직후 한 번 부른다(Bearer).
 * 웹 /auth/callback처럼 login_history를 남기고(Audit 로그 kind login, user_agent로 앱 구분) 역할·페이지 권한을 돌려준다.
 * guest도 기록은 남긴다 — 네이티브 기능 차단은 앱이 역할로 한다.
 */
export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

  const profile = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  const role: UserRole = profile.data?.role === "admin" || profile.data?.role === "user" ? profile.data.role : "guest";
  let permissions: PagePermissions = {};
  if (role === "user") {
    const access = await supabase.from("user_page_access").select("permissions").eq("user_id", user.id).maybeSingle();
    if (access.data && isPagePermissions(access.data.permissions)) permissions = access.data.permissions;
  }
  await logLogin(supabase, request, { userId: user.id, userEmail: user.email ?? null });
  return NextResponse.json({ email: user.email ?? null, role, permissions }, { headers: { "Cache-Control": "no-store" } });
}
```

`@/lib/roles`의 `UserRole`이 `"guest" | "user" | "admin"`인지 확인(`frontend/src/lib/roles.ts`). 다르면 그 타입명을 쓴다.

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/mobile-login-api.test.ts && npx tsc --noEmit -p . && npx eslint src/app/api/mobile`
Expected: 4 PASS, tsc 0.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/app/api/mobile/login/route.ts frontend/src/lib/__tests__/mobile-login-api.test.ts
git commit -m "feat(mobile): POST /api/mobile/login — 앱 로그인 기록(login_history)과 역할·페이지 권한 응답"
```

---

### Task 3: `POST /api/mobile/web-token` — WebView용 일회용 토큰

**Files:**
- Create: `frontend/src/app/api/mobile/web-token/route.ts`
- Test: `frontend/src/lib/__tests__/mobile-web-token-api.test.ts`

**Interfaces:**
- Consumes: `requireUser()`(`@/lib/rfp/require-user`) → `{ ok, userId, role, admin }` (guest는 403 응답).
- Produces: `POST /api/mobile/web-token` → `200 { tokenHash: string }`. 앱(Task 10)은 이 값을 `/auth/mobile?next=…#token=<tokenHash>`에 넣는다.

- [ ] **Step 1: 실패하는 테스트**

```ts
// frontend/src/lib/__tests__/mobile-web-token-api.test.ts
// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const m = vi.hoisted(() => ({ ok: true as boolean, generate: vi.fn(), getUserById: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok
  ? { ok: true, userId: "u1", role: "user", admin: { auth: { admin: { getUserById: m.getUserById, generateLink: m.generate } } } }
  : { ok: false, response: NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 }) } }));
vi.mock("@/lib/audit", () => ({ logAudit: m.audit }));
import { POST } from "@/app/api/mobile/web-token/route";
const req = () => new Request("https://app.test/api/mobile/web-token", { method: "POST" });
beforeEach(() => {
  m.ok = true; m.audit.mockReset();
  m.getUserById.mockReset().mockResolvedValue({ data: { user: { id: "u1", email: "a@innogrid.com" } }, error: null });
  m.generate.mockReset().mockResolvedValue({ data: { properties: { hashed_token: "hash-1", action_link: "https://should-not-leak" } }, error: null });
});

it("magiclink hashed_token만 돌려주고 메일은 보내지 않는다", async () => {
  const res = await POST(req());
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ tokenHash: "hash-1" });
  expect(m.generate).toHaveBeenCalledWith({ type: "magiclink", email: "a@innogrid.com" });
  expect(m.audit).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(m.audit.mock.calls[0][2])).not.toContain("hash-1");
});
it("guest·비로그인은 requireUser 응답 그대로(403)", async () => { m.ok = false; expect((await POST(req())).status).toBe(403); expect(m.generate).not.toHaveBeenCalled(); });
it("발급 실패는 502", async () => { m.generate.mockResolvedValue({ data: null, error: { message: "boom" } }); expect((await POST(req())).status).toBe(502); });
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/mobile-web-token-api.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 라우트 구현**

```ts
// frontend/src/app/api/mobile/web-token/route.ts
import { NextRequest, NextResponse } from "next/server";
import { logAudit } from "@/lib/audit";
import { requireUser } from "@/lib/rfp/require-user";

export const runtime = "nodejs";

/**
 * POST /api/mobile/web-token — 앱 안 WebView가 자기 쿠키 세션을 만들 일회용 토큰.
 * 앱 세션을 복사하지 않는 이유: Supabase 리프레시 토큰 회전(재사용 간격 10초) 때문에 두 클라이언트가 한 세션을 나눠 쓰면
 * 세션이 통째로 끊긴다. generateLink(magiclink)는 메일을 보내지 않고 hashed_token만 돌려주며, 웹 /auth/mobile이
 * verifyOtp(type email)로 소비한다(1회·1시간). 토큰은 감사 로그에 남기지 않는다.
 */
export async function POST(request: NextRequest) {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { data: u, error: ue } = await r.admin.auth.admin.getUserById(r.userId);
  const email = u?.user?.email;
  if (ue || !email) return NextResponse.json({ error: "사용자 이메일을 확인하지 못했습니다." }, { status: 502 });
  const { data, error } = await r.admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = data?.properties?.hashed_token;
  if (error || !tokenHash) return NextResponse.json({ error: "웹 세션 토큰을 발급하지 못했습니다." }, { status: 502 });
  await logAudit(r.admin, request, { userId: r.userId, action: "모바일 웹 세션 발급", category: "mobile", detail: {} });
  return NextResponse.json({ tokenHash }, { headers: { "Cache-Control": "no-store" } });
}
```

`logAudit`의 `AuditEntry` 필드명(`userId`·`action`·`category`·`detail`)은 `frontend/src/lib/audit.ts`에서 확인해 맞춘다.

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/mobile-web-token-api.test.ts && npx tsc --noEmit -p . && npx eslint src/app/api/mobile`
Expected: 3 PASS.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/app/api/mobile/web-token/route.ts frontend/src/lib/__tests__/mobile-web-token-api.test.ts
git commit -m "feat(mobile): POST /api/mobile/web-token — WebView 별도 세션용 일회용 magiclink 토큰(메일 미발송)"
```

---

### Task 4: `/auth/mobile` 페이지 — 조각 토큰으로 쿠키 세션 생성

**Files:**
- Create: `frontend/src/lib/mobile/next-path.ts`
- Create: `frontend/src/app/auth/mobile/page.tsx`
- Test: `frontend/src/lib/__tests__/mobile-next-path.test.ts`

**Interfaces:**
- Produces: `safeNextPath(raw: string | null | undefined): string` — 같은 오리진 경로만 통과, 아니면 `/`. 페이지 `GET /auth/mobile?next=<경로>#token=<hash>`(공개 경로 — 미들웨어 `PUBLIC_PREFIXES`의 `/auth` 아래라 추가 설정 없음).

- [ ] **Step 1: 실패하는 테스트**

```ts
// frontend/src/lib/__tests__/mobile-next-path.test.ts
import { describe, expect, it } from "vitest";
import { safeNextPath } from "@/lib/mobile/next-path";

describe("safeNextPath", () => {
  it("같은 오리진 경로만 통과시키고 쿼리는 보존한다", () => {
    expect(safeNextPath("/ppt")).toBe("/ppt");
    expect(safeNextPath("/admin/settings?tab=ppt")).toBe("/admin/settings?tab=ppt");
  });
  it("오픈 리다이렉트가 될 값은 전부 /", () => {
    for (const v of ["//evil.com", "https://evil.com/x", "javascript:alert(1)", "evil.com", "/\\evil.com", "", null, undefined, "/%2F%2Fevil.com"]) {
      expect(safeNextPath(v)).toBe("/");
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/mobile-next-path.test.ts`
Expected: FAIL.

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/mobile/next-path.ts
/** /auth/mobile?next= 값 검증 — 같은 오리진의 절대 경로만. 그 외(스킴·//·역슬래시·인코딩된 //)는 홈으로. */
export function safeNextPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/";
  try {
    const decoded = decodeURIComponent(raw);
    if (decoded.startsWith("//") || decoded.includes("\\")) return "/";
  } catch {
    return "/";
  }
  return raw;
}
```

```tsx
// frontend/src/app/auth/mobile/page.tsx
"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createClient } from "@/lib/supabase";
import { safeNextPath } from "@/lib/mobile/next-path";

/**
 * 모바일 앱의 WebView가 처음 열 때 들어오는 페이지. 앱이 /api/mobile/web-token으로 받은 일회용 토큰을
 * URL 조각(#token=)으로 넘기면 여기서 verifyOtp로 쿠키 세션을 만들고 next로 이동한다.
 * 조각은 서버·Referer·감사 로그에 남지 않는다. 전체 새로고침으로 이동해 미들웨어가 새 쿠키를 보게 한다.
 */
function MobileAuth() {
  const sp = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const next = safeNextPath(sp.get("next"));
    const token = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("token");
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    if (!token) { setError("세션 토큰이 없습니다. 앱에서 다시 열어 주세요."); return; }
    createClient().auth.verifyOtp({ token_hash: token, type: "email" }).then(({ error: e }) => {
      if (e) setError(`세션을 만들지 못했습니다: ${e.message}`);
      else window.location.replace(next);
    });
  }, [sp]);
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      {error ? <Alert variant="destructive" className="max-w-md"><AlertDescription>{error}</AlertDescription></Alert>
        : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />로그인 상태를 준비하고 있습니다…</div>}
    </div>
  );
}

export default function MobileAuthPage() {
  return <Suspense fallback={null}><MobileAuth /></Suspense>;
}
```

- [ ] **Step 4: 통과 확인 + 수동 점검**

Run: `cd frontend && npx vitest run src/lib/__tests__/mobile-next-path.test.ts && npx tsc --noEmit -p . && npx eslint src/app/auth/mobile src/lib/mobile`
Expected: PASS. 그리고 로컬 `./frontend/scripts/restart-frontend.sh` 후 브라우저에서 `http://localhost:3003/auth/mobile?next=/ppt`(토큰 없음) → "세션 토큰이 없습니다" 문구, 로그인 리다이렉트 없음(공개 경로) 확인.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/mobile/next-path.ts frontend/src/app/auth/mobile/page.tsx frontend/src/lib/__tests__/mobile-next-path.test.ts
git commit -m "feat(mobile): /auth/mobile — WebView가 조각 토큰(verifyOtp)으로 자기 쿠키 세션을 만들고 next로 이동"
```

---

### Task 5: Supabase 리디렉션 허용 + 문서 + 서버 배포

**Files:**
- Create: `.claude/rules/mobile.md`
- Create: `docs/mobile-app.md`
- Modify: `CLAUDE.md`(Commands에 mobile 절, API Routes 줄, Architecture 규칙 파일 목록)
- Modify: `docs/superpowers/specs/2026-10-03-mobile-app-design.md:§4`(패키지 목록에 `file_picker` 추가)

- [ ] **Step 1: Supabase `uri_allow_list`에 딥링크 추가**

```bash
TOK=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d)
CUR=$(curl -s https://api.supabase.com/v1/projects/avooqcxehfeurjhqqgui/config/auth -H "Authorization: Bearer $TOK" | python3 -c 'import json,sys;print(json.load(sys.stdin)["uri_allow_list"])')
echo "$CUR"   # 기대: https://inje-playground.vercel.app/,http://localhost:3003/**
curl -s -X PATCH https://api.supabase.com/v1/projects/avooqcxehfeurjhqqgui/config/auth -H "Authorization: Bearer $TOK" -H "Content-Type: application/json" -d "{\"uri_allow_list\": \"$CUR,innogrid://login-callback\"}" | python3 -c 'import json,sys;print(json.load(sys.stdin)["uri_allow_list"])'
unset TOK
```
Expected: 출력 끝에 `,innogrid://login-callback`. 토큰 값은 출력하지 않는다.

- [ ] **Step 2: 규칙 파일**

```markdown
---
paths:
  - "mobile/**"
  - "frontend/src/app/api/mobile/**"
  - "frontend/src/app/auth/mobile/**"
  - "frontend/src/lib/mobile/**"
  - "frontend/src/lib/__tests__/mobile-*"
  - "docs/mobile-app.md"
---

# 모바일 앱(Flutter)

- 스펙 `docs/superpowers/specs/2026-10-03-mobile-app-design.md`, 계획 `docs/superpowers/plans/2026-10-03-mobile-app.md`, 런북 `docs/mobile-app.md`.
- 코드는 저장소 루트 `mobile/`(frontend와 같은 레벨). Flutter 3.44 stable, Android 8+/iOS 15+, 번들 ID `com.innogrid.playground`, 딥링크 `innogrid://login-callback`. 의존성은 pubspec의 9개뿐 — 추가는 스펙 변경으로.
- 하이브리드: 로그인·탭·뭐 먹지·사다리·커피 타임은 네이티브, 나머지는 WebView(`lib/web/`). 네이티브 API 호출은 `lib/api/client.dart`만 통해서(Bearer, 401 갱신 재시도 1회).
- 서버: `/api/*`는 `Authorization: Bearer`도 받는다(`createServerSupabase`·미들웨어 분기). `POST /api/mobile/login`(로그인 기록·역할·권한), `POST /api/mobile/web-token`(WebView용 일회용 magiclink 토큰), `/auth/mobile`(토큰 → 쿠키 세션 → next). WebView는 앱 세션을 복사하지 않는다(리프레시 회전 충돌).
- 토큰·세션 값은 로그·감사 detail·문서에 남기지 않는다. 감사 카테고리 `mobile`.
```

- [ ] **Step 3: 런북 `docs/mobile-app.md`(초안 — Task 14에서 설치 절차를 채운다)**

```markdown
# 모바일 앱(Flutter) 런북

## 구성
- `mobile/` Flutter 앱(Android·iOS). 운영 서버 `https://inje-playground.vercel.app`를 그대로 쓴다(`--dart-define=API_BASE=` 로 교체).
- 로그인: Supabase Microsoft OAuth → `innogrid://login-callback`(Supabase uri_allow_list에 등록, 2026-10-03). Azure 앱 등록은 변경 없음.
- 네이티브 화면은 `/api/*`를 Bearer로 호출. WebView는 `POST /api/mobile/web-token` → `/auth/mobile?next=…#token=…`으로 자기 세션을 만든다.

## 서버 쪽 확인
- `login_history`에 앱 로그인이 남는다(user_agent `InnogridApp/…`). Audit 로그 → 로그인 성공으로 집계.
- 감사 `모바일 웹 세션 발급`(category mobile) — 토큰은 기록하지 않는다.

## 문제 해결
| 증상 | 원인 | 조치 |
|---|---|---|
| 로그인 후 앱으로 안 돌아옴 | 딥링크 미등록 | Supabase 인증 설정 `uri_allow_list`에 `innogrid://login-callback`, Android intent-filter·iOS CFBundleURLTypes 확인 |
| 네이티브 화면 401 반복 | 토큰 만료·갱신 실패 | 앱이 로그인 화면으로 보낸다. 재로그인 |
| WebView가 로그인 페이지로 튕김 | 웹 토큰 발급 실패(guest·서비스 키) | `/api/mobile/web-token` 응답 확인. guest는 WebView를 열 수 없다 |

## 개발기 설치
(Task 14에서 채움)
```

- [ ] **Step 4: CLAUDE.md·스펙 갱신**

CLAUDE.md `## Commands`에 추가:
```markdown
### mobile (Flutter)

```bash
cd mobile && flutter pub get && flutter run                 # 연결된 기기/에뮬레이터
cd mobile && flutter test && flutter analyze                # 테스트·정적 분석
cd mobile && flutter build apk --debug                      # Android 디버그 APK (런북 docs/mobile-app.md)
```
```
`### API Routes` 끝에 한 줄: `` - `POST /api/mobile/login`, `POST /api/mobile/web-token`, 페이지 `/auth/mobile` — 모바일 앱 인증(규칙 `.claude/rules/mobile.md`, 런북 `docs/mobile-app.md`). `/api/*`는 `Authorization: Bearer`도 받는다 ``.
`## Architecture` 첫 문단의 규칙 파일 목록에 `mobile.md`(모바일 앱) 추가.
스펙 §4 패키지 줄: `shared_preferences`(…), `http` 뒤에 `, file_picker(Android WebView 파일 업로드 — webview_flutter_android의 setOnShowFileSelector가 선택기를 제공하지 않아 필요)` 추가하고 "이 외 추가 금지" 유지.

- [ ] **Step 5: 전체 테스트·배포·검증**

```bash
cd frontend && npx vitest run 2>&1 | tail -3 && npx tsc --noEmit -p . && npx eslint src
cd .. && git add -A .claude/rules/mobile.md docs/mobile-app.md CLAUDE.md docs/superpowers/specs/2026-10-03-mobile-app-design.md
git commit -m "docs(mobile): 규칙·런북·CLAUDE.md, Supabase 딥링크 허용(innogrid://login-callback)"
git pull --rebase origin main && git push origin main
cd frontend && NODE_OPTIONS= vercel deploy --prod --yes && vercel inspect https://inje-playground.vercel.app | grep -E "status|url"
curl -s -o /dev/null -w "%{http_code}\n" https://inje-playground.vercel.app/auth/mobile          # 200 (공개 경로)
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://inje-playground.vercel.app/api/mobile/login   # 401
curl -s -o /dev/null -w "%{http_code}\n" https://inje-playground.vercel.app/api/ppt/decks -H "Authorization: Bearer invalid"   # 401 (500 아님)
```
Expected: vitest 전체 통과, alias Ready, 상태 코드 200/401/401.

---

## Part B — 앱(`mobile/`)

### Task 6: Flutter 프로젝트 골격·설정·딥링크

**Files:**
- Create: `mobile/`(flutter create), `mobile/lib/config.dart`, `mobile/lib/main.dart`, `mobile/lib/app/router.dart`, `mobile/lib/app/theme.dart`
- Modify: `mobile/pubspec.yaml`, `mobile/android/app/build.gradle.kts`, `mobile/android/app/src/main/AndroidManifest.xml`, `mobile/ios/Runner/Info.plist`, `mobile/ios/Podfile`
- Test: `mobile/test/smoke_test.dart`

**Interfaces:**
- Produces: `Config.apiBase`, `Config.supabaseUrl`, `Config.supabaseAnonKey`, `Config.appVersion`, `Config.userAgent`; 라우트 이름 `/login`, `/guest`, `/`(탭 셸: `/food` `/ladder` `/team` `/more`), `/web?path=`. 뒤 Task들이 이 라우트에 화면을 끼운다.

- [ ] **Step 1: 프로젝트 생성·의존성**

```bash
cd /Users/seunguk.kang/Repos/inje-playground && mkdir -p mobile && cd mobile
flutter create --org com.innogrid --project-name playground --platforms android,ios --empty .
flutter pub add supabase_flutter webview_flutter go_router flutter_riverpod geolocator url_launcher shared_preferences http file_picker
flutter pub add --dev flutter_lints
grep -n "applicationId\|minSdk" android/app/build.gradle.kts
```
`applicationId = "com.innogrid.playground"` 확인. `minSdk = flutter.minSdkVersion` → `minSdk = 26`으로. `ios/Podfile` 첫 줄 `platform :ios, '15.0'`(주석 해제·수정), Xcode 프로젝트 `IPHONEOS_DEPLOYMENT_TARGET`도 15.0(`ios/Runner.xcodeproj/project.pbxproj`에서 `sed -i '' 's/IPHONEOS_DEPLOYMENT_TARGET = [0-9.]*/IPHONEOS_DEPLOYMENT_TARGET = 15.0/g'`).

- [ ] **Step 2: 플랫폼 설정**

`android/app/src/main/AndroidManifest.xml`: `<application android:label="이노그리드" …>`; `MainActivity`에 intent-filter 추가; 권한 추가.
```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION"/>
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION"/>
…
<activity android:name=".MainActivity" … android:launchMode="singleTop" …>
  …기존 intent-filter(MAIN/LAUNCHER)…
  <intent-filter>
    <action android:name="android.intent.action.VIEW"/>
    <category android:name="android.intent.category.DEFAULT"/>
    <category android:name="android.intent.category.BROWSABLE"/>
    <data android:scheme="innogrid" android:host="login-callback"/>
  </intent-filter>
</activity>
```
`ios/Runner/Info.plist`에 추가:
```xml
<key>CFBundleDisplayName</key><string>이노그리드</string>
<key>CFBundleURLTypes</key>
<array><dict><key>CFBundleURLSchemes</key><array><string>innogrid</string></array></dict></array>
<key>NSLocationWhenInUseUsageDescription</key><string>주변 식당·카페를 찾기 위해 현재 위치를 사용합니다.</string>
<key>LSApplicationQueriesSchemes</key><array><string>https</string><string>tel</string><string>kakaomap</string></array>
```

- [ ] **Step 3: 설정·테마·라우터 골격·main**

```dart
// mobile/lib/config.dart
class Config {
  static const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'https://inje-playground.vercel.app');
  static const supabaseUrl = 'https://avooqcxehfeurjhqqgui.supabase.co';
  /// 공개 anon 키(frontend NEXT_PUBLIC_SUPABASE_ANON_KEY와 같은 값). 빌드 시 --dart-define=SUPABASE_ANON_KEY= 로 덮어쓸 수 있다.
  static const supabaseAnonKey = String.fromEnvironment('SUPABASE_ANON_KEY', defaultValue: '<frontend/.env.local의 NEXT_PUBLIC_SUPABASE_ANON_KEY 값>');
  static const appVersion = '1.0.0'; // pubspec version과 맞춘다
  static const loginRedirect = 'innogrid://login-callback';
  static String userAgent(String platform) => 'InnogridApp/$appVersion ($platform)';
}
```
구현 시 `defaultValue`에 실제 anon 키 문자열을 넣는다(공개 키).

```dart
// mobile/lib/app/theme.dart
import 'package:flutter/material.dart';
ThemeData appTheme() => ThemeData(colorSchemeSeed: const Color(0xFF0284C7), useMaterial3: true, fontFamily: null);
```

```dart
// mobile/lib/app/router.dart  (골격 — 화면은 뒤 Task가 교체)
import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class StubScreen extends StatelessWidget {
  const StubScreen(this.title, {super.key});
  final String title;
  @override
  Widget build(BuildContext context) => Scaffold(appBar: AppBar(title: Text(title)), body: Center(child: Text(title)));
}

GoRouter buildRouter({required Listenable refresh, required String? Function(BuildContext, GoRouterState) redirect}) => GoRouter(
  initialLocation: '/food',
  refreshListenable: refresh,
  redirect: redirect,
  routes: [
    GoRoute(path: '/login', builder: (c, s) => const StubScreen('로그인')),
    GoRoute(path: '/guest', builder: (c, s) => const StubScreen('권한 안내')),
    GoRoute(path: '/web', builder: (c, s) => StubScreen('웹 ${s.uri.queryParameters['path'] ?? '/'}')),
    StatefulShellRoute.indexedStack(
      builder: (c, s, shell) => Scaffold(
        body: shell,
        bottomNavigationBar: NavigationBar(
          selectedIndex: shell.currentIndex,
          onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
          destinations: const [
            NavigationDestination(icon: Icon(Icons.restaurant), label: '뭐 먹지'),
            NavigationDestination(icon: Icon(Icons.stairs), label: '사다리'),
            NavigationDestination(icon: Icon(Icons.coffee), label: '커피 타임'),
            NavigationDestination(icon: Icon(Icons.more_horiz), label: '더보기'),
          ],
        ),
      ),
      branches: [
        StatefulShellBranch(routes: [GoRoute(path: '/food', builder: (c, s) => const StubScreen('뭐 먹지'))]),
        StatefulShellBranch(routes: [GoRoute(path: '/ladder', builder: (c, s) => const StubScreen('사다리'))]),
        StatefulShellBranch(routes: [GoRoute(path: '/team', builder: (c, s) => const StubScreen('커피 타임'))]),
        StatefulShellBranch(routes: [GoRoute(path: '/more', builder: (c, s) => const StubScreen('더보기'))]),
      ],
    ),
  ],
);
```

```dart
// mobile/lib/main.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'app/router.dart';
import 'app/theme.dart';
import 'config.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Supabase.initialize(url: Config.supabaseUrl, anonKey: Config.supabaseAnonKey);
  runApp(const ProviderScope(child: App()));
}

class App extends StatefulWidget {
  const App({super.key});
  @override
  State<App> createState() => _AppState();
}

class _AppState extends State<App> {
  late final GoRouter _router = buildRouter(refresh: ValueNotifier(0), redirect: (_, __) => null);
  @override
  Widget build(BuildContext context) => MaterialApp.router(title: '이노그리드', theme: appTheme(), routerConfig: _router);
}
```

- [ ] **Step 4: 스모크 테스트**

```dart
// mobile/test/smoke_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/router.dart';

void main() {
  testWidgets('탭 셸이 4개 탭을 그린다', (tester) async {
    final router = buildRouter(refresh: ValueNotifier(0), redirect: (_, __) => null);
    await tester.pumpWidget(MaterialApp.router(routerConfig: router));
    await tester.pumpAndSettle();
    for (final label in ['뭐 먹지', '사다리', '커피 타임', '더보기']) {
      expect(find.text(label), findsWidgets);
    }
  });
}
```

Run: `cd mobile && flutter analyze && flutter test`
Expected: analyze 0 issues, 1 test PASS. 이어서 `flutter build apk --debug`로 Android 빌드가 되는지(수 분), 가능하면 `open -a Simulator && flutter run -d iPhone`로 iOS 시뮬레이터 부팅 확인.

- [ ] **Step 5: 커밋**

`mobile/.gitignore`는 flutter create가 만든 것(build/·.dart_tool/ 등)을 쓴다.
```bash
cd .. && git add mobile && git commit -m "feat(mobile): Flutter 프로젝트 골격 — 탭 셸·라우터·딥링크(innogrid://)·권한·Android 26+/iOS 15+"
```

---

### Task 7: 인증 — Microsoft 로그인·세션 상태·guest 안내·로그아웃

**Files:**
- Create: `mobile/lib/auth/session.dart`, `mobile/lib/auth/login_screen.dart`, `mobile/lib/auth/guest_screen.dart`
- Modify: `mobile/lib/main.dart`, `mobile/lib/app/router.dart`(redirect·화면 연결)
- Test: `mobile/test/auth/session_test.dart`

**Interfaces:**
- Produces: `class AppSession { final String? email; final String role; final Map<String, bool> permissions; bool get isGuest; bool get isAdmin; }`, `sessionProvider: AsyncNotifierProvider<SessionNotifier, AppSession?>`(null = 로그아웃), `SessionNotifier.signIn()`, `signOut()`, `reload()`; `AppSession.fromJson(Map)`; `authRefreshListenable(ref)`; `redirectFor(session: AsyncValue<AppSession?>, location)`.
- Consumes: `POST /api/mobile/login`(Task 2) 응답 `{email, role, permissions}`.

- [ ] **Step 1: 실패하는 테스트(순수 부분)**

```dart
// mobile/test/auth/session_test.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/auth/session.dart';

void main() {
  test('AppSession.fromJson — 역할·권한 파싱, 빈 권한', () {
    final s = AppSession.fromJson({'email': 'a@innogrid.com', 'role': 'user', 'permissions': {'marketing': true}});
    expect(s.email, 'a@innogrid.com');
    expect(s.isGuest, false);
    expect(s.permissions['marketing'], true);
    expect(AppSession.fromJson({'email': null, 'role': 'guest', 'permissions': {}}).isGuest, true);
    expect(AppSession.fromJson({'role': 'admin'}).isAdmin, true);
  });
  test('redirectFor — 로그아웃은 /login, guest는 /guest, 로그인 사용자는 그대로, 로딩 중엔 이동 안 함', () {
    expect(redirectFor(const AsyncValue.data(null), '/food'), '/login');
    expect(redirectFor(const AsyncValue.data(null), '/login'), null);
    final guest = AppSession(email: 'g@x', role: 'guest', permissions: const {});
    expect(redirectFor(AsyncValue.data(guest), '/food'), '/guest');
    expect(redirectFor(AsyncValue.data(guest), '/guest'), null);
    final user = AppSession(email: 'u@x', role: 'user', permissions: const {});
    expect(redirectFor(AsyncValue.data(user), '/food'), null);
    expect(redirectFor(AsyncValue.data(user), '/login'), '/food');
    expect(redirectFor(const AsyncValue.loading(), '/food'), null);
  });
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && flutter test test/auth/session_test.dart`
Expected: FAIL — `session.dart` 없음.

- [ ] **Step 3: 구현**

```dart
// mobile/lib/auth/session.dart
import 'dart:async';
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:webview_flutter/webview_flutter.dart';
import '../config.dart';

class AppSession {
  AppSession({required this.email, required this.role, required this.permissions});
  final String? email;
  final String role; // guest | user | admin
  final Map<String, bool> permissions;
  bool get isGuest => role == 'guest';
  bool get isAdmin => role == 'admin';

  factory AppSession.fromJson(Map<String, dynamic> j) => AppSession(
        email: j['email'] as String?,
        role: (j['role'] as String?) ?? 'guest',
        permissions: {for (final e in ((j['permissions'] as Map?) ?? const {}).entries) if (e.value is bool) e.key as String: e.value as bool},
      );
}

/// 라우터 redirect 규칙(순수 함수). null = 이동 없음.
String? redirectFor(AsyncValue<AppSession?> session, String location) {
  if (session.isLoading) return null;
  final s = session.asData?.value;
  if (s == null) return location == '/login' ? null : '/login';
  if (s.isGuest) return location == '/guest' ? null : '/guest';
  if (location == '/login' || location == '/guest') return '/food';
  return null;
}

class SessionNotifier extends AsyncNotifier<AppSession?> {
  GoTrueClient get _auth => Supabase.instance.client.auth;
  StreamSubscription<AuthState>? _sub;

  @override
  Future<AppSession?> build() async {
    _sub ??= _auth.onAuthStateChange.listen((e) {
      if (e.event == AuthChangeEvent.signedIn) reload();
      if (e.event == AuthChangeEvent.signedOut) state = const AsyncValue.data(null);
    });
    ref.onDispose(() => _sub?.cancel());
    if (_auth.currentSession == null) return null;
    return _fetchSession();
  }

  /// POST /api/mobile/login — 로그인 기록 + 역할·권한. 실패하면 세션은 유지하되 guest로 두지 않고 예외를 올린다.
  Future<AppSession> _fetchSession() async {
    final token = _auth.currentSession?.accessToken;
    if (token == null) throw StateError('세션이 없습니다.');
    final res = await http.post(Uri.parse('${Config.apiBase}/api/mobile/login'),
        headers: {'Authorization': 'Bearer $token', 'User-Agent': Config.userAgent(defaultTargetPlatform.name)});
    if (res.statusCode != 200) throw Exception('로그인 확인 실패(${res.statusCode})');
    return AppSession.fromJson(jsonDecode(res.body) as Map<String, dynamic>);
  }

  Future<void> reload() async {
    state = const AsyncValue.loading();
    state = await AsyncValue.guard(_fetchSession);
  }

  Future<void> signIn() async {
    await _auth.signInWithOAuth(OAuthProvider.azure, redirectTo: Config.loginRedirect, scopes: 'email openid profile');
    // 돌아오면 onAuthStateChange(signedIn) → reload()
  }

  Future<void> signOut() async {
    try { await WebViewCookieManager().clearCookies(); } catch (_) {}
    await _auth.signOut();
    state = const AsyncValue.data(null);
  }
}

final sessionProvider = AsyncNotifierProvider<SessionNotifier, AppSession?>(SessionNotifier.new);

/// go_router refreshListenable — 세션 상태가 바뀔 때마다 redirect 재평가.
class SessionListenable extends ChangeNotifier {
  SessionListenable(Ref ref) { ref.listen(sessionProvider, (_, __) => notifyListeners()); }
}
final sessionListenableProvider = Provider<SessionListenable>(SessionListenable.new);
```

```dart
// mobile/lib/auth/login_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'session.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  String? _error;
  bool _busy = false;
  Future<void> _login() async {
    setState(() { _busy = true; _error = null; });
    try { await ref.read(sessionProvider.notifier).signIn(); }
    catch (e) { setState(() => _error = '로그인에 실패했습니다: $e'); }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider);
    return Scaffold(
      body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
        const Icon(Icons.grid_view_rounded, size: 56, color: Color(0xFF0284C7)),
        const SizedBox(height: 12),
        Text('이노그리드', style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 4),
        const Text('이노크루를 위한 서비스에 로그인하세요', style: TextStyle(color: Colors.grey)),
        const SizedBox(height: 24),
        FilledButton.icon(onPressed: _busy || session.isLoading ? null : _login, icon: const Icon(Icons.login), label: const Text('Microsoft 계정으로 로그인')),
        if (session.hasError) Padding(padding: const EdgeInsets.only(top: 12), child: Text('${session.error}', style: const TextStyle(color: Colors.red))),
        if (_error != null) Padding(padding: const EdgeInsets.only(top: 12), child: Text(_error!, style: const TextStyle(color: Colors.red))),
        if (session.hasError) TextButton(onPressed: () => ref.read(sessionProvider.notifier).reload(), child: const Text('다시 시도')),
      ]))),
    );
  }
}
```

```dart
// mobile/lib/auth/guest_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'session.dart';

class GuestScreen extends ConsumerWidget {
  const GuestScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final email = ref.watch(sessionProvider).asData?.value?.email ?? '';
    return Scaffold(body: Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
      const Icon(Icons.lock_outline, size: 48, color: Colors.grey),
      const SizedBox(height: 12),
      const Text('사용자 권한이 필요합니다', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
      const SizedBox(height: 8),
      Text('$email 계정은 아직 승인되지 않았습니다. 관리자에게 권한을 요청해 주세요.', textAlign: TextAlign.center, style: const TextStyle(color: Colors.grey)),
      const SizedBox(height: 24),
      OutlinedButton(onPressed: () => ref.read(sessionProvider.notifier).reload(), child: const Text('다시 확인')),
      TextButton(onPressed: () => ref.read(sessionProvider.notifier).signOut(), child: const Text('로그아웃')),
    ]))));
  }
}
```

`router.dart`: `/login` → `const LoginScreen()`, `/guest` → `const GuestScreen()`. `main.dart`의 `App`을 세션을 보는 위젯으로 바꾼다:
```dart
// mobile/lib/main.dart (App 부분 교체)
class App extends ConsumerStatefulWidget {
  const App({super.key});
  @override
  ConsumerState<App> createState() => _AppState();
}

class _AppState extends ConsumerState<App> {
  late final GoRouter _router = buildRouter(
    refresh: ref.read(sessionListenableProvider),
    redirect: (context, state) => redirectFor(ref.read(sessionProvider), state.matchedLocation),
  );
  @override
  Widget build(BuildContext context) => MaterialApp.router(title: '이노그리드', theme: appTheme(), routerConfig: _router);
}
```
(`import 'auth/session.dart';`, `import 'package:go_router/go_router.dart';` 추가. `/login`은 redirect가 세션 없을 때만 머무르게 하므로 `initialLocation: '/food'` 그대로.)

- [ ] **Step 4: 테스트·실기기 확인**

Run: `cd mobile && flutter analyze && flutter test`
Expected: PASS. 실기기(Android 기기 또는 iOS 실기기 — OAuth 딥링크는 시뮬레이터보다 실기기에서 확인)에서 `flutter run`: Microsoft 로그인 → 앱으로 복귀 → 탭 셸 표시. 운영 DB `login_history`에 user_agent `InnogridApp/…` 행이 1건 생겼는지 확인(Supabase Management API SQL: `select logged_in_at, user_agent from login_history order by logged_in_at desc limit 3`).

- [ ] **Step 5: 커밋**

```bash
git add mobile && git commit -m "feat(mobile): Microsoft 로그인·세션 상태(Riverpod)·guest 안내·로그아웃, /api/mobile/login 연동"
```

---

### Task 8: API 클라이언트 — Bearer·401 갱신 재시도

**Files:**
- Create: `mobile/lib/api/client.dart`
- Test: `mobile/test/api/client_test.dart`

**Interfaces:**
- Produces: `abstract class TokenSource { Future<String?> accessToken(); Future<String?> refreshToken(); Future<void> onUnauthorized(); }`, `class ApiException implements Exception { final int status; final String message; }`, `class ApiClient { ApiClient({required http.Client httpClient, required TokenSource tokens, required String baseUrl, required String userAgent}); Future<dynamic> getJson(String path, {Map<String, String>? query}); Future<dynamic> postJson(String path, [Object? body]); Future<dynamic> patchJson(String path, Object body); Future<dynamic> deleteJson(String path, {Map<String, String>? query, Object? body}); }`, `apiClientProvider: Provider<ApiClient>`(Supabase 세션을 TokenSource로).

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/api/client_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';

class FakeTokens implements TokenSource {
  FakeTokens(this.token, {this.next});
  String? token; final String? next; int refreshes = 0; int unauthorized = 0;
  @override Future<String?> accessToken() async => token;
  @override Future<String?> refreshToken() async { refreshes++; token = next; return next; }
  @override Future<void> onUnauthorized() async { unauthorized++; }
}

ApiClient client(http.Client h, FakeTokens t) => ApiClient(httpClient: h, tokens: t, baseUrl: 'https://x.test', userAgent: 'InnogridApp/t (test)');

void main() {
  test('Bearer·User-Agent·쿼리를 붙이고 JSON을 돌려준다', () async {
    late http.Request seen;
    final c = client(MockClient((r) async { seen = r; return http.Response('{"ok":1}', 200); }), FakeTokens('tok'));
    expect(await c.getJson('/api/a', query: {'q': '한글'}), {'ok': 1});
    expect(seen.headers['Authorization'], 'Bearer tok');
    expect(seen.headers['User-Agent'], 'InnogridApp/t (test)');
    expect(seen.url.toString(), 'https://x.test/api/a?q=%ED%95%9C%EA%B8%80');
  });
  test('401이면 갱신 후 한 번만 재시도한다', () async {
    var calls = 0;
    final t = FakeTokens('old', next: 'new');
    final c = client(MockClient((r) async { calls++; return r.headers['Authorization'] == 'Bearer new' ? http.Response('{"ok":true}', 200) : http.Response('{"error":"x"}', 401); }), t);
    expect(await c.postJson('/api/b', {'a': 1}), {'ok': true});
    expect(calls, 2); expect(t.refreshes, 1); expect(t.unauthorized, 0);
  });
  test('재시도도 401이면 onUnauthorized 후 ApiException(401)', () async {
    var calls = 0;
    final t = FakeTokens('old', next: 'still-bad');
    final c = client(MockClient((r) async { calls++; return http.Response('{"error":"인증이 필요합니다."}', 401); }), t);
    await expectLater(c.getJson('/api/c'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
    expect(calls, 2); expect(t.unauthorized, 1);
  });
  test('그 외 오류는 {error} 메시지를 그대로, 본문이 JSON이 아니면 상태 코드', () async {
    final c = client(MockClient((r) async => http.Response('{"error":"장소와 구성원이 필요합니다"}', 400, headers: {'content-type': 'application/json; charset=utf-8'})), FakeTokens('t'));
    await expectLater(c.postJson('/api/d'), throwsA(isA<ApiException>().having((e) => e.message, 'message', '장소와 구성원이 필요합니다')));
    final c2 = client(MockClient((r) async => http.Response('<html>', 502)), FakeTokens('t'));
    await expectLater(c2.getJson('/api/e'), throwsA(isA<ApiException>().having((e) => e.message, 'message', contains('502'))));
  });
  test('204·빈 본문은 null', () async {
    final c = client(MockClient((r) async => http.Response('', 204)), FakeTokens('t'));
    expect(await c.deleteJson('/api/f', query: {'place_id': '1'}), isNull);
  });
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && flutter test test/api/client_test.dart` → FAIL(모듈 없음).

- [ ] **Step 3: 구현**

```dart
// mobile/lib/api/client.dart
import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config.dart';

abstract class TokenSource {
  Future<String?> accessToken();
  /// 세션 갱신 후 새 액세스 토큰(실패 시 null)
  Future<String?> refreshToken();
  /// 갱신해도 401 → 호출자가 로그아웃 처리
  Future<void> onUnauthorized();
}

class ApiException implements Exception {
  ApiException(this.status, this.message);
  final int status;
  final String message;
  @override
  String toString() => message;
}

/// 모든 네이티브 API 호출의 단일 경로. Bearer·User-Agent 부착, 401이면 갱신 후 1회 재시도, 오류는 {error} 메시지로 통일.
class ApiClient {
  ApiClient({required http.Client httpClient, required TokenSource tokens, required String baseUrl, required String userAgent})
      : _http = httpClient, _tokens = tokens, _base = baseUrl, _ua = userAgent;
  final http.Client _http;
  final TokenSource _tokens;
  final String _base;
  final String _ua;

  Future<dynamic> getJson(String path, {Map<String, String>? query}) => _send('GET', path, query: query);
  Future<dynamic> postJson(String path, [Object? body]) => _send('POST', path, body: body);
  Future<dynamic> patchJson(String path, Object body) => _send('PATCH', path, body: body);
  Future<dynamic> deleteJson(String path, {Map<String, String>? query, Object? body}) => _send('DELETE', path, query: query, body: body);

  Future<dynamic> _send(String method, String path, {Map<String, String>? query, Object? body}) async {
    var token = await _tokens.accessToken();
    var res = await _request(method, path, token, query, body);
    if (res.statusCode == 401) {
      token = await _tokens.refreshToken();
      res = await _request(method, path, token, query, body);
      if (res.statusCode == 401) {
        await _tokens.onUnauthorized();
        throw ApiException(401, _errorMessage(res));
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) throw ApiException(res.statusCode, _errorMessage(res));
    if (res.statusCode == 204 || res.body.isEmpty) return null;
    return jsonDecode(utf8.decode(res.bodyBytes));
  }

  Future<http.Response> _request(String method, String path, String? token, Map<String, String>? query, Object? body) {
    final uri = Uri.parse('$_base$path').replace(queryParameters: query);
    final headers = {'User-Agent': _ua, 'Accept': 'application/json', if (token != null) 'Authorization': 'Bearer $token', if (body != null) 'Content-Type': 'application/json'};
    final req = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);
    return _http.send(req).then(http.Response.fromStream);
  }

  String _errorMessage(http.Response res) {
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      if (j is Map && j['error'] is String) return j['error'] as String;
    } catch (_) {}
    return '요청에 실패했습니다 (HTTP ${res.statusCode})';
  }
}

class SupabaseTokenSource implements TokenSource {
  SupabaseTokenSource(this._auth, this._onUnauthorized);
  final GoTrueClient _auth;
  final Future<void> Function() _onUnauthorized;
  @override Future<String?> accessToken() async => _auth.currentSession?.accessToken;
  @override Future<String?> refreshToken() async {
    try { return (await _auth.refreshSession()).session?.accessToken; } catch (_) { return null; }
  }
  @override Future<void> onUnauthorized() => _onUnauthorized();
}

final apiClientProvider = Provider<ApiClient>((ref) {
  final auth = Supabase.instance.client.auth;
  return ApiClient(
    httpClient: http.Client(),
    tokens: SupabaseTokenSource(auth, () => auth.signOut()),
    baseUrl: Config.apiBase,
    userAgent: Config.userAgent(defaultTargetPlatform.name),
  );
});
```

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && flutter analyze && flutter test`
Expected: 5 PASS(+이전 테스트).

- [ ] **Step 5: 커밋**

```bash
git add mobile && git commit -m "feat(mobile): API 클라이언트 — Bearer·User-Agent, 401 갱신 후 1회 재시도, {error} 메시지 통일"
```

---

### Task 9: 더보기 — 페이지 카탈로그·역할 필터·화면

**Files:**
- Create: `mobile/lib/more/catalog.dart`, `mobile/lib/more/more_screen.dart`
- Modify: `mobile/lib/app/router.dart`(`/more` 연결)
- Test: `mobile/test/more/catalog_test.dart`

**Interfaces:**
- Produces: `class PageEntry { final String key, href, label, group; final String minRole; }`, `const pages: List<PageEntry>`(웹 `PAGES`와 동일, hidden 제외), `const adminPages: List<PageEntry>`, `List<PageEntry> visiblePages(AppSession s)`, `List<PageEntry> visibleAdminPages(AppSession s)`.
- Consumes: `AppSession`(Task 7).

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/more/catalog_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/auth/session.dart';
import 'package:playground/more/catalog.dart';

AppSession s(String role, [Map<String, bool> p = const {}]) => AppSession(email: 'x@innogrid.com', role: role, permissions: p);

void main() {
  test('guest는 일상 항목만, 숨김 항목(guide)은 아무도 못 본다', () {
    final keys = visiblePages(s('guest')).map((e) => e.key).toList();
    expect(keys, ['food', 'ladder', 'team', 'survey']);
    expect(pages.any((e) => e.key == 'guide'), false);
  });
  test('user는 마케팅을 제외한 전부, 권한이 있으면 마케팅도', () {
    final keys = visiblePages(s('user')).map((e) => e.key);
    expect(keys, containsAll(['usage_code', 'usage_chat', 'usage_perf', 'rfp', 'ppt', 'people_news']));
    expect(keys, isNot(contains('marketing')));
    expect(visiblePages(s('user', {'marketing': true})).map((e) => e.key), contains('marketing'));
    expect(visiblePages(s('user', {'rfp': false})).map((e) => e.key), isNot(contains('rfp')));
  });
  test('admin은 전부 + 관리자 메뉴', () {
    expect(visiblePages(s('admin')).length, pages.length);
    expect(visibleAdminPages(s('admin')).map((e) => e.href), contains('/admin/ppt'));
    expect(visibleAdminPages(s('user')), isEmpty);
  });
}
```

- [ ] **Step 2: 실패 확인** — `flutter test test/more/catalog_test.dart` → FAIL.

- [ ] **Step 3: 구현**

```dart
// mobile/lib/more/catalog.dart
// 웹 frontend/src/lib/page-access.ts PAGES·canUsePage와 같은 규칙. 웹 카탈로그가 바뀌면 여기도 맞춘다.
import '../auth/session.dart';

class PageEntry {
  const PageEntry(this.key, this.href, this.label, this.group, this.minRole);
  final String key, href, label, group, minRole;
}

const pages = <PageEntry>[
  PageEntry('food', '/food', '뭐 먹지', 'daily', 'guest'),
  PageEntry('ladder', '/ladder', '사다리', 'daily', 'guest'),
  PageEntry('team', '/team', '커피 타임', 'daily', 'guest'),
  PageEntry('survey', '/survey', '설문', 'daily', 'guest'),
  PageEntry('usage_code', '/usage/code', 'Claude Code', 'ai', 'user'),
  PageEntry('usage_chat', '/usage/chat', 'Claude 채팅', 'ai', 'user'),
  PageEntry('usage_perf', '/usage/perf', '성과', 'ai', 'user'),
  PageEntry('rfp', '/rfp', 'RFP 분석', 'work', 'user'),
  PageEntry('ppt', '/ppt', 'PPT 만들기', 'work', 'user'),
  PageEntry('people_news', '/people-news', '인사·부고', 'work', 'user'),
  PageEntry('marketing', '/marketing', '마케팅 Master DB', 'work', 'user'),
];
const defaultDenied = {'marketing'};

const adminPages = <PageEntry>[
  PageEntry('admin_users', '/admin/users', '사용자 관리', 'admin', 'admin'),
  PageEntry('admin_page_permissions', '/admin/page-permissions', '페이지 접근 권한', 'admin', 'admin'),
  PageEntry('admin_settings', '/admin/settings', '시스템 설정', 'admin', 'admin'),
  PageEntry('admin_guide', '/admin/guide', '가이드 관리', 'admin', 'admin'),
  PageEntry('admin_chat_history', '/admin/chat-history', '질의/응답 관리', 'admin', 'admin'),
  PageEntry('admin_surveys', '/admin/surveys', '설문 관리', 'admin', 'admin'),
  PageEntry('admin_claude_usage', '/admin/claude-usage', 'Claude Code 사용량', 'admin', 'admin'),
  PageEntry('admin_claude_chat', '/admin/claude-chat', 'Claude 사용량 (Chat/Cowork)', 'admin', 'admin'),
  PageEntry('admin_claude_cost', '/admin/claude-cost', '비용 관리', 'admin', 'admin'),
  PageEntry('admin_perf', '/admin/perf', '성과', 'admin', 'admin'),
  PageEntry('admin_directory', '/admin/directory', '조직/팀', 'admin', 'admin'),
  PageEntry('admin_rfp_catalog', '/admin/rfp-catalog', 'RFP 솔루션 카탈로그', 'admin', 'admin'),
  PageEntry('admin_ppt', '/admin/ppt', 'PPT 덱 관리', 'admin', 'admin'),
  PageEntry('admin_audit', '/admin/audit', 'Audit 로그', 'admin', 'admin'),
];

const _rank = {'guest': 0, 'user': 1, 'admin': 2};

bool canUsePage(AppSession s, PageEntry p) {
  if (s.isAdmin) return true;
  if ((_rank[s.role] ?? 0) < (_rank[p.minRole] ?? 0)) return false;
  final explicit = s.permissions[p.key];
  if (explicit != null) return explicit;
  return !defaultDenied.contains(p.key);
}

List<PageEntry> visiblePages(AppSession s) => pages.where((p) => canUsePage(s, p)).toList();
List<PageEntry> visibleAdminPages(AppSession s) => s.isAdmin ? adminPages : const [];
```

```dart
// mobile/lib/more/more_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../auth/session.dart';
import '../config.dart';
import 'catalog.dart';

const _groupLabel = {'daily': '일상', 'ai': 'AI 사용량', 'work': '업무', 'admin': '관리자'};

class MoreScreen extends ConsumerWidget {
  const MoreScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final session = ref.watch(sessionProvider).asData?.value;
    if (session == null) return const SizedBox.shrink();
    final groups = <String, List<PageEntry>>{};
    for (final p in visiblePages(session)) (groups[p.group] ??= []).add(p);
    final admin = visibleAdminPages(session);
    void open(String path) => context.push('/web?path=${Uri.encodeComponent(path)}');
    return Scaffold(
      appBar: AppBar(title: const Text('더보기')),
      body: ListView(children: [
        for (final g in ['daily', 'ai', 'work']) if (groups[g] != null) ...[
          _header(_groupLabel[g]!),
          for (final p in groups[g]!) ListTile(title: Text(p.label), trailing: const Icon(Icons.chevron_right), onTap: () => open(p.href)),
        ],
        if (admin.isNotEmpty) ...[_header('관리자'), for (final p in admin) ListTile(title: Text(p.label), trailing: const Icon(Icons.chevron_right), onTap: () => open(p.href))],
        _header('계정'),
        ListTile(leading: const Icon(Icons.settings_outlined), title: const Text('설정 (내 팀·알림 채널·Microsoft 연결)'), onTap: () => open('/settings')),
        ListTile(leading: const Icon(Icons.person_outline), title: Text(session.email ?? ''), subtitle: Text('역할 ${session.role} · 앱 ${Config.appVersion}')),
        ListTile(leading: const Icon(Icons.logout), title: const Text('로그아웃'), onTap: () => ref.read(sessionProvider.notifier).signOut()),
      ]),
    );
  }
  Widget _header(String t) => Padding(padding: const EdgeInsets.fromLTRB(16, 16, 16, 4), child: Text(t, style: const TextStyle(fontSize: 12, color: Colors.grey, fontWeight: FontWeight.w600)));
}
```

`router.dart`의 `/more` 빌더를 `const MoreScreen()`으로. 일상 항목 중 네이티브가 있는 `food`·`ladder`·`team`은 더보기에서도 웹으로 열린다(웹 버전 보기) — 그대로 둔다.

- [ ] **Step 4: 통과 확인** — `cd mobile && flutter analyze && flutter test` → PASS.

- [ ] **Step 5: 커밋**

```bash
git add mobile && git commit -m "feat(mobile): 더보기 — 웹 페이지 카탈로그·역할/권한 필터·관리자 메뉴·로그아웃"
```

---

### Task 10: WebView 화면 — 별도 세션 부트스트랩·링크·다운로드·업로드

**Files:**
- Create: `mobile/lib/web/web_session.dart`, `mobile/lib/web/web_screen.dart`
- Modify: `mobile/lib/app/router.dart`(`/web` 연결)
- Test: `mobile/test/web/web_session_test.dart`

**Interfaces:**
- Produces: `class WebNavPolicy { static NavAction decide(Uri target, {required Uri appOrigin}); }`, `enum NavAction { inApp, external, loginRedirect }`, `String bootstrapUrl({required String apiBase, required String nextPath, required String tokenHash})`, 화면 `WebScreen(path)`.
- Consumes: `ApiClient.postJson('/api/mobile/web-token')` → `{tokenHash}`(Task 3·8).

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/web/web_session_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/web/web_session.dart';

void main() {
  final origin = Uri.parse('https://inje-playground.vercel.app');
  test('같은 오리진 페이지는 앱 안, /login은 세션 부트스트랩 신호, 다른 도메인·파일은 외부', () {
    expect(WebNavPolicy.decide(Uri.parse('https://inje-playground.vercel.app/ppt/abc'), appOrigin: origin), NavAction.inApp);
    expect(WebNavPolicy.decide(Uri.parse('https://inje-playground.vercel.app/login?next=/ppt'), appOrigin: origin), NavAction.loginRedirect);
    expect(WebNavPolicy.decide(Uri.parse('https://place.map.kakao.com/123'), appOrigin: origin), NavAction.external);
    expect(WebNavPolicy.decide(Uri.parse('https://avooqcxehfeurjhqqgui.supabase.co/storage/v1/object/sign/ppt/x.pptx?token=1'), appOrigin: origin), NavAction.external);
    expect(WebNavPolicy.decide(Uri.parse('https://inje-playground.vercel.app/api/ppt/decks/1/versions/1/file'), appOrigin: origin), NavAction.external);
    expect(WebNavPolicy.decide(Uri.parse('tel:021234567'), appOrigin: origin), NavAction.external);
  });
  test('부트스트랩 URL은 next를 쿼리에, 토큰을 조각에 넣는다', () {
    expect(bootstrapUrl(apiBase: 'https://inje-playground.vercel.app', nextPath: '/admin/settings?tab=ppt', tokenHash: 'h1'),
        'https://inje-playground.vercel.app/auth/mobile?next=%2Fadmin%2Fsettings%3Ftab%3Dppt#token=h1');
  });
}
```

- [ ] **Step 2: 실패 확인** — `flutter test test/web/web_session_test.dart` → FAIL.

- [ ] **Step 3: 구현**

```dart
// mobile/lib/web/web_session.dart
import '../api/client.dart';

enum NavAction { inApp, external, loginRedirect }

/// WebView 내비게이션 정책(순수). 같은 오리진 페이지만 앱 안에서, /login으로 가면 세션이 없다는 뜻, 파일·다른 도메인·tel 등은 시스템으로.
class WebNavPolicy {
  static const _fileExt = ['.pptx', '.xlsx', '.docx', '.pdf', '.zip', '.csv', '.yaml'];
  static NavAction decide(Uri target, {required Uri appOrigin}) {
    if (target.scheme != 'http' && target.scheme != 'https') return NavAction.external;
    if (target.host != appOrigin.host) return NavAction.external;
    final p = target.path;
    if (p == '/login' || p.startsWith('/login/')) return NavAction.loginRedirect;
    if (p.endsWith('/file') || _fileExt.any((e) => p.toLowerCase().endsWith(e))) return NavAction.external;
    return NavAction.inApp;
  }
}

String bootstrapUrl({required String apiBase, required String nextPath, required String tokenHash}) =>
    '$apiBase/auth/mobile?next=${Uri.encodeComponent(nextPath)}#token=$tokenHash';

/// POST /api/mobile/web-token → 부트스트랩 URL. 호출자는 이걸 WebView에 로드한다.
Future<String> webBootstrapUrl(ApiClient api, String apiBase, String nextPath) async {
  final j = await api.postJson('/api/mobile/web-token') as Map<String, dynamic>;
  return bootstrapUrl(apiBase: apiBase, nextPath: nextPath, tokenHash: j['tokenHash'] as String);
}
```

```dart
// mobile/lib/web/web_screen.dart
import 'dart:io' show Platform;
import 'package:file_picker/file_picker.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import '../api/client.dart';
import '../config.dart';
import 'web_session.dart';

/// 웹 기능을 앱 안에서 연다. 세션은 앱과 별개 — /login으로 튕기면 web-token으로 부트스트랩, 연속 2회 실패면 오류 상태.
class WebScreen extends ConsumerStatefulWidget {
  const WebScreen({super.key, required this.path});
  final String path;
  @override
  ConsumerState<WebScreen> createState() => _WebScreenState();
}

class _WebScreenState extends ConsumerState<WebScreen> {
  late final WebViewController _c;
  final _origin = Uri.parse(Config.apiBase);
  String _title = '';
  bool _loading = true;
  String? _error;
  int _bootstraps = 0;

  @override
  void initState() {
    super.initState();
    _c = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(
        onNavigationRequest: _onNav,
        onPageStarted: (_) => setState(() { _loading = true; _error = null; }),
        onPageFinished: (_) async { final t = await _c.getTitle(); if (mounted) setState(() { _loading = false; _title = t ?? ''; }); },
        onWebResourceError: (e) { if (e.isForMainFrame ?? true) setState(() { _loading = false; _error = '페이지를 불러오지 못했습니다 (${e.description})'; }); },
      ));
    _setUserAgent().then((_) => _c.loadRequest(Uri.parse('${Config.apiBase}${widget.path}')));
    if (Platform.isAndroid) {
      (_c.platform as AndroidWebViewController).setOnShowFileSelector((params) async {
        final r = await FilePicker.platform.pickFiles(allowMultiple: params.mode == FileSelectorMode.openMultiple);
        return r?.files.where((f) => f.path != null).map((f) => Uri.file(f.path!).toString()).toList() ?? [];
      });
    }
  }

  Future<void> _setUserAgent() async {
    final ua = await _c.getUserAgent();
    await _c.setUserAgent('${ua ?? ''} ${Config.userAgent(Platform.operatingSystem)}'.trim());
  }

  Future<NavigationDecision> _onNav(NavigationRequest req) async {
    final uri = Uri.parse(req.url);
    switch (WebNavPolicy.decide(uri, appOrigin: _origin)) {
      case NavAction.inApp:
        if (uri.path.startsWith('/auth/mobile')) _bootstraps = 0; // 부트스트랩 페이지 자체는 통과
        return NavigationDecision.navigate;
      case NavAction.external:
        launchUrl(uri, mode: LaunchMode.externalApplication);
        return NavigationDecision.prevent;
      case NavAction.loginRedirect:
        _bootstrap(uri.queryParameters['next'] ?? widget.path);
        return NavigationDecision.prevent;
    }
  }

  Future<void> _bootstrap(String nextPath) async {
    if (_bootstraps >= 2) { setState(() { _loading = false; _error = '로그인 상태를 만들지 못했습니다. 다시 시도해 주세요.'; }); return; }
    _bootstraps++;
    try {
      final url = await webBootstrapUrl(ref.read(apiClientProvider), Config.apiBase, nextPath.startsWith('/') ? nextPath : widget.path);
      await _c.loadRequest(Uri.parse(url));
    } on ApiException catch (e) {
      setState(() { _loading = false; _error = e.message; });
    } catch (e) {
      setState(() { _loading = false; _error = '로그인 상태를 만들지 못했습니다: $e'; });
    }
  }

  @override
  Widget build(BuildContext context) => PopScope(
        canPop: false,
        onPopInvokedWithResult: (didPop, _) async { if (didPop) return; if (await _c.canGoBack()) { _c.goBack(); } else if (context.mounted) { Navigator.of(context).pop(); } },
        child: Scaffold(
          appBar: AppBar(
            title: Text(_title.isEmpty ? widget.path : _title, overflow: TextOverflow.ellipsis),
            actions: [
              IconButton(icon: const Icon(Icons.refresh), onPressed: () => _c.reload()),
              IconButton(icon: const Icon(Icons.open_in_browser), tooltip: '브라우저로 열기', onPressed: () => launchUrl(Uri.parse('${Config.apiBase}${widget.path}'), mode: LaunchMode.externalApplication)),
            ],
            bottom: _loading ? const PreferredSize(preferredSize: Size.fromHeight(2), child: LinearProgressIndicator(minHeight: 2)) : null,
          ),
          body: _error != null
              ? Center(child: Padding(padding: const EdgeInsets.all(24), child: Column(mainAxisSize: MainAxisSize.min, children: [
                  Text(_error!, textAlign: TextAlign.center),
                  const SizedBox(height: 12),
                  FilledButton(onPressed: () { setState(() { _error = null; _bootstraps = 0; }); _c.loadRequest(Uri.parse('${Config.apiBase}${widget.path}')); }, child: const Text('다시 시도')),
                ])))
              : WebViewWidget(controller: _c),
        ),
      );
}
```

`router.dart`: `/web` → `WebScreen(path: s.uri.queryParameters['path'] ?? '/')`. `pubspec.yaml`에 `webview_flutter_android`가 직접 의존성으로 필요하면(`import` 오류 시) `flutter pub add webview_flutter_android webview_flutter_wkwebview`(webview_flutter의 플랫폼 구현 패키지 — 별도 의존성으로 세지 않는다).

- [ ] **Step 4: 통과 확인·실기기 확인**

Run: `cd mobile && flutter analyze && flutter test` → PASS.
실기기: 더보기 → "PPT 만들기" → 처음에 `/login`으로 튕기는 대신 `/auth/mobile` → `/ppt`가 로그인 상태로 열림. 뒤로 → 다른 항목 열기 → 부트스트랩 없이 바로 열림(쿠키 유지). PPT 덱 다운로드 → 시스템 브라우저로. 운영 Audit 로그에 "모바일 웹 세션 발급" 1건.

- [ ] **Step 5: 커밋**

```bash
git add mobile && git commit -m "feat(mobile): WebView 화면 — 별도 세션 부트스트랩(web-token→/auth/mobile), 외부 링크·파일은 시스템 브라우저, Android 파일 업로드"
```

---

### Task 11: 뭐 먹지 — 모델·저장소·화면

**Files:**
- Create: `mobile/lib/features/food/models.dart`, `mobile/lib/features/food/repository.dart`, `mobile/lib/features/food/prefs.dart`, `mobile/lib/features/food/food_screen.dart`, `mobile/lib/features/food/recommend_sheet.dart`, `mobile/lib/features/food/location.dart`
- Modify: `mobile/lib/app/router.dart`
- Test: `mobile/test/food/models_test.dart`

**Interfaces:**
- Produces: `KakaoPlace.fromJson`, `FoodFavorite.fromJson`, `FoodLocation {double x, y; String address}`(JSON 저장), `FoodFilters {category, subCategory, detailCategory, radius, maxResults}`; `FoodRepository(api)`: `search(...)`, `categories(group, {sub})`, `geocode(query)`, `reverseGeocode(x,y)`, `favorites()`, `addFavorite(KakaoPlace)`, `removeFavorite(placeId)`, `decide({place, members, sendToChannel})`, `payco({address, distance})`.
- Consumes: `ApiClient`(Task 8), 웹 API 입출력(스펙 §3).

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/food/models_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/food/models.dart';

void main() {
  test('KakaoPlace — 카카오 응답(문자열 좌표·거리)을 읽는다', () {
    final p = KakaoPlace.fromJson({'id': '1', 'place_name': '김밥천국', 'category_name': '음식점 > 분식', 'category_group_code': 'FD6', 'category_group_name': '음식점', 'phone': '', 'address_name': '서울 강남구', 'road_address_name': '서울 강남구 테헤란로 1', 'x': '127.03', 'y': '37.50', 'place_url': 'http://place.map.kakao.com/1', 'distance': '120'});
    expect(p.distanceM, 120); expect(p.x, 127.03); expect(p.shortCategory, '분식'); expect(p.address, '서울 강남구 테헤란로 1');
  });
  test('FoodFavorite — null 필드 허용, 즐겨찾기 POST 본문은 웹과 같은 키', () {
    final f = FoodFavorite.fromJson({'id': 'f1', 'place_id': '1', 'place_name': 'A', 'category_name': null, 'address': null, 'road_address': null, 'phone': null, 'place_url': null, 'x': null, 'y': null, 'created_at': '2026-10-03T00:00:00Z'});
    expect(f.placeId, '1');
    final body = favoriteBody(KakaoPlace.fromJson({'id': '2', 'place_name': 'B', 'category_name': 'c', 'category_group_code': 'FD6', 'category_group_name': '', 'phone': '02', 'address_name': 'a', 'road_address_name': 'r', 'x': '1', 'y': '2', 'place_url': 'u', 'distance': '5'}));
    expect(body.keys, containsAll(['place_id', 'place_name', 'category_name', 'address', 'road_address', 'phone', 'place_url', 'x', 'y']));
    expect(body['x'], 1.0);
  });
  test('FoodLocation·FoodFilters — 기기 저장 JSON 왕복, 기본값', () {
    final loc = FoodLocation(x: 127.0, y: 37.5, address: '판교');
    expect(FoodLocation.fromJson(loc.toJson()).address, '판교');
    final f = FoodFilters.defaults;
    expect(f.radius, 500); expect(f.maxResults, 30); expect(f.category, 'ALL');
    expect(FoodFilters.fromJson(f.copyWith(radius: 1000).toJson()).radius, 1000);
  });
}
```

- [ ] **Step 2: 실패 확인** — `flutter test test/food/models_test.dart` → FAIL.

- [ ] **Step 3: 모델·저장소·prefs·위치**

```dart
// mobile/lib/features/food/models.dart
class KakaoPlace {
  KakaoPlace({required this.id, required this.name, required this.categoryName, required this.categoryGroupCode, required this.phone, required this.addressName, required this.roadAddressName, required this.x, required this.y, required this.placeUrl, required this.distanceM});
  final String id, name, categoryName, categoryGroupCode, phone, addressName, roadAddressName, placeUrl;
  final double x, y;
  final int distanceM;
  String get address => roadAddressName.isNotEmpty ? roadAddressName : addressName;
  String get shortCategory => categoryName.split('>').last.trim();
  factory KakaoPlace.fromJson(Map<String, dynamic> j) => KakaoPlace(
        id: '${j['id']}', name: j['place_name'] as String? ?? '', categoryName: j['category_name'] as String? ?? '', categoryGroupCode: j['category_group_code'] as String? ?? '',
        phone: j['phone'] as String? ?? '', addressName: j['address_name'] as String? ?? '', roadAddressName: j['road_address_name'] as String? ?? '',
        x: double.tryParse('${j['x']}') ?? 0, y: double.tryParse('${j['y']}') ?? 0, placeUrl: j['place_url'] as String? ?? '', distanceM: int.tryParse('${j['distance']}') ?? 0);
}

class FoodFavorite {
  FoodFavorite({required this.id, required this.placeId, required this.name, this.categoryName, this.address, this.roadAddress, this.phone, this.placeUrl, this.x, this.y});
  final String id, placeId, name;
  final String? categoryName, address, roadAddress, phone, placeUrl;
  final double? x, y;
  factory FoodFavorite.fromJson(Map<String, dynamic> j) => FoodFavorite(
        id: '${j['id']}', placeId: '${j['place_id']}', name: j['place_name'] as String? ?? '', categoryName: j['category_name'] as String?, address: j['address'] as String?,
        roadAddress: j['road_address'] as String?, phone: j['phone'] as String?, placeUrl: j['place_url'] as String?, x: (j['x'] as num?)?.toDouble(), y: (j['y'] as num?)?.toDouble());
}

/// POST /api/food/favorites 본문 — 웹 FoodPage의 toggleFavorite와 같은 키
Map<String, dynamic> favoriteBody(KakaoPlace p) => {
      'place_id': p.id, 'place_name': p.name, 'category_name': p.categoryName, 'address': p.addressName, 'road_address': p.roadAddressName,
      'phone': p.phone, 'place_url': p.placeUrl, 'x': p.x, 'y': p.y,
    };

class FoodLocation {
  FoodLocation({required this.x, required this.y, required this.address});
  final double x, y; // x=경도, y=위도 (카카오 규약)
  final String address;
  Map<String, dynamic> toJson() => {'x': x, 'y': y, 'address': address};
  factory FoodLocation.fromJson(Map<String, dynamic> j) => FoodLocation(x: (j['x'] as num).toDouble(), y: (j['y'] as num).toDouble(), address: j['address'] as String? ?? '');
}

class FoodFilters {
  const FoodFilters({required this.category, required this.subCategory, required this.detailCategory, required this.radius, required this.maxResults});
  final String category; // ALL | FD6 | CE7
  final String subCategory, detailCategory;
  final int radius, maxResults;
  static const defaults = FoodFilters(category: 'ALL', subCategory: '', detailCategory: '', radius: 500, maxResults: 30);
  FoodFilters copyWith({String? category, String? subCategory, String? detailCategory, int? radius, int? maxResults}) => FoodFilters(
      category: category ?? this.category, subCategory: subCategory ?? this.subCategory, detailCategory: detailCategory ?? this.detailCategory, radius: radius ?? this.radius, maxResults: maxResults ?? this.maxResults);
  Map<String, dynamic> toJson() => {'category': category, 'subCategory': subCategory, 'detailCategory': detailCategory, 'radius': radius, 'maxResults': maxResults};
  factory FoodFilters.fromJson(Map<String, dynamic> j) => FoodFilters(
      category: j['category'] as String? ?? 'ALL', subCategory: j['subCategory'] as String? ?? '', detailCategory: j['detailCategory'] as String? ?? '',
      radius: (j['radius'] as num?)?.toInt() ?? 500, maxResults: (j['maxResults'] as num?)?.toInt() ?? 30);
}
```

```dart
// mobile/lib/features/food/repository.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import 'models.dart';

class FoodRepository {
  FoodRepository(this._api);
  final ApiClient _api;

  /// GET /api/food/search — 웹 FoodPage와 같은 쿼리(category 'ALL'도 그대로 보낸다, 서버가 FD6·CE7를 합친다). 응답 `{documents, meta}`.
  Future<List<KakaoPlace>> search({required FoodLocation loc, required FoodFilters f, String keyword = ''}) async {
    final j = await _api.getJson('/api/food/search', query: {
      'x': '${loc.x}', 'y': '${loc.y}', 'radius': '${f.radius}', 'category_group_code': f.category,
      if (f.category != 'ALL' && f.subCategory.isNotEmpty) 'sub_category': f.subCategory,
      if (f.category != 'ALL' && f.detailCategory.isNotEmpty) 'detail_category': f.detailCategory,
      if (keyword.isNotEmpty) 'keyword': keyword, 'max_results': '${f.maxResults}',
    }) as Map<String, dynamic>;
    return ((j['documents'] as List?) ?? []).map((e) => KakaoPlace.fromJson(e as Map<String, dynamic>)).toList();
  }
  /// GET /api/food/categories → string[]
  Future<List<String>> categories(String group, {String sub = ''}) async =>
      ((await _api.getJson('/api/food/categories', query: {'category_group_code': group, if (sub.isNotEmpty) 'sub_category': sub})) as List).cast<String>();
  /// GET /api/food/geocode?query → GeoResult[] {address, road_address, x, y, type, place_name?}. 라벨은 웹 AddressSearchModal과 같이 "건물명 (도로명주소)".
  Future<List<FoodLocation>> geocode(String query) async {
    final list = (await _api.getJson('/api/food/geocode', query: {'query': query})) as List;
    return list.map((e) {
      final m = e as Map<String, dynamic>;
      final road = (m['road_address'] as String?)?.isNotEmpty == true ? m['road_address'] as String : (m['address'] as String? ?? '');
      final label = m['type'] == 'place' && (m['place_name'] as String?)?.isNotEmpty == true ? '${m['place_name']} ($road)' : road;
      return FoodLocation(x: double.parse('${m['x']}'), y: double.parse('${m['y']}'), address: label);
    }).toList();
  }
  /// GET /api/food/reverse-geocode?x&y → {address: string|null}
  Future<String?> reverseGeocode(double x, double y) async => ((await _api.getJson('/api/food/reverse-geocode', query: {'x': '$x', 'y': '$y'})) as Map<String, dynamic>)['address'] as String?;
  Future<List<FoodFavorite>> favorites() async => ((await _api.getJson('/api/food/favorites')) as List).map((e) => FoodFavorite.fromJson(e as Map<String, dynamic>)).toList();
  Future<void> addFavorite(KakaoPlace p) => _api.postJson('/api/food/favorites', favoriteBody(p));
  Future<void> removeFavorite(String placeId) => _api.deleteJson('/api/food/favorites', query: {'place_id': placeId});
  /// POST /api/food/decide — 웹 FoodRecommendModal과 같은 본문. 응답 {decision, webhook_sent, personal_messages_sent, dm_errors}
  Future<Map<String, dynamic>> decide({required KakaoPlace place, required List<String> members, required bool sendToChannel}) async =>
      (await _api.postJson('/api/food/decide', {'place_name': place.name, 'place_url': place.placeUrl, 'category_name': place.categoryName, 'address': place.address, 'members': members, 'send_to_channel': sendToChannel})) as Map<String, dynamic>;
  /// POST /api/food/payco {address, distance} → PAYCO 응답 `{result: [{mrcCd, name, categoryName, address, telNo, distance, latitude, longitude}]}`. 웹과 같이 KakaoPlace로 변환.
  /// address는 웹 searchPayco처럼 "건물명 (도로명주소)"면 괄호 안만 보낸다.
  Future<List<KakaoPlace>> payco({required String address, required int distance}) async {
    final paren = RegExp(r'\(([^)]+)\)\s*$').firstMatch(address);
    final j = await _api.postJson('/api/food/payco', {'address': paren?.group(1)?.trim() ?? address, 'distance': distance}) as Map<String, dynamic>;
    return ((j['result'] as List?) ?? []).map((e) { final m = e as Map<String, dynamic>; return KakaoPlace(
      id: 'payco_${m['mrcCd']}', name: m['name'] as String? ?? '', categoryName: m['categoryName'] as String? ?? '', categoryGroupCode: '', phone: m['telNo'] as String? ?? '',
      addressName: m['address'] as String? ?? '', roadAddressName: m['address'] as String? ?? '', x: double.tryParse('${m['longitude']}') ?? 0, y: double.tryParse('${m['latitude']}') ?? 0,
      placeUrl: '', distanceM: (m['distance'] as num?)?.toInt() ?? 0); }).toList();
  }
}
final foodRepositoryProvider = Provider((ref) => FoodRepository(ref.watch(apiClientProvider)));
```

```dart
// mobile/lib/features/food/prefs.dart
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import 'models.dart';

class FoodPrefs {
  static const _loc = 'food-location', _filters = 'food-filters';
  static Future<FoodLocation?> location() async { final s = (await SharedPreferences.getInstance()).getString(_loc); return s == null ? null : FoodLocation.fromJson(jsonDecode(s) as Map<String, dynamic>); }
  static Future<void> saveLocation(FoodLocation l) async => (await SharedPreferences.getInstance()).setString(_loc, jsonEncode(l.toJson()));
  static Future<FoodFilters> filters() async { final s = (await SharedPreferences.getInstance()).getString(_filters); return s == null ? FoodFilters.defaults : FoodFilters.fromJson(jsonDecode(s) as Map<String, dynamic>); }
  static Future<void> saveFilters(FoodFilters f) async => (await SharedPreferences.getInstance()).setString(_filters, jsonEncode(f.toJson()));
}
```

```dart
// mobile/lib/features/food/location.dart
import 'package:geolocator/geolocator.dart';

class LocationDenied implements Exception { LocationDenied(this.message, {this.canOpenSettings = false}); final String message; final bool canOpenSettings; }

/// 현재 위치(경도 x, 위도 y). 권한 거부·서비스 꺼짐은 LocationDenied로 — 화면이 주소 검색으로 유도한다.
Future<({double x, double y})> currentPosition() async {
  if (!await Geolocator.isLocationServiceEnabled()) throw LocationDenied('위치 서비스가 꺼져 있습니다.', canOpenSettings: true);
  var p = await Geolocator.checkPermission();
  if (p == LocationPermission.denied) p = await Geolocator.requestPermission();
  if (p == LocationPermission.denied || p == LocationPermission.deniedForever) throw LocationDenied('위치 권한이 없습니다. 주소로 찾아 주세요.', canOpenSettings: p == LocationPermission.deniedForever);
  final pos = await Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 10)));
  return (x: pos.longitude, y: pos.latitude);
}
```

- [ ] **Step 4: 화면**

```dart
// mobile/lib/features/food/food_screen.dart  (핵심 구조 — 상태는 StatefulWidget 안, 저장소는 Riverpod)
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../api/client.dart';
import 'location.dart';
import 'models.dart';
import 'prefs.dart';
import 'recommend_sheet.dart';
import 'repository.dart';

class FoodScreen extends ConsumerStatefulWidget {
  const FoodScreen({super.key});
  @override
  ConsumerState<FoodScreen> createState() => _FoodScreenState();
}

class _FoodScreenState extends ConsumerState<FoodScreen> {
  FoodLocation? _loc;
  FoodFilters _f = FoodFilters.defaults;
  List<KakaoPlace> _places = [];
  List<FoodFavorite> _favs = [];
  List<KakaoPlace> _payco = [];
  bool _busy = false, _showFavs = false;
  String? _error;
  final _keyword = TextEditingController();
  FoodRepository get _repo => ref.read(foodRepositoryProvider);

  @override
  void initState() { super.initState(); _init(); }

  Future<void> _init() async {
    _f = await FoodPrefs.filters();
    _loc = await FoodPrefs.location();
    if (_loc == null) await _useCurrentLocation(); else setState(() {});
    await _loadFavorites();
  }

  Future<void> _useCurrentLocation() async {
    setState(() { _busy = true; _error = null; });
    try {
      final p = await currentPosition();
      final addr = await _repo.reverseGeocode(p.x, p.y) ?? '${p.y.toStringAsFixed(5)}, ${p.x.toStringAsFixed(5)}'; // 웹과 같이 주소를 못 찾으면 좌표 문자열
      _loc = FoodLocation(x: p.x, y: p.y, address: addr);
      await FoodPrefs.saveLocation(_loc!);
    } on LocationDenied catch (e) {
      _error = e.message;
      if (e.canOpenSettings && mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message), action: SnackBarAction(label: '설정', onPressed: Geolocator.openLocationSettings)));
    } catch (e) { _error = '$e'; }
    finally { if (mounted) setState(() => _busy = false); }
  }

  Future<void> _search() async {
    final loc = _loc; if (loc == null) { setState(() => _error = '위치를 먼저 정해 주세요.'); return; }
    setState(() { _busy = true; _error = null; _showFavs = false; });
    try { _places = await _repo.search(loc: loc, f: _f, keyword: _keyword.text.trim()); }
    on ApiException catch (e) { _error = e.message; } catch (e) { _error = '$e'; }
    finally { if (mounted) setState(() => _busy = false); }
  }
  Future<void> _searchPayco() async {
    final loc = _loc;
    if (loc == null || loc.address.isEmpty || RegExp(r'^\d+\.\d+\s*,\s*\d+\.\d+$').hasMatch(loc.address.trim())) { setState(() => _error = "PAYCO 검색은 주소가 필요합니다. '주소 변경'으로 주소를 설정해주세요."); return; }
    setState(() => _busy = true);
    try { _payco = await _repo.payco(address: loc.address, distance: _f.radius); } on ApiException catch (e) { _error = e.message; }
    finally { if (mounted) setState(() => _busy = false); }
  }
  Future<void> _loadFavorites() async { try { _favs = await _repo.favorites(); if (mounted) setState(() {}); } catch (_) {} }
  bool _isFav(String id) => _favs.any((f) => f.placeId == id);
  Future<void> _toggleFav(KakaoPlace p) async {
    try { if (_isFav(p.id)) { await _repo.removeFavorite(p.id); } else { await _repo.addFavorite(p); } await _loadFavorites(); }
    on ApiException catch (e) { if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.message))); }
  }
  Future<void> _changeAddress() async {
    final picked = await showDialog<FoodLocation>(context: context, builder: (_) => _AddressDialog(search: _repo.geocode));
    if (picked != null) { _loc = picked; await FoodPrefs.saveLocation(picked); setState(() {}); }
  }
  Future<void> _openFilters() async {
    final f = await showModalBottomSheet<FoodFilters>(context: context, isScrollControlled: true, builder: (_) => _FilterSheet(initial: _f, categories: _repo.categories));
    if (f != null) { _f = f; await FoodPrefs.saveFilters(f); setState(() {}); }
  }

  @override
  Widget build(BuildContext context) {
    final list = _showFavs ? _favs.map(_favToPlace).toList() : _places;
    return Scaffold(
      appBar: AppBar(title: const Text('뭐 먹지'), actions: [IconButton(icon: const Icon(Icons.tune), onPressed: _openFilters)]),
      body: Column(children: [
        ListTile(leading: const Icon(Icons.place_outlined), title: Text(_loc?.address ?? '위치 없음', maxLines: 1, overflow: TextOverflow.ellipsis), subtitle: Text('반경 ${_f.radius}m · ${_f.category == 'ALL' ? '전체' : _f.category == 'FD6' ? '음식점' : '카페'}${_f.subCategory.isNotEmpty ? ' · ${_f.subCategory}' : ''}'),
          trailing: Wrap(children: [IconButton(icon: const Icon(Icons.my_location), tooltip: '현재 위치', onPressed: _useCurrentLocation), TextButton(onPressed: _changeAddress, child: const Text('주소 변경'))])),
        Padding(padding: const EdgeInsets.fromLTRB(12, 0, 12, 8), child: Row(children: [
          Expanded(child: TextField(controller: _keyword, decoration: const InputDecoration(hintText: '키워드(선택)', isDense: true, border: OutlineInputBorder()), onSubmitted: (_) => _search())),
          const SizedBox(width: 8), FilledButton(onPressed: _busy ? null : _search, child: const Text('검색')),
        ])),
        Padding(padding: const EdgeInsets.symmetric(horizontal: 12), child: Row(children: [
          SegmentedButton<bool>(segments: const [ButtonSegment(value: false, label: Text('검색 결과')), ButtonSegment(value: true, label: Text('즐겨찾기'))], selected: {_showFavs}, onSelectionChanged: (s) => setState(() => _showFavs = s.first)),
          const Spacer(),
          TextButton.icon(onPressed: _busy ? null : _searchPayco, icon: const Icon(Icons.credit_card, size: 18), label: const Text('PAYCO')),
          FilledButton.tonalIcon(onPressed: _places.isEmpty ? null : () => showRecommendSheet(context, ref, _places), icon: const Icon(Icons.casino), label: const Text('오늘 뭐 먹지')),
        ])),
        if (_busy) const LinearProgressIndicator(minHeight: 2),
        if (_error != null) Padding(padding: const EdgeInsets.all(12), child: Text(_error!, style: const TextStyle(color: Colors.red))),
        Expanded(child: ListView(children: [
          if (!_showFavs && _payco.isNotEmpty) ...[const ListTile(dense: true, title: Text('PAYCO 식권 가맹점', style: TextStyle(fontWeight: FontWeight.w600))), for (final p in _payco) _tile(p)],
          if (list.isEmpty && !_busy) Padding(padding: const EdgeInsets.all(32), child: Center(child: Text(_showFavs ? '즐겨찾기가 없습니다.' : '검색을 눌러 주변 식당·카페를 찾아보세요.', style: const TextStyle(color: Colors.grey)))),
          for (final p in list) _tile(p),
        ])),
      ]),
    );
  }

  Widget _tile(KakaoPlace p) => ListTile(
        title: Text(p.name), subtitle: Text('${p.shortCategory} · ${p.distanceM}m · ${p.address}', maxLines: 2),
        trailing: Row(mainAxisSize: MainAxisSize.min, children: [
          if (p.phone.isNotEmpty) IconButton(icon: const Icon(Icons.call_outlined), onPressed: () => launchUrl(Uri.parse('tel:${p.phone.replaceAll('-', '')}'))),
          IconButton(icon: Icon(_isFav(p.id) ? Icons.favorite : Icons.favorite_border, color: _isFav(p.id) ? Colors.red : null), onPressed: () => _toggleFav(p)),
        ]),
        onTap: p.placeUrl.isEmpty ? null : () => launchUrl(Uri.parse(p.placeUrl), mode: LaunchMode.externalApplication),
      );
  KakaoPlace _favToPlace(FoodFavorite f) => KakaoPlace(id: f.placeId, name: f.name, categoryName: f.categoryName ?? '', categoryGroupCode: '', phone: f.phone ?? '', addressName: f.address ?? '', roadAddressName: f.roadAddress ?? '', x: f.x ?? 0, y: f.y ?? 0, placeUrl: f.placeUrl ?? '', distanceM: 0);
}


class _AddressDialog extends StatefulWidget {
  const _AddressDialog({required this.search});
  final Future<List<FoodLocation>> Function(String query) search;
  @override
  State<_AddressDialog> createState() => _AddressDialogState();
}

class _AddressDialogState extends State<_AddressDialog> {
  final _q = TextEditingController();
  List<FoodLocation> _results = [];
  bool _busy = false;
  String? _error;
  Future<void> _run() async {
    final q = _q.text.trim(); if (q.isEmpty) return;
    setState(() { _busy = true; _error = null; });
    try { _results = await widget.search(q); if (_results.isEmpty) _error = '검색 결과가 없습니다.'; }
    on ApiException catch (e) { _error = e.message; }
    finally { if (mounted) setState(() => _busy = false); }
  }
  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('주소 변경'),
        content: SizedBox(width: double.maxFinite, child: Column(mainAxisSize: MainAxisSize.min, children: [
          TextField(controller: _q, autofocus: true, decoration: InputDecoration(hintText: '건물명·도로명·지번', suffixIcon: IconButton(icon: const Icon(Icons.search), onPressed: _run)), onSubmitted: (_) => _run()),
          if (_busy) const Padding(padding: EdgeInsets.all(12), child: LinearProgressIndicator()),
          if (_error != null) Padding(padding: const EdgeInsets.all(8), child: Text(_error!, style: const TextStyle(color: Colors.red))),
          Flexible(child: ListView(shrinkWrap: true, children: [for (final r in _results) ListTile(dense: true, title: Text(r.address), onTap: () => Navigator.pop(context, r))])),
        ])),
        actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('닫기'))],
      );
}

/// 카테고리(전체/음식점/카페) → 세부 → 상세, 반경, 개수. 세부·상세는 카테고리가 ALL이 아닐 때만(웹과 같음).
class _FilterSheet extends StatefulWidget {
  const _FilterSheet({required this.initial, required this.categories});
  final FoodFilters initial;
  final Future<List<String>> Function(String group, {String sub}) categories;
  @override
  State<_FilterSheet> createState() => _FilterSheetState();
}

class _FilterSheetState extends State<_FilterSheet> {
  late FoodFilters _f = widget.initial;
  List<String> _subs = [], _details = [];
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    if (_f.category == 'ALL') { setState(() { _subs = []; _details = []; }); return; }
    final subs = await widget.categories(_f.category);
    final details = _f.subCategory.isEmpty ? <String>[] : await widget.categories(_f.category, sub: _f.subCategory);
    if (mounted) setState(() { _subs = subs; _details = details; });
  }
  @override
  Widget build(BuildContext context) => Padding(
        padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.of(context).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('필터', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 12),
          SegmentedButton<String>(
            segments: const [ButtonSegment(value: 'ALL', label: Text('전체')), ButtonSegment(value: 'FD6', label: Text('음식점')), ButtonSegment(value: 'CE7', label: Text('카페'))],
            selected: {_f.category},
            onSelectionChanged: (v) { _f = _f.copyWith(category: v.first, subCategory: '', detailCategory: ''); _load(); },
          ),
          if (_subs.isNotEmpty) DropdownButtonFormField<String>(
            value: _f.subCategory.isEmpty ? null : _f.subCategory, decoration: const InputDecoration(labelText: '세부 분류'),
            items: [const DropdownMenuItem(value: '', child: Text('전체')), for (final c in _subs) DropdownMenuItem(value: c, child: Text(c))],
            onChanged: (v) { _f = _f.copyWith(subCategory: v ?? '', detailCategory: ''); _load(); },
          ),
          if (_details.isNotEmpty) DropdownButtonFormField<String>(
            value: _f.detailCategory.isEmpty ? null : _f.detailCategory, decoration: const InputDecoration(labelText: '상세 분류'),
            items: [const DropdownMenuItem(value: '', child: Text('전체')), for (final c in _details) DropdownMenuItem(value: c, child: Text(c))],
            onChanged: (v) => setState(() => _f = _f.copyWith(detailCategory: v ?? '')),
          ),
          const SizedBox(height: 12), const Text('반경'),
          Wrap(spacing: 8, children: [for (final r in const [300, 500, 1000, 2000]) ChoiceChip(label: Text('${r}m'), selected: _f.radius == r, onSelected: (_) => setState(() => _f = _f.copyWith(radius: r)))]),
          const SizedBox(height: 8), const Text('최대 개수'),
          Wrap(spacing: 8, children: [for (final n in const [30, 60, 100]) ChoiceChip(label: Text('$n'), selected: _f.maxResults == n, onSelected: (_) => setState(() => _f = _f.copyWith(maxResults: n)))]),
          const SizedBox(height: 16),
          SizedBox(width: double.infinity, child: FilledButton(onPressed: () => Navigator.pop(context, _f), child: const Text('적용'))),
        ]),
      );
}
```

```dart
// mobile/lib/features/food/recommend_sheet.dart
import 'dart:math';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../api/client.dart';
import '../team/repository.dart' show teamRepositoryProvider; // 내 팀 명단(Task 13) — 이 Task에서는 임시로 빈 목록을 쓰고 Task 13 뒤에 연결
import 'models.dart';
import 'repository.dart';

/// "오늘 뭐 먹지": 검색 결과에서 무작위 1곳 → 다시/결정. 결정은 웹과 같은 /api/food/decide 본문(구성원 = 내 팀 이름, 채널 전송 여부).
Future<void> showRecommendSheet(BuildContext context, WidgetRef ref, List<KakaoPlace> candidates) async {
  var pick = candidates[Random().nextInt(candidates.length)];
  var sendToChannel = true;
  await showModalBottomSheet(context: context, isScrollControlled: true, builder: (ctx) => StatefulBuilder(builder: (ctx, setState) => Padding(
    padding: EdgeInsets.fromLTRB(20, 16, 20, 20 + MediaQuery.of(ctx).viewInsets.bottom),
    child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('오늘은 여기 어때요?', style: Theme.of(ctx).textTheme.titleMedium),
      const SizedBox(height: 8),
      ListTile(contentPadding: EdgeInsets.zero, title: Text(pick.name, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)), subtitle: Text('${pick.shortCategory} · ${pick.distanceM}m\n${pick.address}'),
        trailing: pick.placeUrl.isEmpty ? null : IconButton(icon: const Icon(Icons.map_outlined), onPressed: () => launchUrl(Uri.parse(pick.placeUrl), mode: LaunchMode.externalApplication))),
      SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('팀 채널에 알리기'), value: sendToChannel, onChanged: (v) => setState(() => sendToChannel = v)),
      Row(children: [
        OutlinedButton.icon(onPressed: () => setState(() => pick = candidates[Random().nextInt(candidates.length)]), icon: const Icon(Icons.refresh), label: const Text('다시')),
        const Spacer(),
        FilledButton.icon(onPressed: () async {
          try {
            final members = await ref.read(teamRepositoryProvider).memberNames();
            final r = await ref.read(foodRepositoryProvider).decide(place: pick, members: members.isEmpty ? ['나'] : members, sendToChannel: sendToChannel);
            if (ctx.mounted) { Navigator.pop(ctx); ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(r['webhook_sent'] == true ? '결정했습니다. 채널에 알렸어요.' : '결정했습니다.'))); }
          } on ApiException catch (e) { if (ctx.mounted) ScaffoldMessenger.of(ctx).showSnackBar(SnackBar(content: Text(e.message))); }
        }, icon: const Icon(Icons.check), label: const Text('결정')),
      ]),
    ]),
  )));
}
```
Task 13이 아직 없으므로 이 Task에서는 `teamRepositoryProvider.memberNames()` 대신 `const <String>[]`을 쓰고 `// Task 13에서 내 팀 이름으로 교체` 주석을 남긴다. Task 13 Step에서 교체한다.

`router.dart`: `/food` → `const FoodScreen()`.

- [ ] **Step 5: 확인·커밋**

Run: `cd mobile && flutter analyze && flutter test` → PASS. 실기기: 위치 허용 → 주소 표시 → 검색 → 목록 → 하트 → 웹 `/food` 즐겨찾기에 같은 항목 보임 → 장소 탭 → 카카오맵.

```bash
git add mobile && git commit -m "feat(mobile): 뭐 먹지 — 현재 위치/주소 검색·필터·카카오 검색·즐겨찾기·PAYCO·오늘 뭐 먹지(결정·채널 알림)"
```

---

### Task 12: 사다리 — 생성·경로 로직 이식·CustomPainter·이력

**Files:**
- Create: `mobile/lib/features/ladder/model.dart`, `mobile/lib/features/ladder/generator.dart`, `mobile/lib/features/ladder/painter.dart`, `mobile/lib/features/ladder/repository.dart`, `mobile/lib/features/ladder/ladder_screen.dart`, `mobile/lib/features/ladder/history_screen.dart`
- Modify: `mobile/lib/app/router.dart`
- Test: `mobile/test/ladder/generator_test.dart`

**Interfaces:**
- Produces: `LadderResult {text, type}`(`reward|punishment|normal`), `LadderData {participants, results, columns, rows, bridges}`(JSON 왕복 — 웹 `types/ladder.ts`와 동일 키), `generateLadder(participants, results, {double density = 0.4, Random? random})`, `resultIndex(LadderData, int startColumn)`, `List<int> columnPath(LadderData, int startColumn)`(행마다 열 위치), `LadderRepository.list()`, `save({ladder, bridgeDensity, mappings})`.
- Consumes: `ApiClient`, 내 팀 `GET /api/users/members`(Task 13의 `TeamRepository.members()` — 이 Task에서는 자체 호출로 구현하고 Task 13에서 공용으로 옮기지 않아도 된다).

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/ladder/generator_test.dart
import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/ladder/generator.dart';
import 'package:playground/features/ladder/model.dart';

void main() {
  final people = ['가', '나', '다', '라', '마'];
  final results = [LadderResult('커피', 'reward'), LadderResult('꽝', 'normal')];

  test('열=참가자 수, 행=max(2*열, 6), 같은 행에 인접 다리 없음', () {
    for (var seed = 0; seed < 50; seed++) {
      final l = generateLadder(people, results, density: 0.6, random: Random(seed));
      expect(l.columns, 5); expect(l.rows, 10); expect(l.bridges.length, 10);
      for (final row in l.bridges) {
        expect(row.length, 4);
        for (var c = 1; c < row.length; c++) { expect(row[c - 1] && row[c], false, reason: 'seed $seed 인접 다리'); }
      }
    }
    expect(generateLadder(['a', 'b'], results, random: Random(1)).rows, 6);
  });
  test('결과는 참가자 수만큼 "꽝 N"으로 채우고 넘치면 자른다', () {
    final l = generateLadder(people, results, random: Random(3));
    expect(l.results.length, 5);
    expect(l.results.where((r) => r.text.startsWith('꽝')).length, 4); // 입력 '꽝' 1 + 채움 3
    expect(generateLadder(['a'], [LadderResult('x', 'normal'), LadderResult('y', 'normal')], random: Random(1)).results.length, 1);
  });
  test('경로 추적은 전단사 — 모든 참가자가 서로 다른 결과에 닿는다', () {
    for (var seed = 0; seed < 50; seed++) {
      final l = generateLadder(people, results, density: 0.5, random: Random(seed));
      final ends = List.generate(l.columns, (c) => resultIndex(l, c));
      expect(ends.toSet().length, l.columns, reason: 'seed $seed');
      expect(columnPath(l, 0).length, l.rows + 1);
    }
  });
  test('JSON 왕복 — 웹 저장 형식과 키가 같다', () {
    final l = generateLadder(people, results, random: Random(7));
    final j = l.toJson();
    expect(j.keys, containsAll(['participants', 'results', 'columns', 'rows', 'bridges']));
    expect((j['results'] as List).first, isA<Map>());
    expect(LadderData.fromJson(j).bridges, l.bridges);
  });
}
```

- [ ] **Step 2: 실패 확인** — `flutter test test/ladder/generator_test.dart` → FAIL.

- [ ] **Step 3: 모델·생성기(웹 `lib/ladder.ts` 이식)**

```dart
// mobile/lib/features/ladder/model.dart
class LadderResult {
  const LadderResult(this.text, this.type); // type: reward | punishment | normal
  final String text, type;
  Map<String, dynamic> toJson() => {'text': text, 'type': type};
  factory LadderResult.fromJson(Map<String, dynamic> j) => LadderResult(j['text'] as String? ?? '', j['type'] as String? ?? 'normal');
}

class LadderData {
  const LadderData({required this.participants, required this.results, required this.columns, required this.rows, required this.bridges});
  final List<String> participants;
  final List<LadderResult> results;
  final int columns, rows;
  final List<List<bool>> bridges; // rows × (columns-1)
  Map<String, dynamic> toJson() => {'participants': participants, 'results': results.map((r) => r.toJson()).toList(), 'columns': columns, 'rows': rows, 'bridges': bridges};
  factory LadderData.fromJson(Map<String, dynamic> j) {
    final bridges = (j['bridges'] as List).map((r) => (r as List).map((b) => b == true).toList()).toList();
    final participants = (j['participants'] as List).cast<String>();
    return LadderData(participants: participants, results: (j['results'] as List).map((r) => LadderResult.fromJson(r as Map<String, dynamic>)).toList(),
        columns: (j['columns'] as num?)?.toInt() ?? participants.length, rows: (j['rows'] as num?)?.toInt() ?? bridges.length, bridges: bridges);
  }
}

class LadderMapping {
  const LadderMapping(this.participant, this.result);
  final String participant; final LadderResult result;
  Map<String, dynamic> toJson() => {'participant': participant, 'result': result.toJson()};
}
```

```dart
// mobile/lib/features/ladder/generator.dart  — frontend/src/lib/ladder.ts generateLadder·getResultIndex와 동일 규칙
import 'dart:math';
import 'model.dart';

List<T> _shuffle<T>(List<T> a, Random rnd) { final r = [...a]; for (var i = r.length - 1; i > 0; i--) { final j = rnd.nextInt(i + 1); final t = r[i]; r[i] = r[j]; r[j] = t; } return r; }

LadderData generateLadder(List<String> participants, List<LadderResult> results, {double density = 0.4, Random? random}) {
  final rnd = random ?? Random();
  final columns = participants.length;
  final rows = max(columns * 2, 6);
  final bridges = <List<bool>>[];
  for (var r = 0; r < rows; r++) {
    final row = <bool>[];
    for (var c = 0; c < columns - 1; c++) {
      final prev = c > 0 && row[c - 1];
      row.add(!prev && rnd.nextDouble() < density);
    }
    bridges.add(row);
  }
  final padded = [...results];
  while (padded.length < columns) { padded.add(LadderResult('꽝 ${padded.length - results.length + 1}', 'normal')); }
  return LadderData(participants: _shuffle(participants, rnd), results: _shuffle(padded.take(columns).toList(), rnd), columns: columns, rows: rows, bridges: bridges);
}

/// 각 행을 지난 뒤의 열 위치(길이 rows+1, [0]=시작 열). 그리기와 결과 계산이 같은 경로를 쓴다.
List<int> columnPath(LadderData l, int startColumn) {
  var col = startColumn;
  final path = [col];
  for (var r = 0; r < l.rows; r++) {
    if (col < l.columns - 1 && l.bridges[r][col]) { col++; } else if (col > 0 && l.bridges[r][col - 1]) { col--; }
    path.add(col);
  }
  return path;
}

int resultIndex(LadderData l, int startColumn) => columnPath(l, startColumn).last;
```

- [ ] **Step 4: 저장소·페인터·화면·이력**

```dart
// mobile/lib/features/ladder/repository.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import 'model.dart';

class LadderSession {
  LadderSession({required this.id, required this.title, required this.createdAt, required this.ladder, required this.mappings});
  final String id; final String? title; final DateTime createdAt; final LadderData ladder; final List<Map<String, dynamic>> mappings;
  factory LadderSession.fromJson(Map<String, dynamic> j) => LadderSession(
      id: '${j['id']}', title: j['title'] as String?, createdAt: DateTime.parse(j['created_at'] as String),
      ladder: LadderData.fromJson({'participants': j['participants'], 'results': j['results'], 'bridges': j['bridges']}),
      mappings: ((j['mappings'] as List?) ?? []).cast<Map<String, dynamic>>());
}

class LadderRepository {
  LadderRepository(this._api);
  final ApiClient _api;
  Future<List<LadderSession>> list() async => ((await _api.getJson('/api/ladder-sessions')) as List).map((e) => LadderSession.fromJson(e as Map<String, dynamic>)).toList();
  /// 웹 handleSave와 같은 본문
  Future<void> save({required LadderData ladder, required double bridgeDensity, required List<LadderMapping> mappings}) =>
      _api.postJson('/api/ladder-sessions', {'participants': ladder.participants, 'results': ladder.results.map((r) => r.toJson()).toList(), 'bridges': ladder.bridges, 'bridgeDensity': bridgeDensity, 'mappings': mappings.map((m) => m.toJson()).toList()});
  Future<List<String>> myTeamNames() async => ((await _api.getJson('/api/users/members')) as List).map((e) => (e as Map)['name'] as String).toList();
}
final ladderRepositoryProvider = Provider((ref) => LadderRepository(ref.watch(apiClientProvider)));
```

```dart
// mobile/lib/features/ladder/painter.dart
import 'package:flutter/material.dart';
import 'generator.dart';
import 'model.dart';

const kPathColors = [Color(0xFFEF4444), Color(0xFF3B82F6), Color(0xFF10B981), Color(0xFFF59E0B), Color(0xFF8B5CF6), Color(0xFFEC4899), Color(0xFF06B6D4), Color(0xFF84CC16)];

/// 사다리 + 공개된 경로(progress 0~1로 애니메이션). 좌표: 열 간격 = 폭/(columns-1), 행 간격 = 높이/(rows+1).
class LadderPainter extends CustomPainter {
  LadderPainter({required this.ladder, required this.revealed, this.animating, this.progress = 1});
  final LadderData ladder;
  final Set<int> revealed; // 공개된 시작 열
  final int? animating;    // 지금 그리는 중인 시작 열
  final double progress;
  static const padX = 24.0, padY = 16.0;

  double _x(Size s, int c) => padX + c * (s.width - padX * 2) / (ladder.columns - 1).clamp(1, 1 << 30);
  double _y(Size s, int r) => padY + r * (s.height - padY * 2) / (ladder.rows + 1);

  @override
  void paint(Canvas canvas, Size size) {
    final rail = Paint()..color = const Color(0xFF9CA3AF)..strokeWidth = 3..strokeCap = StrokeCap.round;
    for (var c = 0; c < ladder.columns; c++) { canvas.drawLine(Offset(_x(size, c), _y(size, 0)), Offset(_x(size, c), _y(size, ladder.rows + 1)), rail); }
    for (var r = 0; r < ladder.rows; r++) { for (var c = 0; c < ladder.columns - 1; c++) { if (ladder.bridges[r][c]) canvas.drawLine(Offset(_x(size, c), _y(size, r + 1)), Offset(_x(size, c + 1), _y(size, r + 1)), rail); } }
    for (final start in revealed) { _drawPath(canvas, size, start, 1); }
    if (animating != null) _drawPath(canvas, size, animating!, progress);
  }

  void _drawPath(Canvas canvas, Size size, int start, double t) {
    final cols = columnPath(ladder, start);
    final pts = <Offset>[Offset(_x(size, cols[0]), _y(size, 0))];
    for (var r = 0; r < ladder.rows; r++) { pts.add(Offset(_x(size, cols[r]), _y(size, r + 1))); if (cols[r + 1] != cols[r]) pts.add(Offset(_x(size, cols[r + 1]), _y(size, r + 1))); }
    pts.add(Offset(_x(size, cols.last), _y(size, ladder.rows + 1)));
    final total = pts.length - 1; final upto = (total * t);
    final paint = Paint()..color = kPathColors[start % kPathColors.length]..strokeWidth = 4..strokeCap = StrokeCap.round..style = PaintingStyle.stroke;
    final path = Path()..moveTo(pts[0].dx, pts[0].dy);
    for (var i = 1; i <= total; i++) { if (i <= upto) { path.lineTo(pts[i].dx, pts[i].dy); } else { final f = upto - (i - 1); path.lineTo(pts[i - 1].dx + (pts[i].dx - pts[i - 1].dx) * f, pts[i - 1].dy + (pts[i].dy - pts[i - 1].dy) * f); break; } }
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant LadderPainter o) => o.ladder != ladder || o.revealed != revealed || o.animating != animating || o.progress != progress;
}
```

```dart
// mobile/lib/features/ladder/ladder_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../api/client.dart';
import 'generator.dart';
import 'model.dart';
import 'painter.dart';
import 'repository.dart';

const kDensities = {'낮음': 0.25, '보통': 0.4, '높음': 0.6};
const kResultTypes = {'reward': '당첨', 'punishment': '꽝', 'normal': '일반'};
Color resultColor(String type) => type == 'reward' ? const Color(0xFF10B981) : type == 'punishment' ? const Color(0xFFEF4444) : const Color(0xFF6B7280);

class LadderScreen extends ConsumerStatefulWidget {
  const LadderScreen({super.key});
  @override
  ConsumerState<LadderScreen> createState() => _LadderScreenState();
}

class _LadderScreenState extends ConsumerState<LadderScreen> with SingleTickerProviderStateMixin {
  // 설정
  List<String> _team = [];
  final Set<String> _selected = {};
  final List<String> _extra = [];
  final List<LadderResult> _results = [];
  String _density = '보통';
  final _nameCtl = TextEditingController(), _resultCtl = TextEditingController();
  String _resultType = 'normal';
  // 사다리
  LadderData? _ladder;
  final Set<int> _revealed = {};
  final List<LadderMapping> _mappings = [];
  int? _animating;
  bool _saved = false, _saving = false;
  late final AnimationController _anim = AnimationController(vsync: this, duration: const Duration(milliseconds: 800))..addListener(() => setState(() {}));

  List<String> get _participants => [..._team.where(_selected.contains), ..._extra];

  @override
  void initState() {
    super.initState();
    ref.read(ladderRepositoryProvider).myTeamNames().then((n) { if (mounted) setState(() => _team = n); }).catchError((_) {});
  }
  @override
  void dispose() { _anim.dispose(); _nameCtl.dispose(); _resultCtl.dispose(); super.dispose(); }

  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  void _generate() {
    if (_participants.length < 2) { _snack('참가자를 2명 이상 넣어 주세요.'); return; }
    if (_results.isEmpty) { _snack('결과를 1개 이상 넣어 주세요.'); return; }
    setState(() { _ladder = generateLadder(_participants, _results, density: kDensities[_density]!); _revealed.clear(); _mappings.clear(); _saved = false; });
  }

  Future<void> _reveal(int col) async {
    final l = _ladder; if (l == null || _revealed.contains(col) || _animating != null) return;
    setState(() => _animating = col);
    await _anim.forward(from: 0);
    setState(() { _animating = null; _revealed.add(col); _mappings.add(LadderMapping(l.participants[col], l.results[resultIndex(l, col)])); });
  }
  Future<void> _revealAll() async { for (var c = 0; c < (_ladder?.columns ?? 0); c++) { await _reveal(c); } }

  Future<void> _save() async {
    final l = _ladder; if (l == null || _mappings.length < l.columns) return;
    setState(() => _saving = true);
    try { await ref.read(ladderRepositoryProvider).save(ladder: l, bridgeDensity: kDensities[_density]!, mappings: _mappings); setState(() => _saved = true); _snack('저장했습니다.'); }
    on ApiException catch (e) { _snack(e.message); } finally { if (mounted) setState(() => _saving = false); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('사다리'), actions: [IconButton(icon: const Icon(Icons.history), tooltip: '이력', onPressed: () => context.push('/ladder/history'))]),
        body: _ladder == null ? _setup() : _board(_ladder!),
      );

  Widget _setup() => ListView(padding: const EdgeInsets.all(16), children: [
        const Text('참가자', style: TextStyle(fontWeight: FontWeight.w600)),
        Wrap(spacing: 6, children: [
          for (final n in _team) FilterChip(label: Text(n), selected: _selected.contains(n), onSelected: (v) => setState(() => v ? _selected.add(n) : _selected.remove(n))),
          for (final n in _extra) InputChip(label: Text(n), onDeleted: () => setState(() => _extra.remove(n))),
        ]),
        Row(children: [
          Expanded(child: TextField(controller: _nameCtl, decoration: const InputDecoration(hintText: '직접 입력', isDense: true), onSubmitted: (_) => _addName())),
          IconButton(icon: const Icon(Icons.add), onPressed: _addName),
        ]),
        const SizedBox(height: 16), const Text('결과', style: TextStyle(fontWeight: FontWeight.w600)),
        Wrap(spacing: 6, children: [for (final r in _results) InputChip(label: Text(r.text), avatar: CircleAvatar(backgroundColor: resultColor(r.type), radius: 6), onDeleted: () => setState(() => _results.remove(r)))]),
        Row(children: [
          Expanded(child: TextField(controller: _resultCtl, decoration: const InputDecoration(hintText: '예: 커피 사기', isDense: true), onSubmitted: (_) => _addResult())),
          DropdownButton<String>(value: _resultType, items: [for (final e in kResultTypes.entries) DropdownMenuItem(value: e.key, child: Text(e.value))], onChanged: (v) => setState(() => _resultType = v ?? 'normal')),
          IconButton(icon: const Icon(Icons.add), onPressed: _addResult),
        ]),
        Text('결과가 참가자보다 적으면 나머지는 "꽝 N"으로 채웁니다.', style: Theme.of(context).textTheme.bodySmall),
        const SizedBox(height: 16), const Text('다리 밀도', style: TextStyle(fontWeight: FontWeight.w600)),
        SegmentedButton<String>(segments: [for (final k in kDensities.keys) ButtonSegment(value: k, label: Text(k))], selected: {_density}, onSelectionChanged: (v) => setState(() => _density = v.first)),
        const SizedBox(height: 24),
        FilledButton.icon(onPressed: _generate, icon: const Icon(Icons.auto_awesome), label: Text('사다리 만들기 (${_participants.length}명)')),
      ]);
  void _addName() { final n = _nameCtl.text.trim(); if (n.isEmpty || _participants.contains(n)) return; setState(() { _extra.add(n); _nameCtl.clear(); }); }
  void _addResult() { final t = _resultCtl.text.trim(); if (t.isEmpty) return; setState(() { _results.add(LadderResult(t, _resultType)); _resultCtl.clear(); }); }

  Widget _board(LadderData l) {
    final allRevealed = _revealed.length == l.columns;
    return Column(children: [
      Padding(padding: const EdgeInsets.fromLTRB(8, 8, 8, 0), child: Row(children: [
        for (var c = 0; c < l.columns; c++) Expanded(child: Padding(padding: const EdgeInsets.all(2), child: FilledButton.tonal(
          style: FilledButton.styleFrom(padding: EdgeInsets.zero, backgroundColor: _revealed.contains(c) ? kPathColors[c % kPathColors.length].withValues(alpha: .2) : null),
          onPressed: _revealed.contains(c) || _animating != null ? null : () => _reveal(c),
          child: Text(l.participants[c], maxLines: 1, overflow: TextOverflow.ellipsis, style: const TextStyle(fontSize: 12))))),
      ])),
      Expanded(child: Padding(padding: const EdgeInsets.symmetric(horizontal: 8), child: CustomPaint(painter: LadderPainter(ladder: l, revealed: _revealed, animating: _animating, progress: _anim.value), child: const SizedBox.expand()))),
      Padding(padding: const EdgeInsets.fromLTRB(8, 0, 8, 8), child: Row(children: [
        for (var c = 0; c < l.columns; c++) Expanded(child: Builder(builder: (_) {
          final shown = _revealed.any((s) => resultIndex(l, s) == c) || (_animating != null && resultIndex(l, _animating!) == c && _anim.value > .95);
          final r = l.results[c];
          return Container(margin: const EdgeInsets.all(2), padding: const EdgeInsets.symmetric(vertical: 6), decoration: BoxDecoration(color: shown ? resultColor(r.type).withValues(alpha: .15) : Colors.grey.shade200, borderRadius: BorderRadius.circular(6)),
            child: Text(shown ? r.text : '?', textAlign: TextAlign.center, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 12, color: shown ? resultColor(r.type) : Colors.grey)));
        })),
      ])),
      if (_mappings.isNotEmpty) SizedBox(height: 36, child: ListView(scrollDirection: Axis.horizontal, padding: const EdgeInsets.symmetric(horizontal: 12), children: [for (final m in _mappings) Padding(padding: const EdgeInsets.only(right: 8), child: Chip(label: Text('${m.participant} → ${m.result.text}'), backgroundColor: resultColor(m.result.type).withValues(alpha: .15)))])),
      Padding(padding: const EdgeInsets.all(12), child: Row(children: [
        OutlinedButton(onPressed: _animating == null ? () => setState(() => _ladder = null) : null, child: const Text('다시 만들기')),
        const Spacer(),
        if (!allRevealed) FilledButton.tonal(onPressed: _animating == null ? _revealAll : null, child: const Text('전체 공개')),
        if (allRevealed) FilledButton.icon(onPressed: _saved || _saving ? null : _save, icon: Icon(_saved ? Icons.check : Icons.save_outlined), label: Text(_saved ? '저장됨' : '저장')),
      ])),
    ]);
  }
}
```

```dart
// mobile/lib/features/ladder/history_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'repository.dart';
import 'ladder_screen.dart' show resultColor;

String fmtDate(DateTime d) { final l = d.toLocal(); String two(int n) => n.toString().padLeft(2, '0'); return '${l.year}.${two(l.month)}.${two(l.day)} ${two(l.hour)}:${two(l.minute)}'; }

class LadderHistoryScreen extends ConsumerStatefulWidget {
  const LadderHistoryScreen({super.key});
  @override
  ConsumerState<LadderHistoryScreen> createState() => _LadderHistoryScreenState();
}

class _LadderHistoryScreenState extends ConsumerState<LadderHistoryScreen> {
  late Future<List<LadderSession>> _future = ref.read(ladderRepositoryProvider).list();
  Future<void> _refresh() async { setState(() => _future = ref.read(ladderRepositoryProvider).list()); await _future; }
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('사다리 이력')),
        body: RefreshIndicator(onRefresh: _refresh, child: FutureBuilder(future: _future, builder: (context, snap) {
          if (snap.hasError) return ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${snap.error}', style: const TextStyle(color: Colors.red)))]);
          final list = snap.data; if (list == null) return const Center(child: CircularProgressIndicator());
          if (list.isEmpty) return ListView(children: const [Padding(padding: EdgeInsets.all(32), child: Center(child: Text('저장된 사다리가 없습니다.', style: TextStyle(color: Colors.grey))))]);
          return ListView.separated(itemCount: list.length, separatorBuilder: (_, __) => const Divider(height: 1), itemBuilder: (context, i) {
            final s = list[i];
            return ExpansionTile(title: Text(s.title ?? '${s.ladder.participants.length}명 사다리'), subtitle: Text(fmtDate(s.createdAt)), children: [
              for (final m in s.mappings) ListTile(dense: true, leading: CircleAvatar(radius: 5, backgroundColor: resultColor((m['result'] as Map?)?['type'] as String? ?? 'normal')), title: Text('${m['participant']} → ${(m['result'] as Map?)?['text'] ?? ''}')),
            ]);
          });
        })),
      );
}
```

`router.dart`: `/ladder` 브랜치에 `GoRoute(path: '/ladder', builder: … LadderScreen(), routes: [GoRoute(path: 'history', builder: … LadderHistoryScreen())])`.

- [ ] **Step 5: 확인·커밋**

Run: `cd mobile && flutter analyze && flutter test` → PASS(생성기 테스트 4개 포함). 실기기: 참가자 3명·결과 1개 → 사다리 → 한 명 탭 → 경로 애니메이션 → 전체 공개 → 저장 → 웹 `/ladder` 이력에 같은 결과가 보이는지.

```bash
git add mobile && git commit -m "feat(mobile): 사다리 — 웹과 같은 생성 규칙·경로 추적(테스트), CustomPainter 애니메이션, 저장·이력"
```

---

### Task 13: 커피 타임 — 팀 나누기 이식·출석·댓글·알림·이력

**Files:**
- Create: `mobile/lib/features/team/divider.dart`, `mobile/lib/features/team/models.dart`, `mobile/lib/features/team/repository.dart`, `mobile/lib/features/team/team_screen.dart`, `mobile/lib/features/team/history_screen.dart`, `mobile/lib/features/team/prefs.dart`
- Modify: `mobile/lib/app/router.dart`, `mobile/lib/features/food/recommend_sheet.dart`(내 팀 이름 연결)
- Test: `mobile/test/team/divider_test.dart`

**Interfaces:**
- Produces: `TeamConfig {participants, teamCount, minPerTeam, maxPerTeam, cardHolders}`, `String? validateTeamConfig(TeamConfig)`(웹과 같은 문구), `List<Team> divideTeams(TeamConfig, {Random? random})`, `Team {name, members: List<TeamMember{name, hasCard}>}`; `TeamMemberRow.fromJson`(`/api/users/members` 행), `TeamRepository.members()`, `memberNames()`, `sessions()`, `save(...)`, `setAttendance(teamResultId, memberName, attended)`, `addComment(teamResultId, author, content)`, `notify(teams)`; `TeamPrefs.cardHolders()/save`.

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/team/divider_test.dart
import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/team/divider.dart';

TeamConfig cfg({List<String>? p, int teams = 2, int min = 1, int max = 10, List<String> cards = const []}) =>
    TeamConfig(participants: p ?? ['a', 'b', 'c', 'd', 'e', 'f'], teamCount: teams, minPerTeam: min, maxPerTeam: max, cardHolders: cards);

void main() {
  test('validateTeamConfig — 웹 lib/team-divider.ts와 같은 문구', () {
    expect(validateTeamConfig(cfg(p: [])), '참여자를 추가해주세요.');
    expect(validateTeamConfig(cfg(teams: 0)), '팀 수는 1 이상이어야 합니다.');
    expect(validateTeamConfig(cfg(min: 0)), '최소 인원은 1 이상이어야 합니다.');
    expect(validateTeamConfig(cfg(min: 3, max: 2)), '최대 인원은 최소 인원 이상이어야 합니다.');
    expect(validateTeamConfig(cfg(teams: 4, min: 2)), '인원이 부족합니다. 최소 8명이 필요합니다.');
    expect(validateTeamConfig(cfg(teams: 2, max: 2)), '팀 수가 부족하거나 최대 인원을 늘려주세요. 현재 최대 수용: 4명');
    expect(validateTeamConfig(cfg()), isNull);
  });
  test('divideTeams — 전원 배정, 최소·최대 준수, 법카 보유자는 팀마다 나눠 배치', () {
    for (var seed = 0; seed < 30; seed++) {
      final teams = divideTeams(cfg(teams: 3, min: 1, max: 3, cards: ['a', 'b', 'c']), random: Random(seed));
      expect(teams.length, 3);
      final all = teams.expand((t) => t.members.map((m) => m.name)).toList()..sort();
      expect(all, ['a', 'b', 'c', 'd', 'e', 'f']);
      for (final t in teams) { expect(t.members.length, inInclusiveRange(1, 3)); expect(t.members.where((m) => m.hasCard).length, 1); }
      expect(teams.map((t) => t.name), ['팀 1', '팀 2', '팀 3']);
    }
  });
  test('최소 인원을 먼저 채우고 나머지는 돌아가며 — 7명 2팀 min 3 max 4', () {
    final teams = divideTeams(cfg(p: ['1', '2', '3', '4', '5', '6', '7'], teams: 2, min: 3, max: 4), random: Random(1));
    expect(teams.map((t) => t.members.length).toList()..sort(), [3, 4]);
  });
}
```

- [ ] **Step 2: 실패 확인** — `flutter test test/team/divider_test.dart` → FAIL.

- [ ] **Step 3: 이식**

```dart
// mobile/lib/features/team/divider.dart  — frontend/src/lib/team-divider.ts 그대로
import 'dart:math';

class TeamConfig {
  const TeamConfig({required this.participants, required this.teamCount, required this.minPerTeam, required this.maxPerTeam, required this.cardHolders});
  final List<String> participants, cardHolders;
  final int teamCount, minPerTeam, maxPerTeam;
}
class TeamMember { const TeamMember(this.name, this.hasCard); final String name; final bool hasCard; Map<String, dynamic> toJson() => {'name': name, 'hasCard': hasCard}; }
class Team { const Team(this.name, this.members); final String name; final List<TeamMember> members; Map<String, dynamic> toJson() => {'name': name, 'members': members.map((m) => m.toJson()).toList()}; }

String? validateTeamConfig(TeamConfig c) {
  final total = c.participants.length;
  if (total == 0) return '참여자를 추가해주세요.';
  if (c.teamCount <= 0) return '팀 수는 1 이상이어야 합니다.';
  if (c.minPerTeam <= 0) return '최소 인원은 1 이상이어야 합니다.';
  if (c.maxPerTeam < c.minPerTeam) return '최대 인원은 최소 인원 이상이어야 합니다.';
  if (c.teamCount * c.minPerTeam > total) return '인원이 부족합니다. 최소 ${c.teamCount * c.minPerTeam}명이 필요합니다.';
  if (c.teamCount * c.maxPerTeam < total) return '팀 수가 부족하거나 최대 인원을 늘려주세요. 현재 최대 수용: ${c.teamCount * c.maxPerTeam}명';
  return null;
}

List<T> _shuffle<T>(List<T> a, Random rnd) { final r = [...a]; for (var i = r.length - 1; i > 0; i--) { final j = rnd.nextInt(i + 1); final t = r[i]; r[i] = r[j]; r[j] = t; } return r; }

List<Team> divideTeams(TeamConfig c, {Random? random}) {
  final rnd = random ?? Random();
  final cards = c.cardHolders.toSet();
  final cardMembers = _shuffle(c.participants.where(cards.contains).toList(), rnd);
  final regular = _shuffle(c.participants.where((p) => !cards.contains(p)).toList(), rnd);
  final teams = List.generate(c.teamCount, (_) => <TeamMember>[]);
  var t = 0;
  for (final m in cardMembers) { teams[t].add(TeamMember(m, true)); t = (t + 1) % c.teamCount; }
  var cursor = 0;
  for (var i = 0; i < c.teamCount; i++) { while (teams[i].length < c.minPerTeam && cursor < regular.length) { teams[i].add(TeamMember(regular[cursor++], false)); } }
  while (cursor < regular.length) { for (var i = 0; i < c.teamCount && cursor < regular.length; i++) { if (teams[i].length < c.maxPerTeam) teams[i].add(TeamMember(regular[cursor++], false)); } }
  return [for (var i = 0; i < teams.length; i++) Team('팀 ${i + 1}', teams[i])];
}
```

- [ ] **Step 4: 모델·저장소·prefs·화면**

```dart
// mobile/lib/features/team/models.dart
class TeamMemberRow { // GET /api/users/members 행
  TeamMemberRow({required this.name, this.email, required this.isCardHolder});
  final String name; final String? email; final bool isCardHolder;
  factory TeamMemberRow.fromJson(Map<String, dynamic> j) => TeamMemberRow(name: j['name'] as String, email: j['email'] as String?, isCardHolder: j['is_card_holder'] == true);
}
class TeamSessionRow { // GET /api/team-sessions 행(team_results·team_comments 포함)
  TeamSessionRow({required this.id, required this.title, required this.createdAt, required this.results});
  final String id; final String? title; final DateTime createdAt; final List<TeamResultRow> results;
  factory TeamSessionRow.fromJson(Map<String, dynamic> j) => TeamSessionRow(id: '${j['id']}', title: j['title'] as String?, createdAt: DateTime.parse(j['created_at'] as String),
      results: ((j['team_results'] as List?) ?? []).map((e) => TeamResultRow.fromJson(e as Map<String, dynamic>)).toList());
}
class TeamResultRow {
  TeamResultRow({required this.id, required this.teamName, required this.members, required this.attendance, required this.comments});
  final String id, teamName; final List<Map<String, dynamic>> members; final Map<String, bool> attendance; final List<Map<String, dynamic>> comments;
  factory TeamResultRow.fromJson(Map<String, dynamic> j) => TeamResultRow(id: '${j['id']}', teamName: j['team_name'] as String? ?? '', members: ((j['members'] as List?) ?? []).cast<Map<String, dynamic>>(),
      attendance: {for (final e in ((j['attendance'] as Map?) ?? const {}).entries) e.key as String: e.value == true}, comments: ((j['team_comments'] as List?) ?? []).cast<Map<String, dynamic>>());
}
```

```dart
// mobile/lib/features/team/repository.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import 'divider.dart';
import 'models.dart';

class TeamRepository {
  TeamRepository(this._api);
  final ApiClient _api;
  Future<List<TeamMemberRow>> members() async => ((await _api.getJson('/api/users/members')) as List).map((e) => TeamMemberRow.fromJson(e as Map<String, dynamic>)).toList();
  Future<List<String>> memberNames() async => (await members()).map((m) => m.name).toList();
  Future<List<TeamSessionRow>> sessions() async => ((await _api.getJson('/api/team-sessions')) as List).map((e) => TeamSessionRow.fromJson(e as Map<String, dynamic>)).toList();
  /// 웹 team/page.tsx 저장 본문과 동일
  Future<String> save({String? title, required List<String> participants, required int teamCount, required bool cardHolderDistribution, required List<Team> teams}) async =>
      '${((await _api.postJson('/api/team-sessions', {'title': title, 'participants': participants, 'teamCount': teamCount, 'cardHolderDistribution': cardHolderDistribution, 'teams': teams.map((t) => t.toJson()).toList()})) as Map)['id']}';
  Future<void> setAttendance(String teamResultId, String memberName, bool attended) => _api.patchJson('/api/team-attendance', {'teamResultId': teamResultId, 'memberName': memberName, 'attended': attended});
  Future<void> addComment(String teamResultId, String author, String content) => _api.postJson('/api/team-comments', {'teamResultId': teamResultId, 'author': author, 'content': content});
  Future<Map<String, dynamic>> notify(List<Team> teams) async => (await _api.postJson('/api/team-notify', {'teams': teams.map((t) => t.toJson()).toList()})) as Map<String, dynamic>;
}
final teamRepositoryProvider = Provider((ref) => TeamRepository(ref.watch(apiClientProvider)));
```

```dart
// mobile/lib/features/team/prefs.dart — 법카 보유자(기기 저장, 웹 localStorage 'team-card-holders'와 같은 역할)
import 'package:shared_preferences/shared_preferences.dart';
class TeamPrefs {
  static const _k = 'team-card-holders';
  static Future<Set<String>> cardHolders() async => ((await SharedPreferences.getInstance()).getStringList(_k) ?? const []).toSet();
  static Future<void> save(Set<String> s) async => (await SharedPreferences.getInstance()).setStringList(_k, s.toList());
}
```

```dart
// mobile/lib/features/team/team_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../../api/client.dart';
import 'divider.dart';
import 'models.dart';
import 'prefs.dart';
import 'repository.dart';

class TeamScreen extends ConsumerStatefulWidget {
  const TeamScreen({super.key});
  @override
  ConsumerState<TeamScreen> createState() => _TeamScreenState();
}

class _TeamScreenState extends ConsumerState<TeamScreen> {
  List<TeamMemberRow> _members = [];
  final Set<String> _selected = {};
  final List<String> _extra = [];
  Set<String> _cards = {};
  int _teamCount = 2, _min = 1, _max = 10;
  bool _distributeCards = true;
  List<Team>? _result;
  TeamConfig? _lastConfig;
  String? _savedId;
  bool _busy = false;
  final _nameCtl = TextEditingController();
  TeamRepository get _repo => ref.read(teamRepositoryProvider);

  @override
  void initState() { super.initState(); _init(); }
  Future<void> _init() async {
    final saved = await TeamPrefs.cardHolders();
    try { _members = await _repo.members(); } catch (_) {}
    _cards = {...saved, ..._members.where((m) => m.isCardHolder).map((m) => m.name)};
    _selected.addAll(_members.map((m) => m.name)); // 웹과 같이 내 팀 전원 기본 참석
    if (mounted) setState(() {});
  }

  List<String> get _participants => [..._members.map((m) => m.name).where(_selected.contains), ..._extra];
  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  void _divide() {
    final cfg = TeamConfig(participants: _participants, teamCount: _teamCount, minPerTeam: _min, maxPerTeam: _max, cardHolders: _distributeCards ? _participants.where(_cards.contains).toList() : const []);
    final err = validateTeamConfig(cfg);
    if (err != null) { _snack(err); return; }
    setState(() { _lastConfig = cfg; _result = divideTeams(cfg); _savedId = null; });
  }
  Future<void> _save() async {
    final r = _result, c = _lastConfig; if (r == null || c == null) return;
    setState(() => _busy = true);
    try { _savedId = await _repo.save(participants: c.participants, teamCount: c.teamCount, cardHolderDistribution: _distributeCards, teams: r); _snack('저장했습니다.'); }
    on ApiException catch (e) { _snack(e.message); } finally { if (mounted) setState(() => _busy = false); }
  }
  Future<void> _notify() async {
    final r = _result; if (r == null) return;
    setState(() => _busy = true);
    try {
      final res = await _repo.notify(r);
      final msg = [res['error'], res['warning'], res['message']].whereType<String>().join(' ');
      _snack(msg.isEmpty ? '알림을 보냈습니다.' : msg);
    } on ApiException catch (e) { _snack(e.message); } finally { if (mounted) setState(() => _busy = false); }
  }
  Future<void> _toggleCard(String name) async { setState(() => _cards.contains(name) ? _cards.remove(name) : _cards.add(name)); await TeamPrefs.save(_cards); }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('커피 타임'), actions: [IconButton(icon: const Icon(Icons.history), tooltip: '이력', onPressed: () => context.push('/team/history'))]),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          const Text('참가자 (법카 아이콘을 눌러 보유자 표시)', style: TextStyle(fontWeight: FontWeight.w600)),
          Wrap(spacing: 6, children: [
            for (final n in [..._members.map((m) => m.name), ..._extra]) FilterChip(
              label: Text(n), selected: _selected.contains(n) || _extra.contains(n),
              avatar: GestureDetector(onTap: () => _toggleCard(n), child: Icon(Icons.credit_card, size: 16, color: _cards.contains(n) ? Colors.orange : Colors.grey.shade400)),
              onSelected: (v) => setState(() { if (_extra.contains(n)) { _extra.remove(n); } else { v ? _selected.add(n) : _selected.remove(n); } }),
            ),
          ]),
          Row(children: [Expanded(child: TextField(controller: _nameCtl, decoration: const InputDecoration(hintText: '직접 입력', isDense: true), onSubmitted: (_) => _addName())), IconButton(icon: const Icon(Icons.add), onPressed: _addName)]),
          const SizedBox(height: 16),
          _stepper('팀 수', _teamCount, 1, 20, (v) => setState(() => _teamCount = v)),
          _stepper('팀당 최소 인원', _min, 1, 50, (v) => setState(() => _min = v)),
          _stepper('팀당 최대 인원', _max, 1, 50, (v) => setState(() => _max = v)),
          SwitchListTile(contentPadding: EdgeInsets.zero, title: const Text('법카 보유자 분산'), subtitle: const Text('보유자를 팀마다 한 명씩 먼저 배치'), value: _distributeCards, onChanged: (v) => setState(() => _distributeCards = v)),
          const SizedBox(height: 8),
          FilledButton.icon(onPressed: _divide, icon: const Icon(Icons.shuffle), label: Text('팀 나누기 (${_participants.length}명)')),
          if (_result != null) ...[
            const SizedBox(height: 20),
            for (final t in _result!) Card(child: Padding(padding: const EdgeInsets.all(12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text('${t.name} (${t.members.length}명)', style: const TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 6),
              Wrap(spacing: 6, children: [for (final m in t.members) Chip(label: Text(m.hasCard ? '${m.name}(법카)' : m.name), backgroundColor: m.hasCard ? Colors.orange.shade50 : null)]),
            ]))),
            Row(children: [
              OutlinedButton.icon(onPressed: _busy ? null : () => setState(() { _result = divideTeams(_lastConfig!); _savedId = null; }), icon: const Icon(Icons.refresh), label: const Text('다시 섞기')),
              const Spacer(),
              FilledButton.tonalIcon(onPressed: _busy || _savedId != null ? null : _save, icon: Icon(_savedId != null ? Icons.check : Icons.save_outlined), label: Text(_savedId != null ? '저장됨' : '저장')),
              const SizedBox(width: 8),
              FilledButton.icon(onPressed: _busy ? null : _notify, icon: const Icon(Icons.campaign_outlined), label: const Text('알리기')),
            ]),
          ],
        ]),
      );
  void _addName() { final n = _nameCtl.text.trim(); if (n.isEmpty || _participants.contains(n)) return; setState(() { _extra.add(n); _nameCtl.clear(); }); }
  Widget _stepper(String label, int v, int lo, int hi, ValueChanged<int> on) => Row(children: [
        Expanded(child: Text(label)),
        IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: v > lo ? () => on(v - 1) : null),
        SizedBox(width: 32, child: Text('$v', textAlign: TextAlign.center, style: const TextStyle(fontWeight: FontWeight.w600))),
        IconButton(icon: const Icon(Icons.add_circle_outline), onPressed: v < hi ? () => on(v + 1) : null),
      ]);
}
```

```dart
// mobile/lib/features/team/history_screen.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import '../../auth/session.dart';
import '../ladder/history_screen.dart' show fmtDate;
import 'models.dart';
import 'repository.dart';

class TeamHistoryScreen extends ConsumerStatefulWidget {
  const TeamHistoryScreen({super.key});
  @override
  ConsumerState<TeamHistoryScreen> createState() => _TeamHistoryScreenState();
}

class _TeamHistoryScreenState extends ConsumerState<TeamHistoryScreen> {
  List<TeamSessionRow>? _sessions;
  String? _error;
  @override
  void initState() { super.initState(); _load(); }
  Future<void> _load() async {
    try { final s = await ref.read(teamRepositoryProvider).sessions(); if (mounted) setState(() { _sessions = s; _error = null; }); }
    on ApiException catch (e) { if (mounted) setState(() => _error = e.message); }
  }
  void _snack(String m) => ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(m)));

  Future<void> _attend(TeamResultRow r, String name, bool v) async {
    try { await ref.read(teamRepositoryProvider).setAttendance(r.id, name, v); setState(() => r.attendance[name] = v); }
    on ApiException catch (e) { _snack(e.message); }
  }
  Future<void> _comment(TeamResultRow r) async {
    final ctl = TextEditingController();
    final text = await showDialog<String>(context: context, builder: (ctx) => AlertDialog(title: Text('${r.teamName} 댓글'), content: TextField(controller: ctl, autofocus: true, maxLines: 3),
      actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('취소')), FilledButton(onPressed: () => Navigator.pop(ctx, ctl.text.trim()), child: const Text('등록'))]));
    if (text == null || text.isEmpty) return;
    final author = (ref.read(sessionProvider).asData?.value?.email ?? '익명').split('@').first;
    try { await ref.read(teamRepositoryProvider).addComment(r.id, author, text); await _load(); } on ApiException catch (e) { _snack(e.message); }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('커피 타임 이력')),
        body: RefreshIndicator(onRefresh: _load, child: _error != null
            ? ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Text(_error!, style: const TextStyle(color: Colors.red)))])
            : _sessions == null ? const Center(child: CircularProgressIndicator())
            : _sessions!.isEmpty ? ListView(children: const [Padding(padding: EdgeInsets.all(32), child: Center(child: Text('저장된 결과가 없습니다.', style: TextStyle(color: Colors.grey))))])
            : ListView.separated(itemCount: _sessions!.length, separatorBuilder: (_, __) => const Divider(height: 1), itemBuilder: (context, i) {
                final s = _sessions![i];
                return ExpansionTile(title: Text(s.title ?? '${s.results.length}팀 · ${s.results.fold<int>(0, (a, r) => a + r.members.length)}명'), subtitle: Text(fmtDate(s.createdAt)), children: [
                  for (final r in s.results) Padding(padding: const EdgeInsets.fromLTRB(16, 0, 16, 12), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [Text(r.teamName, style: const TextStyle(fontWeight: FontWeight.w600)), const Spacer(), TextButton.icon(onPressed: () => _comment(r), icon: const Icon(Icons.comment_outlined, size: 16), label: const Text('댓글'))]),
                    for (final m in r.members) CheckboxListTile(dense: true, contentPadding: EdgeInsets.zero, controlAffinity: ListTileControlAffinity.leading,
                      title: Text(m['hasCard'] == true ? '${m['name']}(법카)' : '${m['name']}'), value: r.attendance[m['name']] ?? true, onChanged: (v) => _attend(r, '${m['name']}', v ?? true)),
                    for (final c in r.comments) Padding(padding: const EdgeInsets.only(left: 8, top: 2), child: Text('${c['author']}: ${c['content']}', style: Theme.of(context).textTheme.bodySmall)),
                  ])),
                ]);
              })),
      );
}
```

`router.dart`: `/team` 브랜치에 `GoRoute(path: '/team', builder: … TeamScreen(), routes: [GoRoute(path: 'history', …TeamHistoryScreen())])`. `recommend_sheet.dart`의 임시 빈 목록을 `ref.read(teamRepositoryProvider).memberNames()`로 교체(Task 11 주석 제거).

- [ ] **Step 5: 확인·커밋**

Run: `cd mobile && flutter analyze && flutter test` → PASS. 실기기: 내 팀 선택 → 3팀 → 나누기 → 저장 → 웹 `/team` 이력에 보임 → 알리기 → Teams/Dooray 채널에 메시지(관리자 설정에 따라) → 이력에서 출석 토글이 웹에 반영.

```bash
git add mobile && git commit -m "feat(mobile): 커피 타임 — 팀 나누기 로직 이식(테스트), 법카 분산, 저장·알림·이력(출석·댓글), 뭐 먹지 결정에 내 팀 연결"
```

---

### Task 14: 마무리 — 런북 설치 절차·README·전체 검증

**Files:**
- Modify: `docs/mobile-app.md`(개발기 설치·체크리스트), `mobile/README.md`
- Modify(필요 시): `mobile/pubspec.yaml`(version 1.0.0+1 확인)

- [ ] **Step 1: 런북 "개발기 설치" 절 채우기**

```markdown
## 개발기 설치
### Android
```bash
cd mobile && flutter build apk --debug     # build/app/outputs/flutter-apk/app-debug.apk
adb install -r build/app/outputs/flutter-apk/app-debug.apk   # 또는 APK 파일 전달 → 알 수 없는 출처 허용 후 설치
```
### iOS(본인 기기, Personal Team)
1. `open mobile/ios/Runner.xcworkspace` → Runner 타깃 → Signing & Capabilities → Team: 본인 Apple ID(Personal Team), Bundle Identifier가 `com.innogrid.playground`이면 Personal Team에서 충돌 시 `com.innogrid.playground.dev`로 바꿔 서명.
2. 기기 연결 → `flutter run -d <기기>` 또는 Xcode ▶. 처음엔 기기 설정 → 일반 → VPN 및 기기 관리에서 개발자 앱 신뢰.
3. Personal Team 서명은 7일마다 만료 — 재실행하면 갱신. 배포 방식이 정해지면 Apple Developer 계정 + TestFlight로 전환.
### 서버 주소 바꾸기
`flutter run --dart-define=API_BASE=http://<Mac IP>:3003`(로컬 프론트, 같은 Wi-Fi). Supabase 리디렉션은 운영과 같아 로그인은 그대로 된다.

## 실기기 체크리스트
- [ ] Microsoft 로그인 → 앱 복귀 → 탭 표시, `login_history`에 `InnogridApp/…` 1건
- [ ] 뭐 먹지: 현재 위치 → 검색 → 즐겨찾기 ↔ 웹 `/food` 동기화 → 카카오맵 열림 → 오늘 뭐 먹지 결정
- [ ] 사다리: 생성 → 한 명 추적 → 전체 공개 → 저장 → 웹 이력
- [ ] 커피 타임: 나누기 → 저장 → 알리기 → 이력 출석 토글 → 웹 반영
- [ ] 더보기 → PPT 만들기(WebView) → 처음 1회 `/auth/mobile` 거쳐 열림 → 다른 항목은 바로 열림 → 다운로드는 시스템 브라우저
- [ ] 로그아웃 → 로그인 화면, 다시 WebView 열면 세션 부트스트랩부터
- [ ] guest 계정: 안내 화면만, WebView 토큰 403
```

- [ ] **Step 2: `mobile/README.md`**

```markdown
# 이노그리드 모바일 앱 (Flutter)
플레이그라운드(https://inje-playground.vercel.app)의 Android·iOS 클라이언트. 설계 `../docs/superpowers/specs/2026-10-03-mobile-app-design.md`, 런북 `../docs/mobile-app.md`.

- `flutter pub get && flutter run` · `flutter test` · `flutter analyze`
- 네이티브: 로그인·뭐 먹지·사다리·커피 타임·더보기. 그 외 기능은 WebView(`lib/web/`).
- API는 `lib/api/client.dart`(Bearer)만 통해서. 서버 주소 `--dart-define=API_BASE=`.
```

- [ ] **Step 3: 전체 검증**

```bash
cd mobile && flutter analyze && flutter test && flutter build apk --debug | tail -2
cd ../frontend && npx vitest run 2>&1 | tail -3 && npx tsc --noEmit -p . && npx eslint src
```
Expected: analyze 0 issues, Dart 테스트 전부 PASS, APK 생성, 프론트 테스트·tsc·eslint 통과.

- [ ] **Step 4: 커밋·푸시**

```bash
cd .. && git add docs/mobile-app.md mobile/README.md mobile/pubspec.yaml
git commit -m "docs(mobile): 개발기 설치 절차·실기기 체크리스트·README"
git pull --rebase origin main && git push origin main
```

- [ ] **Step 5: 메모리 갱신**

`~/.claude/projects/-Users-seunguk-kang-Repos-inje-playground/memory/`에 `mobile-app-status.md`(type: project — 2026-10-03 설계·구현, 배포 방식 미정·푸시 2단계, 함정: 리프레시 회전 때문에 WebView 별도 세션, generateLink hashed_token은 verifyOtp type email) 작성, `MEMORY.md`에 한 줄 추가.
