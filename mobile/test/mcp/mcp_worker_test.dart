import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/mcp/mcp_worker_provider.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:playground/mcp/mcp_worker.dart';

/// 가짜 저장소: claim은 pending인 것만 한 번 넘기고, complete는 기록만.
class FakeStore {
  final pending = <String, McpCall>{};
  final log = <String>[];
  final results = <String, ({String? text, String? error})>{};
  final all = <String, McpCall>{};
  bool claimAll = true;

  McpCall call(String id, [String tool = 'whoami']) => all[id] = McpCall(id: id, tool: tool, args: const {});

  Future<List<McpCall>> fetchPending() async => pending.values.toList();
  Future<McpCall?> claim(String id) async {
    log.add('claim:$id');
    if (!claimAll) return null;
    pending.remove(id);
    return all[id];
  }

  Future<void> complete(String id, {String? text, String? error}) async {
    log.add('complete:$id');
    results[id] = (text: text, error: error);
  }
}

void main() {
  test('① 실시간으로 받은 호출을 claim→execute→complete(text) 순서로 처리하고 상태를 남긴다', () async {
    final s = FakeStore();
    final inserts = StreamController<McpCall>();
    final w = McpWorker(fetchPending: s.fetchPending, claim: s.claim, complete: s.complete, inserts: inserts.stream, poll: const Duration(hours: 1), execute: (tool, args) async {
      s.log.add('execute:$tool');
      return '{"ok":true}';
    });
    await w.start();
    inserts.add(s.call('a'));
    await pumpEventQueue();
    expect(s.log, ['claim:a', 'execute:whoami', 'complete:a']);
    expect(s.results['a'], (text: '{"ok":true}', error: null));
    expect(w.handled, 1);
    expect(w.lastTool, 'whoami');
    expect(w.lastAt, isNotNull);
    w.dispose();
    await inserts.close();
  });

  test('② claim이 null(다른 기기가 가져감)이면 실행·완료하지 않는다', () async {
    final s = FakeStore()..claimAll = false;
    final w = McpWorker(fetchPending: s.fetchPending, claim: s.claim, complete: s.complete, execute: (_, _) async => fail('실행하면 안 됨'));
    await w.handle(s.call('a'));
    expect(s.log, ['claim:a']);
    expect(w.handled, 0);
  });

  test('③ McpToolError는 그 문장으로, 다른 예외는 원문 없이 타입만 error로 완료', () async {
    final s = FakeStore();
    final w = McpWorker(fetchPending: s.fetchPending, claim: s.claim, complete: s.complete, execute: (tool, _) async {
      if (tool == 'bad') throw McpToolError('모르는 도구입니다: bad');
      throw const FormatException('secret-token-abc');
    });
    await w.handle(s.call('a', 'bad'));
    await w.handle(s.call('b', 'boom'));
    expect(s.results['a'], (text: null, error: '모르는 도구입니다: bad'));
    expect(s.results['b']!.error, '처리하지 못했습니다: FormatException');
    expect(s.results['b']!.error, isNot(contains('secret')));
  });

  test('④ 두 호출이 동시에 와도 클레임은 즉시, 실행은 직렬(실행 중 최대 1)', () async {
    final s = FakeStore();
    var running = 0, maxRunning = 0;
    final w = McpWorker(fetchPending: s.fetchPending, claim: s.claim, complete: s.complete, execute: (_, _) async {
      running++;
      if (running > maxRunning) maxRunning = running;
      await Future<void>.delayed(const Duration(milliseconds: 20));
      running--;
      return '{}';
    });
    await Future.wait([w.handle(s.call('a')), w.handle(s.call('b'))]);
    expect(maxRunning, 1);
    // b의 클레임이 a 실행 완료 전에 일어나야 웹이 10초 안에 클레임을 본다
    expect(s.log.indexOf('claim:b'), lessThan(s.log.indexOf('complete:a')));
    expect(s.log.indexOf('complete:a'), lessThan(s.log.indexOf('complete:b')));
  });

  test('⑤ 안전 폴링: fetchPending이 준 pending을 처리한다', () async {
    final s = FakeStore();
    s.pending['p'] = s.call('p', 'list_mail_inbox');
    final w = McpWorker(fetchPending: s.fetchPending, claim: s.claim, complete: s.complete, poll: const Duration(milliseconds: 20), execute: (_, _) async => '{}');
    unawaited(w.start());
    await Future<void>.delayed(const Duration(milliseconds: 80));
    w.dispose();
    expect(s.log.where((e) => e == 'complete:p'), hasLength(1));
    expect(w.lastTool, 'list_mail_inbox');
  });

  test('⑥ 실행 시간 제한을 넘기면 "앱 실행 시간 초과"', () async {
    final s = FakeStore();
    final w = McpWorker(fetchPending: s.fetchPending, claim: s.claim, complete: s.complete, timeout: const Duration(milliseconds: 20), execute: (_, _) => Completer<String>().future);
    await w.handle(s.call('a'));
    expect(s.results['a'], (text: null, error: mcpTimeoutMessage));
    expect(mcpTimeoutMessage, startsWith('앱 실행 시간 초과 — 쓰기 작업이었다면 이미 반영됐을 수 있으니 다시 실행하지 말고'));
  });

  test('⑦ 512KB 넘는 결과는 앞부분 + …(truncated), JSON이면 {"truncated":true,"text":…}', () async {
    final s = FakeStore();
    final big = 'x' * (600 * 1024);
    final w = McpWorker(fetchPending: s.fetchPending, claim: s.claim, complete: s.complete, execute: (tool, _) async => tool == 'json' ? jsonEncode({'body': big}) : big);
    await w.handle(s.call('plain', 'plain'));
    await w.handle(s.call('j', 'json'));
    final plain = s.results['plain']!.text!;
    expect(plain.endsWith('…(truncated)'), true);
    expect(utf8.encode(plain).length, lessThanOrEqualTo(mcpResultLimit + 20));
    final j = jsonDecode(s.results['j']!.text!) as Map<String, dynamic>;
    expect(j['truncated'], true);
    expect((j['text'] as String).startsWith('{"body":"xxx'), true);
    expect((j['text'] as String).endsWith('…(truncated)'), true);
    expect(truncateResult('짧음'), '짧음');
  });

  test('⑧ 같은 id가 실시간과 handle로 동시에 와도 claim은 한 번', () async {
    final s = FakeStore();
    final inserts = StreamController<McpCall>();
    final w = McpWorker(fetchPending: s.fetchPending, claim: s.claim, complete: s.complete, inserts: inserts.stream, poll: const Duration(hours: 1), execute: (_, _) async => '{}');
    await w.start();
    final c = s.call('a');
    inserts.add(c);
    await Future.wait([w.handle(c), pumpEventQueue()]);
    await pumpEventQueue();
    expect(s.log.where((e) => e == 'claim:a'), hasLength(1));
    w.dispose();
    await inserts.close();
  });

  group('요청 받기 스위치(mcpEnabledProvider)', () {
    Future<bool> settled(Map<String, Object> prefs) async {
      SharedPreferences.setMockInitialValues(prefs);
      final c = ProviderContainer();
      addTearDown(c.dispose);
      expect(c.read(mcpEnabledProvider), false); // 저장값을 읽기 전에는 꺼짐 — 끈 사용자에게 워커가 잠깐 돌지 않게
      await pumpEventQueue();
      return c.read(mcpEnabledProvider);
    }

    test('저장값 없으면 켬, 끈 값이 있으면 끔', () async {
      expect(await settled({}), true);
      expect(await settled({'mcp_enabled': false}), false);
    });
  });
}
