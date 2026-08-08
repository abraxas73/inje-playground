# 이노그리드 리브랜딩 + GW 로그인 연동 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** NHN 인재아이엔씨 브랜딩을 이노그리드로 교체하고, gw.innogrid.com 그룹웨어 로그인 세션을 우리 앱 로그인으로 연동한다.

**Architecture:** 파트 A(리브랜딩)는 로고 자산·문구·테마 색상 교체로 독립 배포한다. 파트 B(GW 로그인)는 앱을 `.innogrid.com` 서브도메인에 두어 공유 쿠키(`omni:*`)를 클라이언트가 읽고, 서버 라우트가 그 토큰으로 GW API를 검증·조회한 뒤 Supabase 매직링크로 세션을 발급한다.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind CSS 4, TypeScript strict, Supabase Auth, vitest, Playwright.

## Global Constraints

- 프레임워크: Next.js 16 App Router / React 19 / Tailwind 4 / TS strict. 기존 패턴(`"use client"`, `@/*` alias) 준수.
- 테스트: 순수 로직은 vitest(`npm run test`), 파일은 `src/lib/__tests__/*.test.ts`. E2E는 Playwright(`npm run test:e2e`).
- 배포: GitHub 자동배포 아님. `git push` 후 `./frontend/scripts/deploy-frontend.sh prod`(Vercel) 수동 실행.
- 문구 치환 규칙 (전 파일 공통):
  | 기존 | 변경 |
  |------|------|
  | `NHN InjeInc` | `이노그리드` |
  | `NHN 인재아이엔씨` | `이노그리드` |
  | `인재인` | `이노그리더` |
  | `NHN InjeInc Workshop` | `Innogrid Workshop` |
- 개인정보처리방침 운영주체는 우선 `이노그리드`로 표기(정식 법인명 확정 시 조정).
- 로고 SVG: `viewBox="0 0 166 23"`, 단일 `<path>`, `<Image>` 태그로 로드되므로 `currentColor` 불가 → **fill 고정색**. `logo.svg`=`#191919`, `logo-white.svg`=`#ffffff`.
- 앱은 현재 다크모드 미활성(`.dark` 토글 코드 없음) — 로고는 밝은 배경용 잉크색 하나로 충분. `logo-white.svg`는 향후 대비용으로 함께 교체하되 신규 사용처 추가는 범위 밖.
- 이노그리드 CI 색상 토큰:
  | 이름 | HEX | oklch |
  |------|-----|-------|
  | inno-blue (primary) | `#0042ff` | `oklch(0.504 0.279 264)` |
  | inno-dark | `#0035cc` | `oklch(0.429 0.233 264)` |
  | inno-sky | `#68caff` | `oklch(0.800 0.119 235)` |

---

# 파트 A — 이노그리드 리브랜딩

## Task A1: 로고 자산 교체

**Files:**
- Modify: `frontend/public/logo.svg`
- Modify: `frontend/public/logo-white.svg`

**Interfaces:**
- Produces: `/logo.svg`, `/logo-white.svg` — `viewBox="0 0 166 23"` INNOGRID 워드마크. 표시 비율 166:23 ≈ 7.217:1.

- [ ] **Step 1: innogrid.com 헤더 워드마크를 추출해 두 파일 생성**

innogrid.com 헤더 로고는 인라인 SVG 단일 path다. 아래 스크립트로 추출·생성한다(viewBox는 path 실제 bbox `x[0,165.13] y[0,22.00]`에 맞춰 `0 0 166 23`으로 하드코딩 — 검증 완료). 원본의 `fill="current"`는 유효하지 않은 값이라 고정색으로 대체한다.

```bash
cd /Users/seunguk.kang/Repos/inje-playground
curl -sL https://www.innogrid.com/ -o /tmp/innogrid-home.html
python3 - <<'PY'
import re
html = open('/tmp/innogrid-home.html').read()
m = re.search(r'header_logo[^>]*><a href="/">\s*(<svg.*?</svg>)', html, re.S)
d = re.search(r'd="([^"]+)"', m.group(1)).group(1)
tmpl = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 166 23"><path fill="{c}" d="{d}"/></svg>\n'
open('frontend/public/logo.svg', 'w').write(tmpl.format(c="#191919", d=d))
open('frontend/public/logo-white.svg', 'w').write(tmpl.format(c="#ffffff", d=d))
print("logo.svg / logo-white.svg written")
PY
```

- [ ] **Step 2: 렌더 육안 검증**

```bash
qlmanage -t -s 400 -o /tmp frontend/public/logo.svg >/dev/null 2>&1 && open /tmp/logo.svg.png
```
Expected: "INNOGRID" 워드마크가 좌우 잘림 없이 표시된다.

- [ ] **Step 3: Commit**

```bash
git add frontend/public/logo.svg frontend/public/logo-white.svg
git commit -m "feat(branding): 로고를 이노그리드 워드마크로 교체"
```

## Task A2: 문구 및 로고 사용처 교체

**Files:**
- Modify: `frontend/src/app/layout.tsx:9-10`
- Modify: `frontend/src/app/page.tsx:85,88`
- Modify: `frontend/src/app/privacy/page.tsx:6,8,26,208,238,278`
- Modify: `frontend/src/app/manual/page.tsx:10,145,148,242`
- Modify: `frontend/src/app/login/page.tsx:27,29`
- Modify: `frontend/src/components/layout/Navigation.tsx:86-90`
- Modify: `frontend/src/app/globals.css:57,186` (주석)

**Interfaces:**
- Consumes: Task A1의 `/logo.svg`.
- Produces: 사용자에게 노출되는 모든 "인재/InjeInc" 표기 제거.

- [ ] **Step 1: 문구 치환 (Global Constraints 규칙표 적용)**

각 위치를 규칙표대로 수정한다. 구체값:
- `layout.tsx`: title `"NHN InjeInc"` → `"이노그리드"`; description `"인재인을 위한 서비스 …"` → `"이노그리더를 위한 서비스 …"`.
- `page.tsx:85` `NHN InjeInc` → `이노그리드`; `page.tsx:88` `<span className="gradient-text">인재인</span>` → `<span className="gradient-text">이노그리더</span>`.
- `privacy/page.tsx`: `6` title `… | NHN InjeInc Workshop` → `… | Innogrid Workshop`; `8`,`26` `NHN 인재아이엔씨` → `이노그리드`; `208` 운영주체 `NHN 인재아이엔씨` → `이노그리드`; `278` `NHN InjeInc Workshop` → `Innogrid Workshop`.
- `manual/page.tsx`: `10` `NHN 인재아이엔씨 구성원` → `이노그리드 구성원`; `145` `NHN InjeInc 사용자 매뉴얼` → `이노그리드 사용자 매뉴얼`; `148` `인재인을 위한` → `이노그리더를 위한`; `242` `NHN InjeInc Workshop` → `Innogrid Workshop`.
- `login/page.tsx:29` `인재인을 위한 서비스에 로그인하세요` → `이노그리더를 위한 서비스에 로그인하세요`.
- `globals.css:57` 주석 `NHN Injeinc Navy Blue Theme` → `Innogrid CI Blue Theme`; `186` 주석 `NHN Injeinc gradient text` → `Innogrid gradient text`.

- [ ] **Step 2: 로고 `alt` 및 `<Image>` 크기 갱신 (비율 166:23)**

`<Image>`의 width/height를 기존값 그대로 두면 새 로고 비율(7.217:1)과 안 맞아 왜곡된다. height 기준 재계산값으로 교체하고 `alt`를 `"이노그리드"`로 바꾼다.
- `Navigation.tsx:86-90`: `alt="이노그리드"`, `width={101} height={14}`.
- `login/page.tsx:27`: `alt="이노그리드"`, `width={130} height={18}`.
- `privacy/page.tsx:238`: `alt="이노그리드"`, `width={115} height={16}`.

- [ ] **Step 3: 잔여 문자열 없음 확인**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/frontend
grep -rn -iE "injeinc|인재아이엔씨|인재인" src/ ; echo "exit=$?"
```
Expected: 매치 없음(`grep` exit=1). 매치가 남으면 수정.

- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(branding): 인재 표기를 이노그리드로 교체"
```

## Task A3: 테마 색상 CI 적용

**Files:**
- Modify: `frontend/src/app/globals.css` — `:root`(약 54-88), `.dark`(약 89-120), `.gradient-text`/`.hover-glow`(약 186-200). 라인은 유동적이므로 셀렉터명으로 위치 특정.

**Interfaces:**
- Produces: 앱 전역 primary/accent/chart/gradient 색이 이노그리드 CI 블루로 전환.

- [ ] **Step 1: `:root` primary 계열 교체**

`globals.css`의 `:root`에서 아래 값으로 교체(hue 260→264, 채도 상향):
```css
  --primary: oklch(0.504 0.279 264);
  --ring: oklch(0.55 0.22 264);
  --chart-1: oklch(0.504 0.279 264);
  --sidebar-primary: oklch(0.504 0.279 264);
  --sidebar-ring: oklch(0.55 0.22 264);
```

- [ ] **Step 2: `.dark` primary 계열 교체 (밝은 배경 대비 확보)**

`.dark` 블록에서:
```css
  --primary: oklch(0.62 0.24 264);
  --ring: oklch(0.62 0.24 264);
  --chart-1: oklch(0.68 0.20 262);
```

- [ ] **Step 3: `.gradient-text` / `.hover-glow` 교체**

```css
.gradient-text {
  background: linear-gradient(135deg, oklch(0.504 0.279 264), oklch(0.800 0.119 235));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
```
`.hover-glow:hover`의 box-shadow 첫 색을 `oklch(0.504 0.279 264 / 15%)`로.

- [ ] **Step 4: 빌드 확인**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build
```
Expected: 빌드 성공(CSS 파싱 에러 없음).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/globals.css
git commit -m "feat(branding): 테마 색상을 이노그리드 CI 블루로 전환"
```

## Task A4: 리브랜딩 검증 및 배포

**Files:** 없음(검증·배포).

- [ ] **Step 1: 빌드 + 린트**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/frontend && npm run build && npm run lint
```
Expected: 둘 다 통과.

- [ ] **Step 2: 로컬 육안 확인**

```bash
./frontend/scripts/restart-frontend.sh 3003
```
홈(`/`), 로그인(`/login`), 네비게이션, 개인정보(`/privacy`), 매뉴얼(`/manual`)에서 로고·문구·primary 색을 확인. 잔여 "인재" 표기 없음.

- [ ] **Step 3: 배포**

```bash
git push
./frontend/scripts/deploy-frontend.sh prod
```
Expected: Vercel Production 배포 완료. 운영 URL에서 재확인.

---

# 파트 B — GW 로그인 연동 (A안)

> 파트 B는 리브랜딩 배포 후 착수. **Task B0(전제 검증)를 먼저 통과해야** 나머지를 진행한다.

## Task B0: Phase 0 전제 검증 (게이트)

**Files:** 없음(수동 검증).

- [ ] **Step 1: omni 공유 쿠키 존재·도메인 확인**

gw.innogrid.com에 로그인된 브라우저 탭의 개발자도구 콘솔에서:
```js
document.cookie.split(';').map(c=>c.trim().split('=')[0]).filter(n=>n.startsWith('omni:'))
```
Expected: `["omni:gw.innogrid.com:oAuthToken", "omni:gw.innogrid.com:signKey", ...]`. 결과가 비면 A안 불가 → 사용자에게 보고하고 B안(사내 IdP SSO)으로 전환.

- [ ] **Step 2: 쿠키 도메인 스코프가 `.innogrid.com`인지 확인**

DevTools → Application → Cookies에서 `omni:*` 쿠키의 Domain 열이 `.innogrid.com`인지 확인. `gw.innogrid.com` 전용이면 서브도메인 공유 불가 → B안 전환.

- [ ] **Step 3: 로컬 서브도메인 + HTTPS 환경 구성**

`omni:*` 쿠키는 `secure` 속성이라 로컬도 HTTPS여야 `document.cookie`로 읽힌다.
```bash
# /etc/hosts 에 추가 (sudo 필요 — 사용자가 직접 실행)
echo "127.0.0.1 playground.innogrid.com" | sudo tee -a /etc/hosts
```
Next dev를 HTTPS로 기동:
```bash
cd /Users/seunguk.kang/Repos/inje-playground/frontend
npx next dev --experimental-https -p 3003
```
`https://playground.innogrid.com:3003` 접속 후 콘솔에서 Step 1 스크립트를 다시 실행해 **우리 앱에서도 omni 쿠키가 읽히는지** 확인. 읽히면 A안 진행 확정.

## Task B1: GW 인증 순수 로직 (`gw-auth.ts`)

**Files:**
- Create: `frontend/src/lib/gw-auth.ts`
- Test: `frontend/src/lib/__tests__/gw-auth.test.ts`

**Interfaces:**
- Produces:
  - `parseOmniTokens(cookieString: string): { oAuthToken: string; signKey: string } | null` — 쿠키 문자열에서 `omni:gw.innogrid.com:oAuthToken`/`:signKey`를 추출. 없으면 null.
  - `buildGwSignature(params: { oAuthToken: string; signKey: string; transactionId: string; timestamp: number; pathname: string }): string` — `base64(HmacSHA256(oAuthToken + transactionId + timestamp + pathname, signKey))`.
  - `isInnogridEmail(email: string): boolean` — `@innogrid.com` 도메인(대소문자 무시) 여부.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/gw-auth.test.ts
import { describe, it, expect } from "vitest";
import { parseOmniTokens, buildGwSignature, isInnogridEmail } from "@/lib/gw-auth";

describe("parseOmniTokens", () => {
  it("omni 쿠키에서 토큰과 서명키를 추출한다", () => {
    const c = "foo=bar; omni:gw.innogrid.com:oAuthToken=TOKEN123; omni:gw.innogrid.com:signKey=KEY456";
    expect(parseOmniTokens(c)).toEqual({ oAuthToken: "TOKEN123", signKey: "KEY456" });
  });
  it("쿠키가 없으면 null", () => {
    expect(parseOmniTokens("foo=bar")).toBeNull();
  });
});

describe("buildGwSignature", () => {
  it("결정적 base64 서명을 만든다", () => {
    const args = { oAuthToken: "tok", signKey: "key", transactionId: "tid", timestamp: 1700000000, pathname: "/gw/gw016A02" };
    const sig = buildGwSignature(args);
    // base64(HmacSHA256("tok"+"tid"+1700000000+"/gw/gw016A02", "key"))
    expect(sig).toBe("nZ2rp0k…"); // Step 3에서 실제 계산값으로 확정
    expect(buildGwSignature(args)).toBe(sig); // 결정성
  });
});

describe("isInnogridEmail", () => {
  it("innogrid.com 도메인만 허용", () => {
    expect(isInnogridEmail("a@innogrid.com")).toBe(true);
    expect(isInnogridEmail("a@INNOGRID.COM")).toBe(true);
    expect(isInnogridEmail("a@gmail.com")).toBe(false);
  });
});
```
> 쿠키 이름의 콜론(`:`)은 값 구분자 `=`의 첫 등장 기준으로 분리해야 한다. 테스트 값의 키릴 문자 오탈자에 주의(실제 작성 시 ASCII로).

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd frontend && npm run test -- gw-auth
```
Expected: FAIL ("gw-auth" 모듈 없음).

- [ ] **Step 3: 최소 구현**

```ts
// frontend/src/lib/gw-auth.ts
import { createHmac } from "crypto";

const OMNI_PREFIX = "omni:gw.innogrid.com:";

export function parseOmniTokens(cookieString: string) {
  const map = new Map<string, string>();
  for (const part of cookieString.split(";")) {
    const s = part.trim();
    const eq = s.indexOf("=");
    if (eq === -1) continue;
    map.set(s.slice(0, eq), s.slice(eq + 1));
  }
  const oAuthToken = map.get(`${OMNI_PREFIX}oAuthToken`);
  const signKey = map.get(`${OMNI_PREFIX}signKey`);
  if (!oAuthToken || !signKey) return null;
  return { oAuthToken, signKey };
}

export function buildGwSignature(p: {
  oAuthToken: string; signKey: string; transactionId: string; timestamp: number; pathname: string;
}): string {
  const msg = `${p.oAuthToken}${p.transactionId}${p.timestamp}${p.pathname}`;
  return createHmac("sha256", p.signKey).update(msg).digest("base64");
}

export function isInnogridEmail(email: string): boolean {
  return /@innogrid\.com$/i.test(email.trim());
}
```

- [ ] **Step 4: 실제 서명값을 계산해 테스트 기대값 확정**

```bash
cd frontend && node -e "const {createHmac}=require('crypto'); console.log(createHmac('sha256','key').update('tok'+'tid'+1700000000+'/gw/gw016A02').digest('base64'))"
```
출력값을 Step 1 테스트의 기대값으로 교체.

- [ ] **Step 5: 테스트 통과 확인**

```bash
cd frontend && npm run test -- gw-auth
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/gw-auth.ts frontend/src/lib/__tests__/gw-auth.test.ts
git commit -m "feat(gw-auth): GW 쿠키 파싱·HMAC 서명·이메일 검증 순수 로직"
```

## Task B2: Supabase Admin 클라이언트

**Files:**
- Create: `frontend/src/lib/supabase-admin.ts`

**Interfaces:**
- Produces: `createAdminClient()` — `SUPABASE_SERVICE_ROLE_KEY`로 만든 서버 전용 Supabase 클라이언트. 클라이언트 번들 포함 금지(서버 라우트에서만 import).

- [ ] **Step 1: 구현**

```ts
// frontend/src/lib/supabase-admin.ts
import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Supabase admin env missing");
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
```

- [ ] **Step 2: 환경변수 등록**

`.env.local`(로컬) 및 Vercel 프로젝트 환경변수에 `SUPABASE_SERVICE_ROLE_KEY` 추가(Supabase 대시보드 → Project Settings → API → service_role key). `GW_API_BASE`(기본 `https://gw.innogrid.com`)도 추가.
> service_role 키는 절대 클라이언트에 노출 금지. `NEXT_PUBLIC_` 접두어 사용하지 않는다.

- [ ] **Step 3: 빌드 확인 + Commit**

```bash
cd frontend && npm run build
git add frontend/src/lib/supabase-admin.ts
git commit -m "feat(gw-auth): 서버 전용 Supabase admin 클라이언트"
```

## Task B3: GW 인증 서버 라우트 (`/api/auth/gw`)

**Files:**
- Create: `frontend/src/app/api/auth/gw/route.ts`

**Interfaces:**
- Consumes: `parseOmniTokens`(형식 참고), `buildGwSignature`, `isInnogridEmail` (B1); `createAdminClient` (B2).
- Produces: `POST /api/auth/gw` — body `{ oAuthToken: string; signKey: string }` → GW API 검증 후 `{ token_hash: string, email: string }` 또는 4xx.

- [ ] **Step 1: 라우트 구현**

```ts
// frontend/src/app/api/auth/gw/route.ts
import { NextResponse } from "next/server";
import { randomUUID, createHmac } from "crypto";
import { buildGwSignature, isInnogridEmail } from "@/lib/gw-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const GW_BASE = process.env.GW_API_BASE ?? "https://gw.innogrid.com";
// Task B0에서 실제 세션 응답으로 확정할 세션 조회 엔드포인트 (후보: /gw/gw016A02)
const SESSION_PATH = "/gw/gw016A02";

export async function POST(req: Request) {
  const { oAuthToken, signKey } = await req.json().catch(() => ({}));
  if (!oAuthToken || !signKey) {
    return NextResponse.json({ error: "missing tokens" }, { status: 400 });
  }

  const transactionId = randomUUID();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = buildGwSignature({ oAuthToken, signKey, transactionId, timestamp, pathname: SESSION_PATH });

  const gwRes = await fetch(`${GW_BASE}${SESSION_PATH}`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${oAuthToken}`,
      "transaction-id": transactionId,
      "timestamp": String(timestamp),
      "wehago-sign": signature,
      "Content-type": "application/x-www-form-urlencoded",
    },
    body: "",
  });

  if (!gwRes.ok) {
    return NextResponse.json({ error: "gw auth failed" }, { status: 401 });
  }
  const data = await gwRes.json();
  // Task B0에서 실제 응답 구조로 경로 확정 (예: data.resultData.sessionInfo)
  const info = data?.resultData?.sessionInfo ?? data?.sessionInfo ?? {};
  const email: string | undefined = info.user_email || info.user_default_email;
  const name: string | undefined = info.user_name;
  if (!email || !isInnogridEmail(email)) {
    return NextResponse.json({ error: "invalid email" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: link, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { data: { full_name: name } },
  });
  if (error || !link?.properties?.hashed_token) {
    return NextResponse.json({ error: "session issue failed" }, { status: 500 });
  }

  return NextResponse.json({ token_hash: link.properties.hashed_token, email });
}
```
> `SESSION_PATH`와 응답 필드 경로는 Task B0에서 실제 GW 세션으로 확인해 확정한다. 확정 전에는 이 값이 추정치임을 주석으로 남긴다.

- [ ] **Step 2: 빌드 확인**

```bash
cd frontend && npm run build
```
Expected: 타입/빌드 통과.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/app/api/auth/gw/route.ts
git commit -m "feat(gw-auth): GW 토큰 검증·이메일 획득·매직링크 발급 라우트"
```

## Task B4: 로그인 페이지 GW 버튼

**Files:**
- Modify: `frontend/src/app/login/page.tsx`

**Interfaces:**
- Consumes: `POST /api/auth/gw` (B3); Supabase 클라이언트 `verifyOtp`.

- [ ] **Step 1: GW 로그인 핸들러 + 버튼 추가**

기존 구글 버튼 아래에 "이노그리드 GW 계정으로 로그인" 버튼을 추가한다. 클릭 시:
```ts
const handleGwLogin = async () => {
  logAction("GW 로그인 시도", "auth");
  // 클라이언트에서 omni 쿠키 두 개를 읽는다 (앱이 *.innogrid.com 서브도메인일 때만 접근 가능)
  const cookie = document.cookie;
  const get = (name: string) => {
    const m = cookie.split(";").map(s => s.trim()).find(s => s.startsWith(name + "="));
    return m ? m.slice(name.length + 1) : "";
  };
  const oAuthToken = get("omni:gw.innogrid.com:oAuthToken");
  const signKey = get("omni:gw.innogrid.com:signKey");
  if (!oAuthToken || !signKey) {
    alert("GW 로그인 세션을 찾을 수 없습니다. 먼저 gw.innogrid.com에 로그인해 주세요.");
    return;
  }
  const res = await fetch("/api/auth/gw", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ oAuthToken, signKey }),
  });
  if (!res.ok) { alert("GW 로그인에 실패했습니다."); return; }
  const { token_hash } = await res.json();
  const supabase = createClient();
  const { error } = await supabase.auth.verifyOtp({ type: "email", token_hash });
  if (error) { alert("세션 생성에 실패했습니다."); return; }
  window.location.href = "/";
};
```
버튼 JSX(기존 구글 버튼 아래):
```tsx
<Button onClick={handleGwLogin} variant="outline" className="w-full h-11 text-sm font-medium mt-2">
  이노그리드 GW 계정으로 로그인
</Button>
```

- [ ] **Step 2: 빌드 확인 + Commit**

```bash
cd frontend && npm run build
git add frontend/src/app/login/page.tsx
git commit -m "feat(gw-auth): 로그인 페이지에 GW 계정 로그인 버튼 추가"
```

## Task B5: 로컬 E2E 검증 (실제 GW 세션)

**Files:** 없음(수동 검증).

- [ ] **Step 1: 실제 GW 세션으로 엔드포인트·응답 구조 확정**

Task B0의 HTTPS 서브도메인 환경에서, 실제 omni 토큰으로 세션 조회를 시도해 `SESSION_PATH`와 응답 필드(`user_name`/`user_email` 위치)를 확정한다. 서버 로그(`console.log(JSON.stringify(data))`)로 실제 구조 확인 후 B3의 추정 경로를 실제값으로 수정하고 재커밋.

- [ ] **Step 2: 로그인 플로우 E2E**

`https://playground.innogrid.com:3003/login`에서 "이노그리드 GW 계정으로 로그인" 클릭 → Supabase 세션 확립 → 홈 이동 확인. `user_profiles`에 프로필 생성/역할 확인.

- [ ] **Step 3: 실패 케이스 확인**

- gw.innogrid.com 로그아웃 상태에서 클릭 → 401/안내.
- 만료 토큰 → 401.
- (가능하면) 비-innogrid 이메일 → 403.

- [ ] **Step 4: 최종 확정 커밋**

```bash
git add -A && git commit -m "fix(gw-auth): 실제 GW 세션 응답 구조로 엔드포인트·필드 확정"
```

> **운영 배포**: 커스텀 서브도메인(`<sub>.innogrid.com`)을 Vercel에 연결하고 사내 DNS CNAME을 확보한 뒤 배포한다. DNS 확보 전에는 로컬(`/etc/hosts`) 검증까지만 완료 상태로 둔다.

---

## Self-Review

- **스펙 커버리지**: 로고(A1) · 문구(A2) · 테마(A3) · 배포(A4) · 전제검증(B0) · 순수로직(B1) · admin(B2) · 라우트(B3) · UI(B4) · E2E(B5) — 스펙 전 항목 대응.
- **불확실 지점(정직)**: GW `SESSION_PATH`와 응답 필드는 정적 분석 기반 추정이며 B0/B5의 실제 세션으로 확정. HMAC 서명 알고리즘은 번들에서 추출했으나 실제 정합성은 E2E에서만 검증 가능.
- **폴백**: B0 실패 시 전체 파트 B는 B안(사내 IdP SAML SSO)으로 전환하며 별도 스펙 필요.
