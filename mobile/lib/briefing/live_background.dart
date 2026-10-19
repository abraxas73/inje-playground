import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:workmanager/workmanager.dart';
import '../gw/gw_api.dart';
import '../gw/gw_creds.dart';
import '../gw/gw_models.dart' show kstNow;
import 'briefing_model.dart';
import 'live_activity.dart';
import 'live_briefing.dart';

/// iOS `BGTaskSchedulerPermittedIdentifiers`·AppDelegate와 같은 이름.
const liveBackgroundTask = 'com.innogrid.playground.briefing';

/// 앱 밖 주기 갱신(Android 15분, iOS는 OS가 정한 간격). **아마란스만** 수집한다 —
/// 백그라운드 엔진에서 Supabase 세션을 열면 리프레시 토큰이 회전돼 앱 쪽이 로그아웃될 수 있어 서버 API(Teams 등)는 부르지 않는다(직전 값 유지).
@pragma('vm:entry-point')
void liveBackgroundDispatcher() {
  Workmanager().executeTask((_, _) async {
    final c = ProviderContainer();
    try {
      final now = kstNow();
      if (!await liveActivityEnabled() || !inLiveWindow(now)) {
        await endLiveActivity();
        return true;
      }
      await c.read(gwProvider.future);
      final api = c.read(gwApiProvider);
      if (api == null) return true;
      final d = BriefingData(now: now, empSeq: api.client.creds().empSeq);
      Future<void> src(Future<void> Function() f) async {
        try {
          await f();
        } catch (_) {} // 실패한 소스는 null로 남아 직전 값을 유지한다
      }
      await Future.wait([
        src(() async => d.cals = await api.calendars()),
        src(() async => d.today = await api.events(now)),
        src(() async => d.approvals = await api.pendingApprovals()),
        src(() async => d.inbox = await api.inbox()),
        src(() async => d.notices = await api.notices(pageSize: 3)),
      ]);
      await syncLiveActivity(d);
      return true;
    } catch (_) {
      return false;
    } finally {
      c.dispose();
    }
  });
}

/// 앱 시작 때 1회. 이미 등록된 작업은 그대로 둔다(keep).
Future<void> registerLiveBackground() async {
  if (!liveActivitySupported) return;
  try {
    await Workmanager().initialize(liveBackgroundDispatcher);
    await Workmanager().registerPeriodicTask(
      liveBackgroundTask,
      liveBackgroundTask,
      frequency: const Duration(minutes: 15),
      constraints: Constraints(networkType: NetworkType.connected),
      existingWorkPolicy: ExistingPeriodicWorkPolicy.keep,
    );
  } catch (_) {
    // 백그라운드 갱신은 부가 기능 — 등록 실패가 앱 시작을 막지 않는다
  }
}
