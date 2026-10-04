import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/client.dart';
import '../gw/gw_models.dart';
import 'briefing_model.dart';

/// Claude "오늘의 한 마디" — 하루 1회(KST 날짜 키) 기기에 저장. 서버가 enabled:false거나 실패하면 null(홈은 격언을 보여 준다). 로그 없음.
class BriefingSummary {
  const BriefingSummary({required this.date, required this.text, required this.at});
  final String date, text, at;
  Map<String, String> toJson() => {'date': date, 'text': text, 'at': at};
  static BriefingSummary? fromJson(dynamic j) => j is Map && j['date'] is String && j['text'] is String ? BriefingSummary(date: j['date'] as String, text: j['text'] as String, at: '${j['at'] ?? ''}') : null;
}

final summaryProvider = AsyncNotifierProvider<SummaryNotifier, BriefingSummary?>(SummaryNotifier.new);

class SummaryNotifier extends AsyncNotifier<BriefingSummary?> {
  // v2: 1.1.2 이전 서버가 생각 토큰에 밀려 잘린 문장("강승")을 저장했다 — 키를 바꿔 그날 것도 한 번 새로 만든다
  static const _key = 'briefing.summary.v2';
  Future<void>? _inflight;

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

  /// 오늘 문장이 없으면 만든다 — 하루 1회(새로고침·탭 재터치로는 다시 만들지 않는다). 동시 호출은 한 번만 간다.
  Future<void> ensure(BriefingData data) async {
    if (state.value?.date == ymd(kstNow())) return;
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
      if (j is! Map || j['enabled'] != true || j['text'] is! String) return;
      final now = kstNow();
      final s = BriefingSummary(date: ymd(now), text: (j['text'] as String).trim(), at: '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}');
      await (await SharedPreferences.getInstance()).setString(_key, jsonEncode(s.toJson()));
      state = AsyncData(s);
    } catch (_) {
      // 부가 기능 — 조용히 격언 유지
    }
  }
}
