import 'dart:convert';
import 'dart:io';
import 'package:flutter/services.dart';
import 'package:flutter_local_notifications/flutter_local_notifications.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../gw/gw_models.dart' show ymd;
import 'briefing_model.dart';
import 'live_briefing.dart';

/// 브리핑 라이브 액티비티 — iOS는 ActivityKit(네이티브 `BriefingLiveActivityPlugin`), Android는 상시 알림.
/// 앱(홈 브리핑 수집 후)과 workmanager 백그라운드가 같은 [syncLiveActivity]를 부른다. 메일 제목·본문은 싣지 않는다(건수·회의 제목만).
const _channel = MethodChannel('innogrid/live_activity');
const _kOn = 'live_briefing.enabled', _kPrev = 'live_briefing.prev', _kDay = 'live_briefing.day';
const _liveId = 7001, _alertId = 7002;

bool get liveActivitySupported => Platform.isIOS || Platform.isAndroid;

Future<bool> liveActivityEnabled() async => (await SharedPreferences.getInstance()).getBool(_kOn) ?? true;

/// 더보기 스위치. 끄면 바로 내린다.
Future<void> setLiveActivityEnabled(bool on) async {
  await (await SharedPreferences.getInstance()).setBool(_kOn, on);
  if (!on) await endLiveActivity();
}

/// 수집 결과를 반영한다. [foreground]면 Android 알림 권한을 요청할 수 있다(백그라운드에선 요청 불가).
Future<void> syncLiveActivity(BriefingData d, {bool foreground = false}) async {
  if (!liveActivitySupported) return;
  final p = await SharedPreferences.getInstance();
  await p.reload(); // 다른 isolate(백그라운드 작업)가 쓴 직전 값을 읽는다
  if (!(p.getBool(_kOn) ?? true) || !inLiveWindow(d.now)) {
    await endLiveActivity();
    return;
  }
  final day = ymd(d.now);
  final prev = p.getString(_kDay) == day ? LiveBriefing.fromJson(jsonDecode(p.getString(_kPrev) ?? 'null')) : null;
  final next = liveBriefingFrom(d, prev: prev);
  final alert = liveAlert(prev, next);
  if (Platform.isIOS) {
    await _channel.invokeMethod('update', {...next.toJson(), 'countsLine': next.countsLine, 'total': next.total, 'alert': alert});
  } else {
    await _androidShow(next, alert, foreground: foreground);
  }
  await p.setString(_kPrev, jsonEncode(next.toJson()));
  await p.setString(_kDay, day);
}

Future<void> endLiveActivity() async {
  if (Platform.isIOS) {
    await _channel.invokeMethod('end');
  } else if (Platform.isAndroid) {
    await (await _android()).cancel(id: _liveId);
  }
}

FlutterLocalNotificationsPlugin? _plugin;
Future<FlutterLocalNotificationsPlugin> _android() async {
  final p = _plugin;
  if (p != null) return p;
  final plugin = FlutterLocalNotificationsPlugin();
  await plugin.initialize(settings: const InitializationSettings(android: AndroidInitializationSettings('@mipmap/ic_launcher')));
  return _plugin = plugin;
}

Future<void> _androidShow(LiveBriefing l, String? alert, {required bool foreground}) async {
  final plugin = await _android();
  if (foreground) {
    await plugin.resolvePlatformSpecificImplementation<AndroidFlutterLocalNotificationsPlugin>()?.requestNotificationsPermission();
  }
  final start = l.meetingStart;
  final countdown = start != null && start.isAfter(DateTime.now());
  await plugin.show(
    id: _liveId,
    title: l.meetingTitle.isEmpty ? '오늘 남은 회의 없음' : l.meetingTitle,
    body: l.countsLine.isEmpty ? '지금 확인할 항목이 없습니다' : l.countsLine,
    notificationDetails: NotificationDetails(
      android: AndroidNotificationDetails(
        'briefing_live', '오늘 브리핑',
        channelDescription: '다음 회의와 결재·메일 건수를 상단에 계속 보여 줍니다',
        importance: Importance.low, priority: Priority.low,
        ongoing: true, autoCancel: false, onlyAlertOnce: true,
        category: AndroidNotificationCategory.status,
        // 회의 시작까지 카운트다운 — 알림을 다시 그리지 않아도 줄어든다
        showWhen: countdown, when: countdown ? start.millisecondsSinceEpoch : null,
        usesChronometer: countdown, chronometerCountDown: countdown,
      ),
    ),
  );
  if (alert != null) {
    await plugin.show(
      id: _alertId,
      title: '데일리 브리핑',
      body: alert,
      notificationDetails: const NotificationDetails(
        android: AndroidNotificationDetails('briefing_alert', '브리핑 변경 알림',
            channelDescription: '결재·메일 등이 새로 도착하면 잠깐 알려 줍니다',
            importance: Importance.high, priority: Priority.high, timeoutAfter: 10000),
      ),
    );
  }
}
