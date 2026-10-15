# 앱 이노봇 새 대화 API 이전 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 앱(Flutter) 이노봇이 무상태 `/api/assistant/turn` 대신 서버 저장 대화 API(`POST /api/chat/turn`, SSE)를 쓰게 하고, 시트에 🕘 대화 기록(웹과 같은 서버 대화 목록)을 붙인다.

**Architecture:** 서버가 대화를 갖고 Claude를 부른다. 앱 도구(아마란스·일정 등, location `device`)와 쓰기는 서버가 `needs_action`으로 멈추고, 앱은 지금의 판단 로직(조회 바로 실행, 쓰기·되돌릴 수 없음은 실제 대상으로 만든 확인 카드, 선택지, 되돌리기, 메일 읽기 제한)을 그대로 돌린 뒤 결과를 `actions`로 돌려준다. 서버 쓰기(teams_send·confluence_create_page)는 앱이 카드를 보이고 `approve`만 보내 서버가 실행한다. 앱 메모리의 Claude 형식 messages·trimHistory는 없어진다.

**Tech Stack:** Flutter 3.44 / Dart 3.12, Riverpod 3, `http` 1.6(`AbortableRequest`·`MockClient`), 서버 Next.js(이미 배포된 `/api/chat/*`).

**Spec:** `docs/superpowers/specs/2026-10-15-llm-portal-phase1-design.md` §1.3·§1.4·§4(앱). 앞선 계획 `docs/superpowers/plans/2026-10-15-llm-portal-phase1.md`(웹·서버, 배포 완료).

## Global Constraints

- 커밋: main 직접, `git -c user.email=native.platform@innogrid.com commit`, 트레일러 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` / `Claude-Session: https://claude.ai/code/session_01CfA8c3gbbdi3ZSNWEy3GnD`. `.claude/skills/claude-usage-csv/SKILL.md` 커밋 금지. push는 컨트롤러.
- **mobile/ 기존 Dart 파일에 `dart format` 금지**(한 줄 if가 풀려 lint·잡음 diff). 새 파일도 주변 스타일(촘촘한 한 줄)을 따른다. 검사는 `cd mobile && flutter analyze && flutter test`.
- 새 pub 의존성 금지(`http`의 스트리밍으로 SSE를 직접 읽는다).
- 네이티브 API 호출은 `lib/api/client.dart`(`ApiClient`)만 지난다(Bearer·401 갱신 재시도 1회).
- 토큰·메일 제목·본문·도구 인자를 로그·예외 메시지에 남기지 않는다.
- 쓰기는 앱 확인 카드 없이 실행하지 않는다. 카드는 모델이 쓴 라벨이 아니라 조회한 실제 대상으로 만든다(`runner.resolve`, 기존 규칙 그대로).
- 화면 문구는 한국어. 자동 TTS 금지(🔊를 누를 때만, 기존 그대로).
- 서버 `/api/assistant/turn`·`/api/assistant/execute`는 지우지 않는다(구버전 앱, 그리고 선택지 안의 Teams 쓰기는 앱이 `/execute`로 실행 — 아래 결정).
- 릴리스(버전 올리기·스토어 배포)는 이 계획에 넣지 않는다 — 사용자가 "릴리스해" 할 때 기존 절차로.

## 이 계획에서 정한 것

- **서버 읽기 도구**(location server, tier read)가 `needs_action`에 섞여 오면 앱은 실행하지 않는다 — 서버가 `actions` 요청을 받을 때 직접 실행한다.
- **서버 쓰기**(teams_send·confluence_create_page)는 앱이 `runner.resolve`(기존, `/api/assistant/execute`의 teams_chats·confluence_spaces로 실제 대상 확인)로 카드를 만들고, 실행은 `{id, approve: true}`로 서버에 맡긴다. 거절은 `approve: false`.
- **선택지(offer_choices)** 안의 쓰기는 서버가 모르는 중첩 호출이라 지금처럼 앱이 실행한다(서버 도구는 기존 `/api/assistant/execute`). 결과는 offer_choices id 하나의 `result`로 돌려준다.
- **고쳐 줘**: 카드를 "고칠 내용을 말씀해 주세요"로 닫고 다음 입력을 그냥 보낸다 — 서버가 대기 호출을 "취소됨"으로 닫고 새 입력을 붙인다(웹과 같음).
- **중지**: 스트림을 끊는다. 이미 실행한 앱 쓰기의 결과는 서버에 보내지 않는다(다음 입력 때 서버가 "취소됨"으로 닫음). 화면 안내는 지금처럼 "실행 중이던 작업은 실행 여부를 확인해 주세요".
- **턴 대기 시간**: 서버 한 요청이 도구 왕복·중계로 길어질 수 있어 스트림 대기는 300초(`assistantTurnTimeoutProvider`), 앱 도구 실행은 기존 75초(`assistantWaitTimeoutProvider`).
- **꺼짐 감지**: 서버가 403에 `code: "assistant_disabled"`를 함께 준다(Task 1에서 서버 한 줄 추가). 앱은 `ApiException.code`로 판단해 이번 실행 동안 이노봇을 숨긴다.

## Review Focus

1. `needs_action`에 서버 읽기 + 앱 읽기 + 앱 쓰기가 섞여 올 때 — 앱은 앱 읽기만 실행, 카드는 앱 쓰기만, 회신에는 앱 호출 전부의 결과가 들어가야 한다(빠지면 서버가 "앱 응답 없음"). — Task 3 테스트 "섞인 호출".
2. 확인 카드에 앱 쓰기와 서버 쓰기가 함께 있을 때 앞 작업이 실패 — 뒤의 서버 쓰기는 `approve: false`로 보내야 한다. — Task 3 테스트 "앞 실패 뒤 서버 쓰기 미승인".
3. 스트림 도중 401(토큰 만료) — 갱신 후 1회 재시도, 그래도 401이면 로그아웃 처리. — Task 1 테스트.
4. 대화 기록에서 남의 대화·지워진 대화 id를 열 때(404) — 안내만 띄우고 현재 대화를 망가뜨리지 않는다. — Task 4 테스트.
5. 새 대화(reset) 직후 늦게 도착한 이전 스트림 이벤트 — 새 대화에 섞이지 않는다(기존 `_active(run)` 규칙). — Task 3 테스트 "중지 후 늦은 응답".

---

### Task 1: SSE 읽기 — `SseDecoder`·`ApiClient.postSse`·`ApiException.code`(+ 서버 꺼짐 코드)

**Files:**
- Create: `mobile/lib/api/sse.dart`
- Modify: `mobile/lib/api/client.dart`(ApiException에 `code`, `postSse` 추가)
- Modify: `frontend/src/app/api/chat/turn/route.ts`(꺼짐 403에 `code`), `frontend/src/lib/__tests__/chat-turn-api.test.ts`
- Test: `mobile/test/api/sse_test.dart`

**Interfaces:**
- Produces: `class SseDecoder { SseDecoder(void Function(Map<String, dynamic>) onEvent); void add(String chunk); }`; `ApiException(int status, String message, {String? code})`(필드 `code`); `Future<void> ApiClient.postSse(String path, Object body, void Function(Map<String, dynamic>) onEvent, {Future<void>? abortTrigger})` — 2xx가 아니면 `ApiException`(서버 `{error, code}`), 401은 갱신 후 1회 재시도.

- [ ] **Step 1: 실패하는 테스트**

`mobile/test/api/sse_test.dart`:

```dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/api/sse.dart';

class _Tokens implements TokenSource {
  var refreshed = 0, unauthorized = 0;
  @override
  Future<String?> accessToken() async => 'old';
  @override
  Future<String?> refreshToken() async { refreshed++; return 'new'; }
  @override
  Future<void> onUnauthorized() async { unauthorized++; }
}

String sse(List<Map<String, dynamic>> events) => events.map((e) => 'data: ${jsonEncode(e)}\n\n').join();

void main() {
  test('SseDecoder — 조각난 청크·CRLF를 이어 붙여 이벤트 단위로', () {
    final got = <Map<String, dynamic>>[];
    final d = SseDecoder(got.add);
    d.add('data: {"type":"text","de');
    d.add('lta":"가"}\r\n\r\ndata: {"type":"done","messageId":"m1"}\n');
    expect(got, [{'type': 'text', 'delta': '가'}]);
    d.add('\n');
    expect(got.last, {'type': 'done', 'messageId': 'm1'});
    d.add('data: {깨짐}\n\n');
    expect(got, hasLength(2));
  });

  test('postSse — 이벤트를 차례로, Bearer·Accept, 본문 JSON', () async {
    late http.BaseRequest seen;
    final api = ApiClient(httpClient: MockClient((r) async { seen = r; return http.Response.bytes(utf8.encode(sse([{'type': 'conversation', 'id': 'c1'}, {'type': 'text', 'delta': '안녕'}, {'type': 'done', 'messageId': 'm1'}])), 200, headers: {'content-type': 'text/event-stream; charset=utf-8'}); }), tokens: _Tokens(), baseUrl: 'https://x.test', userAgent: 'UA');
    final got = <Map<String, dynamic>>[];
    await api.postSse('/api/chat/turn', {'text': '안녕'}, got.add);
    expect(got.map((e) => e['type']), ['conversation', 'text', 'done']);
    expect(seen.headers['Authorization'], 'Bearer old');
    expect(seen.headers['Accept'], 'text/event-stream');
    expect(jsonDecode((seen as http.Request).body), {'text': '안녕'});
  });

  test('postSse — 401이면 갱신 후 1회 재시도, 거절 JSON은 ApiException(status, message, code)', () async {
    final tokens = _Tokens();
    var n = 0;
    final api = ApiClient(httpClient: MockClient((r) async {
      n++;
      if (r.headers['Authorization'] == 'Bearer old') return http.Response('{"error":"만료"}', 401);
      return http.Response.bytes(utf8.encode(jsonEncode({'error': '관리자가 이노봇을 꺼 두었습니다.', 'code': 'assistant_disabled'})), 403, headers: {'content-type': 'application/json; charset=utf-8'});
    }), tokens: tokens, baseUrl: 'https://x.test', userAgent: 'UA');
    await expectLater(api.postSse('/api/chat/turn', {}, (_) {}), throwsA(isA<ApiException>().having((e) => e.status, 'status', 403).having((e) => e.code, 'code', 'assistant_disabled').having((e) => e.message, 'message', '관리자가 이노봇을 꺼 두었습니다.')));
    expect(n, 2);
    expect(tokens.refreshed, 1);
  });

  test('postSse — 갱신해도 401이면 onUnauthorized 후 401', () async {
    final tokens = _Tokens();
    final api = ApiClient(httpClient: MockClient((r) async => http.Response('{"error":"인증이 필요합니다."}', 401)), tokens: tokens, baseUrl: 'https://x.test', userAgent: 'UA');
    await expectLater(api.postSse('/api/chat/turn', {}, (_) {}), throwsA(isA<ApiException>().having((e) => e.status, 'status', 401)));
    expect(tokens.unauthorized, 1);
  });
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd mobile && flutter test test/api/sse_test.dart`
Expected: FAIL — `package:playground/api/sse.dart` 없음

- [ ] **Step 3: 구현**

`mobile/lib/api/sse.dart`:

```dart
import 'dart:convert';

/// `data: {...}\n\n` 블록을 이벤트(Map)로. 청크가 아무 데서나 잘려도 되고 CRLF도 받는다. 깨진 블록은 버린다.
class SseDecoder {
  SseDecoder(this.onEvent);
  final void Function(Map<String, dynamic>) onEvent;
  var _buf = '';

  void add(String chunk) {
    _buf += chunk.replaceAll('\r\n', '\n');
    for (var i = _buf.indexOf('\n\n'); i >= 0; i = _buf.indexOf('\n\n')) {
      final block = _buf.substring(0, i);
      _buf = _buf.substring(i + 2);
      final data = block.split('\n').where((l) => l.startsWith('data:')).map((l) => l.substring(5).trimLeft()).join('\n');
      if (data.isEmpty) continue;
      try {
        final v = jsonDecode(data);
        if (v is Map) onEvent(Map<String, dynamic>.from(v));
      } catch (_) {}
    }
  }
}
```

`mobile/lib/api/client.dart`:
- import에 `import 'sse.dart';`.
- `ApiException`을 아래로 바꾼다(기존 호출부 `ApiException(status, message)`는 그대로 동작).

```dart
class ApiException implements Exception {
  ApiException(this.status, this.message, {this.code});
  final int status;
  final String message;
  /// 서버가 준 기계용 구분값(예: assistant_disabled). 없으면 null.
  final String? code;
  @override
  String toString() => message;
}
```

- `_send`의 `throw ApiException(res.statusCode, _errorMessage(res))` 두 곳을 `throw _apiError(res)`로, `_errorMessage` 아래에 추가:

```dart
  ApiException _apiError(http.Response res) {
    String? code;
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      if (j is Map && j['code'] is String) code = j['code'] as String;
    } catch (_) {}
    return ApiException(res.statusCode, _errorMessage(res), code: code);
  }
```

- `postJsonAbortable` 아래에 추가:

```dart
  /// SSE POST — 이벤트마다 onEvent. 스트림을 열기 전 거절(2xx 아님)은 ApiException, 401은 갱신 후 1회 재시도.
  Future<void> postSse(String path, Object body, void Function(Map<String, dynamic>) onEvent, {Future<void>? abortTrigger}) async {
    var token = await tokens.accessToken();
    var res = await _openStream(path, token, body, abortTrigger);
    if (res.statusCode == 401) {
      await res.stream.drain<void>();
      token = await tokens.refreshToken();
      res = await _openStream(path, token, body, abortTrigger);
      if (res.statusCode == 401) {
        final r = await http.Response.fromStream(res);
        await tokens.onUnauthorized();
        throw _apiError(r);
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) throw _apiError(await http.Response.fromStream(res));
    final dec = SseDecoder(onEvent);
    await for (final chunk in res.stream.transform(utf8.decoder)) {
      dec.add(chunk);
    }
  }

  Future<http.StreamedResponse> _openStream(String path, String? token, Object body, Future<void>? abortTrigger) {
    final req = http.AbortableRequest('POST', Uri.parse('$baseUrl$path'), abortTrigger: abortTrigger)
      ..headers.addAll({'User-Agent': userAgent, 'Accept': 'text/event-stream', 'Content-Type': 'application/json', if (token != null) 'Authorization': 'Bearer $token'})
      ..body = jsonEncode(body);
    return httpClient.send(req);
  }
```

서버 `frontend/src/app/api/chat/turn/route.ts`: 꺼짐 응답을 `NextResponse.json({ error: "관리자가 이노봇을 꺼 두었습니다.", code: "assistant_disabled" }, { status: 403 })`로. `chat-turn-api.test.ts`의 꺼짐 케이스에 `expect((await res.json()).code).toBe("assistant_disabled")` 한 줄(그 케이스의 응답을 변수로 받아서).

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && flutter test test/api/sse_test.dart test/api && flutter analyze` 그리고 `cd ../frontend && npx vitest run src/lib/__tests__/chat-turn-api.test.ts`
Expected: PASS, analyze 이슈 0

- [ ] **Step 5: 커밋** — `feat(app): SSE 읽기(postSse·SseDecoder)와 ApiException.code, 서버 꺼짐 코드`

---

### Task 2: 대화 API 클라이언트 `ChatApi`

**Files:**
- Create: `mobile/lib/assistant/chat_api.dart`
- Test: `mobile/test/assistant/chat_api_test.dart`

**Interfaces:**
- Consumes: Task 1 `ApiClient.postSse`, `ApiException.code`.
- Produces:
  - `class PendingCall { const PendingCall({required this.id, required this.name, required this.input, required this.location, required this.tier, this.target}); final String id, name, location, tier; final Map<String, dynamic> input; final String? target; bool get onServer => location == 'server'; }`
  - `class TurnOutcome { String? conversationId; List<PendingCall>? needsAction; String? error; bool disabled; Map<String, String> toolStatus; }` — `toolStatus`는 이 요청에서 서버가 실행한 도구 id → `ok|error`.
  - `class ConversationSummary { const ConversationSummary(this.id, this.title, this.lastMessageAt); final String id, title, lastMessageAt; }`
  - `class ChatApi { ChatApi(this.api); Future<TurnOutcome> turn(Map<String, dynamic> body, {void Function(String delta)? onText, void Function(String id, String tool, String status)? onTool, Future<void>? abort}); Future<List<ConversationSummary>> list({int limit = 50}); Future<List<({String role, String text})>> load(String id); }` — `load`는 화면에 그릴 말(사용자 텍스트·이노봇 텍스트)만, 도구 결과 행·빈 행은 뺀다. 404는 `ApiException`을 그대로 던진다.
  - `final chatApiProvider = Provider<ChatApi>((ref) => ChatApi(ref.watch(apiClientProvider)));`

- [ ] **Step 1: 실패하는 테스트**

```dart
import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/chat_api.dart';

class _Tokens implements TokenSource {
  @override
  Future<String?> accessToken() async => 't';
  @override
  Future<String?> refreshToken() async => 't';
  @override
  Future<void> onUnauthorized() async {}
}

ChatApi apiWith(Future<http.Response> Function(http.Request r) h) => ChatApi(ApiClient(httpClient: MockClient(h), tokens: _Tokens(), baseUrl: 'https://x.test', userAgent: 'UA'));
http.Response sse(List<Map<String, dynamic>> ev) => http.Response.bytes(utf8.encode(ev.map((e) => 'data: ${jsonEncode(e)}\n\n').join()), 200, headers: {'content-type': 'text/event-stream'});
http.Response json(Object o, [int s = 200]) => http.Response.bytes(utf8.encode(jsonEncode(o)), s, headers: {'content-type': 'application/json; charset=utf-8'});

void main() {
  test('turn — 텍스트 스트림·서버 도구 상태·needs_action을 모은다', () async {
    final deltas = <String>[];
    final tools = <String>[];
    final api = apiWith((r) async => sse([
      {'type': 'conversation', 'id': 'c1'},
      {'type': 'tool', 'id': 's1', 'tool': 'teams_chats', 'location': 'server', 'status': 'running'},
      {'type': 'tool', 'id': 's1', 'tool': 'teams_chats', 'location': 'server', 'status': 'ok', 'summary': '1건'},
      {'type': 'text', 'delta': '확인'},
      {'type': 'text', 'delta': '할게요'},
      {'type': 'needs_action', 'messageId': 'm2', 'calls': [
        {'id': 't1', 'tool': 'mail_list', 'input': {}, 'location': 'device', 'tier': 'read'},
        {'id': 't2', 'tool': 'teams_send', 'input': {'chat_id': '19:x', 'text': 'a'}, 'location': 'server', 'tier': 'write', 'target': '센터'},
      ]},
    ]));
    final o = await api.turn({'text': 'x'}, onText: deltas.add, onTool: (id, tool, s) => tools.add('$id:$s'));
    expect(o.conversationId, 'c1');
    expect(deltas.join(), '확인할게요');
    expect(tools, ['s1:running', 's1:ok']);
    expect(o.toolStatus, {'s1': 'ok'});
    expect(o.needsAction!.map((c) => '${c.id}/${c.name}/${c.location}/${c.tier}/${c.target}'), ['t1/mail_list/device/read/null', 't2/teams_send/server/write/센터']);
    expect(o.needsAction![1].onServer, isTrue);
    expect(o.error, isNull);
  });

  test('turn — done이면 needsAction null, error 이벤트는 문구, 꺼짐 403은 disabled', () async {
    expect((await apiWith((r) async => sse([{'type': 'conversation', 'id': 'c1'}, {'type': 'done', 'messageId': 'm1'}])).turn({'text': 'x'})).needsAction, isNull);
    final e = await apiWith((r) async => sse([{'type': 'conversation', 'id': 'c1'}, {'type': 'error', 'message': '이노봇이 답하지 못했습니다. 다시 시도해 주세요.', 'retryable': true}])).turn({'text': 'x'});
    expect(e.error, '이노봇이 답하지 못했습니다. 다시 시도해 주세요.');
    final off = await apiWith((r) async => json({'error': '관리자가 이노봇을 꺼 두었습니다.', 'code': 'assistant_disabled'}, 403)).turn({'text': 'x'});
    expect(off.disabled, isTrue);
    final limit = await apiWith((r) async => json({'error': '오늘 이노봇 사용 한도를 다 썼습니다. 내일 다시 이용해 주세요.'}, 429)).turn({'text': 'x'});
    expect(limit.error, '오늘 이노봇 사용 한도를 다 썼습니다. 내일 다시 이용해 주세요.');
    expect(limit.disabled, isFalse);
  });

  test('turn — 끝 이벤트 없이 스트림이 끝나면 오류', () async {
    final o = await apiWith((r) async => sse([{'type': 'conversation', 'id': 'c1'}, {'type': 'text', 'delta': '반'}])).turn({'text': 'x'});
    expect(o.error, isNotNull);
  });

  test('list·load — 목록, 본문은 사람이 읽을 말만', () async {
    final api = apiWith((r) async {
      if (r.url.path == '/api/chat/conversations') return json({'conversations': [{'id': 'c1', 'title': '주간보고', 'model': 'claude-sonnet-5-5', 'last_message_at': '2026-10-15T01:00:00Z'}]});
      return json({'conversation': {'id': 'c1'}, 'toolCalls': [], 'messages': [
        {'id': 'm1', 'role': 'user', 'status': 'ok', 'content': [{'type': 'text', 'text': '메일'}, {'type': 'attachment', 'id': 'a', 'name': 'x.pdf'}]},
        {'id': 'm2', 'role': 'assistant', 'status': 'ok', 'content': [{'type': 'tool_use', 'id': 't1', 'name': 'mail_list', 'input': {}}]},
        {'id': 'm3', 'role': 'user', 'status': 'ok', 'content': [{'type': 'tool_result', 'tool_use_id': 't1', 'content': '받은메일 목록 3건'}]},
        {'id': 'm4', 'role': 'assistant', 'status': 'ok', 'content': [{'type': 'text', 'text': '세 통입니다'}]},
        {'id': 'm5', 'role': 'assistant', 'status': 'failed', 'content': [{'type': 'text', 'text': ''}]},
      ]});
    });
    expect((await api.list()).single.title, '주간보고');
    expect(await api.load('c1'), [(role: 'user', text: '메일'), (role: 'assistant', text: '세 통입니다')]);
  });

  test('load — 404는 ApiException', () async {
    final api = apiWith((r) async => json({'error': '대화를 찾지 못했습니다.'}, 404));
    await expectLater(api.load('c9'), throwsA(isA<ApiException>().having((e) => e.status, 'status', 404)));
  });
}
```

- [ ] **Step 2: 실패 확인** — `cd mobile && flutter test test/assistant/chat_api_test.dart` → FAIL(파일 없음)

- [ ] **Step 3: 구현** — `mobile/lib/assistant/chat_api.dart`:

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';

/// 서버가 멈추고 앱에 맡긴 도구 호출(needs_action). location: server|device|desktop-relay, tier: read|write|irreversible|meta|choice.
class PendingCall {
  const PendingCall({required this.id, required this.name, required this.input, required this.location, required this.tier, this.target});
  final String id, name, location, tier;
  final Map<String, dynamic> input;
  /// 서버가 조회한 실제 대상(서버 쓰기만)
  final String? target;
  bool get onServer => location == 'server';
}

class TurnOutcome {
  String? conversationId;
  List<PendingCall>? needsAction;
  String? error;
  bool disabled = false;
  final Map<String, String> toolStatus = {};
}

class ConversationSummary {
  const ConversationSummary(this.id, this.title, this.lastMessageAt);
  final String id, title, lastMessageAt;
}

/// 서버 저장 대화 API(/api/chat/*) — 웹 채팅과 같은 대화. 앱은 client:"app"으로 부른다.
class ChatApi {
  ChatApi(this.api);
  final ApiClient api;

  Future<TurnOutcome> turn(Map<String, dynamic> body, {void Function(String delta)? onText, void Function(String id, String tool, String status)? onTool, Future<void>? abort}) async {
    final o = TurnOutcome();
    var finished = false;
    try {
      await api.postSse('/api/chat/turn', body, (e) {
        switch (e['type']) {
          case 'conversation':
            o.conversationId = '${e['id']}';
          case 'text':
            onText?.call('${e['delta'] ?? ''}');
          case 'tool':
            final id = '${e['id']}', status = '${e['status']}';
            onTool?.call(id, '${e['tool']}', status);
            if (status != 'running') o.toolStatus[id] = status;
          case 'needs_action':
            finished = true;
            o.needsAction = [
              for (final c in (e['calls'] as List? ?? const []).whereType<Map>())
                PendingCall(id: '${c['id']}', name: '${c['tool']}', input: Map<String, dynamic>.from(c['input'] as Map? ?? const {}), location: '${c['location']}', tier: '${c['tier']}', target: c['target'] is String ? c['target'] as String : null),
            ];
          case 'done':
            finished = true;
          case 'error':
            finished = true;
            o.error = '${e['message'] ?? '이노봇이 답하지 못했습니다.'}';
        }
      }, abortTrigger: abort);
    } on ApiException catch (e) {
      if (e.code == 'assistant_disabled') {
        o.disabled = true;
      } else {
        o.error = e.message;
      }
      return o;
    }
    if (!finished) o.error = '응답이 중간에 끊겼습니다. 다시 시도해 주세요.';
    return o;
  }

  Future<List<ConversationSummary>> list({int limit = 50}) async {
    final j = await api.getJson('/api/chat/conversations', query: {'limit': '$limit'});
    final rows = j is Map && j['conversations'] is List ? j['conversations'] as List : const [];
    return [for (final r in rows.whereType<Map>()) ConversationSummary('${r['id']}', '${r['title'] ?? ''}', '${r['last_message_at'] ?? ''}')];
  }

  /// 화면에 다시 그릴 말 — 사용자·이노봇 텍스트만(도구 결과 행·실패 행·빈 행 제외).
  Future<List<({String role, String text})>> load(String id) async {
    final j = await api.getJson('/api/chat/conversations/${Uri.encodeComponent(id)}');
    final rows = j is Map && j['messages'] is List ? j['messages'] as List : const [];
    return [
      for (final r in rows.whereType<Map>())
        if (r['status'] != 'failed')
          if ([for (final b in (r['content'] as List? ?? const []).whereType<Map>()) if (b['type'] == 'text') '${b['text']}'].join('\n').trim() case final t when t.isNotEmpty)
            (role: r['role'] == 'user' ? 'user' : 'assistant', text: t),
    ];
  }
}

final chatApiProvider = Provider<ChatApi>((ref) => ChatApi(ref.watch(apiClientProvider)));
```

- [ ] **Step 4: 통과 확인** — `cd mobile && flutter test test/assistant/chat_api_test.dart && flutter analyze` → PASS, 이슈 0

- [ ] **Step 5: 커밋** — `feat(app): 서버 대화 API 클라이언트(ChatApi — 턴 SSE·목록·본문)`

---

### Task 3: `AssistantSession`을 서버 대화로 이전 + 테스트 가짜 서버 교체

**Files:**
- Modify: `mobile/lib/assistant/assistant_session.dart`
- Create: `mobile/test/assistant/chat_brain.dart`(테스트용 가짜 서버)
- Modify: `mobile/test/assistant/assistant_session_test.dart`(가짜를 `ChatBrain`으로, 프로토콜이 바뀐 테스트만 고침)
- 확인: `mobile/test/assistant/assistant_voice_choice_test.dart`, `assistant_sheet_test.dart`, 그 밖에 `/api/assistant/turn`을 흉내 내는 테스트(`grep -rln "api/assistant/turn" mobile/test`)

**Interfaces:**
- Consumes: Task 2 `ChatApi`·`PendingCall`·`TurnOutcome`·`chatApiProvider`; 기존 `AssistantToolRunner.run/resolve`, `tierOf`, `cardLine`, `progressText`, `slim`, `AssistantJournal`, `undoFor`, `MailReadGuard`.
- Produces(Task 4가 씀): `AssistantSession.conversationId`(getter, `String?`), `Future<void> open(String id)`(대화 불러오기 — 실패 시 안내만), `reset()`은 새 대화(conversationId null). 공개 메서드 `send/confirm/dismiss/fix/stop/reset`의 이름·인자는 그대로. `assistantTurnTimeoutProvider`(기본 300초).

**동작 규칙(테스트가 고정할 것):**
1. `send(text)`: 대기 카드가 있으면 카드를 "그만두었습니다"로 닫고(서버가 대기 호출을 취소로 닫음) `{'text': t}`로 보낸다. `awaitingFix`면 카드는 이미 닫혀 있으니 그냥 보낸다.
2. 모든 요청 body에 `client: 'app'`, `now: nowIso()`, 대화가 있으면 `conversationId`.
3. 스트림의 `text` 델타는 하나의 bot 말풍선에 이어 붙인다(첫 델타에서 말풍선 추가, progress 제거).
4. `tool` 이벤트 `running`이면 `progressText(tool)` 진행 표시.
5. `needs_action`: 서버 읽기(onServer && tier read)는 건너뛴다. 나머지는 지금의 `_handle` 규칙 그대로 — 앱 읽기는 실행, meta(undo_last)는 실행 기록으로 반대 작업 카드, choice는 단독일 때 선택지 카드, 쓰기(앱·서버 모두)는 `runner.resolve`로 실제 대상 카드. 카드가 필요 없으면 바로 회신.
6. 회신(`actions`)은 앱 호출(location != server) **전부**에 대해 `{'id', 'result': slim(r, bodyKeys: {'body','content'}), 'isError': r['ok'] == false}`. 서버 쓰기는 `{'id', 'approve': bool}`. 서버 읽기는 넣지 않는다.
7. `confirm()`: 카드의 쓰기를 순서대로 — 앱 쓰기는 `runner.run`으로 실행, 서버 쓰기는 앞에서 실패가 없으면 승인 표시만. 앞 작업이 실패하면 뒤 작업은 앱이면 "앞 작업이 실패해 실행하지 않았습니다", 서버면 `approve: false`. 회신 스트림의 `toolStatus`로 서버 쓰기 결과를 받아 카드 상태("실행했습니다"/"일부만 실행했습니다"/"실행하지 못했습니다")를 정한다.
8. `dismiss()`: 앱 쓰기는 `{'ok': false, 'error': '사용자가 취소함'}`, 서버 쓰기는 `approve: false`, 선택지는 offer_choices id에 취소 결과. `silent`면 회신하지 않고(다음 send에서 서버가 취소로 닫음) 카드만 닫는다.
9. `fix()`: 카드를 "고칠 내용을 말씀해 주세요"로 닫고 `awaitingFix: true`. 회신하지 않는다.
10. `stop()`: 스트림 abort, 대기 카드 해제, 안내(기존 문구). 서버에는 아무것도 보내지 않는다.
11. 꺼짐(`outcome.disabled`) → `assistantAvailableProvider.disable()` + "관리자가 비서를 꺼 두었습니다." 안내. 그 밖 오류 → 안내만(대화 id는 유지 — 서버가 실패 응답을 기록에서 뺀다).
12. 회신 왕복은 한 사용자 요청당 최대 `maxTurns`(10).
13. `open(id)`: busy면 무시. `chatApi.load` 결과로 items를 다시 그리고(사용자 → user, 이노봇 → bot) `conversationId = id`. 실패하면 현재 대화 그대로 + 안내 "대화를 불러오지 못했습니다.".
14. `reset()`: `conversationId = null` + 기존 초기화.

- [ ] **Step 1: 가짜 서버 `ChatBrain` 작성(테스트 도구)**

`mobile/test/assistant/chat_brain.dart` — 기존 `Brain`처럼 "옛 형식 턴 목록"을 받아 서버 프로토콜(SSE)로 흉내 낸다. 받은 요청을 **옛 messages 형식으로 재구성해** `received`에 남겨 기존 단언을 최대한 살린다.

```dart
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/assistant_tools.dart';

class BrainTokens implements TokenSource {
  @override
  Future<String?> accessToken() async => 't';
  @override
  Future<String?> refreshToken() async => 't';
  @override
  Future<void> onUnauthorized() async {}
}

/// 가짜 /api/chat/turn — turns는 옛 /api/assistant/turn 응답 형식({message, stop_reason} | {__status} | {__throw} | {enabled:false}).
/// 서버처럼: 서버 읽기만 든 응답은 직접 실행하고 다음 턴으로 이어 가며, 앱 호출·쓰기가 있으면 needs_action으로 멈춘다.
/// received: 각 Claude 호출 직전의 대화(옛 messages 형식), executed: 서버에서 실행된 도구 {tool, args}.
class ChatBrain {
  ChatBrain(this.turns, {this.waitForTurn});
  final List<Map<String, dynamic>> turns;
  final Future<void>? waitForTurn;
  final received = <List<dynamic>>[];
  final executed = <Map<String, dynamic>>[];
  final bodies = <Map<String, dynamic>>[];
  final history = <Map<String, dynamic>>[];
  List<Map<String, dynamic>> _pending = [];
  var conversations = 0;

  ApiClient get client => ApiClient(httpClient: MockClient(_handle), tokens: BrainTokens(), baseUrl: base, userAgent: 'test');
  static const base = 'https://brain.test';

  Map<String, dynamic> _serverRun(String name, Map input, bool approved) {
    final tier = tierOf(name);
    if (tier != ToolTier.read && !approved) return {'ok': false, 'error': '사용자가 취소했습니다.'};
    executed.add({'tool': name, 'args': input});
    return name == 'teams_chats'
        ? {'ok': true, 'result': {'chats': [{'id': '19:a@thread.v2', 'name': '센터', 'type': 'group'}]}}
        : {'ok': true, 'result': {'sent': true}};
  }

  Future<http.Response> _handle(http.Request r) async {
    if (r.url.path != '/api/chat/turn') {
      // 선택지 안의 서버 쓰기·카드용 대상 확인은 앱이 기존 /api/assistant/execute로 부른다
      final b = jsonDecode(r.body) as Map<String, dynamic>;
      final out = _serverRun('${b['tool']}', b['args'] as Map? ?? const {}, true);
      return _json(out);
    }
    final body = jsonDecode(r.body) as Map<String, dynamic>;
    bodies.add(body);
    if (waitForTurn != null) await waitForTurn;
    final events = <Map<String, dynamic>>[];
    if (body['conversationId'] == null) conversations++;
    events.add({'type': 'conversation', 'id': 'c$conversations'});
    if (body['actions'] is List) {
      final replies = {for (final a in (body['actions'] as List).whereType<Map>()) '${a['id']}': a};
      history.add({'role': 'user', 'content': [
        for (final c in _pending)
          if (c['location'] == 'server')
            _toolResult('${c['id']}', _serverRun('${c['tool']}', c['input'] as Map, replies['${c['id']}']?['approve'] == true))
          else if (replies['${c['id']}'] case final a?)
            {'type': 'tool_result', 'tool_use_id': '${c['id']}', 'content': jsonEncode(a['result']), if (a['isError'] == true) 'is_error': true}
          else
            {'type': 'tool_result', 'tool_use_id': '${c['id']}', 'content': '앱 응답 없음', 'is_error': true},
      ]});
      for (final c in _pending.where((c) => c['location'] == 'server')) {
        events.add({'type': 'tool', 'id': c['id'], 'tool': c['tool'], 'location': 'server', 'status': executed.isNotEmpty && executed.last['tool'] == c['tool'] ? 'ok' : 'error'});
      }
      _pending = [];
    } else {
      if (_pending.isNotEmpty) {
        history.add({'role': 'user', 'content': [for (final c in _pending) {'type': 'tool_result', 'tool_use_id': '${c['id']}', 'content': '취소됨(사용자가 다른 요청을 함)', 'is_error': true}]});
        _pending = [];
      }
      if (body['text'] != null) history.add({'role': 'user', 'content': body['text']});
    }
    for (var round = 0; round < 12; round++) {
      final head = turns.isEmpty ? null : turns.first;
      if (head != null && head['__status'] != null) {
        turns.removeAt(0);
        return _json({'error': '한도 초과'}, head['__status'] as int);
      }
      if (head != null && head['__throw'] == true) {
        turns.removeAt(0);
        throw http.ClientException('net');
      }
      if (head != null && head['enabled'] == false) {
        turns.removeAt(0);
        return _json({'error': '관리자가 이노봇을 꺼 두었습니다.', 'code': 'assistant_disabled'}, 403);
      }
      received.add(List.of(history));
      final t = turns.isEmpty ? {'message': {'role': 'assistant', 'content': [{'type': 'text', 'text': '(끝)'}]}, 'stop_reason': 'end_turn'} : turns.removeAt(0);
      final msg = Map<String, dynamic>.from(t['message'] as Map);
      history.add(msg);
      final blocks = (msg['content'] as List).whereType<Map>().toList();
      for (final b in blocks.where((b) => b['type'] == 'text')) {
        events.add({'type': 'text', 'delta': '${b['text']}'});
      }
      final uses = blocks.where((b) => b['type'] == 'tool_use').toList();
      if (uses.isEmpty) {
        events.add({'type': 'done', 'messageId': 'm${history.length}'});
        return _sse(events);
      }
      final calls = [
        for (final u in uses)
          {'id': '${u['id']}', 'tool': '${u['name']}', 'input': u['input'] ?? {}, 'location': serverToolNames.contains(u['name']) ? 'server' : 'device', 'tier': (tierOf('${u['name']}') ?? ToolTier.write).name},
      ];
      final auto = calls.every((c) => c['location'] == 'server' && c['tier'] == 'read');
      if (!auto) {
        _pending = calls;
        events.add({'type': 'needs_action', 'messageId': 'm${history.length}', 'calls': calls});
        return _sse(events);
      }
      history.add({'role': 'user', 'content': [for (final c in calls) _toolResult('${c['id']}', _serverRun('${c['tool']}', c['input'] as Map, false))]});
      for (final c in calls) {
        events.add({'type': 'tool', 'id': c['id'], 'tool': c['tool'], 'location': 'server', 'status': 'ok'});
      }
    }
    events.add({'type': 'done', 'messageId': 'last'});
    return _sse(events);
  }

  Map<String, dynamic> _toolResult(String id, Map<String, dynamic> r) => {'type': 'tool_result', 'tool_use_id': id, 'content': jsonEncode(r), if (r['ok'] == false) 'is_error': true};
  http.Response _sse(List<Map<String, dynamic>> ev) => http.Response.bytes(utf8.encode(ev.map((e) => 'data: ${jsonEncode(e)}\n\n').join()), 200, headers: {'content-type': 'text/event-stream; charset=utf-8'});
  http.Response _json(Object o, [int status = 200]) => http.Response.bytes(utf8.encode(jsonEncode(o)), status, headers: {'content-type': 'application/json; charset=utf-8'});
}
```

참고: 아마란스(GW) 가짜(`Gw`·`FakeGwStore` 등)는 기존 테스트 것을 그대로 쓴다. `ChatBrain.client`를 `apiClientProvider` override에 넣으면 `chatApiProvider`도 그것을 쓴다.

- [ ] **Step 2: 세션 테스트를 `ChatBrain`으로 옮겨 실패시키기**

`assistant_session_test.dart`에서:
- `Brain` 클래스를 지우고 `import 'chat_brain.dart';`, 사용처를 `ChatBrain`으로. `assistantWaitTimeoutProvider`를 줄이던 테스트는 `assistantTurnTimeoutProvider`도 같은 값으로 override.
- 그대로 둘 테스트(단언이 `received`의 옛 형식·카드·실행 기록을 보므로 가짜가 재구성해 준다): 177(중지 후 늦은 응답), 353, 435, 517, 569, 674, 700, 731, 779, 804, 828, 867, 889, 910, 924, 936, 953, 1008, 1034, 1068.
- 프로토콜이 바뀌어 고쳐 쓸 테스트:
  - 209 "쓰기 중 중지" → 단언을 "나머지 쓰기는 실행 안 함 + 서버에 아무것도 보내지 않음(`brain.bodies` 길이 변화 없음) + 다음 send의 received 마지막 앞에 '취소됨' tool_result" 로.
  - 266 "응답이 오지 않으면 시간 초과" → `assistantTurnTimeoutProvider`를 짧게 override.
  - 293 "실행 완료 뒤 후속 답변 중지" → 카드 상태는 유지, 서버에 보낸 actions(`brain.bodies.last['actions']`)에 실행 결과가 들어 있었음을 단언.
  - 468 "그만두기·고쳐 줘" → 그만두기: actions에 앱 쓰기 `{'ok':false,'error':'사용자가 취소함'}`·서버 쓰기 `approve:false`; 고쳐 줘: 회신 없음, 다음 send는 `{'text':…}`이고 received에 '취소됨' 결과가 앞에 붙음.
  - 586 "서버가 꺼져 있으면 안내, Teams 쓰기는 확인 후" → Teams 쓰기는 카드 확인 후 `actions`의 `approve:true`로 서버 실행(`brain.executed`에 teams_send), `/api/assistant/execute`로 보내지 않음.
  - 616 `trimHistory` 테스트 → 함수가 없어지므로 삭제.
  - 717 "첫 턴 실패 {enabled:false}" → 꺼짐 403 → 안내·disabled.
  - 977 "{enabled:false}면 숨긴다" → 403 code assistant_disabled로.
- 새 테스트(Review Focus):
  - "섞인 호출" — 한 응답에 `teams_chats`(서버 읽기)·`mail_list`(앱 읽기)·`reserve_room`(앱 쓰기) → 앱은 mail_list만 실행하고 카드에 reserve_room 한 줄, confirm 뒤 actions에 mail_list·reserve_room 결과가 모두 있고 teams_chats는 없음, `brain.executed`에 teams_chats.
  - "앞 실패 뒤 서버 쓰기 미승인" — 카드에 `reserve_room`(실패하도록 가짜 GW 설정)·`teams_send` → actions의 teams_send가 `approve:false`, `brain.executed`에 teams_send 없음, 카드 "실행하지 못했습니다".
  - "대화 id 유지" — 두 번째 send의 body에 첫 응답의 `conversationId`, `client:'app'`, `now` 형식.
  - "reset 뒤 새 대화" — reset 후 send body에 conversationId 없음.

Run: `cd mobile && flutter test test/assistant/assistant_session_test.dart`
Expected: FAIL(세션이 아직 `/api/assistant/turn`을 부름)

- [ ] **Step 3: 세션 구현**

`assistant_session.dart` 변경(나머지 — `ChatKind`·`ChatItem`·`ChoiceView`·`_Choice`·`AssistantState`·`nowIso`·`assistantClockProvider`·`assistantAvailableProvider`·`_wait`·`_runner`·`_offerChoices`의 카드 구성·`_markCardDone`·`_Pending`의 필드는 그대로):

1) 상단 주석을 "서버(/api/chat/turn)가 대화를 저장한다. 앱은 needs_action을 받아 앱 도구를 실행하고 확인 카드를 보인 뒤 actions로 회신한다."로. import에 `chat_api.dart`. `trimHistory`·`_messages`·`_fixResults`·`_rollbackFailedTurn`·`_result` 삭제.

2) 필드·프로바이더:

```dart
final assistantTurnTimeoutProvider = Provider<Duration>((_) => const Duration(seconds: 300));
```

```dart
  String? _conversationId;
  String? get conversationId => _conversationId;
  final _approved = <String>{}; // confirm에서 승인한 서버 쓰기 id
  Map<String, PendingCall> _calls = {}; // 현재 needs_action 호출(id → 위치·등급)
```

`build()`에서 `_conversationId = null; _calls = {}; _approved.clear();`도 비운다(기존 `_messages.clear()` 자리).

3) 회신 빌더:

```dart
  Map<String, dynamic> _reply(String id, Map<String, dynamic> r) => {
    'id': id,
    'result': slim(r, bodyKeys: const {'body', 'content'}),
    if (r['ok'] == false) 'isError': true,
  };

  /// 대기 중이던 호출 전부에 대한 회신 — 앱 호출은 결과, 서버 쓰기는 승인 여부, 서버 읽기는 서버가 실행하므로 뺀다.
  List<Map<String, dynamic>> _repliesFor(_Pending p, Map<String, Map<String, dynamic>> writeResults) => [
    for (final r in _resultsFor(p, writeResults))
      if (_calls[r['id']]?.onServer == true)
        if (tierOf(_calls[r['id']]!.name) != ToolTier.read) {'id': r['id'], 'approve': _approved.contains(r['id'])}
        else ...const <Map<String, dynamic>>[]
      else r,
  ];
```

`_resultsFor`는 반환을 `_reply(id, …)` 목록으로 바꾼다(기존 `_result` 자리에 `_reply`). 서버 읽기 id는 `p.order`에 들어 있지 않게 5)에서 거른다.

4) 턴 루프:

```dart
  Future<void> _drive(Map<String, dynamic> first) async {
    final run = _run = _Run();
    _set(busy: true);
    var body = first;
    try {
      for (var turn = 0; turn < maxTurns; turn++) {
        _add(const ChatItem(ChatKind.progress, '생각하는 중…'));
        var botIndex = -1;
        final outcome = await _waitTurn(run, ref.read(chatApiProvider).turn(
          {...body, 'client': 'app', 'now': nowIso(), if (_conversationId != null) 'conversationId': _conversationId},
          onText: (d) {
            if (!_active(run) || d.isEmpty) return;
            final items = [...state.items.where((x) => x.kind != ChatKind.progress)];
            if (botIndex < 0 || botIndex >= items.length) {
              items.add(ChatItem(ChatKind.bot, d));
              botIndex = items.length - 1;
            } else {
              items[botIndex] = items[botIndex].copyWith(text: items[botIndex].text + d);
            }
            _set(items: items);
          },
          onTool: (id, tool, status) {
            if (_active(run) && status == 'running') _add(ChatItem(ChatKind.progress, progressText(tool)));
          },
          abort: run.stopped.future,
        ));
        if (outcome.conversationId != null) _conversationId = outcome.conversationId;
        _lastToolStatus = outcome.toolStatus;
        if (outcome.disabled) {
          ref.read(assistantAvailableProvider.notifier).disable();
          _add(const ChatItem(ChatKind.notice, '관리자가 비서를 꺼 두었습니다.'));
          return;
        }
        if (outcome.error != null) {
          _add(ChatItem(ChatKind.notice, outcome.error!));
          return;
        }
        final calls = outcome.needsAction;
        if (calls == null) return;
        final replies = await _handle(calls, run);
        if (replies == null) return; // 확인 카드 대기
        body = {'actions': replies};
      }
      _add(const ChatItem(ChatKind.notice, '요청이 너무 복잡합니다. 나눠서 다시 말씀해 주세요.'));
    } on _Stopped {
      return;
    } catch (_) {
      _pending = null;
      _add(const ChatItem(ChatKind.notice, '처리하지 못했습니다. 다시 시도해 주세요.'));
    } finally {
      if (_active(run)) {
        _run = null;
        _set(busy: false, items: [...state.items.where((x) => x.kind != ChatKind.progress)]);
      }
    }
  }

  Map<String, String> _lastToolStatus = const {};

  /// 스트림 대기 — _wait와 같지만 시간 상한은 assistantTurnTimeoutProvider(서버 도구 왕복·중계 때문에 길다).
  Future<T> _waitTurn<T>(_Run run, Future<T> future) async {
    try {
      final result = await Future.any<T>([future, run.stopped.future.then<T>((_) => throw _Stopped())]).timeout(
        ref.read(assistantTurnTimeoutProvider),
        onTimeout: () { if (_active(run)) stop(timedOut: true); throw _Stopped(); },
      );
      if (!_active(run)) throw _Stopped();
      return result;
    } catch (_) {
      if (!_active(run)) throw _Stopped();
      rethrow;
    }
  }
```

(네트워크 예외는 `ChatApi.turn`이 `ApiException`만 잡으므로 `http.ClientException` 등은 catch로 와서 "처리하지 못했습니다" — 기존 "네트워크 연결을 확인하고 다시 시도해 주세요." 문구를 유지하려면 `on Exception catch` 앞에 `ClientException`·`SocketException`을 구분해 그 문구를 쓴다. 기존 테스트 700·674가 문구를 단언하면 그 문구를 따른다.)

5) `_handle(List<PendingCall> pcs, _Run run)` → `Future<List<Map<String, dynamic>>?>`(null = 카드 대기). 기존 `_handle` 본문을 옮기되:
- 맨 앞: `_calls = {for (final p in pcs) p.id: p};` `final calls = [for (final p in pcs) if (!(p.onServer && tierOf(p.name) == ToolTier.read)) ToolCall(p.id, p.name, p.input)];` — 서버 읽기는 뺀다. `calls`가 비면 `return const [];`(서버가 실행).
- 텍스트·stop_reason 처리 삭제(텍스트는 스트림으로 이미 그림).
- choice 단독이 아닐 때의 오류 결과, 모르는 도구, 읽기 실행, meta, 쓰기 수집, 카드 대상 확인 로직은 그대로. 기존에 `_messages.add({'role':'user','content': …})` 후 `return true` 하던 곳은 `return [for (…) _reply(id, r)]`(`_resultsFor(p, …)`를 쓰던 곳은 `_repliesFor(p, …)`). 카드를 띄우고 `return false` 하던 곳은 `return null`.
- `_offerChoices`도 같은 방식으로 `Future<List<Map<String, dynamic>>?>`를 돌려준다(카드면 null, 오류 결과면 `[_reply(c.id, …)]`).

6) `send`:

```dart
  Future<void> send(String text) async {
    final t = text.trim();
    if (t.isEmpty || state.busy) return;
    if (state.pending) {
      _pending = null;
      _markCardDone('그만두었습니다');
    }
    _add(ChatItem(ChatKind.user, t));
    if (!state.awaitingFix) _guard.reset();
    _set(awaitingFix: false);
    await _drive({'text': t});
  }
```

7) `confirm({int? choice})`: 기존 흐름을 유지하되 —
- 쓰기 루프에서 `final server = _calls[w.id]?.onServer == true;` 이면 실행하지 않고 `if (!failed) _approved.add(w.id);` 결과 자리는 비워 둔다(`out`에 넣지 않음). 앞 실패면 승인하지 않는다.
- 선택지(`picked != null`)의 쓰기는 지금처럼 전부 `runner.run`(서버 도구도 기존 `/api/assistant/execute` 경로).
- 쓰기 루프가 끝나면 `await _drive({'actions': _repliesFor(p, picked == null ? out : {…선택지 결과…})})` — 기존 `_messages.add` + `_drive()` 자리.
- 카드 상태는 `_drive`가 끝난 뒤 계산: 서버 쓰기의 성공은 `_lastToolStatus[w.id] == 'ok'`, 앱 쓰기는 `out[w.id]?['ok'] == true`. 상태 문구 규칙은 기존과 같다. (`_markCardDone('실행 중…')`은 시작 때 그대로.)
- `interruptedResults` 관련 코드는 삭제(중지 시 서버에 보내지 않음).

8) `dismiss({bool silent = false})`:

```dart
  Future<void> dismiss({bool silent = false}) async {
    final p = _pending;
    if (p == null || state.busy) return;
    _pending = null;
    _markCardDone('그만두었습니다');
    if (silent) return; // 다음 입력 때 서버가 대기 호출을 "취소됨"으로 닫는다
    _approved.clear();
    await _drive({'actions': _repliesFor(p, {
      for (final w in p.writes) w.id: {'ok': false, 'error': '사용자가 취소함'},
      if (p.choiceId != null) p.choiceId!: {'ok': false, 'error': '사용자가 취소함'},
    })});
  }
```

9) `fix()`: `_pending = null; _markCardDone('고칠 내용을 말씀해 주세요'); _set(awaitingFix: true);`(결과를 보관하지 않음).

10) `stop({bool timedOut = false})`: `_messages`·`interruptedResults`·`_rollbackFailedTurn` 관련 줄을 지우고 나머지(카드 "중지했습니다 · 실행 여부를 확인해 주세요", 안내 문구)는 그대로.

11) `open` / `reset`:

```dart
  /// 서버 대화 불러오기(🕘 기록). 실패하면 지금 대화를 그대로 두고 안내만.
  Future<void> open(String id) async {
    if (state.busy) return;
    try {
      final lines = await ref.read(chatApiProvider).load(id);
      state = build();
      _conversationId = id;
      _set(items: [
        for (final l in lines) ChatItem(l.role == 'user' ? ChatKind.user : ChatKind.bot, l.text),
        if (lines.isEmpty) const ChatItem(ChatKind.bot, '무엇을 도와드릴까요?'),
      ]);
    } catch (_) {
      _add(const ChatItem(ChatKind.notice, '대화를 불러오지 못했습니다.'));
    }
  }
```

`reset()`은 그대로(`build()`가 `_conversationId`를 비움).

- [ ] **Step 4: 통과 확인**

Run: `cd mobile && flutter test test/assistant && flutter analyze`
Expected: PASS, 이슈 0. 다른 테스트 파일이 `/api/assistant/turn`을 흉내 내면(`grep -rln "api/assistant/turn" test`) `ChatBrain`으로 바꾼다.

- [ ] **Step 5: 전체 테스트**

Run: `cd mobile && flutter test`
Expected: 전부 PASS

- [ ] **Step 6: 커밋** — `feat(app): 이노봇이 서버 저장 대화(/api/chat/turn)를 쓴다 — needs_action 처리·actions 회신·스트리밍 답`

---

### Task 4: 시트의 🕘 대화 기록

**Files:**
- Create: `mobile/lib/assistant/conversation_list_sheet.dart`
- Modify: `mobile/lib/assistant/assistant_sheet.dart`(헤더에 🕘 버튼)
- Test: `mobile/test/assistant/conversation_list_test.dart`

**Interfaces:**
- Consumes: Task 2 `ChatApi.list`, Task 3 `AssistantSession.open`·`conversationId`.
- Produces: `Future<String?> showConversationList(BuildContext context)` — 고른 대화 id(닫으면 null).

- [ ] **Step 1: 실패하는 위젯 테스트**

```dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/conversation_list_sheet.dart';
import 'chat_brain.dart' show BrainTokens;

void main() {
  testWidgets('대화 목록 — 제목을 보여 주고 누르면 id를 돌려준다, 비면 안내', (t) async {
    var rows = [{'id': 'c1', 'title': '주간보고 초안', 'model': 'claude-sonnet-5-5', 'last_message_at': '2026-10-15T01:00:00Z'}];
    final api = ApiClient(httpClient: MockClient((r) async => http.Response.bytes(utf8.encode(jsonEncode({'conversations': rows})), 200, headers: {'content-type': 'application/json; charset=utf-8'})), tokens: BrainTokens(), baseUrl: 'https://x.test', userAgent: 'UA');
    String? picked;
    await t.pumpWidget(ProviderScope(overrides: [apiClientProvider.overrideWithValue(api)], child: MaterialApp(home: Builder(builder: (c) => TextButton(onPressed: () async => picked = await showConversationList(c), child: const Text('열기'))))));
    await t.tap(find.text('열기'));
    await t.pumpAndSettle();
    expect(find.text('주간보고 초안'), findsOneWidget);
    await t.tap(find.text('주간보고 초안'));
    await t.pumpAndSettle();
    expect(picked, 'c1');
    rows = [];
    await t.tap(find.text('열기'));
    await t.pumpAndSettle();
    expect(find.text('저장된 대화가 없습니다.'), findsOneWidget);
  });
}
```

`assistant_sheet_test.dart`에 추가: 헤더에 툴팁 '대화 기록' 버튼이 있다(`find.byTooltip('대화 기록')`).

- [ ] **Step 2: 실패 확인** — `cd mobile && flutter test test/assistant/conversation_list_test.dart` → FAIL

- [ ] **Step 3: 구현**

`conversation_list_sheet.dart`:

```dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/theme.dart';
import 'chat_api.dart';

/// 🕘 대화 기록 — 서버에 저장된 내 대화(웹 /chat과 같은 목록). 고른 대화 id를 돌려준다.
Future<String?> showConversationList(BuildContext context) => showModalBottomSheet<String>(
  context: context,
  isScrollControlled: true,
  backgroundColor: Brand.ground,
  builder: (_) => const FractionallySizedBox(heightFactor: 0.7, child: _ConversationList()),
);

class _ConversationList extends ConsumerStatefulWidget {
  const _ConversationList();
  @override
  ConsumerState<_ConversationList> createState() => _ConversationListState();
}

class _ConversationListState extends ConsumerState<_ConversationList> {
  late final Future<List<ConversationSummary>> _items = ref.read(chatApiProvider).list();

  String _when(String iso) {
    final d = DateTime.tryParse(iso)?.toUtc().add(const Duration(hours: 9));
    if (d == null) return '';
    String two(int v) => v.toString().padLeft(2, '0');
    return '${d.month}/${d.day} ${two(d.hour)}:${two(d.minute)}';
  }

  @override
  Widget build(BuildContext context) => Column(
    children: [
      const Padding(padding: EdgeInsets.fromLTRB(16, 16, 16, 8), child: Align(alignment: Alignment.centerLeft, child: Text('대화 기록', style: TextStyle(fontSize: 16, fontWeight: FontWeight.w700, color: Brand.navy)))),
      Expanded(
        child: FutureBuilder<List<ConversationSummary>>(
          future: _items,
          builder: (context, s) {
            if (s.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
            if (s.hasError) return const Center(child: Text('대화 기록을 불러오지 못했습니다.'));
            final items = s.data ?? const [];
            if (items.isEmpty) return const Center(child: Text('저장된 대화가 없습니다.'));
            return ListView(children: [
              for (final c in items)
                ListTile(title: Text(c.title.isEmpty ? '새 대화' : c.title, maxLines: 1, overflow: TextOverflow.ellipsis), subtitle: Text(_when(c.lastMessageAt)), onTap: () => Navigator.of(context).pop(c.id)),
            ]);
          },
        ),
      ),
    ],
  );
}
```

`assistant_sheet.dart` 헤더의 '새 대화' `IconButton` 앞에 추가(import `conversation_list_sheet.dart`):

```dart
                IconButton(
                  tooltip: '대화 기록',
                  icon: const Icon(Icons.history),
                  onPressed: st.busy
                      ? null
                      : () async {
                          final id = await showConversationList(context);
                          if (id != null) {
                            _stopSpeaking();
                            await s.open(id);
                          }
                        },
                ),
```

- [ ] **Step 4: 통과 확인** — `cd mobile && flutter test test/assistant && flutter analyze` → PASS

- [ ] **Step 5: 커밋** — `feat(app): 이노봇 🕘 대화 기록 — 웹과 같은 서버 대화를 이어서`

---

### Task 5: 문서와 마무리

**Files:**
- Modify: `.claude/rules/mobile.md`(비서 이노봇 줄), `docs/mobile-app.md`(§비서), `frontend/src/lib/manual/sections.ts`(앱 `innobot` 절 — 대화 기록·웹과 이어짐), `CLAUDE.md`(`/api/assistant/turn` 줄)

- [ ] **Step 1: 문서**
- `.claude/rules/mobile.md` 비서 이노봇 문장에서 "서버는 무상태 중계(대화·인자·결과 저장·로그 금지…)"를 "서버가 대화를 저장한다(`/api/chat/turn`, 앱은 client:\"app\" — needs_action을 받아 앱 도구 실행·확인 카드 후 actions로 회신, 결과는 요약만 저장, 감사엔 도구 이름·토큰·가린 건수). 선택지 안의 서버 쓰기와 카드용 대상 확인은 기존 `/api/assistant/execute`. 구버전 앱용 `/api/assistant/turn`은 이 버전이 퍼질 때까지 유지"로. "Claude 호출은 between_tools·4096·비스트리밍"은 "between_tools·8192·스트리밍(SSE)"로.
- `docs/mobile-app.md` §비서: 위와 같은 내용 + 🕘 대화 기록, 웹 `/chat`과 같은 대화.
- `sections.ts` 앱 `innobot` 절 steps에 "🕘 대화 기록에서 지난 대화를 열어 이어서 묻습니다. 웹 이노봇(/chat)에서 시작한 대화도 같은 목록에 있습니다." 한 줄, note에 "대화는 서버에 저장되며 보존 기간(기본 90일)이 지나면 지워집니다."
- `CLAUDE.md`의 `POST /api/assistant/turn` 줄 끝에 "(구버전 앱용 — 앱 1.7.0부터 `/api/chat/turn`)".

- [ ] **Step 2: 확인** — `cd frontend && npx vitest run src/lib/__tests__/manual*` 및 `cd mobile && flutter analyze && flutter test` → PASS

- [ ] **Step 3: 커밋** — `docs(app): 이노봇 서버 대화 이전·대화 기록 문서`

- [ ] **Step 4: 웹 배포(서버 403 code 반영)** — 컨트롤러: push 후 `cd frontend && vercel --prod --yes`, 배포 URL·alias 확인. 앱 릴리스는 사용자 지시가 있을 때 기존 릴리스 절차로(버전 1.7.0+51 제안).
