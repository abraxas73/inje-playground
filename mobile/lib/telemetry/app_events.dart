import 'dart:async';
import 'package:flutter/foundation.dart';
import '../config.dart';

/// 서버 `POST /api/app/events`가 받는 kind → code(frontend/src/lib/app-events.ts와 같게). app_error는 예외 타입 이름.
/// 메시지·스택·아마란스 아이디·토큰·메일 제목/본문은 절대 넣지 않는다.
const appEventCodes = <String, Set<String>?>{
  'gw_login_failed': {'no_field', 'no_button', 'watchdog', 'reveal_error', 'otp', 'verify_failed'},
  'gw_unauthorized': {'session_expired'},
  'app_error': null,
};

/// 예외 → 타입 이름만(서버 형식 `[A-Za-z_$][\w$<>,.? ]{0,79}`에 맞게 다른 글자는 _로).
String errorTypeName(Object error) {
  final s = error.runtimeType.toString().replaceAll(RegExp(r'[^\w$<>,.? ]'), '_');
  final t = RegExp(r'^[A-Za-z_$]').hasMatch(s) ? s : '_$s';
  return t.length > 80 ? t.substring(0, 80) : t;
}

/// 장애 신호를 메모리 큐에 모아 [delay] 뒤 한 번에 보낸다. [sender]가 없으면(앱 연결 전·로그인 전·개발 빌드) 바로 버린다.
/// 보내기 실패는 조용히 버린다 — 앱 동작에 영향 없게.
class AppEvents {
  AppEvents({this.delay = const Duration(seconds: 10)});
  final Duration delay;

  /// 이벤트 묶음을 보낸다. 로그인 여부 확인은 sender 몫(로그인 전이면 그냥 돌아온다).
  Future<void> Function(List<Map<String, String>> events)? sender;
  final _queue = <Map<String, String>>[];
  Timer? _timer;

  void report(String kind, String code) {
    final allowed = appEventCodes[kind];
    if (sender == null || !appEventCodes.containsKey(kind) || (allowed != null && !allowed.contains(code))) return;
    if (_queue.length >= 20) return; // 서버 한 번 상한 — 폭주 때 넘치는 건 버린다
    _queue.add({'kind': kind, 'code': code, 'version': Config.appVersion, 'platform': defaultTargetPlatform.name, 'at': DateTime.now().toUtc().toIso8601String()});
    _timer ??= Timer(delay, flush);
  }

  Future<void> flush() async {
    _timer?.cancel();
    _timer = null;
    final send = sender;
    if (_queue.isEmpty || send == null) return _queue.clear();
    final batch = List.of(_queue);
    _queue.clear();
    try {
      await send(batch);
    } catch (_) {}
  }
}

/// 앱 전체 한 개. main.dart가 sender를 붙인다.
final appEvents = AppEvents();
