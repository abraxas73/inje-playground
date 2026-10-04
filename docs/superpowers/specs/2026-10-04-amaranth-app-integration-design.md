# 모바일 앱 아마란스(그룹웨어) 연동 설계 — 1단계

> 2026-10-04. 이노그리드 앱(`mobile/`)에서 사용자가 **자기 아마란스(gw.innogrid.com) 계정을 한 번 연결**하면, 앱이 그 사람 토큰으로 그룹웨어 API를 **직접** 불러 미결 결재·출퇴근·오늘 일정/회의실·메일 미읽음을 보여 주고 출퇴근을 기록한다. 서버(Vercel)는 손대지 않는다. 사용자 결정(2026-10-04): "2번 방법(사용자별 토큰 위임)으로", 1단계 기능은 4개 모두.

## 1. 목적과 성공 기준

- 홈 탭을 열면 "오늘" 카드에 **미결 결재 N건 · 출근/퇴근 시각 · 오늘 일정 n건 · 회의실 예약 n건 · 미읽음 메일 n통**이 뜬다(연결돼 있을 때).
- 각 숫자를 누르면 전용 화면(미결 목록→본문, 출퇴근 기록, 오늘 일정+회의실, 받은메일 목록)으로 간다.
- 출근/퇴근은 **사용자가 버튼을 누르고 확인한 뒤**에만 기록되고, 이미 기록이 있으면 다시 찍지 않으며, 기록 후 재조회로 반영을 확인해 보여 준다.
- 아마란스 MCP(inno-creed)를 앱이나 서버에 넣지 않는다. 그 소스가 밝혀 둔 엔드포인트·필드·함정을 Dart로 옮긴다(출처: https://github.com/zilhak/inno-creed — `src/client.rs`, `src/sign.rs`, `src/modules/{approval,attendance,calendar,resource,mail}.rs`, `docs/api-reference.md`).

## 2. 범위

**들어가는 것**
1. 연결: 앱 안 WebView로 gw.innogrid.com 로그인 → 쿠키(`oAuthToken`·`signKey`) 추출 → `gw050A02`로 검증 → 기기에 저장. 재연결·해제.
2. GW 클라이언트: 요청 서명(`wehago-sign`), 표준 봉투 해석, 세션 정보 10분 캐시, 401 → "다시 연결" 상태.
3. 읽기 4종: 미결 결재(건수·목록·본문), 오늘 출퇴근, 오늘 일정+회의실 예약(내 것 우선, 전체 토글), 메일 미읽음 수+받은메일 최근 20통 목록.
4. 쓰기 1종: 출근/퇴근 기록(확인 다이얼로그 + 중복 가드 + read-back).
5. 홈 "오늘" 카드, 하단 바 그룹 **아마란스**(부채꼴 4항목), 더보기 → 계정 카드의 연결 상태 행.

**빠지는 것(2단계 후보, §11)**: 결재 승인·반려·상신, 메일 본문 읽기(서버가 읽음 처리해 버린다)·발송, 일정·회의실 등록/수정, 월 근태 현황, 웹(브라우저) 쪽 아마란스 기능, 서버 저장·감사 로그, 보안 저장소(Keychain) 이관, 다른 사람의 데이터.

## 3. 현재 상태와 재사용하는 것

- 앱: Riverpod 3 · go_router 셸(5 브랜치) · `lib/app/tab_shell.dart`(그룹 부채꼴 메뉴, `catalog.dart`의 `pageGroups`) · `lib/api/client.dart`(우리 서버용 Bearer 클라이언트) · `lib/web/web_screen.dart`(WebView, `runJavaScriptReturningResult` 사용 가능) · 디자인 토큰 `Brand`·공용 위젯 `brand.dart`.
- 서버 쪽에 이미 있는 GW 지식(스펙 `2026-08-08-innogrid-rebranding-gw-login-design.md`, `frontend/src/lib/gw-auth.ts`): 인증은 쿠키가 아니라 헤더 4종이며 CORS가 전 오리진에 열려 있어 **토큰을 가진 쪽이 어디든 직접 호출**할 수 있다.
- 2026-10-04 확인: Chrome의 gw.innogrid.com 쿠키 `oAuthToken`·`signKey`·`BIZCUBE_AT`·`BIZCUBE_HK`는 **HttpOnly가 아니다**(SPA 자신이 JS로 읽어 헤더에 넣는다) → WebView에서 `document.cookie`로 읽을 수 있다. 세션 쿠키(만료 없음)인데 10월 2일 발급 토큰이 4일에도 인증에 성공했다 — 수명은 최소 며칠, 정확한 값은 운영하며 본다.
- HMAC-SHA256은 이미 전이 의존성으로 들어와 있는 `crypto` 패키지(gotrue가 씀)로 한다 → pubspec에 명시만 추가(규칙 "의존성 9개"를 10개로 갱신하는 스펙 변경).

## 4. 전체 구조

```
mobile/lib/gw/
  gw_sign.dart        transactionId(), wehagoSign()                      ← src/sign.rs
  gw_creds.dart       GwCreds(authToken, signKey) + groupSeq/empSeq, 저장소(shared_preferences)
  gw_client.dart      GwClient: call()/callForm(), 봉투 해석, 세션 캐시, companyInfo, 401 → GwUnauthorized
  gw_api.dart         기능별 호출 함수(순수 매핑: 요청 body 조립 + 응답 정제)       ← modules/*.rs
  gw_connect_screen.dart   WebView 로그인 → 쿠키 → 검증 → 저장
  gw_today_card.dart       홈 "오늘" 카드
  approvals_screen.dart    미결 목록 → 상세
  attendance_screen.dart   오늘 출퇴근 + 출근/퇴근 버튼
  today_screen.dart        오늘 일정 + 회의실 예약
  mail_screen.dart         미읽음 수 + 받은메일 최근 20통
```

- **상태**: `gwCredsProvider`(Notifier<GwCreds?>, 앱 시작 시 저장소에서 로드) · `gwStatusProvider`(connected | needsRelogin | none) · 화면별 `FutureProvider`는 두지 않고 화면이 직접 `GwApi`를 부른다(사다리·커피 타임과 같은 패턴).
- **라우트**: 셸 브랜치는 그대로 5개. 새 화면은 `/gw/approvals` `/gw/attendance` `/gw/today` `/gw/mail` `/gw/connect`를 **셸 밖 push 라우트**로 둔다(WebScreen처럼 전체 화면). 카탈로그에 그룹 `PageGroup('gw', '아마란스')`와 네이티브 항목 4개를 추가하고, `TabShell._openPage`는 `href`가 `/gw/`로 시작하면 `context.push(href)`(WebView 아님)로 연다. 하단 바는 홈·일상·AI·업무·아마란스·더보기 6칸이 된다(폭 65px, 라벨 11px — `fan_layout`은 슬롯 수와 무관).
- **원칙**: GW 호출은 `GwClient.call` 한 관문만 지난다(서명 규격이 두 곳에 있으면 한쪽만 고쳐 401이 난다 — inno-creed의 교훈). 토큰·서명키·세션 값은 로그·오류 메시지·테스트 출력에 찍지 않는다.

## 5. 연결(인증)

### 5.1 흐름
1. 더보기 → 계정 → "아마란스 연결" 또는 홈 카드의 "연결하기" → `/gw/connect`.
2. WebView가 `https://gw.innogrid.com/`을 연다(기본 UA). 사용자가 평소처럼 로그인한다.
3. `onPageFinished`마다 `runJavaScriptReturningResult('document.cookie')` → `oAuthToken`과 `signKey`(없으면 `BIZCUBE_AT`/`BIZCUBE_HK`)가 둘 다 있으면 추출. 파서는 순수 함수 `parseGwCookies(String) → GwCreds?`.
4. 검증: `POST /gw/gw050A02`(form `a10Domain=https://gw.innogrid.com`) → `resultData.sessionInfo.ucUserInfo`. 성공이면 저장하고 "홍길동(hong@innogrid.com) 연결됨"을 보여 준 뒤 pop. 실패면 "로그인을 확인하지 못했습니다" + 다시 시도.
5. 앱 로그인 이메일(Microsoft)과 GW 이메일(`emailAdd@emailDomain`)이 다르면 **막지 않고** 두 주소를 함께 보여 준다(본인 기기, 본인 선택).

### 5.2 토큰 구조와 저장
- `authToken = "{groupSeq}|{empSeq}|{secret}"` → `split('|')`로 groupSeq/empSeq(본인 식별, 소유권 판정 기준).
- 저장: `shared_preferences` 키 `gw.authToken`·`gw.signKey`·`gw.empName`·`gw.email`. Supabase 세션도 같은 저장소에 있으므로 보호 수준이 같다(앱 샌드박스 안, 암호화 아님). Keychain/Keystore 이관은 2단계(`flutter_secure_storage` 추가 = 스펙 변경).
- WebView 쿠키 저장소에 기대지 않는다(iOS WKWebView는 세션 쿠키를 재시작 후 보장하지 않는다).

### 5.3 만료·해제
- 어떤 호출이든 HTTP 401(`resultCode` 140=토큰 없음, 112=서명 불일치도 같은 처방) → `GwUnauthorized` → 상태 `needsRelogin`. 홈 카드와 각 화면은 "아마란스 다시 연결" 버튼을 보인다. 저장된 토큰은 지우지 않고(재연결 때 덮어씀) 호출만 멈춘다.
- 재연결 화면에는 "쿠키 지우고 로그인" 보조 버튼(`WebViewCookieManager.clearCookies()`) — GW SPA가 WebView에 남은 옛 쿠키로 자동 진입해 버리는 경우 대비.
- 해제: 저장값 삭제 + WebView 쿠키 삭제. 서버에는 아무것도 없으므로 그걸로 끝.

## 6. GW 클라이언트

### 6.1 서명(`gw_sign.dart`)
```
transaction-id = 16바이트 난수 → 32 hex
timestamp      = unix epoch 초(문자열)
wehago-sign    = base64( HMAC_SHA256( authToken ‖ transactionId ‖ timestamp ‖ pathname , signKey ) )   // 구분자 없음, pathname은 쿼리 제외
헤더: Authorization: Bearer {authToken} · timestamp · transaction-id · wehago-sign
```
골든 테스트(inno-creed `sign.rs`에서 그대로): `("gcmsAmaranth31433|3166|test", "0123456789abcdef0123456789abcdef", "1700000000", "/gw/gw050A02", "SIGNKEY-abc")` → `IIJvpAZ5u3uKLH5mGGgNoEtcnXVwplKL2pNErNz/PXc=`.

### 6.2 호출·봉투(`gw_client.dart`)
- `Future<dynamic> call(String path, Object body)`: JSON POST → HTTP 2xx 아니면 `GwException(status, resultMsg)`(401이면 `GwUnauthorized`) → `resultCode ∈ {0, 200}`이 아니면 `GwException` → `resultData` 반환.
- `callForm(path, params)`: `application/x-www-form-urlencoded`(gw050A02 전용).
- 서명 헤더는 두 함수가 같은 `_signed()`를 거친다.
- 세션(`GwSession`): `gw050A02` → `ucUserInfo{compSeq, deptSeq, empName, emailAdd, emailDomain, erpEmpSeq→empCd, erpDeptSeq→deptCd, erpCompSeq→coCd}`. 10분 메모리 캐시. `companyInfo = {compSeq, groupSeq, deptSeq, emailAddr, emailDomain}`.
- 캘린더 목록(`sc111A02`)은 10분, 회의실 목록(`rs121A01`)은 30분 메모리 캐시(앱 생명주기).
- 네트워크 예외는 `GwException(0, '네트워크 오류')`로 통일. 메시지에 토큰 조각을 넣지 않는다.

## 7. 기능별 API 매핑(`gw_api.dart`)

모든 날짜 인자는 `YYYYMMDD`, 시각은 `YYYYMMDDHHmm`(KST). 아래 "응답"은 `resultData` 기준.

| 기능 | 요청 | 응답에서 쓰는 것 |
|---|---|---|
| 세션 | `POST /gw/gw050A02` form `a10Domain=https://gw.innogrid.com` | 위 §6.2 |
| 미결 건수 | `POST /eap/api/getMenuCountInfo` `{deptSeq, userSe:"USER\|AT", compSeq, bizSeq:compSeq, empSeq, groupSeq, menuType:"", pageCode:"EapSide"}` | `{menuNo: count}` — `1001000`=미결, `1001100`=기결, `1001200`=수신참조, `1000400`=상신 |
| 미결 목록 | `POST /eap/eap105A04` `{fDocSts:[], page:"1", pageSize:"50", eaBoxId:"1000900", nMenuID:"1001000", menuNo:"1001000", upperMenuNo:"1000900", sfrDt:오늘-90일, stoDt:오늘, sFormId:["0"], periodPicker:"ARRIVED_DT", sortField:"ARRIVED_DT", sortType:"DESC", docContentsData:{}, item:{}, useElasticSearch:true, useElasticSearch_new:true, pageCode:""}` | `map.totalCount`, `map.list[]`: `DOC_ID` `FORM_ID` `DOC_TITLE` `FORM_NM` `USER_NM`(기안자) `DEPT_NM` `ARRIVED_DT` `READYN` `DOC_STSNM` `FILE_CNT`. 대기일수 = 오늘 − `ARRIVED_DT` |
| 결재 상세 | `POST /eap/eap111A04` `{doc_id, form_id, bindType:"V", p_doc_id:0, doc_auth:"0", spDocId:"", setReadYn:"N", commentReqYn:"N", pageCode:"UBA1100", docToken:""}` | `docTitle` `formName` `docStsName` `empName` `deptName` `repDt` `attachCnt` `lineName`(현재 결재자) 본문 `contentsWord`(평문, 비면 `docContents` HTML을 태그 제거) — **열람 처리 없음**(`setReadYn:"N"`) |
| 오늘 출퇴근 | `POST /human/common/judgeTimeManagement/getTodayComeLeaveInfo` `{empCd, coCd, workDt}` | `comeTm` `leaveTm`(`YYYYMMDDHHmm`, 빈 문자열=미등록) `holidayYn` |
| 출근/퇴근 기록 | (정보성) `POST …/confirmApplicationStatus` `{empCd, deptCd, coCd}` → `POST …/getJudgeTimeManagement` `{type:"WEB", judgeData:{empCd, deptCd, coCd, attendFg}}` — `attendFg` `"1"`=출근 `"4"`=퇴근 | 응답의 successCount는 믿지 않는다. **기록 전** 오늘 현황을 읽어 해당 필드가 있으면 찍지 않고 `already`로 끝내고, **기록 후** 다시 읽어 `comeTm`/`leaveTm`이 채워졌는지로 성공 판정 |
| 캘린더 목록 | `POST /schres/sc111A02` `{companyInfo, calType:"", langCode:"kr"}` | `resultList[]`: `mcalSeq` `calTitle` `calType`(`E` 개인/`M` 공용, **빈값은 `E`로 보정**) `empSeq` `calColor` |
| 오늘 일정 | `POST /schres/sc111A03` `{companyInfo, startDate, endDate, mySchYn:"N", calList:[{mcalSeq, calType, adminYn:"Y", color}], tcalList:[], acalList:[], searchEmpSeq:"", sortDate:"Y", langCode:"kr"}` | `resultList[]`: `schSeq` `schTitle` `startDate` `endDate` `alldayYn` `calTitle` `mcalSeq` `createName` `schPlace` `delYn`(**이름과 달리 "내 일정(참석자/작성자)" 플래그**: `Y`=내 것) |
| 회의실 목록 | `POST /schres/rs121A01` `{companyInfo, searchText:"", attrUseYn:"", attrList:["1","3","ETC"], propList:[], langCode:"kr"}` | `resultList[]`: `resSeq` `resName` `attrSeq`(1 본사/3 구로) `attrName` |
| 오늘 예약 | `POST /schres/rs121A05` `{companyInfo, startDate, endDate, statusType:["10","20"], resList:[{resSeq}…전체], statusCode:"", searchType:"", sechType:"", menuAuth:"USER", langCode:"kr"}` | `resultList[]`: `resSeq` `resName` `seqNum` `resIdx` `resStartDate` `resEndDate` `reqText`(예약명) `resTitleDisplay` `empName` `empSeq`(소유자 — 나와 같으면 "내 예약") `resUserName` `alldayYn` |
| 메일 카운트 | `POST /mail/mail000A03` `{}` | 배열. 각 `{boxnameSeq, count(미읽음), totalCount}`, **마지막 항목이 계정 전체** `{unreadCount, toMeCount, flaggedCount, attachCount, totalCount}` |
| 메일함 목록 | `POST /mail/mail000A01` `{}` | 중첩 트리에서 `fullname`/`name`이 `INBOX`인 노드의 `mboxSeq`(**계정마다 다르므로 상수 금지**, 숫자/문자열 혼용 흡수) |
| 받은메일 목록 | `POST /mail/mail003A01` `{boxName:"INBOX", mainApiCode:"mail003A01", mboxSeq, page:1, pageSize:20, sort:"rfc822date", sortType:"desc", listType:"", showType:"", seen:false}` | `Records[]`: `muid` `subject` `fromAddrName` `fromAddrEmail` `rfc822date`(오늘이면 `HH:mm`, 아니면 날짜 — 표시용 문자열) `tooltipDate` `seen`(0/1) `attach`(bool) `flagged`; `TotalRecordCount` `TotalUnseenCount` |

- 메일 본문은 열지 않는다(`mail002A01`은 읽음 플래그를 세운다). 목록 항목을 누르면 아무것도 하지 않거나(1단계) 안내만 띄운다.
- `delYn`·`seen`·`mboxSeq`처럼 서버가 숫자/문자열/불리언을 섞어 주는 값은 `asStr()`/`asBool()` 헬퍼로 흡수한다.

## 8. 화면

- **홈 "오늘" 카드**(`gw_today_card.dart`, 격언 카드 아래): 연결 전 → 아이콘 + "아마란스를 연결하면 미결 결재·출퇴근·일정·메일을 여기서 봅니다" + [연결하기]. 연결 후 → 2×2 타일(미결 결재 N건 / 출근 09:02 · 퇴근 — / 일정 n · 회의실 n / 미읽음 n통), 각 타일이 해당 화면으로 push. 불러오는 동안 숫자 자리에 점 세 개, 실패하면 타일 자리에 한 줄 오류와 [다시 시도]; 401이면 [다시 연결]. 네 호출은 `Future.wait`로 병렬, 하나가 실패해도 나머지는 보인다.
- **미결 결재**(`approvals_screen.dart`): `BrandHeader('미결 결재')`, 총 N건, 목록(제목·양식·기안자/부서·도착일·대기 N일·미열람 점). 당겨서 새로고침. 항목 → 상세(제목·상태·기안자·현재 결재자·첨부 N·본문 평문). 승인/반려 버튼 없음 — 하단에 "승인·반려는 아마란스에서" 안내.
- **출퇴근**(`attendance_screen.dart`): 오늘 날짜·휴일 여부, 출근/퇴근 시각 두 칸, 큰 버튼 [출근 기록]/[퇴근 기록](이미 있으면 비활성 + 시각). 누르면 `AlertDialog` "지금 출근을 기록할까요? 실제 근태에 반영되며 되돌릴 수 없습니다" → 기록 → read-back → 스낵바("출근 09:02 기록됨" / "응답은 왔지만 반영이 확인되지 않았습니다 — 아마란스에서 확인하세요").
- **오늘**(`today_screen.dart`): 두 구역. 일정 — 기본 "내 일정"(`delYn=="Y"` 또는 개인 캘린더 `calType E && empSeq==me`), 토글로 "전체 캘린더". 회의실 — 기본 "내 예약", 토글로 "전체 회의실 현황"(회의실별 시간순). 시각은 `HH:mm`, 종일은 "종일".
- **메일**(`mail_screen.dart`): 상단 "미읽음 n · 나에게 온 것 m", 목록 20통(제목·보낸이·시각, 미읽음은 굵게, 첨부 클립). 당겨서 새로고침. 본문 열기 없음.
- **더보기 → 계정 카드**: "아마란스" 행 — 미연결 "연결하기" / 연결됨 "홍길동 · hong@innogrid.com" + [재연결] [해제] / 재로그인 필요 "다시 연결하세요".
- **하단 바**: 그룹 아마란스(아이콘 `Icons.apartment_outlined`/`apartment`) 부채꼴 4항목 = 미결 결재·출퇴근·오늘·메일. 각 항목 아이콘은 `serviceMeta`에 추가. 모든 화면은 `Brand` 토큰·`BrandHeader`를 쓴다.

## 9. 오류 처리

| 상황 | 동작 |
|---|---|
| 미연결 상태에서 GW 화면 진입 | 화면 대신 연결 안내 + [연결하기] |
| HTTP 401 | `GwUnauthorized` → 상태 `needsRelogin`, 화면마다 [다시 연결]. 토큰은 유지 |
| `resultCode` ≠ 0/200 | 서버 `resultMsg`를 그대로 한 줄로(해석 불가 메시지일 수 있음) + [다시 시도] |
| 네트워크 오류·타임아웃(15초) | "그룹웨어에 연결할 수 없습니다" + [다시 시도] |
| 세션 정보 없음(`ucUserInfo` 누락) | 연결 실패로 처리(저장하지 않음) |
| 출퇴근 기록 후 read-back 미반영 | 성공으로 보고하지 않는다 — "확인되지 않음" 문구 |
| WebView 로그인 중 쿠키가 끝내 안 잡힘 | 60초 뒤 안내 "로그인 후에도 연결되지 않으면 쿠키 지우고 다시 시도" |

## 10. 테스트

- 순수 함수(단위): `wehagoSign` 골든 2개(고정 입력·순서 민감), `transactionId` 32 hex, `GwCreds.groupSeq/empSeq` 파싱, `parseGwCookies`(oAuthToken/signKey, BIZCUBE 폴백, 없음 → null), 미결 라벨 매핑, 대기일수 계산, `calList` 보정(빈 `calType`→`E`), INBOX `mboxSeq` 탐색(중첩·숫자/문자열), 메일 전체 집계(마지막 항목), 일정 "내 것" 필터, 출퇴근 가드(기록 있으면 punch 호출 0회).
- 클라이언트(`MockClient`): 헤더 4종 존재, 봉투 성공/실패(`resultCode` 999)/401 → `GwUnauthorized`, 세션 10분 캐시(두 번째 호출에 gw050A02 안 나감), 네트워크 예외 → `GwException(0)`.
- 위젯: 연결 화면 상태(안내·검증 실패), 홈 카드 3상태(미연결/데이터/재연결), 출퇴근 확인 다이얼로그 취소 시 호출 없음, 탭 셸 아마란스 그룹 4항목 → `/gw/*` push.
- 실기기: 연결 → 카드 숫자 → 각 화면 → 출근 기록은 **실제 출근 시각에 한 번만**.

## 11. 다음 단계 후보(이번 범위 밖)

월 근태 현황(`/human/openapi/worktime/status/getWorkTimeStatusList`) · 결재 승인/반려(inno-creed도 미구현) · 메일 본문 읽기 + `mail002A15`로 읽음 복원 · 회의실 예약/일정 등록(소유권 가드·read-back 규약 포함) · Keychain 저장 · 토큰 만료 주기 측정 → 선제 재연결 안내 · 웹 쪽은 크롬 확장(C안) 또는 서버 저장(MS 토큰처럼 암호화) · 서버 감사 로그.
