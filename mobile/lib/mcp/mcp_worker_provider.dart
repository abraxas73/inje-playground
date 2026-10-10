import 'dart:async';
import 'dart:io';
import 'dart:math';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../auth/session.dart';
import 'mcp_worker.dart';

const _enabledKey = 'mcp_enabled', _installKey = 'mcp_install_id';

/// 설정 스위치 "요청 받기"(저장값 없으면 켬). 저장값을 읽기 전에는 꺼진 상태로 시작해, 끈 사용자에게 시작 시 워커가 잠깐 도는 일이 없게 한다.
class McpEnabled extends Notifier<bool> {
  bool _userSet = false;

  @override
  bool build() {
    _load();
    return false;
  }

  Future<void> _load() async {
    try {
      final v = (await SharedPreferences.getInstance()).getBool(_enabledKey);
      if (ref.mounted && !_userSet) state = v ?? true;
    } catch (_) {}
  }

  Future<void> set(bool v) async {
    _userSet = true;
    state = v;
    await (await SharedPreferences.getInstance()).setBool(_enabledKey, v);
  }
}

final mcpEnabledProvider = NotifierProvider<McpEnabled, bool>(McpEnabled.new);

/// Task 6의 McpTools.execute로 바뀐다.
Future<String> mcpPlaceholderExecute(String tool, Map<String, dynamic> args) async => throw McpToolError('모르는 도구입니다: $tool');

/// 클레임 충돌 진단용 기기 식별: 설치 id(무작위 hex, shared_preferences) + 플랫폼.
Future<String> _workerId() async {
  final prefs = await SharedPreferences.getInstance();
  var id = prefs.getString(_installKey);
  if (id == null) {
    final r = Random.secure();
    id = List.generate(16, (_) => r.nextInt(256).toRadixString(16).padLeft(2, '0')).join();
    await prefs.setString(_installKey, id);
  }
  return '$id/${Platform.operatingSystem}';
}

/// macOS·Windows에서만: 앱 로그인 + 스위치 켬일 때 `mcp_calls`를 구독·폴링해 Claude 커넥터 요청을 대신 실행한다.
final mcpWorkerProvider = Provider<McpWorker?>((ref) {
  if (!(Platform.isMacOS || Platform.isWindows)) return null;
  if (!ref.watch(sessionProvider.select((s) => s.asData?.value != null)) || !ref.watch(mcpEnabledProvider)) return null; // 로그인 여부만 — reload()로 채널을 다시 만들지 않게
  final client = Supabase.instance.client;
  final uid = client.auth.currentUser?.id;
  if (uid == null) return null;
  final table = client.from('mcp_calls');
  final workerId = _workerId();
  final inserts = StreamController<McpCall>();
  final channel = client
      .channel('mcp_calls:$uid')
      .onPostgresChanges(
        event: PostgresChangeEvent.insert,
        schema: 'public',
        table: 'mcp_calls',
        filter: PostgresChangeFilter(type: PostgresChangeFilterType.eq, column: 'user_id', value: uid),
        callback: (payload) {
          final c = McpCall.fromRow(payload.newRecord);
          if (c != null && !inserts.isClosed) inserts.add(c);
        },
      )
      .subscribe();
  final w = McpWorker(
    inserts: inserts.stream,
    execute: mcpPlaceholderExecute,
    fetchPending: () async => [for (final r in await table.select('id, tool, args').eq('status', 'pending').order('created_at')) ?McpCall.fromRow(r)],
    claim: (id) async {
      final r = await table.update({'status': 'running', 'worker': await workerId, 'claimed_at': DateTime.now().toUtc().toIso8601String()}).eq('id', id).eq('status', 'pending').select('id, tool, args').maybeSingle();
      return r == null ? null : McpCall.fromRow(r);
    },
    // 웹이 시간 초과로 행을 지웠으면 0행 갱신 — 오류 아님.
    complete: (id, {text, error}) => table.update({'status': error == null ? 'done' : 'error', 'result': error == null ? {'text': text} : {'error': error}, 'done_at': DateTime.now().toUtc().toIso8601String()}).eq('id', id).eq('status', 'running'),
  );
  w.start();
  ref.onDispose(() {
    w.dispose();
    inserts.close();
    client.removeChannel(channel);
  });
  return w;
});
