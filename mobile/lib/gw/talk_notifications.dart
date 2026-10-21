import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'gw_api.dart';
import 'talk_alert_watcher.dart';
import 'talk_alerts.dart';

const _seenKey = 'talk_alert_seen';

/// OS 알림(멘션·새 대화)을 탭하면 열 앱 안 경로. main.dart가 지켜보고 라우팅한다(원본 앱 대신 우리 메신저).
final messengerNotifyTap = ValueNotifier<String?>(null);

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
    onDidReceiveNotificationResponse: (r) => messengerNotifyTap.value = (r.payload == null || r.payload!.isEmpty) ? '/gw/messenger' : r.payload,
  );
  _plugin = plugin;
  return plugin;
}

String _roomPath(String roomId, String title) =>
    roomId.isEmpty ? '/gw/messenger' : '/gw/room?id=${Uri.encodeComponent(roomId)}&title=${Uri.encodeComponent(title)}';

/// "[메신저] 일반미팅룸 · 김명진님이 멘션" + 본문 한 줄. 탭하면 그 대화방(roomId 있으면)으로.
Future<void> showTalkNotification(GwTalkAlert a) async {
  final plugin = await _notifications();
  await plugin.show(
    id: a.alertId.hashCode & 0x7fffffff,
    title: '[메신저] ${a.room.isNotEmpty ? '${a.room} · ' : ''}${a.sender}님이 멘션',
    body: a.text.length > 140 ? '${a.text.substring(0, 140)}…' : a.text,
    notificationDetails: const NotificationDetails(macOS: DarwinNotificationDetails(), windows: WindowsNotificationDetails()),
    payload: _roomPath(a.roomId, a.sender.isEmpty ? a.room : a.sender),
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
