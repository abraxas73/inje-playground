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

## 파트 3 — GW 로그인 연동 (A안: 서브도메인 + 공유 쿠키)

### 조사 결과 (main.0d5e089b.js 정적 분석)

- gw.innogrid.com은 **더존 WEHAGO / Amaranth 10** 기반 SPA.
- 인증 자격은 쿠키 `oAuthToken`(베어러 토큰) + `signKey`(HMAC 비밀키). jQuery-cookie로 심어 **HttpOnly 아님** → JS 읽기 가능.
- GW API는 쿠키 인증을 쓰지 않는다(`xhr.withCredentials = false`). 대신:
  - `Authorization: Bearer <oAuthToken>`
  - `transaction-id: <uuid>`
  - `timestamp: <unix초>`
  - `wehago-sign: base64(HmacSHA256(oAuthToken + transactionId + timestamp + pathname, signKey))`
- 세션 조회 응답(`/gw/gw016A02` 계열)에 `sessionInfo` → `user_name`, `user_email`, `user_default_email` 존재.
- **CORS가 모든 오리진에 열려 있음**(`access-control-allow-origin`이 요청 Origin 반사, `allow-credentials: true`). 실측: `POST /gw/gw050A02` → 401(인증만 필요, CORS 통과).
- 상위 도메인 공유 쿠키를 심는 코드 존재: `omni:gw.innogrid.com:oAuthToken`, `omni:gw.innogrid.com:signKey`를 `domain: erp10CookieDomain`, `SameSite=None`, `secure: true`로 설정.

### 왜 "다른 도메인에서 쿠키 검사"는 불가능한가

동일 출처 정책상 우리 앱(다른 도메인)의 JS는 gw.innogrid.com의 쿠키를 읽을 수 없다. 예외 없음. 유일한 우회는 **우리 앱을 같은 상위 도메인(`.innogrid.com`)에 두어** 공유 쿠키(omni:*)를 읽는 것 = A안.

### 아키텍처

```
[브라우저] gw.innogrid.com 로그인
   └→ .innogrid.com 스코프 omni 쿠키 저장 (secure, SameSite=None)

[우리 앱: <sub>.innogrid.com]
  1. "이노그리드 GW 계정으로 로그인" 버튼 클릭
  2. (client) document.cookie 에서
       omni:gw.innogrid.com:oAuthToken, :signKey 읽기
  3. (client → server) POST /api/auth/gw  { oAuthToken, signKey }
  4. (server) GW API 호출 (server-to-server, HMAC 서명 재현)
       → 토큰 유효성 검증 + user_name / user_email 획득
  5. (server) Supabase Admin(service_role)
       → 이메일로 유저 확인/생성 → magiclink token_hash 생성
  6. (server → client) { token_hash } 반환
  7. (client) supabase.auth.verifyOtp({ type:'email', token_hash })
       → Supabase 세션 확립 → 로그인 완료
```

### 핵심 설계 판단

**토큰 검증을 서버에서 수행한다.** 클라이언트에서 이메일만 받아 세션을 발급하면 이메일 위조로 아무나 로그인된다. 서버가 GW 토큰을 GW API로 직접 검증(=진짜 GW 로그인 상태 확인)해야 안전하다. 따라서 신뢰 로직 · `service_role` 키 · HMAC 계산을 전부 서버 라우트(`/api/auth/gw`)에 둔다. 클라이언트는 omni 쿠키 두 개를 읽어 전달하는 역할만 한다.

### 신규/변경 컴포넌트

- `frontend/src/lib/gw-auth.ts` (신규) — 순수 로직. omni 쿠키 파싱, GW `wehago-sign` HMAC 계산, GW API 호출 래퍼. 클라이언트/서버 공용 가능한 순수 함수로 분리해 단위 테스트 가능하게 한다.
- `frontend/src/app/api/auth/gw/route.ts` (신규) — POST 핸들러. 토큰 검증 → 이메일 획득 → Supabase Admin으로 magiclink 발급.
- `frontend/src/lib/supabase-admin.ts` (신규 또는 기존 재사용) — `service_role` 클라이언트. 서버 전용, 클라이언트 번들에 포함 금지.
- `frontend/src/app/login/page.tsx` (수정) — "GW 계정으로 로그인" 버튼 + 클릭 핸들러(쿠키 읽기 → API 호출 → verifyOtp).
- 환경변수: `SUPABASE_SERVICE_ROLE_KEY`(서버 전용), `GW_API_BASE`(기본 `https://gw.innogrid.com`).

### Supabase 세션 발급 상세

`supabase.auth.admin.generateLink({ type: 'magiclink', email })`로 `token_hash`를 얻고, 클라이언트가 `verifyOtp`로 세션을 확립한다. 유저가 없으면 자동 생성되며, 역할(role)은 기존 `user_profiles` 기본값 로직을 따른다. 이메일 도메인이 `@innogrid.com`인지 서버에서 한 번 더 확인해 외부 계정 유입을 차단한다.

### Phase 0 — 착수 전 전제 검증 (2가지)

A안은 아래 두 전제가 성립해야 동작한다. 하나라도 실패하면 A안 불가 → B안(사내 IdP SAML SSO) 폴백.

1. **omni 쿠키 도메인 스코프**: `omni:gw.innogrid.com:oAuthToken` 쿠키가 `.innogrid.com` 상위 도메인 스코프로 저장되는가.
   - 검증: GW 로그인된 탭 콘솔에서
     ```js
     document.cookie.split(';').map(c=>c.trim().split('=')[0]).filter(n=>n.startsWith('omni:'))
     ```
   - 결과가 비어 있으면(= omni 쿠키가 심어지지 않거나 gw 서브도메인 전용이면) A안 불가.

2. **서브도메인 배포 가능성**: 우리 앱을 `<sub>.innogrid.com`으로 서빙할 수 있는가.
   - 로컬 개발은 **`/etc/hosts`에 `127.0.0.1 playground.innogrid.com` 수동 등록**으로 시작한다(사용자 결정).
   - 쿠키는 IP가 아니라 도메인 기준이므로, `/etc/hosts` 매핑만으로도 브라우저의 `.innogrid.com` 쿠키가 로컬 앱과 공유된다.
   - **주의**: omni 쿠키가 `secure` 속성이라 **로컬 dev도 HTTPS여야** `document.cookie`로 접근된다. `next dev --experimental-https`(또는 mkcert 로컬 인증서)로 `https://playground.innogrid.com:3003`을 띄운다.
   - 운영 배포는 Vercel 커스텀 도메인 + 사내 DNS CNAME이 필요(추후 확보).

### 리스크 (정직한 평가)

- 비공식 경로다. GW(WEHAGO) 업데이트로 쿠키명·API·서명 방식이 바뀌면 깨진다.
- 우리 서버가 GW의 HMAC 비밀키(signKey)를 (요청 처리 동안) 다루게 된다. 저장하지 않고 즉시 폐기한다.
- 안정성은 B안(사내 IdP SSO)이 명백히 우위. A안은 "지금 착수 가능한 유일한 길"로서 채택한 것이며, 사내 IdP 협조가 되면 B안으로 이전하는 것을 권장한다.

### 검증

- `gw-auth.ts` HMAC 계산 단위 테스트(코드에서 추출한 알고리즘과 동일한지).
- 로컬 HTTPS + `/etc/hosts` 환경에서 GW 로그인 상태로 "GW 계정으로 로그인" → Supabase 세션 확립 E2E.
- 만료/무효 토큰 → 401 처리, 비-innogrid 이메일 → 거부 처리 확인.

---

## 범위 밖 (YAGNI)

- B안(사내 IdP SAML SSO) 실제 구현 — 협조 확보 후 별도 스펙.
- GW의 다른 기능(결재/메일 등) 연동.
- 운영 서브도메인 DNS 설정 자동화.
