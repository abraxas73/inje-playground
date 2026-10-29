import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'gw_alerts.dart';
import 'gw_api.dart';
import '../notifications/notifications.dart' show notifHiddenKindsProvider, notifKindOf;
import 'talk_alert_watcher.dart';
import '../app/platform.dart';

const _seenKey = 'gw_alert_seen'; // 알림센터 전체로 바꾸며 새 키(예전 멘션 기준 시각이면 업그레이드 직후 지난 알림이 쏟아진다)

/// OS 알림(멘션·새 대화)을 탭하면 열 앱 안 경로. main.dart가 지켜보고 라우팅한다(원본 앱 대신 우리 메신저).
final messengerNotifyTap = ValueNotifier<String?>(null);

/// macOS·Windows에서만: 아마란스가 연결돼 있으면 60초마다 알림센터를 확인해 새 알림을 OS 알림으로(누르면 그 화면).
/// 알림 필터로 숨긴 종류는 OS 알림도 띄우지 않는다.
/// 모바일은 아마란스10 앱이 이미 푸시를 보내므로 만들지 않는다. 연결이 끊기면(gwApi null) 감시도 멈춘다.
final talkAlertWatcherProvider = Provider<TalkAlertWatcher<GwAlert>?>((ref) {
  if (!isDesktopPlatform) return null;
  final api = ref.watch(gwApiProvider);
  if (api == null) return null;
  final w = TalkAlertWatcher<GwAlert>(
    fetch: () => api.alerts(pageSize: 20),
    notify: (a) async {
      if (!ref.read(notifHiddenKindsProvider).contains(notifKindOf(a.kind))) await showGwAlertNotification(a);
    },
    loadSeen: () async => (await SharedPreferences.getInstance()).getInt(_seenKey) ?? 0,
    saveSeen: (t) async => (await SharedPreferences.getInstance()).setInt(_seenKey, t),
  );
  w.start();
  ref.onDispose(w.dispose);
  return w;
});

FlutterLocalNotificationsPlugin? _plugin;
Future<FlutterLocalNotificationsPlugin> _notifications() async {
  final p = _plugin;
  if (p != null) return p;
  final plugin = FlutterLocalNotificationsPlugin();
  await plugin.initialize(
    settings: const InitializationSettings(
      macOS: DarwinInitializationSettings(), // 배지 권한도 함께 — Dock 아이콘 알림 숫자(app_badge.dart)
      windows: WindowsInitializationSettings(appName: 'INNOCREW', appUserModelId: 'Innogrid.INNOGRID', guid: 'c3b2a1f0-5d4e-4a6b-9c8d-7e6f5a4b3c2d'),
    ),
    onDidReceiveNotificationResponse: (r) => messengerNotifyTap.value = (r.payload == null || r.payload!.isEmpty) ? '/gw/messenger' : r.payload,
  );
  _plugin = plugin;
  return plugin;
}

/// 알림센터 한 건 → OS 알림. 탭하면 앱 안 화면(결재 문서·메일·대화방), 그런 화면이 없는 종류(일정·게시판 등)는 그룹웨어 웹.
/// 아마란스 읽음은 앱 안에서 눌렀을 때만(OS 알림을 띄웠다고 읽음 처리하지 않는다).
Future<void> showGwAlertNotification(GwAlert a) async {
  final plugin = await _notifications();
  await plugin.show(
    id: a.alertId.hashCode & 0x7fffffff,
    title: a.title,
    body: a.content.length > 140 ? '${a.content.substring(0, 140)}…' : a.content,
    notificationDetails: const NotificationDetails(macOS: DarwinNotificationDetails(), windows: WindowsNotificationDetails()),
    payload: a.path.isEmpty ? a.webUrl : a.path,
  );
}

/// 메신저 실시간 푸시(새 대화 등)를 OS 알림으로. 탭하면 path로 이동.
Future<void> showMessengerPush({required String title, required String body, required String path}) async {
  final plugin = await _notifications();
  await plugin.show(
    id: DateTime.now().millisecondsSinceEpoch & 0x7fffffff,
    title: title,
    body: body.length > 140 ? '${body.substring(0, 140)}…' : body,
    notificationDetails: const NotificationDetails(macOS: DarwinNotificationDetails(), windows: WindowsNotificationDetails()),
    payload: path,
  );
}
