import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/client.dart';
import '../gw/gw_models.dart';
import 'briefing_model.dart';

/// 한국 시간 시계. 테스트에서 07:00 경계를 재현할 수 있다.
final briefingClockProvider = Provider<DateTime Function()>((ref) => kstNow);

/// 브리핑 하루는 한국 시간 07:00에 시작한다.
String briefingPeriod(DateTime kst) => ymd(kst.subtract(const Duration(hours: 7)));
Duration untilNextBriefing(DateTime kst) {
  var next = DateTime.utc(kst.year, kst.month, kst.day, 7);
  final wall = DateTime.utc(kst.year, kst.month, kst.day, kst.hour, kst.minute, kst.second, kst.millisecond, kst.microsecond);
  if (!next.isAfter(wall)) next = next.add(const Duration(days: 1));
  return next.difference(wall);
}

/// 앱 시작·매일 07:00 이후·사용자의 강제 새로고침 때 생성한다.
class BriefingSummary {
  const BriefingSummary({
    required this.date,
    required this.text,
    required this.at,
  });
  final String date, text, at;
  Map<String, String> toJson() => {'date': date, 'text': text, 'at': at};
  static BriefingSummary? fromJson(dynamic j) =>
      j is Map && j['date'] is String && j['text'] is String
      ? BriefingSummary(
          date: j['date'] as String,
          text: j['text'] as String,
          at: '${j['at'] ?? ''}',
        )
      : null;
}

final summaryProvider =
    AsyncNotifierProvider<SummaryNotifier, BriefingSummary?>(
      SummaryNotifier.new,
    );

class SummaryNotifier extends AsyncNotifier<BriefingSummary?> {
  // v3: Jira가 포함된 기존 요약문은 읽지 않는다 — 업무는 아래 표에서만 표시한다
  static const _key = 'briefing.summary.v3';
  Future<bool>? _inflight;
  String? _inflightPeriod;
  // 이번 실행에서 마지막으로 생성한 07:00 기준 날짜.
  String? _generatedPeriod;
  // build(로그아웃 invalidate 포함)마다 올린다 — 이전 계정의 요청이 늦게 끝나도 새 계정 화면에 쓰지 않게.
  int _epoch = 0;

  @override
  Future<BriefingSummary?> build() async {
    // Riverpod 3는 invalidate 뒤에도 인스턴스를 재사용한다 — 계정이 바뀌었을 수 있으니 실행 상태도 새로.
    _epoch++;
    _generatedPeriod = null;
    _inflight = null;
    final raw = (await SharedPreferences.getInstance()).getString(_key);
    BriefingSummary? s;
    try {
      s = raw == null ? null : BriefingSummary.fromJson(jsonDecode(raw));
    } catch (_) {
      s = null;
    }
    return s != null && s.date == ymd(ref.read(briefingClockProvider)()) ? s : null;
  }

  /// 내용이 바뀌는 일(출근 기록)이 있었다 — 다음 ensure에서 한 번 다시 만든다.
  void stale() => _generatedPeriod = null;

  /// 같은 시간대의 동시 호출은 합치고, 07:00 이전 요청은 새 시간대에 재사용하지 않는다.
  Future<bool> ensure(BriefingData data, {bool force = false}) async {
    final epoch = _epoch;
    final period = briefingPeriod(ref.read(briefingClockProvider)());
    final pending = _inflight;
    if (pending != null) {
      if (_inflightPeriod == period) return pending;
      await pending;
      if (epoch != _epoch || !ref.mounted) return false;
      return ensure(data, force: force);
    }
    if (!force && _generatedPeriod == period) return state.value != null;
    final run = _generate(data, period);
    _inflight = run;
    _inflightPeriod = period;
    try {
      return await run;
    } finally {
      if (identical(_inflight, run)) _inflight = null;
    }
  }

  Future<bool> _generate(BriefingData data, String period) async {
    final epoch = _epoch;
    try {
      final j = await ref
          .read(apiClientProvider)
          .postJson('/api/mobile/briefing', summaryPayload(data));
      if (!ref.mounted || epoch != _epoch || period != briefingPeriod(ref.read(briefingClockProvider)())) return false;
      if (j is! Map || j['enabled'] != true || j['text'] is! String) {
        _generatedPeriod = period; // 관리자가 껐거나 키 없음 — 이번 실행에선 다시 묻지 않는다
        return false;
      }
      final now = ref.read(briefingClockProvider)();
      final s = BriefingSummary(
        date: ymd(now),
        text: (j['text'] as String).trim(),
        at: '${now.hour.toString().padLeft(2, '0')}:${now.minute.toString().padLeft(2, '0')}',
      );
      final prefs = await SharedPreferences.getInstance();
      if (!ref.mounted || epoch != _epoch || period != briefingPeriod(ref.read(briefingClockProvider)())) return false;
      await prefs.setString(
        _key,
        jsonEncode(s.toJson()),
      );
      if (!ref.mounted || epoch != _epoch) return false;
      _generatedPeriod = period;
      state = AsyncData(s);
      return true;
    } catch (_) {
      // 직전 브리핑을 유지하며 수동 요청자는 실패를 안내한다.
      return false;
    }
  }
}
