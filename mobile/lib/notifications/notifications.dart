import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/client.dart';
import '../briefing/briefing_model.dart';
import '../gw/gw_api.dart';
import '../gw/gw_creds.dart';
import '../messenger/messenger_mqtt.dart';
import '../messenger/messenger_provider.dart';

/// 통합 알림 — 아마란스 멘션·새 대화, 미결 결재, 안 읽은 메일, Teams 멘션을 한곳에.
/// 종 버튼(이노봇 레이어)을 누르면 패널로 뜬다. 소스별 try/catch로 독립(한쪽 실패해도 나머지 표시).

final notifOpen = ValueNotifier<bool>(false);

enum NotifKind { mention, chat, approval, mail, teams }

class NotifItem {
  const NotifItem({required this.kind, required this.key, required this.title, required this.subtitle, required this.path, this.at, this.branchRoot = false});
  final NotifKind kind;

  /// 로컬 '읽음' 식별자(탭하면 이 키를 읽음 처리해 배지·목록에서 뺀다).
  final String key;
  final String title, subtitle, path;
  final DateTime? at;
  final bool branchRoot;

  IconData get icon => switch (kind) {
        NotifKind.mention => Icons.alternate_email,
        NotifKind.chat => Icons.chat_bubble_outline,
        NotifKind.approval => Icons.fact_check_outlined,
        NotifKind.mail => Icons.mail_outline,
        NotifKind.teams => Icons.groups_outlined,
      };
}

/// 웹 화면을 앱에서 여는 경로.
String _web(String href) => '/web?path=${Uri.encodeComponent(href)}';

class NotifCenter extends AsyncNotifier<List<NotifItem>> {
  Timer? _debounce;

  @override
  Future<List<NotifItem>> build() async {
    // 실시간: 새 대화 신호가 오면 잠시 묶어 다시 모은다(구독은 invalidate 때 onDispose로 정리됨)
    final sub = ref.read(messengerMqttProvider).events.listen((e) {
      if (e.isChat) {
        _debounce?.cancel();
        _debounce = Timer(const Duration(seconds: 1), () => ref.invalidateSelf());
      }
    });
    ref.onDispose(() {
      sub.cancel();
      _debounce?.cancel();
    });
    // 메신저를 안 열어도 새 대화 알림이 오도록 MQTT를 깨운다(실패는 무시).
    () async {
      try {
        final s = await ref.read(messengerClientProvider).ensureSession();
        await ref.read(messengerMqttProvider).connect(s);
      } catch (_) {}
    }();
    return _gather();
  }

  Future<void> refresh() async {
    state = const AsyncLoading();
    state = await AsyncValue.guard(_gather);
  }

  Future<List<NotifItem>> _gather() async {
    final items = <NotifItem>[];
    try {
      await ref.read(gwProvider.future);
    } catch (_) {}
    final api = ref.read(gwApiProvider);
    if (api != null) {
      await _safe(() async {
        final talks = await api.talkAlerts(pageSize: 10);
        for (final t in talks.where((t) => !t.read)) {
          // roomId가 있으면 그 대화방으로 바로, 없으면 목록으로
          final path = t.roomId.isEmpty ? '/gw/messenger' : '/gw/room?id=${Uri.encodeComponent(t.roomId)}&title=${Uri.encodeComponent(t.sender.isEmpty ? t.room : t.sender)}';
          items.add(NotifItem(kind: NotifKind.mention, key: 'm:${t.alertId}', title: t.sender.isEmpty ? '아마란스 멘션' : '${t.sender}${t.room.isEmpty ? '' : ' · ${t.room}'}', subtitle: t.text, at: t.at, path: path));
        }
      });
      await _safe(() async {
        final (cnt, _) = await api.pendingApprovals();
        if (cnt > 0) items.add(NotifItem(kind: NotifKind.approval, key: 'a:$cnt', title: '미결 결재', subtitle: '$cnt건 대기', path: '/gw/approvals'));
      });
      await _safe(() async {
        final m = await api.mailSummary();
        if (m.unread > 0) items.add(NotifItem(kind: NotifKind.mail, key: 'l:${m.unread}', title: '안 읽은 메일', subtitle: '${m.unread}통', path: '/gw/mail'));
      });
    }
    await _safe(() async {
      final tm = TeamsMentions.parse(await ref.read(apiClientProvider).getJson('/api/teams/mentions', query: {'days': '2'}));
      if (tm.connected) {
        for (final x in tm.items) {
          // 웹 /teams/chat은 ?chat=<id>로 그 채팅을 바로 연다
          final href = x.chatId.isEmpty ? '/teams/chat' : '/teams/chat?chat=${x.chatId}';
          items.add(NotifItem(kind: NotifKind.teams, key: 't:${x.chatId}:${x.at}', title: '${x.from}${x.topic.isEmpty ? '' : ' · ${x.topic}'}', subtitle: x.text, at: DateTime.tryParse(x.at), path: _web(href)));
        }
      }
    });
    items.sort((a, b) => (b.at ?? DateTime(2000)).compareTo(a.at ?? DateTime(2000)));
    return items;
  }

  Future<void> _safe(Future<void> Function() f) async {
    try {
      await f();
    } catch (_) {}
  }
}

final notifCenterProvider = AsyncNotifierProvider<NotifCenter, List<NotifItem>>(NotifCenter.new);

/// 로컬 '읽음' 키 집합(기기 저장). 탭하거나 '모두 읽음'으로 추가하면 배지·목록에서 빠진다.
class NotifSeen extends Notifier<Set<String>> {
  static const _key = 'notif_seen';

  @override
  Set<String> build() {
    _load();
    return <String>{};
  }

  Future<void> _load() async {
    try {
      final p = await SharedPreferences.getInstance();
      state = (p.getStringList(_key) ?? const []).toSet();
    } catch (_) {}
  }

  Future<void> mark(Iterable<String> keys) async {
    state = {...state, ...keys};
    try {
      final p = await SharedPreferences.getInstance();
      await p.setStringList(_key, state.toList());
    } catch (_) {}
  }
}

final notifSeenProvider = NotifierProvider<NotifSeen, Set<String>>(NotifSeen.new);

/// 아직 안 읽은 알림만(배지·목록 공용).
final notifVisibleProvider = Provider<List<NotifItem>>((ref) {
  final items = ref.watch(notifCenterProvider).maybeWhen(data: (l) => l, orElse: () => const <NotifItem>[]);
  final seen = ref.watch(notifSeenProvider);
  return items.where((i) => !seen.contains(i.key)).toList();
});

/// 배지 숫자(안 읽은 알림 건수).
final notifUnreadProvider = Provider<int>((ref) => ref.watch(notifVisibleProvider).length);
