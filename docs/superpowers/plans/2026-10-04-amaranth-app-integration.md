# 아마란스(그룹웨어) 앱 연동 1단계 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱에서 아마란스 계정을 연결하면(WebView 로그인 → 쿠키 → 검증 → 기기 저장) 홈 "오늘" 카드와 전용 화면 4개에서 미결 결재·출퇴근·오늘 일정/회의실·메일 미읽음을 보고 출퇴근을 기록한다. 서버 변경 없음.

**Architecture:** `mobile/lib/gw/` 모듈 하나. 순수 함수(서명·쿠키 파싱·응답 정제)와 네트워크(`GwClient` 관문 하나, `GwApi` 기능 함수)를 나누고, 화면은 `GwGate`(미연결/재연결/연결됨 분기)로 감싼다. 상태는 Riverpod `gwProvider`(AsyncNotifier, shared_preferences 저장). 새 화면은 셸 밖 push 라우트 `/gw/*`, 하단 바 그룹 "아마란스"(부채꼴 4항목)로 진입.

**Tech Stack:** Flutter 3.44 · Riverpod 3 · go_router · webview_flutter · http · shared_preferences · crypto(HMAC-SHA256, 이미 전이 의존성)

**Spec:** `docs/superpowers/specs/2026-10-04-amaranth-app-integration-design.md`

## Global Constraints

- 모든 GW 호출은 `GwClient`의 `call`/`callForm` 두 함수만 지나고, 둘은 같은 `_signed` 헤더 빌더를 쓴다(서명 규격 한 곳).
- 토큰·서명키·세션 값·메일 제목은 로그·예외 메시지·테스트 출력에 찍지 않는다. 테스트 픽스처는 가짜 값만.
- 쓰기 호출은 출근/퇴근 `getJudgeTimeManagement` 하나뿐. 반드시 사용자 확인 다이얼로그 → 기록 전 가드(이미 있으면 0회 호출) → 기록 후 read-back.
- 메일 본문(`mail002A01`)은 부르지 않는다(읽음 처리 부작용).
- 서버 응답 값은 숫자/문자열/불리언 혼용 → `asStr`/`asBool`로만 읽는다. 메일함 `mboxSeq`는 상수로 박지 않는다.
- 의존성 추가는 `crypto` 하나(pubspec 명시). 규칙 `.claude/rules/mobile.md`의 "의존성 9개" → 10개.
- AnimationController 등 Ticker는 `late final` 지연 생성 금지. 새 화면은 `Brand` 토큰·`BrandHeader`를 쓴다.
- 커밋 트레일러: `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. main에 직접 커밋.

## Review Focus

1. 쿠키 문자열 형식 — iOS `runJavaScriptReturningResult`는 따옴표로 감싼 JSON 문자열을 돌려줄 수 있다(`"\"a=b; c=d\""`). 파서가 바깥 따옴표·이스케이프를 벗겨야 한다 → Task 2 테스트.
2. `resultCode`가 문자열 `"0"`로 오는 응답 — 성공으로 처리해야 한다 → Task 3 테스트.
3. 출퇴근 read-back에서 `comeTm`이 `null`로 오는 경우(빈 문자열이 아니라) → "미등록"으로 읽어야 한다 → Task 4 테스트.
4. 캘린더 `calType`이 빈 문자열인 캘린더 — `calList`에 `"E"`로 보정하지 않으면 그 캘린더 일정이 빠진다 → Task 5 테스트.
5. 메일 `mail000A03`이 빈 배열을 주는 계정 — 전체 집계가 없어도 0으로 표시해야 한다(예외 금지) → Task 6 테스트.

---

### Task 1: 서명(`gw_sign.dart`) + `crypto` 의존성

**Files:**
- Modify: `mobile/pubspec.yaml`(dependencies에 `crypto: ^3.0.6`)
- Modify: `.claude/rules/mobile.md`("의존성은 pubspec의 9개뿐" → 10개, crypto 추가 사유)
- Create: `mobile/lib/gw/gw_sign.dart`
- Test: `mobile/test/gw/gw_sign_test.dart`

**Interfaces:**
- Produces: `String gwTransactionId([Random? rng])` — 32 hex. `String wehagoSign({required String authToken, required String transactionId, required String timestamp, required String path, required String signKey})` — base64.

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/gw/gw_sign_test.dart
import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_sign.dart';

void main() {
  test('골든: inno-creed sign.rs와 같은 입력에 같은 서명', () {
    expect(
      wehagoSign(authToken: 'gcmsAmaranth31433|3166|test', transactionId: '0123456789abcdef0123456789abcdef', timestamp: '1700000000', path: '/gw/gw050A02', signKey: 'SIGNKEY-abc'),
      'IIJvpAZ5u3uKLH5mGGgNoEtcnXVwplKL2pNErNz/PXc=',
    );
  });
  test('입력 순서(token‖tid‖ts‖path)가 바뀌면 서명이 달라진다', () {
    final a = wehagoSign(authToken: 'A', transactionId: 'B', timestamp: 'C', path: 'D', signKey: 'k');
    final b = wehagoSign(authToken: 'B', transactionId: 'A', timestamp: 'C', path: 'D', signKey: 'k');
    expect(a, isNot(b));
  });
  test('transaction-id는 32자리 hex이고 매번 다르다', () {
    final t = gwTransactionId();
    expect(t.length, 32);
    expect(RegExp(r'^[0-9a-f]{32}$').hasMatch(t), true);
    expect(t, isNot(gwTransactionId()));
    expect(gwTransactionId(Random(1)), gwTransactionId(Random(1))); // 주입한 난수원은 재현 가능
  });
}
```

- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/gw/gw_sign_test.dart` → Expected: 컴파일 실패 `gw_sign.dart` 없음.

- [ ] **Step 3: 구현**

`pubspec.yaml` dependencies에 `crypto: ^3.0.6` 추가(알파벳 순, `file_picker` 앞).

```dart
// mobile/lib/gw/gw_sign.dart
import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';

/// 요청마다 새로 뽑는 transaction-id(16바이트 난수 → 32 hex).
String gwTransactionId([Random? rng]) {
  final r = rng ?? Random.secure();
  return [for (var i = 0; i < 16; i++) r.nextInt(256).toRadixString(16).padLeft(2, '0')].join();
}

/// wehago-sign = base64(HMAC_SHA256(authToken ‖ transactionId ‖ timestamp ‖ path, signKey)). 구분자 없음, path는 쿼리 제외.
/// 규격 출처: inno-creed `src/sign.rs`(골든 테스트 동일).
String wehagoSign({required String authToken, required String transactionId, required String timestamp, required String path, required String signKey}) {
  final mac = Hmac(sha256, utf8.encode(signKey));
  return base64.encode(mac.convert(utf8.encode('$authToken$transactionId$timestamp$path')).bytes);
}
```

`.claude/rules/mobile.md`: "의존성은 pubspec의 9개뿐" → "의존성은 pubspec의 10개뿐(crypto는 아마란스 서명용, 2026-10-04 스펙으로 추가)".

- [ ] **Step 4: 통과 확인** — Run: `cd mobile && flutter pub get && flutter test test/gw/gw_sign_test.dart` → Expected: 3 passed.

- [ ] **Step 5: 커밋** — `git add mobile/pubspec.yaml mobile/pubspec.lock mobile/lib/gw/gw_sign.dart mobile/test/gw/gw_sign_test.dart .claude/rules/mobile.md && git commit -m "feat(mobile): 아마란스 요청 서명(wehago-sign, HMAC-SHA256) + crypto 의존성"`

---

### Task 2: 크레덴셜·쿠키 파싱·저장·상태(`gw_creds.dart`)

**Files:**
- Create: `mobile/lib/gw/gw_creds.dart`
- Test: `mobile/test/gw/gw_creds_test.dart`

**Interfaces:**
- Produces:
  - `class GwCreds { final String authToken, signKey; final String? empName, email; String get groupSeq; String get empSeq; GwCreds copyWith({String? empName, String? email}); }`
  - `GwCreds? parseGwCookies(String raw)` — `oAuthToken`/`signKey`(없으면 `BIZCUBE_AT`/`BIZCUBE_HK`) 둘 다 있을 때만.
  - `class GwCredsStore { Future<GwCreds?> load(); Future<void> save(GwCreds c); Future<void> clear(); }` (shared_preferences 키 `gw.authToken` `gw.signKey` `gw.empName` `gw.email`)
  - `enum GwStatus { none, connected, needsRelogin }`; `class GwState { final GwCreds? creds; final bool needsRelogin; GwStatus get status; }`
  - `class GwNotifier extends AsyncNotifier<GwState> { Future<void> connect(GwCreds c); Future<void> disconnect(); void markUnauthorized(); }`
  - `final gwStoreProvider = Provider<GwCredsStore>`; `final gwProvider = AsyncNotifierProvider<GwNotifier, GwState>`

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/gw/gw_creds_test.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  test('authToken에서 groupSeq·empSeq를 뗀다', () {
    final c = GwCreds(authToken: 'gcmsX|3166|secret', signKey: 'k');
    expect(c.groupSeq, 'gcmsX');
    expect(c.empSeq, '3166');
  });
  group('parseGwCookies', () {
    test('oAuthToken·signKey 둘 다 있을 때만', () {
      final c = parseGwCookies('a=1; oAuthToken=g%7C1%7Cs; signKey=KEY%3D%3D; b=2');
      expect(c?.authToken, 'g|1|s'); // 퍼센트 인코딩 해제
      expect(c?.signKey, 'KEY==');
      expect(parseGwCookies('oAuthToken=x'), isNull);
      expect(parseGwCookies(''), isNull);
    });
    test('BIZCUBE_AT/HK로 폴백', () {
      final c = parseGwCookies('BIZCUBE_AT=t; BIZCUBE_HK=h');
      expect((c?.authToken, c?.signKey), ('t', 'h'));
    });
    test('iOS가 돌려주는 따옴표 감싼 JSON 문자열도 벗긴다', () {
      final c = parseGwCookies('"oAuthToken=t; signKey=h"');
      expect((c?.authToken, c?.signKey), ('t', 'h'));
    });
  });
  test('저장소 왕복과 삭제', () async {
    SharedPreferences.setMockInitialValues({});
    final s = GwCredsStore();
    expect(await s.load(), isNull);
    await s.save(GwCreds(authToken: 'a|b|c', signKey: 'k', empName: '홍길동', email: 'h@innogrid.com'));
    final c = await s.load();
    expect((c?.authToken, c?.signKey, c?.empName, c?.email), ('a|b|c', 'k', '홍길동', 'h@innogrid.com'));
    await s.clear();
    expect(await s.load(), isNull);
  });
  test('상태: 없음 → connect → needsRelogin → disconnect', () async {
    SharedPreferences.setMockInitialValues({});
    final container = ProviderContainer();
    addTearDown(container.dispose);
    expect((await container.read(gwProvider.future)).status, GwStatus.none);
    await container.read(gwProvider.notifier).connect(GwCreds(authToken: 'a|b|c', signKey: 'k'));
    expect(container.read(gwProvider).value?.status, GwStatus.connected);
    container.read(gwProvider.notifier).markUnauthorized();
    expect(container.read(gwProvider).value?.status, GwStatus.needsRelogin);
    expect(container.read(gwProvider).value?.creds, isNotNull); // 토큰은 유지
    await container.read(gwProvider.notifier).disconnect();
    expect(container.read(gwProvider).value?.status, GwStatus.none);
    expect(await GwCredsStore().load(), isNull);
  });
}
```

- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/gw/gw_creds_test.dart` → Expected: 컴파일 실패.

- [ ] **Step 3: 구현**

```dart
// mobile/lib/gw/gw_creds.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 아마란스 크레덴셜. authToken = "{groupSeq}|{empSeq}|{secret}". 값은 로그·메시지에 찍지 않는다.
class GwCreds {
  const GwCreds({required this.authToken, required this.signKey, this.empName, this.email});
  final String authToken, signKey;
  final String? empName, email;
  String get groupSeq => authToken.split('|').first;
  String get empSeq => authToken.split('|').elementAtOrNull(1) ?? '';
  GwCreds copyWith({String? empName, String? email}) => GwCreds(authToken: authToken, signKey: signKey, empName: empName ?? this.empName, email: email ?? this.email);
}

/// `document.cookie` 문자열 → 크레덴셜. oAuthToken/signKey가 없으면 BIZCUBE_AT/HK. iOS WKWebView는 JSON 문자열(따옴표 포함)로 돌려주므로 먼저 벗긴다.
GwCreds? parseGwCookies(String raw) {
  var s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.substring(1, s.length - 1).replaceAll(r'\"', '"');
  final m = <String, String>{};
  for (final part in s.split(';')) {
    final i = part.indexOf('=');
    if (i <= 0) continue;
    m[part.substring(0, i).trim()] = Uri.decodeComponent(part.substring(i + 1).trim());
  }
  final at = m['oAuthToken'] ?? m['BIZCUBE_AT'];
  final hk = m['signKey'] ?? m['BIZCUBE_HK'];
  if (at == null || at.isEmpty || hk == null || hk.isEmpty) return null;
  return GwCreds(authToken: at, signKey: hk);
}

/// shared_preferences 저장(Supabase 세션과 같은 저장소·같은 보호 수준).
class GwCredsStore {
  static const _at = 'gw.authToken', _hk = 'gw.signKey', _name = 'gw.empName', _email = 'gw.email';
  Future<GwCreds?> load() async {
    final p = await SharedPreferences.getInstance();
    final at = p.getString(_at), hk = p.getString(_hk);
    if (at == null || hk == null) return null;
    return GwCreds(authToken: at, signKey: hk, empName: p.getString(_name), email: p.getString(_email));
  }

  Future<void> save(GwCreds c) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_at, c.authToken);
    await p.setString(_hk, c.signKey);
    if (c.empName != null) await p.setString(_name, c.empName!);
    if (c.email != null) await p.setString(_email, c.email!);
  }

  Future<void> clear() async {
    final p = await SharedPreferences.getInstance();
    for (final k in [_at, _hk, _name, _email]) {
      await p.remove(k);
    }
  }
}

enum GwStatus { none, connected, needsRelogin }

class GwState {
  const GwState({this.creds, this.needsRelogin = false});
  final GwCreds? creds;
  final bool needsRelogin;
  GwStatus get status => creds == null ? GwStatus.none : (needsRelogin ? GwStatus.needsRelogin : GwStatus.connected);
}

final gwStoreProvider = Provider<GwCredsStore>((_) => GwCredsStore());

class GwNotifier extends AsyncNotifier<GwState> {
  @override
  Future<GwState> build() async => GwState(creds: await ref.read(gwStoreProvider).load());

  Future<void> connect(GwCreds c) async {
    await ref.read(gwStoreProvider).save(c);
    state = AsyncValue.data(GwState(creds: c));
  }

  Future<void> disconnect() async {
    await ref.read(gwStoreProvider).clear();
    state = const AsyncValue.data(GwState());
  }

  /// 401 — 토큰은 두고(재연결 때 덮어씀) 호출만 멈춘다.
  void markUnauthorized() {
    final c = state.value?.creds;
    if (c != null) state = AsyncValue.data(GwState(creds: c, needsRelogin: true));
  }
}

final gwProvider = AsyncNotifierProvider<GwNotifier, GwState>(GwNotifier.new);
```

- [ ] **Step 4: 통과 확인** — Run: `cd mobile && flutter test test/gw/gw_creds_test.dart` → Expected: 6 passed.

- [ ] **Step 5: 커밋** — `git add mobile/lib/gw/gw_creds.dart mobile/test/gw/gw_creds_test.dart && git commit -m "feat(mobile): 아마란스 크레덴셜(쿠키 파싱·기기 저장·연결 상태)"`

---

### Task 3: GW 클라이언트(`gw_client.dart`) — 서명 헤더·봉투·세션 캐시·401

**Files:**
- Create: `mobile/lib/gw/gw_client.dart`
- Test: `mobile/test/gw/gw_client_test.dart`

**Interfaces:**
- Consumes: `GwCreds`, `wehagoSign`, `gwTransactionId`, `gwProvider`.
- Produces:
  - `class GwException implements Exception { final int status; final int resultCode; final String message; }`, `class GwUnauthorized extends GwException`
  - `class GwSession { compSeq, deptSeq, empName, emailAddr, emailDomain, empCd, deptCd, coCd; String get email; factory GwSession.fromUcUserInfo(Map m); }`
  - `class GwClient { GwClient({required http.Client httpClient, required GwCreds Function() creds, String baseUrl = 'https://gw.innogrid.com', DateTime Function()? now, String Function()? txId, void Function()? onUnauthorized}); Future<dynamic> call(String path, Object body); Future<dynamic> callForm(String path, Map<String,String> params); Future<GwSession> session(); Future<Map<String,String>> companyInfo(); }`
  - `final gwHttpClientProvider = Provider<http.Client>`; `final gwClientProvider = Provider<GwClient?>`(크레덴셜 없으면 null)
  - `String asStr(Object? v)`, `bool asBool(Object? v)`(`'Y'`/`'true'`/`true`/`1`/`'1'` → true), `int asInt(Object? v, [int fallback = 0])`

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/gw/gw_client_test.dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:playground/gw/gw_sign.dart';

const creds = GwCreds(authToken: 'g|7|s', signKey: 'k');
GwClient client(MockClient m, {void Function()? onUnauthorized}) => GwClient(
      httpClient: m, creds: () => creds, now: () => DateTime.fromMillisecondsSinceEpoch(1700000000 * 1000), txId: () => 'f' * 32, onUnauthorized: onUnauthorized);
http.Response ok(Object data) => http.Response(jsonEncode({'resultCode': 0, 'resultMsg': 'SUCCESS', 'resultData': data}), 200, headers: {'content-type': 'application/json'});

void main() {
  test('서명 헤더 4종 + JSON 본문으로 POST하고 resultData를 돌려준다', () async {
    late http.Request seen;
    final c = client(MockClient((r) async { seen = r; return ok({'x': 1}); }));
    final d = await c.call('/eap/api/getMenuCountInfo', {'a': 1});
    expect(d, {'x': 1});
    expect(seen.url.toString(), 'https://gw.innogrid.com/eap/api/getMenuCountInfo');
    expect(seen.headers['Authorization'], 'Bearer g|7|s');
    expect(seen.headers['timestamp'], '1700000000');
    expect(seen.headers['transaction-id'], 'f' * 32);
    expect(seen.headers['wehago-sign'], wehagoSign(authToken: 'g|7|s', transactionId: 'f' * 32, timestamp: '1700000000', path: '/eap/api/getMenuCountInfo', signKey: 'k'));
    expect(seen.headers['Content-Type'], startsWith('application/json'));
    expect(jsonDecode(seen.body), {'a': 1});
  });
  test('resultCode가 문자열 "0"이나 200이어도 성공', () async {
    final c = client(MockClient((_) async => http.Response('{"resultCode":"0","resultData":{"ok":true}}', 200)));
    expect(await c.call('/p', {}), {'ok': true});
    final c2 = client(MockClient((_) async => http.Response('{"resultCode":200,"resultData":[]}', 200)));
    expect(await c2.call('/p', {}), []);
  });
  test('resultCode≠0이면 resultMsg를 담은 GwException', () async {
    final c = client(MockClient((_) async => http.Response('{"resultCode":999,"resultMsg":"nope"}', 200)));
    await expectLater(c.call('/p', {}), throwsA(isA<GwException>().having((e) => e.resultCode, 'code', 999).having((e) => e.message, 'msg', 'nope')));
  });
  test('HTTP 401은 GwUnauthorized + onUnauthorized 콜백, 메시지에 토큰 없음', () async {
    var called = 0;
    final c = client(MockClient((_) async => http.Response('{"resultCode":140,"resultMsg":"no token"}', 401)), onUnauthorized: () => called++);
    await expectLater(c.call('/p', {}), throwsA(isA<GwUnauthorized>().having((e) => e.message.contains('g|7|s'), 'leak', false)));
    expect(called, 1);
  });
  test('네트워크 예외는 GwException(status 0)', () async {
    final c = client(MockClient((_) async => throw http.ClientException('down')));
    await expectLater(c.call('/p', {}), throwsA(isA<GwException>().having((e) => e.status, 'status', 0)));
  });
  test('callForm은 x-www-form-urlencoded', () async {
    late http.Request seen;
    final c = client(MockClient((r) async { seen = r; return ok({}); }));
    await c.callForm('/gw/gw050A02', {'a10Domain': 'https://gw.innogrid.com'});
    expect(seen.headers['Content-Type'], startsWith('application/x-www-form-urlencoded'));
    expect(seen.body, 'a10Domain=https%3A%2F%2Fgw.innogrid.com');
  });
  test('session()은 gw050A02를 한 번만 부르고 10분 캐시, companyInfo 조립', () async {
    var calls = 0;
    final c = client(MockClient((_) async { calls++; return ok({'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E1', 'erpDeptSeq': 'D1', 'erpCompSeq': 'C1'}}}); }));
    final s = await c.session();
    expect((s.empName, s.email, s.empCd, s.deptCd, s.coCd), ('홍길동', 'hong@innogrid.com', 'E1', 'D1', 'C1'));
    await c.session();
    expect(calls, 1);
    expect(await c.companyInfo(), {'compSeq': '10', 'groupSeq': 'g', 'deptSeq': '20', 'emailAddr': 'hong', 'emailDomain': 'innogrid.com'});
  });
  test('ucUserInfo가 없으면 GwException', () async {
    final c = client(MockClient((_) async => ok({'sessionInfo': {}})));
    await expectLater(c.session(), throwsA(isA<GwException>()));
  });
  test('asStr/asBool/asInt는 혼용 타입을 흡수한다', () {
    expect((asStr(1), asStr('a'), asStr(null), asStr(true)), ('1', 'a', '', 'true'));
    expect([asBool('Y'), asBool(1), asBool('1'), asBool(true), asBool('N'), asBool(0), asBool(null)], [true, true, true, true, false, false, false]);
    expect((asInt('3'), asInt(4), asInt('x', 9)), (3, 4, 9));
  });
}
```

- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/gw/gw_client_test.dart` → Expected: 컴파일 실패.

- [ ] **Step 3: 구현**

```dart
// mobile/lib/gw/gw_client.dart
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'gw_creds.dart';
import 'gw_sign.dart';

class GwException implements Exception {
  GwException(this.status, this.resultCode, this.message);
  final int status, resultCode;
  final String message;
  @override
  String toString() => message;
}

/// HTTP 401 — 세션 만료·서명 불일치(resultCode 140/112). 처방은 같다: 다시 연결.
class GwUnauthorized extends GwException {
  GwUnauthorized(int resultCode) : super(401, resultCode, '아마란스 로그인이 만료되었습니다. 다시 연결해 주세요.');
}

/// gw050A02 sessionInfo.ucUserInfo. UC 계열(compSeq/deptSeq/email)과 근태 ERP 코드(erp*Seq)를 한 번에.
class GwSession {
  const GwSession({required this.compSeq, required this.deptSeq, required this.empName, required this.emailAddr, required this.emailDomain, required this.empCd, required this.deptCd, required this.coCd});
  final String compSeq, deptSeq, empName, emailAddr, emailDomain, empCd, deptCd, coCd;
  String get email => emailDomain.isEmpty ? emailAddr : '$emailAddr@$emailDomain';
  factory GwSession.fromUcUserInfo(Map m) => GwSession(
        compSeq: asStr(m['compSeq']), deptSeq: asStr(m['deptSeq']), empName: asStr(m['empName']), emailAddr: asStr(m['emailAdd']), emailDomain: asStr(m['emailDomain']),
        empCd: asStr(m['erpEmpSeq']), deptCd: asStr(m['erpDeptSeq']), coCd: asStr(m['erpCompSeq']));
}

String asStr(Object? v) => v == null ? '' : v.toString();
bool asBool(Object? v) => v == true || v == 1 || (v is String && (v == 'Y' || v == 'y' || v == '1' || v == 'true'));
int asInt(Object? v, [int fallback = 0]) => v is int ? v : (v is num ? v.toInt() : int.tryParse(asStr(v)) ?? fallback);

/// 모든 아마란스 호출의 단일 관문. 서명 헤더 4종 → POST → 봉투({resultCode,resultMsg,resultData}) 해석.
class GwClient {
  GwClient({required this.httpClient, required this.creds, this.baseUrl = 'https://gw.innogrid.com', DateTime Function()? now, String Function()? txId, this.onUnauthorized})
      : _now = now ?? DateTime.now, _txId = txId ?? gwTransactionId;
  final http.Client httpClient;
  final GwCreds Function() creds;
  final String baseUrl;
  final DateTime Function() _now;
  final String Function() _txId;
  final void Function()? onUnauthorized;
  static const sessionTtl = Duration(minutes: 10);
  GwSession? _session;
  DateTime? _sessionAt;

  Map<String, String> _signed(String path, String contentType) {
    final c = creds();
    final tid = _txId();
    final ts = (_now().millisecondsSinceEpoch ~/ 1000).toString();
    return {
      'Authorization': 'Bearer ${c.authToken}',
      'timestamp': ts,
      'transaction-id': tid,
      'wehago-sign': wehagoSign(authToken: c.authToken, transactionId: tid, timestamp: ts, path: path, signKey: c.signKey),
      'Content-Type': contentType,
      'Accept': 'application/json',
    };
  }

  Future<dynamic> _post(String path, String contentType, String body) async {
    http.Response res;
    try {
      res = await httpClient.post(Uri.parse('$baseUrl$path'), headers: _signed(path, contentType), body: body).timeout(const Duration(seconds: 15));
    } catch (_) {
      throw GwException(0, -1, '그룹웨어에 연결할 수 없습니다');
    }
    Map<String, dynamic> v = const {};
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      if (j is Map<String, dynamic>) v = j;
    } catch (_) {}
    final code = asInt(v['resultCode'], -1);
    if (res.statusCode == 401) {
      onUnauthorized?.call();
      throw GwUnauthorized(code);
    }
    if (res.statusCode < 200 || res.statusCode >= 300) throw GwException(res.statusCode, code, asStr(v['resultMsg']).isEmpty ? '요청에 실패했습니다 (HTTP ${res.statusCode})' : asStr(v['resultMsg']));
    if (code != 0 && code != 200) throw GwException(res.statusCode, code, asStr(v['resultMsg']).isEmpty ? '요청에 실패했습니다 (resultCode $code)' : asStr(v['resultMsg']));
    return v['resultData'];
  }

  /// JSON POST → resultData.
  Future<dynamic> call(String path, Object body) => _post(path, 'application/json', jsonEncode(body));

  /// x-www-form-urlencoded POST(gw050A02).
  Future<dynamic> callForm(String path, Map<String, String> params) =>
      _post(path, 'application/x-www-form-urlencoded', params.entries.map((e) => '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}').join('&'));

  /// 세션 정보(10분 캐시). 연결 검증에도 쓴다.
  Future<GwSession> session() async {
    final cached = _session;
    if (cached != null && _sessionAt != null && _now().difference(_sessionAt!) < sessionTtl) return cached;
    final d = await callForm('/gw/gw050A02', {'a10Domain': baseUrl});
    final uc = d is Map ? (d['sessionInfo'] as Map?)?['ucUserInfo'] : null;
    if (uc is! Map) throw GwException(200, 0, '세션 정보를 받지 못했습니다');
    _session = GwSession.fromUcUserInfo(uc);
    _sessionAt = _now();
    return _session!;
  }

  /// 캘린더·자원 API 공통 companyInfo. groupSeq는 authToken, 나머지는 세션.
  Future<Map<String, String>> companyInfo() async {
    final s = await session();
    return {'compSeq': s.compSeq, 'groupSeq': creds().groupSeq, 'deptSeq': s.deptSeq, 'emailAddr': s.emailAddr, 'emailDomain': s.emailDomain};
  }
}

final gwHttpClientProvider = Provider<http.Client>((_) => http.Client());

/// 크레덴셜이 있을 때만 클라이언트. 401이면 gwProvider를 needsRelogin으로.
final gwClientProvider = Provider<GwClient?>((ref) {
  final creds = ref.watch(gwProvider).value?.creds;
  if (creds == null) return null;
  return GwClient(httpClient: ref.watch(gwHttpClientProvider), creds: () => creds, onUnauthorized: () => ref.read(gwProvider.notifier).markUnauthorized());
});
```

- [ ] **Step 4: 통과 확인** — Run: `cd mobile && flutter test test/gw/gw_client_test.dart` → Expected: 9 passed.

- [ ] **Step 5: 커밋** — `git add mobile/lib/gw/gw_client.dart mobile/test/gw/gw_client_test.dart && git commit -m "feat(mobile): 아마란스 GW 클라이언트 — 서명 헤더·응답 봉투·세션 10분 캐시·401 처리"`

---

### Task 4: 결재·근태 — 모델·정제 함수(`gw_models.dart`) + API(`gw_api.dart`)

**Files:**
- Create: `mobile/lib/gw/gw_models.dart`(순수: 모델 + 정제 함수 + 날짜 헬퍼)
- Create: `mobile/lib/gw/gw_api.dart`(네트워크: `GwApi` — 이 태스크에서 결재·근태 메서드, 5·6에서 나머지 추가)
- Test: `mobile/test/gw/gw_models_test.dart`, `mobile/test/gw/gw_api_test.dart`

**Interfaces:**
- Consumes: `GwClient.call/companyInfo/session`, `asStr/asBool/asInt`.
- Produces(이 태스크):
  - 날짜: `String ymd(DateTime d)`(`20261004`), `String hm(String ymdhm12)`(`'202610040902'`→`'09:02'`, 길이가 12가 아니면 원문), `int? daysBetween(String ymd8, DateTime today)`
  - `class PendingApproval { docId, formId, title, form, drafter, dept, arrivedDt, status, unread, fileCount; int? waitingDays(DateTime today); factory fromRow(Map) }`
  - `class ApprovalDetail { title, form, status, drafter, dept, repDt, attachCount, currentApprover, content; factory fromData(Map) }` — `content`는 `contentsWord`가 비면 `docContents` HTML을 `htmlToText`로.
  - `String htmlToText(String html)`(태그 제거·엔티티 `&nbsp; &amp; &lt; &gt; &quot;` 해제·공백 접기)
  - `Map<String,int> approvalCounts(Map data)` → 키 `pending`(1001000)·`approved`(1001100)·`reference`(1001200)·`sent`(1000400), 없으면 0
  - `class Attendance { workDt, comeTm, leaveTm, holiday; bool get clockedIn; bool get clockedOut; factory fromData(String workDt, Map? d) }` — `comeTm`이 null/''이면 `''`.
  - `class PunchResult { ok, already, kind, comeTm, leaveTm, verified, note }`
  - `class GwApi { GwApi(this.client, {DateTime Function()? now}); Future<Map<String,int>> approvalCounts(); Future<(int, List<PendingApproval>)> pendingApprovals({int pageSize = 50}); Future<ApprovalDetail> approvalDetail(String docId, String formId); Future<Attendance> attendanceToday(); Future<PunchResult> punch({required bool clockIn}); }`
  - `final gwApiProvider = Provider<GwApi?>`

- [ ] **Step 1: 실패하는 테스트(모델)**

```dart
// mobile/test/gw/gw_models_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_models.dart';

void main() {
  final today = DateTime(2026, 10, 4, 12);
  test('날짜 헬퍼', () {
    expect(ymd(today), '20261004');
    expect(hm('202610040902'), '09:02');
    expect(hm(''), '');
    expect(hm('0902'), '0902');
    expect(daysBetween('20261001', today), 3);
    expect(daysBetween('2026-10-01', today), 3); // 구분자 섞여도 숫자만
    expect(daysBetween('', today), isNull);
  });
  test('미결 문서 행 → 모델, 대기일수', () {
    final p = PendingApproval.fromRow({'DOC_ID': 'D1', 'FORM_ID': 7, 'DOC_TITLE': '휴가', 'FORM_NM': '휴가신청', 'USER_NM': '김', 'DEPT_NM': '팀', 'ARRIVED_DT': '20261001', 'READYN': 'N', 'DOC_STSNM': '진행', 'FILE_CNT': '2'});
    expect((p.docId, p.formId, p.title, p.form, p.drafter, p.dept, p.unread, p.fileCount), ('D1', '7', '휴가', '휴가신청', '김', '팀', true, 2));
    expect(p.waitingDays(today), 3);
    expect(PendingApproval.fromRow({'FORM_NM': '', 'DRAFT_FORM_NM': '초안양식'}).form, '초안양식');
  });
  test('결재 상세: contentsWord 우선, 비면 HTML 본문을 평문으로', () {
    expect(ApprovalDetail.fromData({'docTitle': 't', 'contentsWord': ' 평문 ', 'docContents': '<p>html</p>', 'attachCnt': 1}).content, '평문');
    final d = ApprovalDetail.fromData({'docTitle': 't', 'contentsWord': '', 'docContents': '<p>a&nbsp;b</p><br>c &amp; d', 'lineName': '박'});
    expect(d.content, 'a b c & d');
    expect((d.title, d.currentApprover, d.attachCount), ('t', '박', 0));
  });
  test('미처리 카운트 menuNo → 라벨, 없으면 0, 숫자/문자열 혼용', () {
    expect(approvalCounts({'1001000': '3', '1001100': 12, '1001200': '0', '9999': '1'}), {'pending': 3, 'approved': 12, 'reference': 0, 'sent': 0});
  });
  test('출퇴근: null과 빈 문자열은 미등록', () {
    final a = Attendance.fromData('20261004', {'comeTm': null, 'leaveTm': '', 'holidayYn': 'N'});
    expect((a.comeTm, a.leaveTm, a.clockedIn, a.clockedOut, a.holiday), ('', '', false, false, false));
    final b = Attendance.fromData('20261004', {'comeTm': '202610040902', 'holidayYn': 'Y'});
    expect((b.clockedIn, b.clockedOut, b.holiday, hm(b.comeTm)), (true, false, true, '09:02'));
    expect(Attendance.fromData('20261004', null).clockedIn, false);
  });
}
```

- [ ] **Step 2: 실패하는 테스트(API)**

```dart
// mobile/test/gw/gw_api_test.dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';

const _creds = GwCreds(authToken: 'g|7|s', signKey: 'k');
final _now = DateTime(2026, 10, 4, 12);
http.Response ok(Object? data) => http.Response(jsonEncode({'resultCode': 0, 'resultData': data}), 200, headers: {'content-type': 'application/json'});
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍', 'emailAdd': 'h', 'emailDomain': 'x.com', 'erpEmpSeq': 'E1', 'erpDeptSeq': 'D1', 'erpCompSeq': 'C1'}}};

/// 경로별 응답 + 호출 기록. 같은 경로가 여러 번이면 순서대로 소비한다.
class Fake {
  Fake(this.routes);
  final Map<String, List<Object?>> routes;
  final calls = <(String, Map<String, dynamic>)>[];
  GwApi api() => GwApi(GwClient(httpClient: MockClient((r) async {
        final body = r.body.startsWith('{') ? jsonDecode(r.body) as Map<String, dynamic> : <String, dynamic>{'form': r.body};
        calls.add((r.url.path, body));
        final q = routes[r.url.path];
        if (q == null || q.isEmpty) return http.Response('{"resultCode":999,"resultMsg":"unexpected ${r.url.path}"}', 200);
        return ok(q.length == 1 ? q.first : q.removeAt(0));
      }), creds: () => _creds, now: () => _now), now: () => _now);
  int count(String path) => calls.where((c) => c.$1 == path).length;
}

void main() {
  test('approvalCounts: 세션 값으로 body를 채우고 라벨 맵을 돌려준다', () async {
    final f = Fake({'/gw/gw050A02': [session], '/eap/api/getMenuCountInfo': [{'1001000': '2'}]});
    expect(await f.api().approvalCounts(), {'pending': 2, 'approved': 0, 'reference': 0, 'sent': 0});
    final body = f.calls.last.$2;
    expect((body['deptSeq'], body['compSeq'], body['bizSeq'], body['empSeq'], body['groupSeq'], body['userSe'], body['pageCode']), ('20', '10', '10', '7', 'g', 'USER|AT', 'EapSide'));
  });
  test('pendingApprovals: eap105A04 미결함 body + map.list 정제, 오래 기다린 순', () async {
    final f = Fake({'/gw/gw050A02': [session], '/eap/eap105A04': [{'map': {'totalCount': 2, 'list': [
      {'DOC_ID': 'B', 'FORM_ID': '1', 'DOC_TITLE': 'b', 'ARRIVED_DT': '20261003', 'READYN': 'Y'},
      {'DOC_ID': 'A', 'FORM_ID': '1', 'DOC_TITLE': 'a', 'ARRIVED_DT': '20260920', 'READYN': 'N'},
    ]}}]});
    final (total, docs) = await f.api().pendingApprovals();
    expect(total, 2);
    expect(docs.map((d) => d.docId), ['A', 'B']);
    final body = f.calls.last.$2;
    expect((body['eaBoxId'], body['menuNo'], body['periodPicker'], body['sfrDt'], body['stoDt'], body['pageSize']), ('1000900', '1001000', 'ARRIVED_DT', '20260706', '20261004', '50'));
  });
  test('approvalDetail: eap111A04, 열람 처리 없음(setReadYn N)', () async {
    final f = Fake({'/eap/eap111A04': [{'docTitle': 't', 'contentsWord': 'c', 'empName': '김'}]});
    final d = await f.api().approvalDetail('D1', '7');
    expect((d.title, d.content, d.drafter), ('t', 'c', '김'));
    expect((f.calls.last.$2['doc_id'], f.calls.last.$2['form_id'], f.calls.last.$2['setReadYn']), ('D1', '7', 'N'));
  });
  test('attendanceToday: 근태 코드(empCd/coCd)와 오늘 날짜', () async {
    final f = Fake({'/gw/gw050A02': [session], '/human/common/judgeTimeManagement/getTodayComeLeaveInfo': [{'comeTm': '202610040902', 'leaveTm': ''}]});
    final a = await f.api().attendanceToday();
    expect((a.workDt, a.comeTm, a.clockedOut), ('20261004', '202610040902', false));
    expect((f.calls.last.$2['empCd'], f.calls.last.$2['coCd'], f.calls.last.$2['workDt']), ('E1', 'C1', '20261004'));
  });
  test('punch: 이미 출근 기록이 있으면 기록 호출 0회, already', () async {
    final f = Fake({'/gw/gw050A02': [session], '/human/common/judgeTimeManagement/getTodayComeLeaveInfo': [{'comeTm': '202610040902', 'leaveTm': ''}]});
    final r = await f.api().punch(clockIn: true);
    expect((r.ok, r.already, r.kind), (true, true, '출근'));
    expect(f.count('/human/common/judgeTimeManagement/getJudgeTimeManagement'), 0);
  });
  test('punch: 기록 → read-back으로 반영 판정(attendFg 4=퇴근)', () async {
    const base = '/human/common/judgeTimeManagement';
    final f = Fake({'/gw/gw050A02': [session], '$base/getTodayComeLeaveInfo': [{'comeTm': '202610040902', 'leaveTm': ''}, {'comeTm': '202610040902', 'leaveTm': '202610041805'}], '$base/confirmApplicationStatus': [{}], '$base/getJudgeTimeManagement': [{'successCount': 1}]});
    final r = await f.api().punch(clockIn: false);
    expect((r.ok, r.already, r.verified, r.kind, r.leaveTm), (true, false, true, '퇴근', '202610041805'));
    final punch = f.calls.firstWhere((c) => c.$1 == '$base/getJudgeTimeManagement').$2;
    expect(punch['type'], 'WEB');
    expect((punch['judgeData'] as Map)['attendFg'], '4');
    expect((punch['judgeData'] as Map)['deptCd'], 'D1');
  });
  test('punch: read-back에 반영이 없으면 ok=false·verified=false', () async {
    const base = '/human/common/judgeTimeManagement';
    final f = Fake({'/gw/gw050A02': [session], '$base/getTodayComeLeaveInfo': [{'comeTm': '', 'leaveTm': ''}, {'comeTm': '', 'leaveTm': ''}], '$base/confirmApplicationStatus': [{}], '$base/getJudgeTimeManagement': [{}]});
    final r = await f.api().punch(clockIn: true);
    expect((r.ok, r.verified), (false, false));
  });
}
```

- [ ] **Step 3: 실패 확인** — Run: `cd mobile && flutter test test/gw/gw_models_test.dart test/gw/gw_api_test.dart` → Expected: 컴파일 실패.

- [ ] **Step 4: 구현(모델)**

```dart
// mobile/lib/gw/gw_models.dart
// 아마란스 응답 정제 — 순수 함수만(네트워크 없음). 필드 이름·의미의 출처는 inno-creed src/modules/*.rs.
import 'gw_client.dart' show asStr, asBool, asInt;

String ymd(DateTime d) => '${d.year}${d.month.toString().padLeft(2, '0')}${d.day.toString().padLeft(2, '0')}';
String ymdhm(DateTime d) => '${ymd(d)}${d.hour.toString().padLeft(2, '0')}${d.minute.toString().padLeft(2, '0')}';
/// 'YYYYMMDDHHmm' → 'HH:mm'. 형식이 다르면 원문.
String hm(String s) => s.length == 12 ? '${s.substring(8, 10)}:${s.substring(10, 12)}' : s;
String _digits(String s) => s.replaceAll(RegExp(r'\D'), '');
DateTime? _parseYmd(String s) {
  final d = _digits(s);
  if (d.length < 8) return null;
  return DateTime(int.parse(d.substring(0, 4)), int.parse(d.substring(4, 6)), int.parse(d.substring(6, 8)));
}
int? daysBetween(String ymd8, DateTime today) {
  final a = _parseYmd(ymd8);
  if (a == null) return null;
  return DateTime(today.year, today.month, today.day).difference(a).inDays;
}

String htmlToText(String html) {
  var s = html.replaceAll(RegExp(r'<(br|/p|/div|/li|/tr)\s*/?>', caseSensitive: false), ' ').replaceAll(RegExp(r'<[^>]+>'), '');
  const ent = {'&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'"};
  ent.forEach((k, v) => s = s.replaceAll(k, v));
  return s.replaceAll(RegExp(r'\s+'), ' ').trim();
}

/// 미결함 행(eap105A04 map.list[]). 대문자 컬럼명은 서버 그대로.
class PendingApproval {
  const PendingApproval({required this.docId, required this.formId, required this.title, required this.form, required this.drafter, required this.dept, required this.arrivedDt, required this.status, required this.unread, required this.fileCount});
  final String docId, formId, title, form, drafter, dept, arrivedDt, status;
  final bool unread;
  final int fileCount;
  int? waitingDays(DateTime today) => daysBetween(arrivedDt, today);
  factory PendingApproval.fromRow(Map r) => PendingApproval(
        docId: asStr(r['DOC_ID']), formId: asStr(r['FORM_ID']), title: asStr(r['DOC_TITLE']),
        form: asStr(r['FORM_NM']).isEmpty ? asStr(r['DRAFT_FORM_NM']) : asStr(r['FORM_NM']),
        drafter: asStr(r['USER_NM']), dept: asStr(r['DEPT_NM']), arrivedDt: _digits(asStr(r['ARRIVED_DT'])), status: asStr(r['DOC_STSNM']),
        unread: asStr(r['READYN']) == 'N', fileCount: asInt(r['FILE_CNT']));
}

/// 문서 상세(eap111A04). 본문은 평문 contentsWord 우선, 비면 docContents(HTML) 태그 제거.
class ApprovalDetail {
  const ApprovalDetail({required this.title, required this.form, required this.status, required this.drafter, required this.dept, required this.repDt, required this.attachCount, required this.currentApprover, required this.content});
  final String title, form, status, drafter, dept, repDt, currentApprover, content;
  final int attachCount;
  factory ApprovalDetail.fromData(Map d) {
    final word = asStr(d['contentsWord']).trim();
    return ApprovalDetail(
        title: asStr(d['docTitle']), form: asStr(d['formName']), status: asStr(d['docStsName']), drafter: asStr(d['empName']), dept: asStr(d['deptName']), repDt: asStr(d['repDt']),
        attachCount: asInt(d['attachCnt']), currentApprover: asStr(d['lineName']), content: word.isEmpty ? htmlToText(asStr(d['docContents'])) : word);
  }
}

/// getMenuCountInfo {menuNo: count} → 함 라벨.
Map<String, int> approvalCounts(Map data) => {'pending': asInt(data['1001000']), 'approved': asInt(data['1001100']), 'reference': asInt(data['1001200']), 'sent': asInt(data['1000400'])};

/// 오늘 출퇴근(getTodayComeLeaveInfo). comeTm/leaveTm은 'YYYYMMDDHHmm', 미등록이면 ''(null도 ''로).
class Attendance {
  const Attendance({required this.workDt, required this.comeTm, required this.leaveTm, required this.holiday});
  final String workDt, comeTm, leaveTm;
  final bool holiday;
  bool get clockedIn => comeTm.isNotEmpty;
  bool get clockedOut => leaveTm.isNotEmpty;
  factory Attendance.fromData(String workDt, Map? d) => Attendance(workDt: workDt, comeTm: asStr(d?['comeTm']), leaveTm: asStr(d?['leaveTm']), holiday: asBool(d?['holidayYn']));
}

class PunchResult {
  const PunchResult({required this.ok, required this.already, required this.kind, required this.comeTm, required this.leaveTm, required this.verified, required this.note});
  final bool ok, already, verified;
  final String kind, comeTm, leaveTm, note;
}
```

- [ ] **Step 5: 구현(API)**

```dart
// mobile/lib/gw/gw_api.dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'gw_client.dart';
import 'gw_models.dart';

/// 기능별 호출. 요청 본문 값과 함정의 출처는 inno-creed(approval.rs·attendance.rs·calendar.rs·resource.rs·mail.rs).
class GwApi {
  GwApi(this.client, {DateTime Function()? now}) : _now = now ?? DateTime.now;
  final GwClient client;
  final DateTime Function() _now;

  // ── 전자결재 ──
  Future<Map<String, int>> approvalCounts() async {
    final s = await client.session();
    final d = await client.call('/eap/api/getMenuCountInfo', {
      'deptSeq': s.deptSeq, 'userSe': 'USER|AT', 'compSeq': s.compSeq, 'bizSeq': s.compSeq, 'empSeq': client.creds().empSeq, 'groupSeq': client.creds().groupSeq, 'menuType': '', 'pageCode': 'EapSide',
    });
    return approvalCounts(d is Map ? d : const {});
  }

  /// 미결함(eap105A04, eaBoxId 1000900 / menuNo 1001000). 서버 기본 기간이 좁아 최근 90일을 명시. 오래 기다린 순.
  Future<(int, List<PendingApproval>)> pendingApprovals({int pageSize = 50}) async {
    final today = _now();
    final d = await client.call('/eap/eap105A04', {
      'fDocSts': [], 'page': '1', 'pageSize': '$pageSize', 'eaBoxId': '1000900', 'nMenuID': '1001000', 'menuNo': '1001000', 'upperMenuNo': '1000900',
      'sfrDt': ymd(today.subtract(const Duration(days: 90))), 'stoDt': ymd(today), 'sFormId': ['0'], 'periodPicker': 'ARRIVED_DT', 'sortField': 'ARRIVED_DT', 'sortType': 'DESC',
      'docContentsData': {}, 'item': {}, 'useElasticSearch': true, 'useElasticSearch_new': true, 'pageCode': '',
    });
    final map = d is Map ? d['map'] : null;
    final list = (map is Map ? map['list'] : null) as List? ?? const [];
    final docs = [for (final r in list) if (r is Map) PendingApproval.fromRow(r)]..sort((a, b) => (b.waitingDays(today) ?? 0).compareTo(a.waitingDays(today) ?? 0));
    return (asInt(map is Map ? map['totalCount'] : null, docs.length), docs);
  }

  /// 문서 상세 — 열람 처리 없음(setReadYn N).
  Future<ApprovalDetail> approvalDetail(String docId, String formId) async {
    final d = await client.call('/eap/eap111A04', {
      'doc_id': docId, 'form_id': formId, 'bindType': 'V', 'p_doc_id': 0, 'doc_auth': '0', 'spDocId': '', 'setReadYn': 'N', 'commentReqYn': 'N', 'pageCode': 'UBA1100', 'docToken': '',
    });
    return ApprovalDetail.fromData(d is Map ? d : const {});
  }

  // ── 근태 ──
  static const _att = '/human/common/judgeTimeManagement';
  Future<Attendance> attendanceToday() async {
    final s = await client.session();
    final wd = ymd(_now());
    final d = await client.call('$_att/getTodayComeLeaveInfo', {'empCd': s.empCd, 'coCd': s.coCd, 'workDt': wd});
    return Attendance.fromData(wd, d is Map ? d : null);
  }

  /// 출근(attendFg 1)/퇴근(4) 기록. 기록 전 가드(이미 있으면 호출 안 함) → confirmApplicationStatus(정보성) → punch → read-back으로 판정.
  Future<PunchResult> punch({required bool clockIn}) async {
    final kind = clockIn ? '출근' : '퇴근';
    final before = await attendanceToday();
    final existing = clockIn ? before.comeTm : before.leaveTm;
    if (existing.isNotEmpty) {
      return PunchResult(ok: true, already: true, kind: kind, comeTm: before.comeTm, leaveTm: before.leaveTm, verified: true, note: '이미 $kind 기록(${hm(existing)})이 있어 다시 기록하지 않았습니다.');
    }
    final s = await client.session();
    try {
      await client.call('$_att/confirmApplicationStatus', {'empCd': s.empCd, 'deptCd': s.deptCd, 'coCd': s.coCd});
    } on GwException catch (_) {}
    await client.call('$_att/getJudgeTimeManagement', {'type': 'WEB', 'judgeData': {'empCd': s.empCd, 'deptCd': s.deptCd, 'coCd': s.coCd, 'attendFg': clockIn ? '1' : '4'}});
    final after = await attendanceToday();
    final now = clockIn ? after.comeTm : after.leaveTm;
    final ok = now.isNotEmpty;
    return PunchResult(ok: ok, already: false, kind: kind, comeTm: after.comeTm, leaveTm: after.leaveTm, verified: ok, note: ok ? '$kind ${hm(now)} 기록됨' : '응답은 왔지만 반영이 확인되지 않았습니다. 아마란스에서 확인하세요.');
  }
}

final gwApiProvider = Provider<GwApi?>((ref) {
  final c = ref.watch(gwClientProvider);
  return c == null ? null : GwApi(c);
});
```

- [ ] **Step 6: 통과 확인** — Run: `cd mobile && flutter test test/gw/` → Expected: 모두 통과(모델 5 + API 7 + 이전 15).

- [ ] **Step 7: 커밋** — `git add mobile/lib/gw/gw_models.dart mobile/lib/gw/gw_api.dart mobile/test/gw/gw_models_test.dart mobile/test/gw/gw_api_test.dart && git commit -m "feat(mobile): 아마란스 결재(미결 건수·목록·상세)·근태(오늘·출퇴근 기록 가드+read-back) API"`

---

### Task 5: 일정·회의실 — 모델·정제 + API 메서드

**Files:**
- Modify: `mobile/lib/gw/gw_models.dart`(추가), `mobile/lib/gw/gw_api.dart`(추가)
- Test: `mobile/test/gw/gw_models_test.dart`(추가), `mobile/test/gw/gw_api_test.dart`(추가)

**Interfaces:**
- Produces:
  - `class GwCalendar { mcalSeq, title, calType, ownerEmpSeq, color; factory fromRow(Map) }`, `List<Map<String,String>> calListFor(List<GwCalendar>)` — `{mcalSeq, calType(빈값→'E'), adminYn:'Y', color}`
  - `class GwEvent { schSeq, title, start, end, allDay, calendar, mcalSeq, mine, createName, place; factory fromRow(Map) }` — `mine = delYn == 'Y'`
  - `List<GwEvent> myEvents(List<GwEvent> all, List<GwCalendar> cals, String empSeq)` — `mine` 이거나 내 개인 캘린더(`calType E && ownerEmpSeq == empSeq`)의 일정
  - `class GwResource { resSeq, resName, attrSeq, attrName; factory fromRow(Map) }`
  - `class GwReservation { resSeq, resName, start, end, title, display, owner, ownerEmpSeq, attendees, allDay; factory fromRow(Map) }` — `display`는 `resTitleDisplay` 없으면 `[owner] resName`
  - `GwApi`: `Future<List<GwCalendar>> calendars()`(10분 캐시), `Future<List<GwEvent>> events(DateTime day)`, `Future<List<GwResource>> resources()`(30분 캐시), `Future<List<GwReservation>> reservations(DateTime day)`(시작 시각순)

- [ ] **Step 1: 실패하는 테스트** — `gw_models_test.dart`에 추가:

```dart
  test('캘린더 calList: 빈 calType은 E로 보정, adminYn Y', () {
    final cals = [GwCalendar.fromRow({'mcalSeq': '1', 'calTitle': '개인', 'calType': '', 'empSeq': '7', 'calColor': '#fff'}), GwCalendar.fromRow({'mcalSeq': 2, 'calTitle': '팀', 'calType': 'M', 'empSeq': '9'})];
    expect(calListFor(cals), [{'mcalSeq': '1', 'calType': 'E', 'adminYn': 'Y', 'color': '#fff'}, {'mcalSeq': '2', 'calType': 'M', 'adminYn': 'Y', 'color': ''}]);
  });
  test('일정: delYn Y는 내 일정, myEvents는 내 개인 캘린더 일정도 포함', () {
    final cals = [GwCalendar.fromRow({'mcalSeq': '1', 'calType': 'E', 'empSeq': '7'}), GwCalendar.fromRow({'mcalSeq': '2', 'calType': 'M', 'empSeq': '9'})];
    final all = [
      GwEvent.fromRow({'schSeq': 'a', 'schTitle': '내것', 'startDate': '202610041000', 'endDate': '202610041100', 'delYn': 'Y', 'mcalSeq': '2', 'calTitle': '팀'}),
      GwEvent.fromRow({'schSeq': 'b', 'schTitle': '개인캘린더', 'startDate': '202610040900', 'endDate': '202610040930', 'delYn': 'N', 'mcalSeq': '1', 'alldayYn': 'N'}),
      GwEvent.fromRow({'schSeq': 'c', 'schTitle': '남의것', 'startDate': '202610041200', 'endDate': '202610041300', 'delYn': 'N', 'mcalSeq': '2'}),
    ];
    expect(all[0].mine, true);
    expect(myEvents(all, cals, '7').map((e) => e.schSeq), ['a', 'b']);
  });
  test('회의실 예약: 표시명은 resTitleDisplay 우선, 없으면 [예약자] 회의실', () {
    final r = GwReservation.fromRow({'resSeq': 45, 'resName': 'A-1', 'resStartDate': '202610041400', 'resEndDate': '202610041500', 'reqText': '주간회의', 'empName': '홍', 'empSeq': '7', 'resUserName': '홍, 김', 'alldayYn': 'N'});
    expect((r.display, r.title, r.ownerEmpSeq, hm(r.start)), ('[홍] A-1', '주간회의', '7', '14:00'));
    expect(GwReservation.fromRow({'resTitleDisplay': 'X'}).display, 'X');
  });
```

`gw_api_test.dart`에 추가:

```dart
  test('events: sc111A02 목록(10분 캐시) → sc111A03 calList/날짜', () async {
    final f = Fake({'/gw/gw050A02': [session], '/schres/sc111A02': [{'resultList': [{'mcalSeq': '1', 'calType': '', 'empSeq': '7'}]}], '/schres/sc111A03': [{'resultList': [{'schSeq': 'a', 'schTitle': 't', 'startDate': '202610041000', 'endDate': '202610041100', 'delYn': 'Y'}]}]});
    final api = f.api();
    final ev = await api.events(DateTime(2026, 10, 4));
    expect(ev.single.title, 't');
    await api.events(DateTime(2026, 10, 4));
    expect(f.count('/schres/sc111A02'), 1);
    final body = f.calls.last.$2;
    expect((body['startDate'], body['endDate'], body['mySchYn'], body['langCode']), ('20261004', '20261004', 'N', 'kr'));
    expect(body['calList'], [{'mcalSeq': '1', 'calType': 'E', 'adminYn': 'Y', 'color': ''}]);
    expect((body['companyInfo'] as Map)['compSeq'], '10');
  });
  test('reservations: rs121A01 자원 전체 → rs121A05, 시작 시각순', () async {
    final f = Fake({'/gw/gw050A02': [session], '/schres/rs121A01': [{'resultList': [{'resSeq': '45', 'resName': 'A'}, {'resSeq': '46', 'resName': 'B'}]}], '/schres/rs121A05': [{'resultList': [
      {'resSeq': '46', 'resName': 'B', 'resStartDate': '202610041500', 'resEndDate': '202610041600', 'empSeq': '9'},
      {'resSeq': '45', 'resName': 'A', 'resStartDate': '202610041000', 'resEndDate': '202610041100', 'empSeq': '7'},
    ]}]});
    final rs = await f.api().reservations(DateTime(2026, 10, 4));
    expect(rs.map((r) => r.resName), ['A', 'B']);
    final body = f.calls.last.$2;
    expect(body['resList'], [{'resSeq': '45'}, {'resSeq': '46'}]);
    expect((body['statusType'], body['menuAuth'], body['startDate']), (['10', '20'], 'USER', '20261004'));
  });
```

- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/gw/` → Expected: 컴파일 실패(GwCalendar 없음).

- [ ] **Step 3: 구현** — `gw_models.dart`에 추가:

```dart
/// 캘린더(sc111A02 resultList[]).
class GwCalendar {
  const GwCalendar({required this.mcalSeq, required this.title, required this.calType, required this.ownerEmpSeq, required this.color});
  final String mcalSeq, title, calType, ownerEmpSeq, color;
  bool get personal => calType == 'E';
  factory GwCalendar.fromRow(Map r) => GwCalendar(mcalSeq: asStr(r['mcalSeq']), title: asStr(r['calTitle']), calType: asStr(r['calType']), ownerEmpSeq: asStr(r['empSeq']), color: asStr(r['calColor']));
}

/// sc111A03의 calList. 빈 calType은 'E'로 보정(안 하면 그 캘린더 일정이 조회에서 빠진다 — 실측), adminYn은 조회용 'Y'.
List<Map<String, String>> calListFor(List<GwCalendar> cals) => [for (final c in cals) {'mcalSeq': c.mcalSeq, 'calType': c.calType.isEmpty ? 'E' : c.calType, 'adminYn': 'Y', 'color': c.color}];

/// 일정(sc111A03 resultList[]). delYn은 이름과 달리 "내 일정(참석자/작성자)" 플래그.
class GwEvent {
  const GwEvent({required this.schSeq, required this.title, required this.start, required this.end, required this.allDay, required this.calendar, required this.mcalSeq, required this.mine, required this.createName, required this.place});
  final String schSeq, title, start, end, calendar, mcalSeq, createName, place;
  final bool allDay, mine;
  factory GwEvent.fromRow(Map r) => GwEvent(
        schSeq: asStr(r['schSeq']), title: asStr(r['schTitle']), start: asStr(r['startDate']), end: asStr(r['endDate']), allDay: asBool(r['alldayYn']), calendar: asStr(r['calTitle']), mcalSeq: asStr(r['mcalSeq']),
        mine: asStr(r['delYn']) == 'Y', createName: asStr(r['createName']), place: asStr(r['schPlace']));
}

List<GwEvent> myEvents(List<GwEvent> all, List<GwCalendar> cals, String empSeq) {
  final personal = {for (final c in cals) if (c.personal && c.ownerEmpSeq == empSeq) c.mcalSeq};
  return [for (final e in all) if (e.mine || personal.contains(e.mcalSeq)) e];
}

class GwResource {
  const GwResource({required this.resSeq, required this.resName, required this.attrSeq, required this.attrName});
  final String resSeq, resName, attrSeq, attrName;
  factory GwResource.fromRow(Map r) => GwResource(resSeq: asStr(r['resSeq']), resName: asStr(r['resName']), attrSeq: asStr(r['attrSeq']), attrName: asStr(r['attrName']));
}

/// 회의실 예약(rs121A05 resultList[]). 원본 74필드 중 표시에 쓰는 것만.
class GwReservation {
  const GwReservation({required this.resSeq, required this.resName, required this.start, required this.end, required this.title, required this.display, required this.owner, required this.ownerEmpSeq, required this.attendees, required this.allDay});
  final String resSeq, resName, start, end, title, display, owner, ownerEmpSeq, attendees;
  final bool allDay;
  factory GwReservation.fromRow(Map r) {
    final owner = asStr(r['empName']), name = asStr(r['resName']);
    final disp = asStr(r['resTitleDisplay']);
    return GwReservation(resSeq: asStr(r['resSeq']), resName: name, start: asStr(r['resStartDate']), end: asStr(r['resEndDate']), title: asStr(r['reqText']), display: disp.isEmpty ? '[$owner] $name' : disp,
        owner: owner, ownerEmpSeq: asStr(r['empSeq']), attendees: asStr(r['resUserName']), allDay: asBool(r['alldayYn']));
  }
}
```

`gw_api.dart`의 `GwApi`에 추가(필드 + 메서드):

```dart
  // ── 일정·회의실 ──
  List<GwCalendar>? _cals; DateTime? _calsAt;
  List<GwResource>? _res; DateTime? _resAt;
  static const _calTtl = Duration(minutes: 10), _resTtl = Duration(minutes: 30);
  List<Map> _list(dynamic d) => ((d is Map ? d['resultList'] : null) as List? ?? const []).whereType<Map>().toList();

  Future<List<GwCalendar>> calendars() async {
    if (_cals != null && _calsAt != null && _now().difference(_calsAt!) < _calTtl) return _cals!;
    final d = await client.call('/schres/sc111A02', {'companyInfo': await client.companyInfo(), 'calType': '', 'langCode': 'kr'});
    _cals = [for (final r in _list(d)) GwCalendar.fromRow(r)];
    _calsAt = _now();
    return _cals!;
  }

  /// 하루치 일정(전체 캘린더). "내 것"만 보려면 myEvents(…).
  Future<List<GwEvent>> events(DateTime day) async {
    final cals = await calendars();
    final d = await client.call('/schres/sc111A03', {
      'companyInfo': await client.companyInfo(), 'startDate': ymd(day), 'endDate': ymd(day), 'mySchYn': 'N', 'calList': calListFor(cals), 'tcalList': [], 'acalList': [], 'searchEmpSeq': '', 'sortDate': 'Y', 'langCode': 'kr',
    });
    return [for (final r in _list(d)) GwEvent.fromRow(r)]..sort((a, b) => a.start.compareTo(b.start));
  }

  Future<List<GwResource>> resources() async {
    if (_res != null && _resAt != null && _now().difference(_resAt!) < _resTtl) return _res!;
    final d = await client.call('/schres/rs121A01', {'companyInfo': await client.companyInfo(), 'searchText': '', 'attrUseYn': '', 'attrList': ['1', '3', 'ETC'], 'propList': [], 'langCode': 'kr'});
    _res = [for (final r in _list(d)) GwResource.fromRow(r)];
    _resAt = _now();
    return _res!;
  }

  /// 하루치 예약(전 회의실). 내 것은 ownerEmpSeq == creds.empSeq로 거른다.
  Future<List<GwReservation>> reservations(DateTime day) async {
    final rooms = await resources();
    final d = await client.call('/schres/rs121A05', {
      'companyInfo': await client.companyInfo(), 'startDate': ymd(day), 'endDate': ymd(day), 'statusType': ['10', '20'], 'resList': [for (final r in rooms) {'resSeq': r.resSeq}],
      'statusCode': '', 'searchType': '', 'sechType': '', 'menuAuth': 'USER', 'langCode': 'kr',
    });
    return [for (final r in _list(d)) GwReservation.fromRow(r)]..sort((a, b) => a.start.compareTo(b.start));
  }
```

- [ ] **Step 4: 통과 확인** — Run: `cd mobile && flutter test test/gw/` → Expected: 모두 통과.

- [ ] **Step 5: 커밋** — `git add mobile/lib/gw mobile/test/gw && git commit -m "feat(mobile): 아마란스 일정(캘린더 캐시·내 일정 필터)·회의실 예약 API"`

---

### Task 6: 메일 — 집계·받은메일 목록

**Files:**
- Modify: `mobile/lib/gw/gw_models.dart`, `mobile/lib/gw/gw_api.dart`
- Test: `mobile/test/gw/gw_models_test.dart`, `mobile/test/gw/gw_api_test.dart`

**Interfaces:**
- Produces:
  - `class MailSummary { unread, toMe, total; static MailSummary fromCounts(List counts) }` — 배열 **마지막** 항목의 `unreadCount/toMeCount/totalCount`, 빈 배열이면 전부 0
  - `int? findMboxSeq(Object? node, String name)` — 중첩 트리에서 `fullname`/`name`(대소문자 무시)이 일치하는 노드의 `mboxSeq`(숫자/문자열)
  - `class MailItem { muid, subject, fromName, fromEmail, date, tooltip, seen, attach; factory fromRow(Map) }`
  - `GwApi`: `Future<MailSummary> mailSummary()`, `Future<(int unseen, List<MailItem>)> inbox({int pageSize = 20})`

- [ ] **Step 1: 실패하는 테스트** — `gw_models_test.dart`에 추가:

```dart
  test('메일 집계: 마지막 항목이 계정 전체, 빈 배열이면 0', () {
    final s = MailSummary.fromCounts([{'boxnameSeq': 1, 'count': 2, 'totalCount': 5}, {'unreadCount': '3', 'toMeCount': 1, 'totalCount': 40, 'flaggedCount': 0}]);
    expect((s.unread, s.toMe, s.total), (3, 1, 40));
    expect(MailSummary.fromCounts(const []).unread, 0);
  });
  test('INBOX mboxSeq 탐색: 중첩·대소문자·숫자/문자열', () {
    final tree = {'resultList': [{'name': 'Sent', 'mboxSeq': '2'}, {'children': [{'fullname': 'inbox', 'mboxSeq': 26986}]}]};
    expect(findMboxSeq(tree, 'INBOX'), 26986);
    expect(findMboxSeq(tree, 'SENT'), 2);
    expect(findMboxSeq(tree, 'DRAFTS'), isNull);
  });
  test('메일 항목: seen 0/1 → bool, attach bool', () {
    final m = MailItem.fromRow({'muid': 14531056, 'subject': 's', 'fromAddrName': '홍', 'fromAddrEmail': 'h@x', 'rfc822date': '07:10', 'tooltipDate': '2026-10-04 07:10', 'seen': 0, 'attach': true});
    expect((m.muid, m.seen, m.attach, m.fromName, m.date), ('14531056', false, true, '홍', '07:10'));
    expect(MailItem.fromRow({'seen': '1'}).seen, true);
  });
```

`gw_api_test.dart`에 추가:

```dart
  test('mailSummary: mail000A03 body {}', () async {
    final f = Fake({'/mail/mail000A03': [[{'boxnameSeq': 1, 'count': 1, 'totalCount': 2}, {'unreadCount': 4, 'toMeCount': 2, 'totalCount': 9}]]});
    final s = await f.api().mailSummary();
    expect((s.unread, s.toMe), (4, 2));
    expect(f.calls.last.$2, isEmpty);
  });
  test('inbox: mail000A01에서 INBOX seq를 찾아 mail003A01(mainApiCode 필수)', () async {
    final f = Fake({'/mail/mail000A01': [{'list': [{'fullname': 'INBOX', 'mboxSeq': '777'}]}], '/mail/mail003A01': [{'Records': [{'muid': 1, 'subject': 'a', 'seen': 0}], 'TotalRecordCount': 10, 'TotalUnseenCount': 3}]});
    final (unseen, items) = await f.api().inbox(pageSize: 5);
    expect((unseen, items.single.subject), (3, 'a'));
    final body = f.calls.last.$2;
    expect((body['mainApiCode'], body['mboxSeq'], body['pageSize'], body['sort'], body['sortType'], body['seen']), ('mail003A01', 777, 5, 'rfc822date', 'desc', false));
  });
  test('inbox: INBOX를 못 찾으면 GwException', () async {
    final f = Fake({'/mail/mail000A01': [{'list': []}]});
    await expectLater(f.api().inbox(), throwsA(isA<GwException>()));
  });
```

- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/gw/` → Expected: 컴파일 실패.

- [ ] **Step 3: 구현** — `gw_models.dart`에 추가:

```dart
/// mail000A03 배열의 마지막 항목 = 계정 전체 집계. 없으면 0.
class MailSummary {
  const MailSummary({required this.unread, required this.toMe, required this.total});
  final int unread, toMe, total;
  static MailSummary fromCounts(List counts) {
    final last = counts.isEmpty ? null : counts.last;
    if (last is! Map) return const MailSummary(unread: 0, toMe: 0, total: 0);
    return MailSummary(unread: asInt(last['unreadCount']), toMe: asInt(last['toMeCount']), total: asInt(last['totalCount']));
  }
}

/// mail000A01 트리에서 이름(fullname/name, 대소문자 무시)이 맞는 메일함의 mboxSeq. 계정마다 값이 달라 상수 금지.
int? findMboxSeq(Object? node, String name) {
  if (node is Map) {
    if (node.containsKey('mboxSeq') && [node['fullname'], node['name']].any((v) => asStr(v).toLowerCase() == name.toLowerCase())) {
      return int.tryParse(asStr(node['mboxSeq']));
    }
    for (final v in node.values) {
      final r = findMboxSeq(v, name);
      if (r != null) return r;
    }
  } else if (node is List) {
    for (final v in node) {
      final r = findMboxSeq(v, name);
      if (r != null) return r;
    }
  }
  return null;
}

/// mail003A01 Records[] 항목. 본문은 열지 않는다(읽음 처리 부작용).
class MailItem {
  const MailItem({required this.muid, required this.subject, required this.fromName, required this.fromEmail, required this.date, required this.tooltip, required this.seen, required this.attach});
  final String muid, subject, fromName, fromEmail, date, tooltip;
  final bool seen, attach;
  factory MailItem.fromRow(Map r) => MailItem(
        muid: asStr(r['muid']), subject: asStr(r['subject']), fromName: asStr(r['fromAddrName']), fromEmail: asStr(r['fromAddrEmail']), date: asStr(r['rfc822date']), tooltip: asStr(r['tooltipDate']),
        seen: asBool(r['seen']), attach: asBool(r['attach']));
}
```

`gw_api.dart`의 `GwApi`에 추가:

```dart
  // ── 메일 ──
  Future<MailSummary> mailSummary() async {
    final d = await client.call('/mail/mail000A03', const <String, Object>{});
    return MailSummary.fromCounts(d is List ? d : const []);
  }

  int? _inboxSeq;
  /// 받은메일함 최근 N통. INBOX seq는 계정마다 달라 mail000A01에서 이름으로 찾는다(세션 동안 캐시).
  Future<(int, List<MailItem>)> inbox({int pageSize = 20}) async {
    _inboxSeq ??= findMboxSeq(await client.call('/mail/mail000A01', const <String, Object>{}), 'INBOX');
    final seq = _inboxSeq;
    if (seq == null) throw GwException(200, 0, '받은메일함을 찾지 못했습니다');
    final d = await client.call('/mail/mail003A01', {'boxName': 'INBOX', 'mainApiCode': 'mail003A01', 'mboxSeq': seq, 'page': 1, 'pageSize': pageSize, 'sort': 'rfc822date', 'sortType': 'desc', 'listType': '', 'showType': '', 'seen': false});
    final recs = (d is Map ? d['Records'] : null) as List? ?? const [];
    return (asInt(d is Map ? d['TotalUnseenCount'] : null), [for (final r in recs) if (r is Map) MailItem.fromRow(r)]);
  }
```

- [ ] **Step 4: 통과 확인** — Run: `cd mobile && flutter test test/gw/` → Expected: 모두 통과.

- [ ] **Step 5: 커밋** — `git add mobile/lib/gw mobile/test/gw && git commit -m "feat(mobile): 아마란스 메일 집계·받은메일 목록 API(INBOX seq 탐색)"`

---

### Task 7: 연결 화면(`gw_connect_screen.dart`) + `GwGate` + 라우트 + 더보기 연결 행

**Files:**
- Create: `mobile/lib/gw/gw_connect_screen.dart`, `mobile/lib/gw/gw_gate.dart`
- Modify: `mobile/lib/app/router.dart`(라우트 `/gw/connect`), `mobile/lib/more/more_screen.dart`(계정 카드에 아마란스 행)
- Test: `mobile/test/gw/gw_connect_test.dart`, `mobile/test/gw/fakes.dart`

**Interfaces:**
- Consumes: `parseGwCookies`, `GwClient.session()`, `gwProvider.connect/disconnect`, `gwHttpClientProvider`.
- Produces:
  - `Future<GwCreds> verifyGwCookies(String cookieString, http.Client http)` — 파싱 → `GwClient(...).session()` → 이름·이메일을 채운 `GwCreds`. 파싱 실패면 `GwException(0, 0, '로그인 쿠키를 찾지 못했습니다')`.
  - `class GwConnectScreen extends ConsumerStatefulWidget { const GwConnectScreen({super.key, this.webView}); final Widget Function(WebViewController c)? webView; }` — 테스트에서 WebView 자리에 다른 위젯을 끼운다.
  - `class GwGate extends ConsumerWidget { const GwGate({required this.title, required this.builder}); final String title; final Widget Function(BuildContext, GwApi api) builder; }` — 상태별 안내(미연결 → [연결하기] push `/gw/connect`, 재연결 필요 → [다시 연결], 로딩 → 진행 표시).
  - 테스트 헬퍼 `test/gw/fakes.dart`: `class FakeGwStore extends GwCredsStore`(메모리), `ProviderScope gwScope({GwCreds? creds, required MockClient http, required Widget child})`.

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/gw/fakes.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/testing.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';

class FakeGwStore extends GwCredsStore {
  FakeGwStore([this.creds]);
  GwCreds? creds;
  @override
  Future<GwCreds?> load() async => creds;
  @override
  Future<void> save(GwCreds c) async => creds = c;
  @override
  Future<void> clear() async => creds = null;
}

const testCreds = GwCreds(authToken: 'g|7|s', signKey: 'k', empName: '홍길동', email: 'hong@innogrid.com');

Widget gwScope({GwCreds? creds, required MockClient http, required Widget child, List<Override> extra = const []}) => ProviderScope(
      overrides: [gwStoreProvider.overrideWithValue(FakeGwStore(creds)), gwHttpClientProvider.overrideWithValue(http), ...extra],
      child: MaterialApp(home: child),
    );
```

```dart
// mobile/test/gw/gw_connect_test.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_api.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_connect_screen.dart';
import 'package:playground/gw/gw_gate.dart';
import 'fakes.dart';

http.Response ok(Object data) => http.Response(jsonEncode({'resultCode': 0, 'resultData': data}), 200);
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E', 'erpDeptSeq': 'D', 'erpCompSeq': 'C'}}};

void main() {
  test('verifyGwCookies: 쿠키 → gw050A02 검증 → 이름·이메일을 채운 크레덴셜', () async {
    final c = await verifyGwCookies('oAuthToken=g%7C7%7Cs; signKey=k', MockClient((_) async => ok(session)));
    expect((c.authToken, c.empName, c.email), ('g|7|s', '홍길동', 'hong@innogrid.com'));
    await expectLater(verifyGwCookies('nothing=1', MockClient((_) async => ok(session))), throwsA(isA<GwException>()));
    await expectLater(verifyGwCookies('oAuthToken=a; signKey=b', MockClient((_) async => http.Response('{}', 401))), throwsA(isA<GwUnauthorized>()));
  });
  testWidgets('연결 화면: WebView 자리 주입, 안내 문구', (tester) async {
    await tester.pumpWidget(gwScope(http: MockClient((_) async => ok(session)), child: GwConnectScreen(webView: (_) => const Text('WEBVIEW'))));
    await tester.pump();
    expect(find.text('WEBVIEW'), findsOneWidget);
    expect(find.textContaining('아마란스에 로그인'), findsOneWidget);
  });
  testWidgets('GwGate: 미연결이면 연결 안내, 연결되면 builder', (tester) async {
    await tester.pumpWidget(gwScope(http: MockClient((_) async => ok(session)), child: GwGate(title: '미결 결재', builder: (_, api) => const Text('BODY'))));
    await tester.pumpAndSettle();
    expect(find.text('아마란스 연결하기'), findsOneWidget);
    expect(find.text('BODY'), findsNothing);
    await tester.pumpWidget(gwScope(creds: testCreds, http: MockClient((_) async => ok(session)), child: GwGate(title: '미결 결재', builder: (_, GwApi api) => const Text('BODY'))));
    await tester.pumpAndSettle();
    expect(find.text('BODY'), findsOneWidget);
  });
}
```

- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/gw/gw_connect_test.dart` → Expected: 컴파일 실패.

- [ ] **Step 3: 구현 — GwGate**

```dart
// mobile/lib/gw/gw_gate.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_creds.dart';

/// 아마란스 화면의 공통 입구: 미연결·재연결 필요·로딩이면 안내를, 연결돼 있으면 [builder]를 그린다.
class GwGate extends ConsumerWidget {
  const GwGate({super.key, required this.title, required this.builder});
  final String title;
  final Widget Function(BuildContext context, GwApi api) builder;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final st = ref.watch(gwProvider);
    final api = ref.watch(gwApiProvider);
    final state = st.value;
    if (state == null) return Scaffold(appBar: BrandHeader(title: title), body: const Center(child: CircularProgressIndicator()));
    if (state.status == GwStatus.connected && api != null) return builder(context, api);
    final relogin = state.status == GwStatus.needsRelogin;
    return Scaffold(
      appBar: BrandHeader(title: title),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(28),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            TintIcon(relogin ? Icons.lock_reset : Icons.apartment_outlined, size: 56),
            const SizedBox(height: 16),
            Text(relogin ? '아마란스 로그인이 만료되었습니다' : '아마란스를 연결하면 여기서 바로 봅니다', style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
            const SizedBox(height: 6),
            Text(relogin ? '다시 로그인하면 이어서 쓸 수 있습니다.' : '미결 결재 · 출퇴근 · 오늘 일정과 회의실 · 메일 미읽음. 토큰은 이 기기에만 저장됩니다.', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Brand.muted), textAlign: TextAlign.center),
            const SizedBox(height: 20),
            FilledButton.icon(onPressed: () => context.push('/gw/connect'), icon: const Icon(Icons.login, size: 18), label: Text(relogin ? '다시 연결' : '아마란스 연결하기')),
          ]),
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: 구현 — 연결 화면**

```dart
// mobile/lib/gw/gw_connect_screen.dart
import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:webview_flutter/webview_flutter.dart';
import '../app/theme.dart';
import 'gw_client.dart';
import 'gw_creds.dart';

const gwOrigin = 'https://gw.innogrid.com';

/// document.cookie → 크레덴셜 → gw050A02 검증(이름·이메일 확보). 토큰 값은 예외 메시지에 넣지 않는다.
Future<GwCreds> verifyGwCookies(String cookieString, http.Client httpClient) async {
  final c = parseGwCookies(cookieString);
  if (c == null) throw GwException(0, 0, '로그인 쿠키를 찾지 못했습니다');
  final s = await GwClient(httpClient: httpClient, creds: () => c).session();
  return c.copyWith(empName: s.empName, email: s.email);
}

/// WebView로 gw.innogrid.com에 로그인시키고, 페이지가 뜰 때마다 쿠키를 읽어 크레덴셜이 보이면 검증·저장한다.
class GwConnectScreen extends ConsumerStatefulWidget {
  const GwConnectScreen({super.key, this.webView});
  /// 테스트용: WebView 자리에 끼울 위젯.
  final Widget Function(WebViewController c)? webView;
  @override
  ConsumerState<GwConnectScreen> createState() => _GwConnectScreenState();
}

class _GwConnectScreenState extends ConsumerState<GwConnectScreen> {
  late final WebViewController _c;
  Timer? _hintTimer;
  bool _busy = false, _hint = false;
  String? _error, _done;

  @override
  void initState() {
    super.initState();
    _c = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setNavigationDelegate(NavigationDelegate(onPageFinished: (_) => _check()));
    if (widget.webView == null) _c.loadRequest(Uri.parse('$gwOrigin/'));
    _hintTimer = Timer(const Duration(seconds: 60), () { if (mounted) setState(() => _hint = true); });
  }

  @override
  void dispose() {
    _hintTimer?.cancel();
    super.dispose();
  }

  Future<void> _check() async {
    if (_busy || _done != null) return;
    String raw;
    try {
      raw = (await _c.runJavaScriptReturningResult('document.cookie')).toString();
    } catch (_) {
      return;
    }
    if (parseGwCookies(raw) == null) return;
    setState(() { _busy = true; _error = null; });
    try {
      final creds = await verifyGwCookies(raw, ref.read(gwHttpClientProvider));
      await ref.read(gwProvider.notifier).connect(creds);
      if (mounted) setState(() => _done = '${creds.empName ?? ''} (${creds.email ?? ''}) 연결됨');
    } on GwException catch (e) {
      if (mounted) setState(() => _error = '로그인을 확인하지 못했습니다: ${e.message}');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _clearCookies() async {
    await WebViewCookieManager().clearCookies();
    await _c.loadRequest(Uri.parse('$gwOrigin/'));
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      appBar: AppBar(title: const Text('아마란스 연결'), actions: [TextButton(onPressed: _clearCookies, child: const Text('쿠키 지우고 로그인'))]),
      body: Column(children: [
        Container(
          width: double.infinity,
          color: Brand.blueTint,
          padding: const EdgeInsets.fromLTRB(16, 10, 16, 10),
          child: Text(
            _done ?? _error ?? (_busy ? '로그인을 확인하는 중…' : '평소처럼 아마란스에 로그인하세요. 로그인되면 자동으로 연결됩니다.${_hint ? '\n로그인했는데도 연결되지 않으면 오른쪽 위 "쿠키 지우고 로그인"을 눌러 다시 시도하세요.' : ''}'),
            style: theme.textTheme.bodySmall?.copyWith(color: _error != null ? Brand.dangerText : Brand.navy),
          ),
        ),
        if (_done != null)
          Padding(padding: const EdgeInsets.all(16), child: FilledButton(onPressed: () => Navigator.of(context).pop(true), child: const Text('완료')))
        else
          Expanded(child: widget.webView?.call(_c) ?? WebViewWidget(controller: _c)),
      ]),
    );
  }
}
```

- [ ] **Step 5: 라우트와 더보기 행**

`router.dart` routes에(`/web` 다음) 추가:
```dart
    GoRoute(path: '/gw/connect', builder: (c, s) => const GwConnectScreen()),
```
(import `'../gw/gw_connect_screen.dart'`)

`more_screen.dart` 계정 카드 — "설정" ListTile 위에 아마란스 행을 넣는다. `MoreScreen.build` 안에서 `final gw = ref.watch(gwProvider).value;` 뒤:
```dart
                _GwRow(gw: gw, onConnect: () => context.push('/gw/connect'), onDisconnect: () => ref.read(gwProvider.notifier).disconnect()),
                const Divider(),
```
그리고 파일 끝에:
```dart
class _GwRow extends StatelessWidget {
  const _GwRow({required this.gw, required this.onConnect, required this.onDisconnect});
  final GwState? gw;
  final VoidCallback onConnect, onDisconnect;
  @override
  Widget build(BuildContext context) {
    final status = gw?.status ?? GwStatus.none;
    final c = gw?.creds;
    return ListTile(
      leading: const Icon(Icons.apartment_outlined),
      title: const Text('아마란스'),
      subtitle: Text(switch (status) {
        GwStatus.none => '연결하면 미결 결재·출퇴근·일정·메일을 앱에서 봅니다',
        GwStatus.connected => '${c?.empName ?? ''} · ${c?.email ?? ''}',
        GwStatus.needsRelogin => '로그인이 만료되었습니다 — 다시 연결하세요',
      }),
      trailing: status == GwStatus.none
          ? TextButton(onPressed: onConnect, child: const Text('연결하기'))
          : Row(mainAxisSize: MainAxisSize.min, children: [
              TextButton(onPressed: onConnect, child: Text(status == GwStatus.needsRelogin ? '다시 연결' : '재연결')),
              IconButton(icon: const Icon(Icons.link_off, size: 20), tooltip: '연결 해제', onPressed: onDisconnect),
            ]),
    );
  }
}
```
(import `'../gw/gw_creds.dart'`)

- [ ] **Step 6: 통과 확인** — Run: `cd mobile && flutter test test/gw/ && flutter analyze` → Expected: 모두 통과, 0 issues.

- [ ] **Step 7: 커밋** — `git add mobile/lib/gw mobile/lib/app/router.dart mobile/lib/more/more_screen.dart mobile/test/gw && git commit -m "feat(mobile): 아마란스 연결 화면(WebView 쿠키 → 검증 → 저장)·GwGate·더보기 연결 상태"`

---

### Task 8: 미결 결재 화면 + 출퇴근 화면

**Files:**
- Create: `mobile/lib/gw/approvals_screen.dart`, `mobile/lib/gw/attendance_screen.dart`
- Modify: `mobile/lib/app/router.dart`(`/gw/approvals`, `/gw/attendance`)
- Test: `mobile/test/gw/screens_test.dart`

**Interfaces:**
- Consumes: `GwGate`, `GwApi.pendingApprovals/approvalDetail/attendanceToday/punch`, `hm`, `BrandHeader`, `InitialBadge`, `PrimaryCta`.
- Produces: `class ApprovalsScreen extends StatelessWidget`, `class AttendanceScreen extends StatelessWidget`(둘 다 `GwGate`로 감싸고 내부 상태 위젯을 둔다).

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/gw/screens_test.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/approvals_screen.dart';
import 'package:playground/gw/attendance_screen.dart';
import 'fakes.dart';

http.Response ok(Object? data) => http.Response(jsonEncode({'resultCode': 0, 'resultData': data}), 200);
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E', 'erpDeptSeq': 'D', 'erpCompSeq': 'C'}}};

/// 경로 → 응답(순서 소비) + 호출 수.
class Routes {
  Routes(this.m);
  final Map<String, List<Object?>> m;
  final hits = <String, int>{};
  MockClient get client => MockClient((r) async {
        hits[r.url.path] = (hits[r.url.path] ?? 0) + 1;
        final q = m[r.url.path];
        if (q == null || q.isEmpty) return http.Response('{"resultCode":999,"resultMsg":"unexpected ${r.url.path}"}', 200);
        return ok(q.length == 1 ? q.first : q.removeAt(0));
      });
}

void main() {
  testWidgets('미결 결재: 목록을 그리고 항목을 누르면 상세 시트(열람 처리 없음)', (tester) async {
    final r = Routes({'/gw/gw050A02': [session], '/eap/eap105A04': [{'map': {'totalCount': 1, 'list': [{'DOC_ID': 'D1', 'FORM_ID': '7', 'DOC_TITLE': '휴가 신청', 'FORM_NM': '휴가', 'USER_NM': '김민준', 'DEPT_NM': '팀', 'ARRIVED_DT': '20261001', 'READYN': 'N'}]}}], '/eap/eap111A04': [{'docTitle': '휴가 신청', 'contentsWord': '10월 10일 연차', 'empName': '김민준', 'lineName': '홍길동'}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const ApprovalsScreen()));
    await tester.pumpAndSettle();
    expect(find.text('휴가 신청'), findsOneWidget);
    expect(find.textContaining('김민준'), findsWidgets);
    await tester.tap(find.text('휴가 신청'));
    await tester.pumpAndSettle();
    expect(find.text('10월 10일 연차'), findsOneWidget);
    expect(find.textContaining('승인·반려는 아마란스에서'), findsOneWidget);
    expect(r.hits['/eap/eap111A04'], 1);
  });
  testWidgets('출퇴근: 출근 버튼 → 확인 다이얼로그에서 취소하면 기록 호출 없음, 확인하면 기록 후 시각 표시', (tester) async {
    const base = '/human/common/judgeTimeManagement';
    final r = Routes({'/gw/gw050A02': [session], '$base/getTodayComeLeaveInfo': [{'comeTm': '', 'leaveTm': ''}, {'comeTm': '', 'leaveTm': ''}, {'comeTm': '202610040902', 'leaveTm': ''}, {'comeTm': '202610040902', 'leaveTm': ''}], '$base/confirmApplicationStatus': [{}], '$base/getJudgeTimeManagement': [{}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const AttendanceScreen()));
    await tester.pumpAndSettle();
    expect(find.text('출근 기록'), findsOneWidget);
    await tester.tap(find.text('출근 기록'));
    await tester.pumpAndSettle();
    expect(find.textContaining('실제 근태에 반영'), findsOneWidget);
    await tester.tap(find.text('취소'));
    await tester.pumpAndSettle();
    expect(r.hits['$base/getJudgeTimeManagement'], isNull);
    await tester.tap(find.text('출근 기록'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('기록'));
    await tester.pumpAndSettle();
    expect(r.hits['$base/getJudgeTimeManagement'], 1);
    expect(find.text('09:02'), findsWidgets);
    expect(find.textContaining('기록됨'), findsOneWidget);
  });
}
```

- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/gw/screens_test.dart` → Expected: 컴파일 실패.

- [ ] **Step 3: 구현 — 미결 결재**

```dart
// mobile/lib/gw/approvals_screen.dart
import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';

class ApprovalsScreen extends StatelessWidget {
  const ApprovalsScreen({super.key});
  @override
  Widget build(BuildContext context) => GwGate(title: '미결 결재', builder: (_, api) => _Body(api));
}

class _Body extends StatefulWidget {
  const _Body(this.api);
  final GwApi api;
  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  late Future<(int, List<PendingApproval>)> _future = widget.api.pendingApprovals();
  Future<void> _refresh() async {
    setState(() => _future = widget.api.pendingApprovals());
    await _future.catchError((_) => (0, <PendingApproval>[]));
  }

  Future<void> _open(PendingApproval p) async {
    final detail = widget.api.approvalDetail(p.docId, p.formId);
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      builder: (_) => DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.7,
        builder: (_, ctl) => FutureBuilder(
          future: detail,
          builder: (context, snap) {
            if (snap.hasError) return Padding(padding: const EdgeInsets.all(24), child: Text('불러오지 못했습니다: ${snap.error}'));
            final d = snap.data;
            if (d == null) return const Center(child: CircularProgressIndicator());
            final theme = Theme.of(context);
            return ListView(controller: ctl, padding: const EdgeInsets.fromLTRB(20, 8, 20, 32), children: [
              Text(d.title, style: theme.textTheme.headlineSmall),
              const SizedBox(height: 6),
              Text([d.form, d.status, if (d.repDt.isNotEmpty) d.repDt].where((s) => s.isNotEmpty).join(' · '), style: theme.textTheme.bodySmall),
              const SizedBox(height: 4),
              Text('기안 ${d.drafter}${d.dept.isEmpty ? '' : ' (${d.dept})'}${d.currentApprover.isEmpty ? '' : ' · 현재 결재자 ${d.currentApprover}'}${d.attachCount > 0 ? ' · 첨부 ${d.attachCount}' : ''}', style: theme.textTheme.bodySmall),
              const Divider(height: 24),
              Text(d.content.isEmpty ? '(본문 없음)' : d.content, style: const TextStyle(fontSize: 15, height: 1.6, color: Brand.navy)),
              const SizedBox(height: 20),
              Container(padding: const EdgeInsets.all(12), decoration: BoxDecoration(color: Brand.blueTint, borderRadius: BorderRadius.circular(12)), child: Text('승인·반려는 아마란스에서 처리하세요. 여기서는 열람 처리도 하지 않습니다.', style: theme.textTheme.bodySmall?.copyWith(color: Brand.navy))),
            ]);
          },
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    return Scaffold(
      appBar: const BrandHeader(title: '미결 결재'),
      body: RefreshIndicator(
        onRefresh: _refresh,
        child: FutureBuilder(
          future: _future,
          builder: (context, snap) {
            if (snap.hasError) return ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Column(children: [Text('${snap.error}', style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 12), FilledButton(onPressed: _refresh, child: const Text('다시 시도'))]))]);
            if (!snap.hasData) return const Center(child: CircularProgressIndicator());
            final (total, docs) = snap.data!;
            if (docs.isEmpty) return ListView(children: const [Padding(padding: EdgeInsets.all(40), child: Center(child: Text('미결 문서가 없습니다', style: TextStyle(color: Brand.muted))))]);
            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(20, 4, 20, 24),
              itemCount: docs.length + 1,
              separatorBuilder: (_, _) => const SizedBox(height: 8),
              itemBuilder: (context, i) {
                if (i == 0) return Padding(padding: const EdgeInsets.only(left: 4, bottom: 4), child: CountTitle('미결', total));
                final p = docs[i - 1];
                final days = p.waitingDays(today);
                return Card(
                  child: ListTile(
                    onTap: () => _open(p),
                    leading: InitialBadge(p.drafter, size: 40),
                    title: Row(children: [
                      if (p.unread) const Padding(padding: EdgeInsets.only(right: 6), child: CircleAvatar(radius: 4, backgroundColor: Brand.blue)),
                      Expanded(child: Text(p.title, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: p.unread ? FontWeight.w800 : FontWeight.w600))),
                    ]),
                    subtitle: Text('${p.form} · ${p.drafter}${p.dept.isEmpty ? '' : ' (${p.dept})'}${days == null ? '' : ' · ${days == 0 ? '오늘' : '$days일째'}'}', maxLines: 1, overflow: TextOverflow.ellipsis),
                    trailing: const Icon(Icons.chevron_right, color: Brand.faint),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
```

- [ ] **Step 4: 구현 — 출퇴근**

```dart
// mobile/lib/gw/attendance_screen.dart
import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';

class AttendanceScreen extends StatelessWidget {
  const AttendanceScreen({super.key});
  @override
  Widget build(BuildContext context) => GwGate(title: '출퇴근', builder: (_, api) => _Body(api));
}

class _Body extends StatefulWidget {
  const _Body(this.api);
  final GwApi api;
  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  Attendance? _a;
  String? _error, _note;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final a = await widget.api.attendanceToday();
      if (mounted) setState(() { _a = a; _error = null; });
    } catch (e) {
      if (mounted) setState(() => _error = '$e');
    }
  }

  Future<void> _punch(bool clockIn) async {
    final kind = clockIn ? '출근' : '퇴근';
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('지금 $kind을 기록할까요?'),
        content: const Text('실제 근태에 반영되며 되돌릴 수 없습니다.'),
        actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('취소')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('기록'))],
      ),
    );
    if (ok != true) return;
    setState(() { _busy = true; _note = null; });
    try {
      final r = await widget.api.punch(clockIn: clockIn);
      if (mounted) setState(() { _note = r.note; _a = Attendance(workDt: _a?.workDt ?? '', comeTm: r.comeTm, leaveTm: r.leaveTm, holiday: _a?.holiday ?? false); });
    } catch (e) {
      if (mounted) setState(() => _note = '기록하지 못했습니다: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final a = _a;
    return Scaffold(
      appBar: const BrandHeader(title: '출퇴근'),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 24), children: [
          if (_error != null) Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(children: [Text(_error!, style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 8), FilledButton(onPressed: _load, child: const Text('다시 시도'))])))
          else if (a == null) const Padding(padding: EdgeInsets.all(40), child: Center(child: CircularProgressIndicator()))
          else ...[
            Container(
              padding: const EdgeInsets.all(18),
              decoration: BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.circular(16)),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${a.workDt.substring(0, 4)}.${a.workDt.substring(4, 6)}.${a.workDt.substring(6, 8)}${a.holiday ? ' · 휴일' : ''}', style: TextStyle(fontSize: 13, color: Colors.white.withValues(alpha: 0.7))),
                const SizedBox(height: 12),
                Row(children: [
                  Expanded(child: _Time('출근', a.clockedIn ? hm(a.comeTm) : '—')),
                  Expanded(child: _Time('퇴근', a.clockedOut ? hm(a.leaveTm) : '—')),
                ]),
              ]),
            ),
            const SizedBox(height: 16),
            PrimaryCta(label: a.clockedIn ? '출근 ${hm(a.comeTm)} 기록됨' : '출근 기록', icon: Icons.login, onPressed: a.clockedIn || _busy ? null : () => _punch(true)),
            const SizedBox(height: 10),
            PrimaryCta(label: a.clockedOut ? '퇴근 ${hm(a.leaveTm)} 기록됨' : '퇴근 기록', icon: Icons.logout, onPressed: a.clockedOut || _busy ? null : () => _punch(false)),
            if (_note != null) Padding(padding: const EdgeInsets.only(top: 14), child: Text(_note!, style: theme.textTheme.bodySmall?.copyWith(color: Brand.navy), textAlign: TextAlign.center)),
            const SizedBox(height: 16),
            Text('기록은 아마란스 근태에 그대로 반영됩니다. 이미 기록이 있으면 다시 찍지 않습니다.', style: theme.textTheme.bodySmall, textAlign: TextAlign.center),
          ],
        ]),
      ),
    );
  }
}

class _Time extends StatelessWidget {
  const _Time(this.label, this.value);
  final String label, value;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(label, style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w700, color: Brand.sky)),
        const SizedBox(height: 4),
        Text(value, style: const TextStyle(fontSize: 28, fontWeight: FontWeight.w800, color: Colors.white)),
      ]);
}
```

`router.dart`에 라우트 추가: `GoRoute(path: '/gw/approvals', builder: (c, s) => const ApprovalsScreen())`, `GoRoute(path: '/gw/attendance', builder: (c, s) => const AttendanceScreen())`.

- [ ] **Step 5: 통과 확인** — Run: `cd mobile && flutter test test/gw/screens_test.dart && flutter analyze` → Expected: 2 passed, 0 issues.

- [ ] **Step 6: 커밋** — `git add mobile/lib/gw mobile/lib/app/router.dart mobile/test/gw && git commit -m "feat(mobile): 아마란스 미결 결재 화면(목록·상세 시트)·출퇴근 화면(확인 다이얼로그·기록)"`

---

### Task 9: 오늘(일정+회의실) 화면 + 메일 화면

**Files:**
- Create: `mobile/lib/gw/today_screen.dart`, `mobile/lib/gw/mail_screen.dart`
- Modify: `mobile/lib/app/router.dart`(`/gw/today`, `/gw/mail`)
- Test: `mobile/test/gw/screens_test.dart`(추가)

**Interfaces:**
- Consumes: `GwApi.events/calendars/reservations/mailSummary/inbox`, `myEvents`, `hm`, `GwGate`.
- Produces: `class TodayScreen extends StatelessWidget`, `class MailScreen extends StatelessWidget`.

- [ ] **Step 1: 실패하는 테스트** — `screens_test.dart`에 추가(import `today_screen.dart`, `mail_screen.dart`):

```dart
  testWidgets('오늘: 기본은 내 일정·내 예약, "전체" 토글로 남의 것도', (tester) async {
    final r = Routes({'/gw/gw050A02': [session],
      '/schres/sc111A02': [{'resultList': [{'mcalSeq': '1', 'calType': 'E', 'empSeq': '7'}, {'mcalSeq': '2', 'calType': 'M', 'empSeq': '9'}]}],
      '/schres/sc111A03': [{'resultList': [{'schSeq': 'a', 'schTitle': '내 회의', 'startDate': '202610041000', 'endDate': '202610041100', 'delYn': 'Y', 'mcalSeq': '2'}, {'schSeq': 'c', 'schTitle': '남의 회의', 'startDate': '202610041200', 'endDate': '202610041300', 'delYn': 'N', 'mcalSeq': '2'}]}],
      '/schres/rs121A01': [{'resultList': [{'resSeq': '45', 'resName': 'A-1'}]}],
      '/schres/rs121A05': [{'resultList': [{'resSeq': '45', 'resName': 'A-1', 'resStartDate': '202610041400', 'resEndDate': '202610041500', 'reqText': '내 예약', 'empName': '홍길동', 'empSeq': '7'}, {'resSeq': '45', 'resName': 'A-1', 'resStartDate': '202610041600', 'resEndDate': '202610041700', 'reqText': '남의 예약', 'empName': '김', 'empSeq': '9'}]}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const TodayScreen()));
    await tester.pumpAndSettle();
    expect(find.text('내 회의'), findsOneWidget);
    expect(find.text('남의 회의'), findsNothing);
    expect(find.text('내 예약'), findsOneWidget);
    expect(find.text('남의 예약'), findsNothing);
    await tester.tap(find.text('전체').first);
    await tester.pumpAndSettle();
    expect(find.text('남의 회의'), findsOneWidget);
    expect(find.text('남의 예약'), findsOneWidget);
  });
  testWidgets('메일: 미읽음 집계와 목록, 미읽음은 굵게, 본문 호출 없음', (tester) async {
    final r = Routes({'/mail/mail000A03': [[{'unreadCount': 2, 'toMeCount': 1, 'totalCount': 9}]], '/mail/mail000A01': [{'list': [{'fullname': 'INBOX', 'mboxSeq': 5}]}], '/mail/mail003A01': [{'Records': [{'muid': 1, 'subject': '안 읽음', 'fromAddrName': '홍', 'rfc822date': '07:10', 'seen': 0}, {'muid': 2, 'subject': '읽음', 'fromAddrName': '김', 'rfc822date': '10-03', 'seen': 1}], 'TotalUnseenCount': 2}]});
    await tester.pumpWidget(gwScope(creds: testCreds, http: r.client, child: const MailScreen()));
    await tester.pumpAndSettle();
    expect(find.textContaining('미읽음 2'), findsOneWidget);
    expect(find.text('안 읽음'), findsOneWidget);
    expect(tester.widget<Text>(find.text('안 읽음')).style?.fontWeight, FontWeight.w800);
    expect(tester.widget<Text>(find.text('읽음')).style?.fontWeight, isNot(FontWeight.w800));
    await tester.tap(find.text('안 읽음'));
    await tester.pumpAndSettle();
    expect(r.hits.containsKey('/mail/mail002A01'), false);
  });
```

- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/gw/screens_test.dart` → Expected: 컴파일 실패.

- [ ] **Step 3: 구현 — 오늘**

```dart
// mobile/lib/gw/today_screen.dart
import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';

class TodayScreen extends StatelessWidget {
  const TodayScreen({super.key});
  @override
  Widget build(BuildContext context) => GwGate(title: '오늘', builder: (_, api) => _Body(api));
}

class _Body extends StatefulWidget {
  const _Body(this.api);
  final GwApi api;
  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  bool _allEvents = false, _allRooms = false;
  List<GwEvent>? _events;
  List<GwCalendar>? _cals;
  List<GwReservation>? _rooms;
  String? _eventsError, _roomsError;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final day = DateTime.now();
    await Future.wait([
      () async {
        try {
          final cals = await widget.api.calendars();
          final ev = await widget.api.events(day);
          if (mounted) setState(() { _cals = cals; _events = ev; _eventsError = null; });
        } catch (e) {
          if (mounted) setState(() => _eventsError = '$e');
        }
      }(),
      () async {
        try {
          final rs = await widget.api.reservations(day);
          if (mounted) setState(() { _rooms = rs; _roomsError = null; });
        } catch (e) {
          if (mounted) setState(() => _roomsError = '$e');
        }
      }(),
    ]);
  }

  String _range(String s, String e, bool allDay) => allDay ? '종일' : '${hm(s)}–${hm(e)}';

  @override
  Widget build(BuildContext context) {
    final me = widget.api.client.creds().empSeq;
    final events = _events == null ? null : (_allEvents ? _events! : myEvents(_events!, _cals ?? const [], me));
    final rooms = _rooms == null ? null : (_allRooms ? _rooms! : _rooms!.where((r) => r.ownerEmpSeq == me).toList());
    return Scaffold(
      appBar: const BrandHeader(title: '오늘'),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 24), children: [
          _Section(title: '일정', count: events?.length, all: _allEvents, onToggle: (v) => setState(() => _allEvents = v), error: _eventsError, loading: _events == null, empty: '일정이 없습니다',
              items: [for (final e in events ?? const <GwEvent>[]) _Row(time: _range(e.start, e.end, e.allDay), title: e.title, sub: [e.calendar, if (e.place.isNotEmpty) e.place, if (!e.mine && e.createName.isNotEmpty) e.createName].where((s) => s.isNotEmpty).join(' · '), mine: e.mine)]),
          const SizedBox(height: 16),
          _Section(title: '회의실', count: rooms?.length, all: _allRooms, onToggle: (v) => setState(() => _allRooms = v), error: _roomsError, loading: _rooms == null, empty: '예약이 없습니다',
              items: [for (final r in rooms ?? const <GwReservation>[]) _Row(time: _range(r.start, r.end, r.allDay), title: r.title.isEmpty ? r.display : r.title, sub: '${r.resName}${r.owner.isEmpty ? '' : ' · ${r.owner}'}', mine: r.ownerEmpSeq == me)]),
        ]),
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.count, required this.all, required this.onToggle, required this.error, required this.loading, required this.empty, required this.items});
  final String title, empty;
  final int? count;
  final bool all, loading;
  final String? error;
  final ValueChanged<bool> onToggle;
  final List<Widget> items;
  @override
  Widget build(BuildContext context) => Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
        Row(children: [
          Padding(padding: const EdgeInsets.only(left: 4), child: CountTitle(title, count ?? 0)),
          const Spacer(),
          SegmentedButton<bool>(
            showSelectedIcon: false,
            style: const ButtonStyle(visualDensity: VisualDensity.compact),
            segments: const [ButtonSegment(value: false, label: Text('내 것')), ButtonSegment(value: true, label: Text('전체'))],
            selected: {all},
            onSelectionChanged: (s) => onToggle(s.first),
          ),
        ]),
        const SizedBox(height: 8),
        Card(
          child: error != null
              ? Padding(padding: const EdgeInsets.all(16), child: Text(error!, style: const TextStyle(color: Brand.dangerText)))
              : loading
                  ? const Padding(padding: EdgeInsets.all(24), child: Center(child: SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))))
                  : items.isEmpty
                      ? Padding(padding: const EdgeInsets.all(20), child: Center(child: Text(empty, style: const TextStyle(color: Brand.muted))))
                      : Column(children: [for (final (i, w) in items.indexed) ...[if (i > 0) const Divider(height: 1), w]]),
        ),
      ]);
}

class _Row extends StatelessWidget {
  const _Row({required this.time, required this.title, required this.sub, required this.mine});
  final String time, title, sub;
  final bool mine;
  @override
  Widget build(BuildContext context) => ListTile(
        dense: true,
        leading: SizedBox(width: 92, child: Text(time, style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: mine ? Brand.blue : Brand.muted))),
        title: Text(title, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: sub.isEmpty ? null : Text(sub, maxLines: 1, overflow: TextOverflow.ellipsis),
      );
}
```

- [ ] **Step 4: 구현 — 메일**

```dart
// mobile/lib/gw/mail_screen.dart
import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_gate.dart';
import 'gw_models.dart';

class MailScreen extends StatelessWidget {
  const MailScreen({super.key});
  @override
  Widget build(BuildContext context) => GwGate(title: '메일', builder: (_, api) => _Body(api));
}

class _Body extends StatefulWidget {
  const _Body(this.api);
  final GwApi api;
  @override
  State<_Body> createState() => _BodyState();
}

class _BodyState extends State<_Body> {
  late Future<(MailSummary, List<MailItem>)> _future = _load();
  Future<(MailSummary, List<MailItem>)> _load() async {
    final (s, (_, items)) = await (widget.api.mailSummary(), widget.api.inbox()).wait;
    return (s, items);
  }

  Future<void> _refresh() async {
    setState(() => _future = _load());
    await _future.catchError((_) => (const MailSummary(unread: 0, toMe: 0, total: 0), <MailItem>[]));
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: const BrandHeader(title: '메일'),
        body: RefreshIndicator(
          onRefresh: _refresh,
          child: FutureBuilder(
            future: _future,
            builder: (context, snap) {
              if (snap.hasError) return ListView(children: [Padding(padding: const EdgeInsets.all(24), child: Column(children: [Text('${snap.error}', style: const TextStyle(color: Brand.dangerText)), const SizedBox(height: 12), FilledButton(onPressed: _refresh, child: const Text('다시 시도'))]))]);
              if (!snap.hasData) return const Center(child: CircularProgressIndicator());
              final (s, items) = snap.data!;
              return ListView(padding: const EdgeInsets.fromLTRB(20, 4, 20, 24), children: [
                Container(
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(color: Brand.navy, borderRadius: BorderRadius.circular(16)),
                  child: Text('미읽음 ${s.unread} · 나에게 온 것 ${s.toMe} · 전체 ${s.total}', style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700, color: Colors.white)),
                ),
                const SizedBox(height: 12),
                Card(
                  child: items.isEmpty
                      ? const Padding(padding: EdgeInsets.all(20), child: Center(child: Text('받은 메일이 없습니다', style: TextStyle(color: Brand.muted))))
                      : Column(children: [
                          for (final (i, m) in items.indexed) ...[
                            if (i > 0) const Divider(height: 1),
                            ListTile(
                              onTap: () => ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('본문은 아마란스에서 확인하세요(앱에서 열면 읽음 처리됩니다).'))),
                              leading: InitialBadge(m.fromName.isEmpty ? m.fromEmail : m.fromName, size: 36, circle: true),
                              title: Text(m.subject.isEmpty ? '(제목 없음)' : m.subject, maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontWeight: m.seen ? FontWeight.w500 : FontWeight.w800)),
                              subtitle: Text(m.fromName.isEmpty ? m.fromEmail : m.fromName, maxLines: 1, overflow: TextOverflow.ellipsis),
                              trailing: Column(mainAxisAlignment: MainAxisAlignment.center, crossAxisAlignment: CrossAxisAlignment.end, children: [
                                Text(m.date, style: const TextStyle(fontSize: 12, color: Brand.muted)),
                                if (m.attach) const Icon(Icons.attach_file, size: 14, color: Brand.faint),
                              ]),
                            ),
                          ],
                        ]),
                ),
                const SizedBox(height: 10),
                const Text('본문은 열지 않습니다 — 앱에서 열면 아마란스에서 읽음으로 바뀌기 때문입니다.', style: TextStyle(fontSize: 12, color: Brand.muted), textAlign: TextAlign.center),
              ]);
            },
          ),
        ),
      );
}
```

`router.dart`에 라우트 추가: `GoRoute(path: '/gw/today', builder: (c, s) => const TodayScreen())`, `GoRoute(path: '/gw/mail', builder: (c, s) => const MailScreen())`.

- [ ] **Step 5: 통과 확인** — Run: `cd mobile && flutter test test/gw/ && flutter analyze` → Expected: 모두 통과, 0 issues.

- [ ] **Step 6: 커밋** — `git add mobile/lib/gw mobile/lib/app/router.dart mobile/test/gw && git commit -m "feat(mobile): 아마란스 오늘(일정·회의실, 내 것/전체) 화면·메일(미읽음·받은메일 목록) 화면"`

---

### Task 10: 홈 "오늘" 카드 + 하단 바 그룹 "아마란스"(부채꼴 4항목)

**Files:**
- Create: `mobile/lib/gw/gw_today_card.dart`
- Modify: `mobile/lib/more/catalog.dart`(`appPages`, 그룹 `gw`, `visibleGroups`가 `pages + appPages`), `mobile/lib/more/service_grid.dart`(`serviceMeta`에 gw 4개 아이콘), `mobile/lib/app/tab_shell.dart`(`_groupIcons['gw']`, `_openPage`의 `/gw/` 분기), `mobile/lib/features/home/home_screen.dart`(격언 카드 아래 `GwTodayCard`)
- Test: `mobile/test/gw/today_card_test.dart`, `mobile/test/app/tab_shell_test.dart`(그룹 추가), `mobile/test/more/catalog_test.dart`(appPages는 visiblePages에 안 섞임)

**Interfaces:**
- Consumes: `gwProvider`, `gwApiProvider`, `tabTapProvider`, `GwApi.approvalCounts/attendanceToday/events/calendars/reservations/mailSummary`.
- Produces: `const appPages = <PageEntry>[gw_approvals '/gw/approvals' '미결 결재', gw_attendance '/gw/attendance' '출퇴근', gw_today '/gw/today' '오늘 일정', gw_mail '/gw/mail' '메일'](group 'gw', minRole 'user')`; `pageGroups`에 `PageGroup('gw', '아마란스')`(업무 다음); `class GwTodayCard extends ConsumerStatefulWidget`.

- [ ] **Step 1: 실패하는 테스트**

```dart
// mobile/test/gw/today_card_test.dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/gw/gw_today_card.dart';
import 'fakes.dart';

http.Response ok(Object? data) => http.Response(jsonEncode({'resultCode': 0, 'resultData': data}), 200);
const session = {'sessionInfo': {'ucUserInfo': {'compSeq': '10', 'deptSeq': '20', 'empName': '홍길동', 'emailAdd': 'hong', 'emailDomain': 'innogrid.com', 'erpEmpSeq': 'E', 'erpDeptSeq': 'D', 'erpCompSeq': 'C'}}};
MockClient routes(Map<String, Object?> m) => MockClient((r) async => m.containsKey(r.url.path) ? ok(m[r.url.path]) : http.Response('{"resultCode":999,"resultMsg":"x"}', 200));

void main() {
  testWidgets('미연결: 연결 안내 카드', (tester) async {
    await tester.pumpWidget(gwScope(http: routes({}), child: const Scaffold(body: GwTodayCard())));
    await tester.pumpAndSettle();
    expect(find.text('연결하기'), findsOneWidget);
  });
  testWidgets('연결됨: 4개 타일 숫자, 하나가 실패해도 나머지는 보인다', (tester) async {
    await tester.pumpWidget(gwScope(creds: testCreds, http: routes({
      '/gw/gw050A02': session, '/eap/api/getMenuCountInfo': {'1001000': '3'}, '/human/common/judgeTimeManagement/getTodayComeLeaveInfo': {'comeTm': '202610040902', 'leaveTm': ''},
      '/schres/sc111A02': {'resultList': [{'mcalSeq': '1', 'calType': 'E', 'empSeq': '7'}]}, '/schres/sc111A03': {'resultList': [{'schSeq': 'a', 'startDate': '202610041000', 'endDate': '202610041100', 'delYn': 'Y', 'mcalSeq': '1'}]},
      '/schres/rs121A01': {'resultList': []}, '/schres/rs121A05': {'resultList': []},
      // 메일은 라우트 없음 → 999 실패
    }), child: const Scaffold(body: GwTodayCard())));
    await tester.pumpAndSettle();
    expect(find.text('3건'), findsOneWidget);
    expect(find.text('09:02'), findsOneWidget);
    expect(find.text('1건'), findsOneWidget); // 일정 1 · 회의실 0 → "1건"은 일정
    expect(find.textContaining('다시 시도'), findsOneWidget); // 메일 타일만 오류
  });
}
```

`tab_shell_test.dart`의 첫 테스트 라벨 목록을 `['홈', '일상', 'AI', '업무', '아마란스', '더보기']`로 바꾸고 테스트 추가:

```dart
  testWidgets('아마란스 그룹의 항목은 네이티브 화면으로 push된다(WebView 아님)', (tester) async {
    await pumpShell(tester, user);
    await tester.tap(tab('아마란스'));
    await tester.pumpAndSettle();
    for (final l in ['미결 결재', '출퇴근', '오늘 일정', '메일']) {
      expect(fanItem(l), findsOneWidget, reason: l);
    }
    await tester.tap(fanItem('출퇴근'));
    await tester.pumpAndSettle();
    expect(find.text('아마란스 연결하기'), findsOneWidget); // 미연결 → GwGate 안내
    expect(find.byType(FanItem), findsNothing);
  });
```
(`pumpShell`의 `ProviderScope.overrides`에 `gwStoreProvider.overrideWithValue(FakeGwStore())`를 추가 — import `'../gw/fakes.dart'`, `'package:playground/gw/gw_creds.dart'`.)

`catalog_test.dart`에 추가:
```dart
  test('앱 전용 항목(appPages)은 그룹에는 나오지만 웹 서비스 목록(visiblePages)에는 섞이지 않는다', () {
    expect(visiblePages(s('user')).any((p) => p.group == 'gw'), false);
    final groups = visibleGroups(s('user'));
    expect(groups.map((g) => g.$1.id), ['daily', 'ai', 'work', 'gw']);
    expect(groups.last.$2.map((p) => p.href), ['/gw/approvals', '/gw/attendance', '/gw/today', '/gw/mail']);
  });
```

- [ ] **Step 2: 실패 확인** — Run: `cd mobile && flutter test test/gw/today_card_test.dart test/app/tab_shell_test.dart test/more/catalog_test.dart` → Expected: 실패.

- [ ] **Step 3: 구현 — 카탈로그·아이콘·셸**

`catalog.dart`:
```dart
const pageGroups = <PageGroup>[PageGroup('daily', '일상'), PageGroup('ai', 'AI'), PageGroup('work', '업무'), PageGroup('gw', '아마란스')];

/// 앱 전용 네이티브 항목(웹 카탈로그에 없음, 하단 바 그룹에만 나온다 — 사내 서비스 카드에는 안 섞인다).
const appPages = <PageEntry>[
  PageEntry('gw_approvals', '/gw/approvals', '미결 결재', 'gw', 'user'),
  PageEntry('gw_attendance', '/gw/attendance', '출퇴근', 'gw', 'user'),
  PageEntry('gw_today', '/gw/today', '오늘 일정', 'gw', 'user'),
  PageEntry('gw_mail', '/gw/mail', '메일', 'gw', 'user'),
];
```
`visibleGroups`: `visiblePages(s).where(...)` → `[...visiblePages(s), ...appPages.where((p) => canUsePage(s, p))].where((p) => p.group == g.id)`.

`service_grid.dart` `serviceMeta`에: `'gw_approvals': (Icons.fact_check_outlined, '미결 문서'), 'gw_attendance': (Icons.timer_outlined, '출근·퇴근 기록'), 'gw_today': (Icons.event_outlined, '일정·회의실'), 'gw_mail': (Icons.mail_outline, '받은메일 미읽음')`.

`tab_shell.dart`: `_groupIcons`에 `'gw': (Icons.apartment_outlined, Icons.apartment)`; `_openPage`:
```dart
    if (p.href.startsWith('/gw/')) { _close(); context.push(p.href); return; }
```

- [ ] **Step 4: 구현 — 홈 카드**

```dart
// mobile/lib/gw/gw_today_card.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../app/brand.dart';
import '../app/router.dart';
import '../app/theme.dart';
import 'gw_api.dart';
import 'gw_creds.dart';
import 'gw_models.dart';

/// 홈 "오늘" 카드 — 아마란스 4개 숫자. 호출은 병렬이고 하나가 실패해도 나머지는 보인다.
class GwTodayCard extends ConsumerStatefulWidget {
  const GwTodayCard({super.key});
  @override
  ConsumerState<GwTodayCard> createState() => _GwTodayCardState();
}

class _Tile {
  _Tile(this.label, this.icon, this.route);
  final String label, route;
  final IconData icon;
  String? value, sub, error;
}

class _GwTodayCardState extends ConsumerState<GwTodayCard> {
  final _tiles = [_Tile('미결 결재', Icons.fact_check_outlined, '/gw/approvals'), _Tile('출퇴근', Icons.timer_outlined, '/gw/attendance'), _Tile('오늘 일정', Icons.event_outlined, '/gw/today'), _Tile('메일', Icons.mail_outline, '/gw/mail')];
  GwApi? _loadedWith;

  Future<void> _load(GwApi api) async {
    _loadedWith = api;
    for (final t in _tiles) { t.value = null; t.sub = null; t.error = null; }
    if (mounted) setState(() {});
    final me = api.client.creds().empSeq;
    final day = DateTime.now();
    await Future.wait([
      _fill(_tiles[0], () async { final c = await api.approvalCounts(); return ('${c['pending']}건', null); }),
      _fill(_tiles[1], () async { final a = await api.attendanceToday(); return (a.clockedIn ? hm(a.comeTm) : '—', a.clockedOut ? '퇴근 ${hm(a.leaveTm)}' : (a.clockedIn ? '출근' : '미기록')); }),
      _fill(_tiles[2], () async {
        final cals = await api.calendars();
        final ev = myEvents(await api.events(day), cals, me);
        final rooms = (await api.reservations(day)).where((r) => r.ownerEmpSeq == me).length;
        return ('${ev.length}건', '회의실 $rooms');
      }),
      _fill(_tiles[3], () async { final s = await api.mailSummary(); return ('${s.unread}통', '미읽음'); }),
    ]);
  }

  Future<void> _fill(_Tile t, Future<(String, String?)> Function() f) async {
    try {
      final (v, s) = await f();
      t.value = v; t.sub = s;
    } catch (e) {
      t.error = '$e';
    }
    if (mounted) setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final gw = ref.watch(gwProvider).value;
    final api = ref.watch(gwApiProvider);
    ref.listen(tabTapProvider, (_, _) { if (api != null) _load(api); });
    if (gw == null) return const SizedBox.shrink();
    if (gw.status != GwStatus.connected || api == null) {
      final relogin = gw.status == GwStatus.needsRelogin;
      return Card(child: ListTile(
        leading: const TintIcon(Icons.apartment_outlined, size: 40),
        title: Text(relogin ? '아마란스 로그인이 만료되었습니다' : '아마란스를 연결하세요'),
        subtitle: Text(relogin ? '다시 연결하면 이어서 봅니다' : '미결 결재·출퇴근·일정·메일을 여기서 봅니다', style: theme.textTheme.bodySmall),
        trailing: FilledButton(onPressed: () => context.push('/gw/connect'), child: Text(relogin ? '다시 연결' : '연결하기')),
      ));
    }
    if (_loadedWith != api) WidgetsBinding.instance.addPostFrameCallback((_) { if (mounted) _load(api); });
    return GridView.count(
      crossAxisCount: 2, shrinkWrap: true, physics: const NeverScrollableScrollPhysics(), mainAxisSpacing: 8, crossAxisSpacing: 8, childAspectRatio: 1.9,
      children: [for (final t in _tiles) Card(child: InkWell(onTap: () => context.push(t.route), child: Padding(padding: const EdgeInsets.fromLTRB(14, 10, 12, 10), child: Row(children: [
        TintIcon(t.icon, size: 36, background: Brand.blueTint, color: Brand.navy),
        const SizedBox(width: 12),
        Expanded(child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisAlignment: MainAxisAlignment.center, children: [
          Text(t.label, style: theme.textTheme.bodySmall?.copyWith(fontSize: 12)),
          if (t.error != null) Text('다시 시도', style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.dangerText))
          else Text(t.value ?? '…', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Brand.navy)),
          if (t.sub != null) Text(t.sub!, style: theme.textTheme.bodySmall?.copyWith(fontSize: 11), maxLines: 1, overflow: TextOverflow.ellipsis),
        ])),
      ]))))],
    );
  }
}
```
(오류 타일을 누르면 라우트로 가는 대신 다시 불러오게 하려면 `onTap: t.error != null ? () => _load(api) : () => context.push(t.route)`.)

`home_screen.dart`: 격언 카드 `Container(...)` 다음 `const SizedBox(height: 20)` 앞에 `const SizedBox(height: 12), const GwTodayCard(),` 추가(import `'../../gw/gw_today_card.dart'`).

- [ ] **Step 5: 통과 확인** — Run: `cd mobile && flutter test && flutter analyze` → Expected: 전체 통과, 0 issues.

- [ ] **Step 6: 커밋** — `git add mobile/lib mobile/test && git commit -m "feat(mobile): 홈 '오늘' 카드(아마란스 4개 숫자) + 하단 바 그룹 아마란스(부채꼴 미결 결재·출퇴근·오늘 일정·메일)"`

---

### Task 11: 문서·규칙·메모리 + 전체 검증

**Files:**
- Modify: `docs/mobile-app.md`(절 "아마란스 연동" 추가 + 트러블슈팅 행), `.claude/rules/mobile.md`(gw 모듈 한 줄), `CLAUDE.md`(mobile 커맨드 아래 한 줄 없음 — 변경 없음; 모바일 규칙 파일이 담당), 메모리 `mobile-app-status.md`

- [ ] **Step 1: 런북** `docs/mobile-app.md`에 절 추가:

```
## 아마란스(그룹웨어) 연동 (2026-10-04)
설계 `docs/superpowers/specs/2026-10-04-amaranth-app-integration-design.md`. 사용자가 더보기 → 계정 → "아마란스 연결"(또는 홈 카드)에서 WebView로 gw.innogrid.com에 로그인하면 `document.cookie`의 `oAuthToken`·`signKey`를 읽어 `gw050A02`로 검증하고 기기(shared_preferences)에 저장한다. 그 뒤 앱이 **직접** GW API를 부른다(서버 미경유, MCP 불필요). 코드 `mobile/lib/gw/`: 서명 `gw_sign.dart`(골든 테스트는 inno-creed `sign.rs` 값), 관문 `gw_client.dart`(`call`/`callForm`만, 401 → `needsRelogin`), 기능 `gw_api.dart`·정제 `gw_models.dart`, 화면 `*_screen.dart`, 홈 카드 `gw_today_card.dart`, 입구 `gw_gate.dart`. 엔드포인트·필드 출처는 https://github.com/zilhak/inno-creed (`docs/api-reference.md`). 쓰기는 출퇴근 기록 하나(확인 → 가드 → read-back). 메일 본문은 열지 않는다(읽음 처리).
| 증상 | 확인 | 조치 |
|---|---|---|
| 연결 화면에서 로그인했는데 연결이 안 됨 | 쿠키 이름이 `oAuthToken`/`signKey`(또는 `BIZCUBE_AT`/`HK`)인지, HttpOnly로 바뀌지 않았는지(Chrome DevTools) | "쿠키 지우고 로그인"으로 재시도. 이름이 바뀌었으면 `parseGwCookies` 수정 |
| 모든 화면이 "다시 연결" | 토큰 만료(401). 만료 주기는 아직 미측정 | 다시 연결. 자주 나면 만료 주기를 기록해 선제 안내 검토 |
| 특정 화면만 오류(resultCode≠0) | 서버 `resultMsg` 그대로 표시됨 — 엔드포인트가 바뀌었을 수 있음 | inno-creed 최신 소스와 비교 |
| 출퇴근 "반영이 확인되지 않았습니다" | read-back에 comeTm/leaveTm 없음 | 아마란스에서 직접 확인 — 응답 successCount는 믿지 않는다 |
```

- [ ] **Step 2: 규칙** `.claude/rules/mobile.md`에 한 줄: "아마란스 연동: `lib/gw/`(스펙 2026-10-04). GW 호출은 `GwClient.call/callForm`만, 토큰·세션 값 로그 금지, 쓰기는 출퇴근 기록뿐(확인·가드·read-back), 메일 본문 금지. 엔드포인트 출처 inno-creed(zilhak/inno-creed)."

- [ ] **Step 3: 메모리** `mobile-app-status.md`에 2026-10-04 아마란스 연동 항목(사용자 결정: 2번 방식·4기능·6번째 그룹 승인; 실기기 미확인; 토큰 만료 주기 미측정).

- [ ] **Step 4: 전체 검증** — Run: `cd mobile && flutter analyze && flutter test` → Expected: 0 issues, 전체 통과. 골든 PNG(런북 §디자인 방법)로 홈 카드·출퇴근 화면 모양 확인.

- [ ] **Step 5: 커밋·푸시** — `git add docs/mobile-app.md .claude/rules/mobile.md && git commit -m "docs(mobile): 아마란스 연동 런북·규칙" && git pull --rebase && git push`
