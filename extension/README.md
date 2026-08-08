# Innogrid GW 로그인 브리지

## 목적

이 크롬 확장은 이노그리드 그룹웨어(GW)의 세션 쿠키를 읽어 워크샵 앱의 로그인에 자동으로 연동합니다. GW에 이미 로그인된 사용자가 워크샵 앱에서 "이노그리드 GW 계정으로 로그인" 버튼을 클릭하면, 자동으로 GW 세션 정보가 앱에 전달됩니다.

## 설치 방법

1. `chrome://extensions` 주소를 주소창에 입력하여 Chrome 확장 관리 페이지로 이동합니다.
2. 우측 상단의 "개발자 모드" 토글을 ON으로 설정합니다.
3. "압축해제된 확장 프로그램을 로드" 버튼을 클릭합니다.
4. 이 파일이 위치한 `extension/` 폴더를 선택하면 확장이 설치됩니다.

## 사용 방법

1. `gw.innogrid.com`에 먼저 로그인되어 있어야 합니다.
2. 워크샵 앱(http://localhost 또는 https://inje-playground.vercel.app)에 접속합니다.
3. 로그인 페이지에서 "이노그리드 GW 계정으로 로그인" 버튼을 클릭합니다.
4. 확장이 GW 세션을 감지하고 자동으로 앱에 전달합니다.
5. 세션 정보는 앱의 서버에서 GW API로 재검증한 후 로그인을 완료합니다.

## 권한 설명

### `cookies` 권한
- gw.innogrid.com의 `oAuthToken`과 `signKey` 쿠키를 읽기 위해 필요합니다.
- 다른 사이트의 쿠키는 읽지 않습니다.

### `host_permissions: https://gw.innogrid.com/*`
- gw.innogrid.com 도메인의 쿠키만 접근할 수 있도록 제한합니다.

### Content Script (우리 앱 origin에만 주입)
- 이 확장의 content script는 manifest에서 명시한 origin에만 주입됩니다:
  - **프로덕션**: `https://inje-playground.vercel.app` (정확한 도메인만 매칭)
  - **개발**: `http://localhost/*` (Chrome match pattern으로 인해 **모든 포트의 localhost** 매칭)
- CORS 정책을 통해 origin 검증이 추가로 이루어집니다.

## 보안

### 일반 보안 설계
- 이 확장은 **GW 쿠키를 읽기만 하고**, 워크샵 앱에만 전달합니다.
- GW 서버와의 직접적인 통신은 하지 않습니다.
- 최종 검증은 워크샵 앱의 서버(`/api/auth/gw` 엔드포인트)에서 GW API로 재검증하므로, 위조된 쿠키로는 로그인할 수 없습니다.
- 확장의 모든 통신은 Content Script를 통한 `window.postMessage` 방식으로 이뤄져 크로스 원점 정책(CORS)을 준수합니다.

### 개발 환경 주의 (localhost)
- 개발 시 **localhost의 모든 포트**에 content script가 주입됩니다.
- 같은 Chrome 프로필에서 신뢰할 수 없는 로컬 서버(다른 프로젝트, 악성 로컬 프로세스 등)를 실행 중이면, 그 서버가 우리 확장의 프로토콜을 모방하여 GW 토큰을 탈취할 수 있습니다.
- **권장사항**: 개발 시 신뢰할 수 있는 로컬 서버만 실행하세요. 알 수 없는 코드를 localhost에서 실행하지 마세요.

### 프로덕션 환경 (vercel.app)
- `https://inje-playground.vercel.app` (정확한 HTTPS 도메인)에만 content script가 주입됩니다.
- 다른 사이트(악성 사이트 포함)에서는 확장이 동작하지 않습니다.
- 프로덕션 환경은 localhost의 모든 포트 문제가 없으므로 안전합니다.
