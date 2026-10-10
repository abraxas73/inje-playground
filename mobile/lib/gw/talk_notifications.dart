import 'dart:io';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'gw_api.dart';
import 'messenger_open.dart';
import 'talk_alert_watcher.dart';
import 'talk_alerts.dart';

const _seenKey = 'talk_alert_seen';

/// macOS·Windows에서만: 아마란스가 연결돼 있으면 60초마다 멘션 알림을 확인해 새 것을 OS 알림으로(누르면 메신저 열기).
/// 모바일은 아마란스10 앱이 이미 푸시를 보내므로 만들지 않는다. 연결이 끊기면(gwApi null) 감시도 멈춘다.
final talkAlertWatcherProvider = Provider<TalkAlertWatcher?>((ref) {
  if (!(Platform.isMacOS || Platform.isWindows)) return null;
  final api = ref.watch(gwApiProvider);
  if (api == null) return null;
  final w = TalkAlertWatcher(
    fetch: () => api.talkAlerts(pageSize: 10),
    notify: showTalkNotification,
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
      macOS: DarwinInitializationSettings(requestBadgePermission: false),
      windows: WindowsInitializationSettings(appName: 'INNOGRID', appUserModelId: 'Innogrid.INNOGRID', guid: 'c3b2a1f0-5d4e-4a6b-9c8d-7e6f5a4b3c2d'),
    ),
    onDidReceiveNotificationResponse: (_) => openMessenger(),
  );
  _plugin = plugin;
  return plugin;
}

/// "[메신저] 일반미팅룸 · 김명진님이 멘션" + 본문 한 줄. id는 알림 id 해시(같은 알림은 한 번만).
Future<void> showTalkNotification(GwTalkAlert a) async {
  final plugin = await _notifications();
  await plugin.show(
    id: a.alertId.hashCode & 0x7fffffff,
    title: '[메신저] ${a.room.isNotEmpty ? '${a.room} · ' : ''}${a.sender}님이 멘션',
    body: a.text.length > 140 ? '${a.text.substring(0, 140)}…' : a.text,
    notificationDetails: const NotificationDetails(macOS: DarwinNotificationDetails(), windows: WindowsNotificationDetails()),
    payload: a.alertId,
  );
}
