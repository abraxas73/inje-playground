import 'dart:async';
import 'talk_alerts.dart';

/// 데스크탑 전용: 앱이 떠 있는 동안 주기적으로 메신저 멘션 알림을 확인해 **새 것만** OS 알림으로 보낸다(순수 로직 — 타이머·저장·알림은 주입).
/// 처음 실행(저장된 기준 없음)에는 지난 알림을 쏟아 내지 않고 가장 최근 시각을 기준으로 삼는다. 실패는 조용히 다음 주기로.
class TalkAlertWatcher {
  TalkAlertWatcher({required this.fetch, required this.notify, required this.loadSeen, required this.saveSeen, this.interval = const Duration(seconds: 60)});
  final Future<List<GwTalkAlert>> Function() fetch;
  final Future<void> Function(GwTalkAlert alert) notify;
  final Future<int> Function() loadSeen;
  final Future<void> Function(int createTime) saveSeen;
  final Duration interval;

  Timer? _timer;
  int _seen = 0;
  bool _loaded = false, _busy = false;

  Future<void> start() async {
    _timer?.cancel();
    _timer = Timer.periodic(interval, (_) => tick());
    await tick();
  }

  Future<void> tick() async {
    if (_busy) return;
    _busy = true;
    try {
      if (!_loaded) {
        _seen = await loadSeen();
        _loaded = true;
      }
      final list = await fetch();
      final newest = list.fold(0, (m, a) => a.createTime > m ? a.createTime : m);
      if (_seen == 0) {
        // 첫 기준: 지금까지 것은 이미 본 것으로
        if (newest > 0) await _mark(newest);
        return;
      }
      final fresh = list.where((a) => a.createTime > _seen).toList()..sort((a, b) => a.createTime.compareTo(b.createTime));
      for (final a in fresh) {
        await notify(a);
      }
      if (fresh.isNotEmpty) await _mark(fresh.last.createTime);
    } catch (_) {
      // 네트워크·세션 만료 등 — 다음 주기에 다시
    } finally {
      _busy = false;
    }
  }

  Future<void> _mark(int t) async {
    _seen = t;
    await saveSeen(t);
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
  }
}
