import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/client.dart';
import '../gw/gw_models.dart';
import 'briefing_model.dart';

/// Claude "데일리 브리핑" — 앱이 새로 시작될 때마다 1회 생성(켜져 있는 동안 새로고침·탭 재터치로는 다시 만들지 않음). 시작 직후엔 오늘 저장된 직전 문장을 먼저 보여 준다. 서버가 enabled:false거나 실패하면 null(홈은 격언을 보여 준다). 로그 없음.
class BriefingSummary {
  const BriefingSummary({required this.date, required this.text, required this.at});
  final String date, text, at;
  Map<String, String> toJson() => {'date': date, 'text': text, 'at': at};
  static BriefingSummary? fromJson(dynamic j) => j is Map && j['date'] is String && j['text'] is String ? BriefingSummary(date: j['date'] as String, text: j['text'] as String, at: '${j['at'] ?? ''}') : null;
}

final summaryProvider = AsyncNotifierProvider<SummaryNotifier, BriefingSummary?>(SummaryNotifier.new);

class SummaryNotifier extends AsyncNotifier<BriefingSummary?> {
  // v2: 1.1.2 이전 서버가 생각 토큰에 밀려 잘린 문장("강승")을 저장했다 — 옛 키는 읽지 않는다
  static const _key = 'briefing.summary.v2';
  Future<void>? _inflight;
  // 이 프로세스(앱 실행)에서 이미 만들었는지 — Notifier는 앱이 켜져 있는 동안 살아 있으므로 "시작마다 1회"가 된다.
  bool _generatedThisRun = false;

  @override
  Future<BriefingSummary?> build() async {
    final raw = (await SharedPreferences.getInstance()).getString(_key);
    BriefingSummary? s;
    try {
      s = raw == null ? null : BriefingSummary.fromJson(jsonDecode(raw));
    } catch (_) {
      s = null;
    }
    return s != null && s.date == ymd(kstNow()) ? s : null;
  }

  /// 내용이 바뀌는 일(출근 기록)이 있었다 — 다음 ensure에서 한 번 다시 만든다.
  void stale() => _generatedThisRun = false;

  /// 이번 앱 실행에서 아직 안 만들었으면 만든다. 동시 호출은 한 번만 간다. 실패하면 다음 기회(새로고침)에 다시 시도한다.
  Future<void> ensure(BriefingData data) async {
    if (_generatedThisRun) return;
    if (_inflight != null) return _inflight;
    final run = _generate(data);
    _inflight = run;
    try {
      await run;
    } finally {
      _inflight = null;
    }
  }

  Future<void> _generate(BriefingData data) async {
    try {
      final j = await ref.read(apiClientProvider).postJson('/api/mobile/briefing', summaryPayload(data));
      if (j is! Map || j['enabled'] != true || j['text'] is! String) {
        _generatedThisRun = true; // 관리자가 껐거나 키 없음 — 이번 실행에선 다시 묻지 않는다
        return;
      }
      final now = kstNow();
      final s = BriefingSummary(date: ymd(now), text: (j['text'] as String).trim(), at: '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}');
      await (await SharedPreferences.getInstance()).setString(_key, jsonEncode(s.toJson()));
      _generatedThisRun = true;
      state = AsyncData(s);
    } catch (_) {
      // 부가 기능 — 조용히 격언 유지
    }
  }
}
