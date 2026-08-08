# 이노그리드 리브랜딩 + GW 로그인 연동 설계

**작성일**: 2026-08-08
**상태**: 설계 승인 대기

## 배경

NHN 인재아이엔씨 소속이었던 워크샵 유틸리티 앱이 이노그리드(Innogrid)로 브랜드가 변경되었다. 세 가지 작업이 필요하다.

1. 로고를 NHN InjeInc → 이노그리드로 교체
2. "인재" 관련 표현을 모두 이노그리드로 수정
3. 구글 로그인 외에, 사내 그룹웨어(gw.innogrid.com)에 로그인된 사용자를 우리 앱에서도 로그인 처리

파트 1·2(리브랜딩)와 파트 3(GW 로그인)은 서로 독립적이다. **리브랜딩을 먼저 완성·배포**한 뒤 GW 로그인을 이어서 구현한다.

---

## 파트 1·2 — 이노그리드 리브랜딩

### 로고 교체

이노그리드 공식 홈페이지(innogrid.com) 헤더의 워드마크 SVG를 사용한다.

- 원본: 인라인 SVG, `viewBox="0 0 165 22"`, 단일 `<path>`. 원본은 `fill="current"`(유효하지 않은 값)로 되어 있어 **`fill="currentColor"`로 수정**한다.
- `frontend/public/logo.svg` — 잉크색(다크) 워드마크. `currentColor`로 두고 사용처의 텍스트 색을 상속받게 한다.
- `frontend/public/logo-white.svg` — 흰색 워드마크(어두운 배경용).
- 가로세로비(165:22 ≈ 7.5:1)가 기존 로고(140:16, 150:18)와 거의 같아 `<Image>` width/height는 기존 값을 유지하면 레이아웃이 깨지지 않는다.

로고 사용처: `Navigation.tsx`, `login/page.tsx`, `privacy/page.tsx` (`alt` 텍스트도 "이노그리드"로 함께 수정).

### 문구 교체

7개 파일 17곳. 치환 규칙:

| 기존 | 변경 |
|------|------|
| `NHN InjeInc` | `이노그리드` |
| `NHN 인재아이엔씨` | `이노그리드` |
| `인재인` | `이노그리더` |
| `NHN InjeInc Workshop` | `Innogrid Workshop` |

대상 파일: `app/layout.tsx`(메타 title/description), `app/page.tsx`(히어로), `app/globals.css`(주석), `app/privacy/page.tsx`(운영주체 표기 포함), `app/manual/page.tsx`, `app/login/page.tsx`, `components/layout/Navigation.tsx`.

개인정보처리방침의 **운영 주체** 표기는 법적 성격이 있으므로 정식 법인명("이노그리드" 또는 "주식회사 이노그리드")으로 정확히 기재한다. 정확한 법인 표기가 필요하면 사용자에게 확인한다.

### 테마 색상 (CI 적용)

innogrid.com CSS에서 확보한 공식 브랜드 토큰:

| 토큰 | HEX | oklch |
|------|-----|-------|
| inno-blue (primary) | `#0042ff` | `oklch(0.504 0.279 264)` |
| inno-dark | `#0035cc` | `oklch(0.429 0.233 264)` |
| inno-sky | `#68caff` | `oklch(0.800 0.119 235)` |
| cloud-dark | `#0a2348` | `oklch(0.261 0.076 258)` |

현재 테마는 "NHN Injeinc Navy Blue" = `oklch(0.35 0.12 260)`. **hue는 260→264로 사실상 동일**하고 채도만 0.12→0.28로 올라간다. 즉 "차분한 남색"에서 "선명한 코발트블루"로 바뀔 뿐 계열이 달라지지 않아 기존 디자인이 유지된다.

`frontend/src/app/globals.css` 수정:

- `:root` — `--primary`, `--ring`, `--sidebar-primary`, `--sidebar-ring`, `--chart-1`을 inno-blue 계열로 교체.
- `.dark` — 어두운 배경 대비 확보를 위해 primary/ring을 inno-sky(`oklch(0.80 0.12 235)`) 쪽으로 밝게.
- `.gradient-text` — 그라디언트를 inno-blue → inno-sky로.
- `.hover-glow` — glow 색상을 inno-blue로.

### 검증

- `npm run build` + `npm run lint` 통과.
- 육안 확인: 홈/로그인/네비/개인정보/매뉴얼 페이지에서 로고·문구·색상.
- 배포: `deploy-frontend.sh prod` (Vercel Production, `git push` 후 수동).

---

## 파트 3 — GW 로그인 연동 (C안: 사내 크롬 확장 브리지)

### GW 인증 구조 (main.0d5e089b.js 정적 분석)

- gw.innogrid.com은 **더존 WEHAGO / Amaranth 10** 기반 SPA.
- 인증 자격은 쿠키 `oAuthToken`(베어러 토큰) + `signKey`(HMAC 비밀키). `gw.innogrid.com` 도메인 스코프.
- GW API는 쿠키 인증을 쓰지 않는다(`xhr.withCredentials = false`). 대신:
  - `Authorization: Bearer <oAuthToken>`
  - `transaction-id: <uuid>`
  - `timestamp: <unix초>`
  - `wehago-sign: base64(HmacSHA256(oAuthToken + transactionId + timestamp + pathname, signKey))`
- 세션 조회 응답(`/gw/gw016A02` 계열)에 `sessionInfo` → `user_name`, `user_email`, `user_default_email` 존재.
- **CORS가 모든 오리진에 열려 있음**(요청 Origin 반사, `allow-credentials: true`). 즉 서버가 토큰만 확보하면 GW API를 server-to-server로 호출할 수 있다.

### 왜 A안(서브도메인 공유 쿠키)이 불가능했나

착수 전 검증(B0)에서 gw.innogrid.com 로그인 상태의 콘솔에서 `omni:*` 공유 쿠키가 **존재하지 않음(`[]`)** 을 확인했다. GW는 인증 쿠키를 `.innogrid.com` 상위 도메인으로 복제하지 않으며, `oAuthToken`/`signKey`는 `gw.innogrid.com` 전용 스코프다. 따라서 우리 앱을 `*.innogrid.com` 서브도메인에 두어도 `document.cookie`로 읽을 수 없다. → A안 폐기.

### C안 아키텍처 (신규 크롬 확장)

크롬 확장은 `chrome.cookies` API로 **다른 도메인의 쿠키(HttpOnly 포함)** 를 읽을 수 있다. 이 권한을 이용해 확장이 gw 쿠키를 읽어 우리 앱에 전달한다. 서브도메인·공유 쿠키·`/etc/hosts`·로컬 HTTPS가 모두 불필요하다.

```
[브라우저] gw.innogrid.com 로그인 (oAuthToken/signKey 쿠키 보유)

[우리 앱: 아무 origin (localhost, vercel)]
  1. "이노그리드 GW 계정으로 로그인" 버튼 클릭
  2. (app → 확장) window.postMessage({ type:"GW_SESSION_REQUEST", id })
  3. (확장 content script → background) chrome.runtime 메시지 전달
  4. (확장 background) chrome.cookies.get({url:"https://gw.innogrid.com", name:"oAuthToken"/"signKey"})
  5. (확장 → app) window.postMessage({ type:"GW_SESSION_RESPONSE", id, data:{oAuthToken, signKey} })
  6. (app → server) POST /api/auth/gw { oAuthToken, signKey }
  7. (server) GW API 호출(server-to-server, HMAC 서명 재현) → 토큰 검증 + user_name/user_email
  8. (server) Supabase Admin(service_role) → 이메일로 유저 확인/생성 → magiclink token_hash
  9. (app) supabase.auth.verifyOtp({ type:'email', token_hash }) → 세션 확립 → 완료
```

### 신규 크롬 확장 (repo 내 `extension/`)

- **Manifest V3**. `permissions: ["cookies"]`, `host_permissions: ["https://gw.innogrid.com/*"]`.
- **content script**: `matches`를 **우리 앱 origin에만** 한정(`http://localhost:*/*`, `https://inje-playground.vercel.app/*`). 아무 사이트나 확장에 토큰을 요청하지 못하게 하는 1차 방어선.
- **background service worker**: content script로부터 받은 `GW_SESSION_REQUEST`에 대해 `chrome.cookies.get`으로 `oAuthToken`/`signKey`를 읽어 응답.
- GW 로그인 전용. 기존 Dooray 프록시 확장은 그대로 둔다(별도).

### 앱/서버 컴포넌트 (A안 설계 재사용)

- `frontend/src/lib/gw-auth.ts` (신규) — `buildGwSignature`(wehago-sign HMAC), `isInnogridEmail`. 순수 함수, 단위 테스트.
- `frontend/src/lib/supabase-admin.ts` (신규) — `service_role` 서버 전용 클라이언트.
- `frontend/src/app/api/auth/gw/route.ts` (신규) — POST `{oAuthToken, signKey}` → GW API 검증 → 이메일 → magiclink 발급.
- `frontend/src/app/login/page.tsx` (수정) — "GW 계정으로 로그인" 버튼 + 확장 postMessage 핸들러(요청/응답, 타임아웃) → verifyOtp.
- `frontend/src/lib/gw-extension.ts` (신규) — 확장과의 postMessage 요청/응답 래퍼(타임아웃·확장 미설치 감지). Dooray의 `doorayFetch` 패턴 참고.
- 환경변수: `SUPABASE_SERVICE_ROLE_KEY`(서버 전용), `GW_API_BASE`(기본 `https://gw.innogrid.com`).

### 핵심 설계 판단 — 토큰 검증은 서버에서

확장이 반환한 토큰/이메일을 앱이 그대로 신뢰하면 위조 위험이 있다. 서버가 GW 토큰으로 GW API를 직접 호출해 유효성과 이메일을 확인한 뒤에만 Supabase 세션을 발급한다. 신뢰 로직·`service_role`·HMAC 계산은 전부 서버 라우트에 둔다. 확장은 쿠키를 읽어 전달하는 역할만 한다. 이메일 도메인이 `@innogrid.com`인지 서버에서 확인해 외부 계정을 차단한다.

### 검증

- `gw-auth.ts` HMAC·이메일 검증 단위 테스트(vitest).
- 확장을 개발자 모드(언팩)로 로드한 상태에서, gw.innogrid.com 로그인 후 "GW 계정으로 로그인" → Supabase 세션 확립 E2E.
- 확장 미설치 → 안내, 만료/무효 토큰 → 401, 비-innogrid 이메일 → 403 확인.
- 실제 세션 응답으로 `SESSION_PATH`(후보 `/gw/gw016A02`)와 `user_email` 필드 경로를 확정.

### 리스크 (정직한 평가)

- 비공식 경로다. GW(WEHAGO) 업데이트로 쿠키명·API·서명 방식이 바뀌면 깨진다.
- 확장이 gw 세션 토큰을 읽어 앱에 전달한다 → content script 주입 범위를 우리 앱 origin으로 엄격히 제한하고, 서버가 최종 검증한다.
- 우리 서버가 GW의 HMAC 비밀키(signKey)를 요청 처리 동안 다룬다. 저장하지 않고 즉시 폐기.
- 확장 설치가 전제다. 사내 배포(정책 설치 등)는 별도. 초기에는 개발자 모드 언팩 설치.
- 안정성은 사내 IdP SSO가 우위. 협조가 되면 그쪽으로 이전 권장.

---

## 범위 밖 (YAGNI)

- 사내 IdP SAML SSO 실제 구현 — 협조 확보 후 별도 스펙(가장 안정적인 최종 목표).
- GW의 다른 기능(결재/메일 등) 연동.
- 크롬 확장 사내 정책 배포(관리형 설치) 자동화 — 초기에는 개발자 모드 언팩 설치.
