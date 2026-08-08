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

# 파트 B — GW 로그인 연동 (C안: 사내 크롬 확장 브리지)

> A안(서브도메인+공유쿠키)은 B0 검증에서 omni 쿠키 부재로 폐기됨. C안 채택: 신규 크롬 확장이 `chrome.cookies`로 gw 쿠키를 읽어 앱에 전달 → 서버가 GW API로 검증 → Supabase 세션. 서버/순수로직(B1~B3)은 확장과 독립이라 먼저 구현하고, 확장(B4)·앱 연결(B5)·통합(B6) 순으로 진행.

## Task B1: GW 인증 순수 로직 (`gw-auth.ts`)

**Files:**
- Create: `frontend/src/lib/gw-auth.ts`
- Test: `frontend/src/lib/__tests__/gw-auth.test.ts`

**Interfaces:**
- Produces:
  - `buildGwSignature(params: { oAuthToken: string; signKey: string; transactionId: string; timestamp: number; pathname: string }): string` — `base64(HmacSHA256(oAuthToken + transactionId + timestamp + pathname, signKey))`.
  - `isInnogridEmail(email: string): boolean` — `@innogrid.com` 도메인(대소문자 무시) 여부.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/gw-auth.test.ts
import { describe, it, expect } from "vitest";
import { buildGwSignature, isInnogridEmail } from "@/lib/gw-auth";

describe("buildGwSignature", () => {
  it("결정적 base64 서명을 만든다", () => {
    const args = { oAuthToken: "tok", signKey: "key", transactionId: "tid", timestamp: 1700000000, pathname: "/gw/gw016A02" };
    const sig = buildGwSignature(args);
    // base64(HmacSHA256("tok"+"tid"+1700000000+"/gw/gw016A02", "key")) — Step 3에서 실제값 확정
    expect(sig).toBe("__FILL_ME__");
    expect(buildGwSignature(args)).toBe(sig); // 결정성
  });
});

describe("isInnogridEmail", () => {
  it("innogrid.com 도메인만 허용", () => {
    expect(isInnogridEmail("a@innogrid.com")).toBe(true);
    expect(isInnogridEmail("a@INNOGRID.COM")).toBe(true);
    expect(isInnogridEmail("a@gmail.com")).toBe(false);
    expect(isInnogridEmail("  a@innogrid.com  ")).toBe(true);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw/frontend && npm run test -- gw-auth
```
Expected: FAIL ("gw-auth" 모듈 없음).

- [ ] **Step 3: 최소 구현**

```ts
// frontend/src/lib/gw-auth.ts
import { createHmac } from "crypto";

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

- [ ] **Step 4: 실제 서명값 계산해 기대값 확정**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw/frontend
node -e "const {createHmac}=require('crypto'); console.log(createHmac('sha256','key').update('tok'+'tid'+1700000000+'/gw/gw016A02').digest('base64'))"
```
출력값을 Step 1 테스트의 `__FILL_ME__`에 넣는다.

- [ ] **Step 5: 테스트 통과 확인 + Commit**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw/frontend && npm run test -- gw-auth
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw
git add frontend/src/lib/gw-auth.ts frontend/src/lib/__tests__/gw-auth.test.ts
git commit -m "feat(gw-auth): GW HMAC 서명·이메일 검증 순수 로직"
```

## Task B2: Supabase Admin 클라이언트

**Files:**
- Create: `frontend/src/lib/supabase-admin.ts`

**Interfaces:**
- Produces: `createAdminClient()` — `SUPABASE_SERVICE_ROLE_KEY`로 만든 서버 전용 클라이언트. 서버 라우트에서만 import.

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

`.env.local`(로컬) 및 Vercel 프로젝트 환경변수에 `SUPABASE_SERVICE_ROLE_KEY`(Supabase 대시보드 → Settings → API → service_role) 추가. `GW_API_BASE`(기본 `https://gw.innogrid.com`)도 추가. `service_role` 키는 `NEXT_PUBLIC_` 접두어 금지.

- [ ] **Step 3: 빌드 + Commit**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw/frontend && npm run build
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw
git add frontend/src/lib/supabase-admin.ts
git commit -m "feat(gw-auth): 서버 전용 Supabase admin 클라이언트"
```

## Task B3: GW 인증 서버 라우트 (`/api/auth/gw`)

**Files:**
- Create: `frontend/src/app/api/auth/gw/route.ts`

**Interfaces:**
- Consumes: `buildGwSignature`, `isInnogridEmail` (B1); `createAdminClient` (B2).
- Produces: `POST /api/auth/gw` — body `{ oAuthToken: string; signKey: string }` → `{ token_hash, email }` 또는 4xx.

- [ ] **Step 1: 라우트 구현**

```ts
// frontend/src/app/api/auth/gw/route.ts
import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { buildGwSignature, isInnogridEmail } from "@/lib/gw-auth";
import { createAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const GW_BASE = process.env.GW_API_BASE ?? "https://gw.innogrid.com";
// B6에서 실제 세션 응답으로 확정할 세션 조회 엔드포인트 (후보: /gw/gw016A02)
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
  // B6에서 실제 응답 구조로 경로 확정 (예: data.resultData.sessionInfo)
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
> `SESSION_PATH`와 응답 필드 경로는 B6에서 실제 GW 세션으로 확인해 확정한다(확정 전 추정치임을 주석으로 명시).

- [ ] **Step 2: 빌드 확인 + Commit**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw/frontend && npm run build
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw
git add frontend/src/app/api/auth/gw/route.ts
git commit -m "feat(gw-auth): GW 토큰 검증·이메일 획득·매직링크 발급 라우트"
```

## Task B4: 신규 크롬 확장 (`extension/`)

**Files:**
- Create: `extension/manifest.json`
- Create: `extension/background.js`
- Create: `extension/content.js`
- Create: `extension/README.md` (로드/사용 방법)

**Interfaces:**
- Produces: 앱 페이지에서 `window.postMessage({ source:"gw-bridge", type:"GW_SESSION_REQUEST", id })` 수신 시, `window.postMessage({ source:"gw-bridge-ext", type:"GW_SESSION_RESPONSE", id, data:{oAuthToken, signKey} | error })` 응답.

- [ ] **Step 1: manifest.json (MV3)**

```json
{
  "manifest_version": 3,
  "name": "Innogrid GW 로그인 브리지",
  "version": "1.0.0",
  "description": "이노그리드 그룹웨어(GW) 세션을 워크샵 앱 로그인에 연동합니다.",
  "permissions": ["cookies"],
  "host_permissions": ["https://gw.innogrid.com/*"],
  "background": { "service_worker": "background.js" },
  "content_scripts": [
    {
      "matches": ["http://localhost/*", "https://inje-playground.vercel.app/*"],
      "js": ["content.js"],
      "run_at": "document_start"
    }
  ]
}
```
> `matches`는 host 기반이라 `http://localhost/*`가 모든 포트의 localhost에 매칭된다(포트는 매치 패턴에서 무시). 운영 커스텀 도메인이 생기면 여기에 추가한다.

- [ ] **Step 2: background.js (service worker)**

```js
// extension/background.js
// content script로부터 GW 세션 요청을 받아 gw.innogrid.com 쿠키를 읽어 응답.
const GW_URL = "https://gw.innogrid.com";

function getCookie(name) {
  return new Promise((resolve) => {
    chrome.cookies.get({ url: GW_URL, name }, (c) => resolve(c && c.value ? c.value : null));
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "GW_SESSION_REQUEST") return;
  (async () => {
    try {
      const [oAuthToken, signKey] = await Promise.all([
        getCookie("oAuthToken"),
        getCookie("signKey"),
      ]);
      if (!oAuthToken || !signKey) {
        sendResponse({ error: "GW 세션을 찾을 수 없습니다. gw.innogrid.com에 먼저 로그인하세요." });
      } else {
        sendResponse({ data: { oAuthToken, signKey } });
      }
    } catch (e) {
      sendResponse({ error: String(e) });
    }
  })();
  return true; // async sendResponse
});
```

- [ ] **Step 3: content.js (page ↔ extension 브리지)**

```js
// extension/content.js
// 우리 앱 페이지에만 주입됨(manifest matches). window.postMessage ↔ chrome.runtime 브리지.
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  const msg = event.data;
  if (!msg || msg.source !== "gw-bridge" || msg.type !== "GW_SESSION_REQUEST") return;
  chrome.runtime.sendMessage({ type: "GW_SESSION_REQUEST" }, (resp) => {
    window.postMessage(
      { source: "gw-bridge-ext", type: "GW_SESSION_RESPONSE", id: msg.id, data: resp?.data, error: resp?.error || (chrome.runtime.lastError && chrome.runtime.lastError.message) },
      window.location.origin
    );
  });
});
```

- [ ] **Step 4: README.md (개발자 모드 설치 방법)**

`extension/README.md`에 다음을 기록: chrome://extensions → 개발자 모드 ON → "압축해제된 확장 프로그램을 로드" → `extension/` 폴더 선택. gw.innogrid.com 로그인 상태에서 워크샵 앱의 "GW 계정으로 로그인" 사용. 권한(cookies, gw.innogrid.com host) 설명.

- [ ] **Step 5: 확장 유효성 확인 + Commit**

manifest.json이 유효한 JSON인지 확인(`node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json'))"`). content_scripts matches에 앱 origin이 포함됐는지 확인.
```bash
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw
node -e "JSON.parse(require('fs').readFileSync('extension/manifest.json','utf8')); console.log('manifest OK')"
git add extension/
git commit -m "feat(gw-ext): GW 세션 브리지 크롬 확장 신규 추가"
```

## Task B5: 앱측 확장 래퍼 + 로그인 버튼

**Files:**
- Create: `frontend/src/lib/gw-extension.ts`
- Modify: `frontend/src/app/login/page.tsx`

**Interfaces:**
- Consumes: 확장 프로토콜(B4); `POST /api/auth/gw`(B3); Supabase `verifyOtp`.
- Produces: `requestGwSession(timeoutMs?: number): Promise<{ oAuthToken: string; signKey: string }>` — 확장에 요청, 응답/타임아웃 처리.

- [ ] **Step 1: gw-extension.ts (postMessage 래퍼, Dooray 패턴 참고)**

```ts
// frontend/src/lib/gw-extension.ts
export function requestGwSession(timeoutMs = 8000): Promise<{ oAuthToken: string; signKey: string }> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("GW 로그인 확장 프로그램이 응답하지 않습니다. 확장 설치를 확인해주세요."));
    }, timeoutMs);

    function cleanup() {
      window.removeEventListener("message", handler);
      clearTimeout(timeout);
    }
    function handler(event: MessageEvent) {
      const d = event.data;
      if (event.source !== window || !d || d.source !== "gw-bridge-ext" || d.type !== "GW_SESSION_RESPONSE" || d.id !== id) return;
      cleanup();
      if (d.error) reject(new Error(d.error));
      else if (d.data?.oAuthToken && d.data?.signKey) resolve(d.data);
      else reject(new Error("GW 세션 정보를 받지 못했습니다."));
    }

    window.addEventListener("message", handler);
    window.postMessage({ source: "gw-bridge", type: "GW_SESSION_REQUEST", id }, window.location.origin);
  });
}
```

- [ ] **Step 2: 로그인 페이지에 GW 버튼 + 핸들러**

기존 구글 버튼 아래에 버튼과 핸들러를 추가한다.
```tsx
// login/page.tsx 핸들러 (컴포넌트 내부)
const handleGwLogin = async () => {
  logAction("GW 로그인 시도", "auth");
  try {
    const { oAuthToken, signKey } = await requestGwSession();
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
  } catch (e) {
    alert(e instanceof Error ? e.message : "GW 로그인 오류");
  }
};
```
버튼 JSX(구글 버튼 아래):
```tsx
<Button onClick={handleGwLogin} variant="outline" className="w-full h-11 text-sm font-medium mt-2">
  이노그리드 GW 계정으로 로그인
</Button>
```
`requestGwSession` import 추가. `createClient`, `logAction`은 기존 import 재사용.

- [ ] **Step 3: 빌드 + Commit**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw/frontend && npm run build
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw
git add frontend/src/lib/gw-extension.ts frontend/src/app/login/page.tsx
git commit -m "feat(gw-auth): 로그인 페이지 GW 버튼 + 확장 브리지 래퍼"
```

## Task B6: 통합 E2E 검증 (확장 로드 + 실제 GW 세션)

**Files:** 없음(수동 검증) — 필요 시 B3의 `SESSION_PATH`/필드 경로 수정 커밋.

- [ ] **Step 1: 확장 로드 & 앱 기동**

chrome://extensions에서 `extension/`을 언팩 로드. 워크샵 앱을 로컬(`npm run dev`, 포트 임의) 기동. `SUPABASE_SERVICE_ROLE_KEY`/`GW_API_BASE`가 `.env.local`에 있는지 확인.

- [ ] **Step 2: 실제 세션으로 엔드포인트·필드 확정**

gw.innogrid.com 로그인 상태에서 앱의 "이노그리드 GW 계정으로 로그인" 클릭. 서버 로그(`console.log(JSON.stringify(data))`)로 GW 응답 구조를 확인해 `SESSION_PATH`와 `user_name`/`user_email` 위치를 실제값으로 확정하고 B3 수정·재커밋.

- [ ] **Step 3: 로그인 플로우 + 실패 케이스**

- 성공: Supabase 세션 확립 → 홈 이동, `user_profiles` 프로필 확인.
- 확장 미설치: 타임아웃 안내.
- gw 로그아웃 상태: 확장이 "세션 없음" 응답.
- 만료/무효 토큰: 서버 401.
- (가능 시) 비-innogrid 이메일: 서버 403.

- [ ] **Step 4: 최종 확정 커밋 (필요 시)**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/.claude/worktrees/innogrid-rebrand-gw
git add -A && git commit -m "fix(gw-auth): 실제 GW 세션 응답 구조로 엔드포인트·필드 확정"
```

> **운영 배포**: 확장을 사내 구성원에게 배포(개발자 모드 언팩 또는 관리형 정책 설치)해야 실제 사용 가능. 앱 자체는 기존 Vercel 배포에 포함.

---

## Self-Review

- **스펙 커버리지**: 로고(A1) · 문구(A2·A2b) · 테마(A3·A5) · 배포(A4) — 완료·배포됨. GW: 순수로직(B1) · admin(B2) · 라우트(B3) · 크롬확장(B4) · 앱연결(B5) · 통합E2E(B6) — 스펙 파트3(C안) 전 항목 대응.
- **불확실 지점(정직)**: GW `SESSION_PATH`와 응답 필드는 정적 분석 기반 추정이며 B6의 실제 세션으로 확정. HMAC 서명 알고리즘은 번들에서 추출했으나 실제 정합성은 통합 E2E에서만 검증 가능.
- **방향 전환 기록**: A안(서브도메인+공유쿠키)은 B0에서 omni 쿠키 부재로 폐기 → C안(신규 크롬 확장 브리지) 채택. 서버/순수로직은 A안 설계 그대로 재사용, 토큰 획득만 확장 postMessage로 대체.
- **최종 목표**: 안정성은 사내 IdP SSO가 우위 — 협조 확보 시 이전 권장(별도 스펙).
