import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/client.dart';
import '../briefing/briefing_model.dart';
import '../gw/gw_alerts.dart';
import '../gw/gw_api.dart';
import '../gw/gw_creds.dart';
import '../messenger/messenger_mqtt.dart';
import '../messenger/messenger_provider.dart';

/// 통합 알림 — 아마란스 알림센터 전체(메일·결재·일정·게시판·멘션 등, 2026-10-29) + Teams 멘션을 한곳에.
/// 아마란스 알림의 읽음은 서버(그룹웨어 웹·아마란스 앱과 같은 상태)에, Teams는 기기에만 기억한다.
/// 종 버튼(이노봇 레이어)을 누르면 패널로 뜬다. 소스별 try/catch로 독립(한쪽 실패해도 나머지 표시).

final notifOpen = ValueNotifier<bool>(false);

enum NotifKind { mention, chat, approval, mail, schedule, board, other, teams }

/// 알림 패널·홈 위젯 필터에 보이는 종류(순서대로).
const notifFilterKinds = {
  NotifKind.mail: '메일',
  NotifKind.approval: '결재',
  NotifKind.schedule: '일정',
  NotifKind.board: '게시판',
  NotifKind.mention: '멘션',
  NotifKind.other: '기타',
  NotifKind.teams: 'Teams',
};

NotifKind notifKindOf(GwAlertKind k) => switch (k) {
      GwAlertKind.mail => NotifKind.mail,
      GwAlertKind.approval => NotifKind.approval,
      GwAlertKind.schedule => NotifKind.schedule,
      GwAlertKind.board => NotifKind.board,
      GwAlertKind.talk => NotifKind.mention,
      GwAlertKind.other => NotifKind.other,
    };

class NotifItem {
  const NotifItem({required this.kind, required this.key, required this.title, required this.subtitle, required this.path, this.at, this.branchRoot = false, this.gwAlertId = '', this.webUrl = ''});
  final NotifKind kind;

  /// 로컬 '읽음' 식별자(탭하면 이 키를 읽음 처리해 배지·목록에서 뺀다).
  final String key;
  final String title, subtitle, path;
  final DateTime? at;
  final bool branchRoot;

  /// 아마란스 알림이면 그 id(누르면 서버에 읽음 처리). path가 비면 webUrl(그룹웨어 웹)을 브라우저로 연다.
  final String gwAlertId, webUrl;
  bool get isGw => gwAlertId.isNotEmpty;

  IconData get icon => switch (kind) {
        NotifKind.mention => Icons.alternate_email,
        NotifKind.chat => Icons.chat_bubble_outline,
        NotifKind.approval => Icons.fact_check_outlined,
        NotifKind.mail => Icons.mail_outline,
        NotifKind.schedule => Icons.event_outlined,
        NotifKind.board => Icons.campaign_outlined,
        NotifKind.other => Icons.notifications_none,
        NotifKind.teams => Icons.groups_outlined,
      };
}

/// 웹 화면을 앱에서 여는 경로.
String _web(String href) => '/web?path=${Uri.encodeComponent(href)}';

class NotifCenter extends AsyncNotifier<List<NotifItem>> {
  Timer? _debounce;
  Timer? _poll;

  @override
  Future<List<NotifItem>> build() async {
    // 실시간: 새 대화 신호가 오면 잠시 묶어 다시 모은다(구독은 invalidate 때 onDispose로 정리됨)
    final sub = ref.read(messengerMqttProvider).events.listen((e) {
      if (e.isChat) {
        _debounce?.cancel();
        _debounce = Timer(const Duration(seconds: 1), () => ref.invalidateSelf());
      }
    });
    // Teams·메일·결재는 실시간 신호가 없어 주기 폴링으로 당겨온다(배지·목록만 조용히 갱신, 스피너·OS 배너 없음).
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 60), (_) async {
      state = await AsyncValue.guard(_gather);
    });
    ref.onDispose(() {
      sub.cancel();
      _debounce?.cancel();
      _poll?.cancel();
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
      // 아마란스 알림센터(안 읽은 것 최근 50건) + 전체 안 읽은 수(배지)
      await _safe(() async {
        for (final a in await api.alerts()) {
          items.add(NotifItem(kind: notifKindOf(a.kind), key: 'g:${a.alertId}', title: a.title, subtitle: a.content, at: a.at, path: a.path, gwAlertId: a.alertId, webUrl: a.webUrl));
        }
      });
      await _safe(() async => ref.read(notifGwCountProvider.notifier).set(await api.alertCount()));
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

/// 아마란스 안 읽은 알림 전체 수(목록은 최근 50건만이라 배지는 이 값으로).
class NotifGwCount extends Notifier<int> {
  @override
  int build() => 0;
  void set(int n) => state = n;
}

final notifGwCountProvider = NotifierProvider<NotifGwCount, int>(NotifGwCount.new);

/// 알림 읽음 — 아마란스 알림은 서버에도(웹·아마란스 앱과 같은 상태), 모두는 기기에 기억해 바로 목록에서 뺀다.
/// all: 패널의 '모두 읽음'. 필터가 없으면 아마란스 전체 읽음, 있으면 보이는 것만.
Future<void> markNotifsRead(WidgetRef ref, List<NotifItem> items, {bool all = false}) async {
  final local = items.where((n) => !n.isGw).map((n) => n.key);
  if (local.isNotEmpty) ref.read(notifSeenProvider.notifier).mark(local);
  final gw = items.where((n) => n.isGw).toList();
  if (gw.isEmpty) return;
  // 아마란스 알림은 기기에 영구 저장하지 않는다(서버가 기준) — 이번 실행 동안만 숨기고, 서버 읽음이 실패하면 되돌린다
  final pending = ref.read(notifGwReadProvider.notifier);
  pending.add(gw.map((n) => n.key));
  final countNotifier = ref.read(notifGwCountProvider.notifier);
  final count = ref.read(notifGwCountProvider);
  final everything = all && ref.read(notifHiddenKindsProvider).isEmpty;
  countNotifier.set(everything ? 0 : (count - gw.length).clamp(0, 1 << 30));
  final api = ref.read(gwApiProvider);
  if (api == null) return;
  try {
    if (everything) {
      await api.readAllAlerts();
    } else {
      await api.readAlerts(gw.map((n) => n.gwAlertId).toList());
    }
  } catch (_) {
    // 서버 읽음 실패 — 목록·배지에 다시 보이게 되돌린다(다음 수집에서 서버 수도 다시 맞춰진다)
    pending.remove(gw.map((n) => n.key));
    countNotifier.set(count);
  }
}

/// 이번 실행에서 읽음 처리한 아마란스 알림 키(서버 반영 전후로 바로 목록에서 빼는 용도, 저장 안 함).
class NotifGwRead extends Notifier<Set<String>> {
  @override
  Set<String> build() => <String>{};
  void add(Iterable<String> keys) => state = {...state, ...keys};
  void remove(Iterable<String> keys) => state = {...state}..removeAll(keys);
}

final notifGwReadProvider = NotifierProvider<NotifGwRead, Set<String>>(NotifGwRead.new);

/// 필터로 숨긴 종류(기기 저장). 기본은 전부 보임(메일 포함 — 2026-10-29 사용자 결정, 필터로 끌 수 있게).
class NotifHiddenKinds extends Notifier<Set<NotifKind>> {
  static const _key = 'notif_hidden_kinds';

  @override
  Set<NotifKind> build() {
    _load();
    return <NotifKind>{};
  }

  Future<void> _load() async {
    try {
      final p = await SharedPreferences.getInstance();
      state = {for (final n in p.getStringList(_key) ?? const <String>[]) ...NotifKind.values.where((k) => k.name == n)};
    } catch (_) {}
  }

  Future<void> toggle(NotifKind k) async {
    state = state.contains(k) ? ({...state}..remove(k)) : {...state, k};
    try {
      final p = await SharedPreferences.getInstance();
      await p.setStringList(_key, state.map((k) => k.name).toList());
    } catch (_) {}
  }
}

final notifHiddenKindsProvider = NotifierProvider<NotifHiddenKinds, Set<NotifKind>>(NotifHiddenKinds.new);

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

/// 아직 안 읽었고 필터로 숨기지 않은 알림(목록 공용).
final notifVisibleProvider = Provider<List<NotifItem>>((ref) {
  final items = ref.watch(notifCenterProvider).maybeWhen(data: (l) => l, orElse: () => const <NotifItem>[]);
  final seen = ref.watch(notifSeenProvider);
  final gwRead = ref.watch(notifGwReadProvider);
  final hidden = ref.watch(notifHiddenKindsProvider);
  return items.where((i) => !seen.contains(i.key) && !gwRead.contains(i.key) && !hidden.contains(i.kind)).toList();
});

/// 배지 숫자. 필터가 없으면 아마란스 쪽은 서버 안 읽은 수(웹 알림센터 배지와 같은 값), 필터가 있으면 보이는 것만 센다.
final notifUnreadProvider = Provider<int>((ref) {
  final visible = ref.watch(notifVisibleProvider);
  final gwShown = visible.where((n) => n.isGw).length;
  final gw = ref.watch(notifHiddenKindsProvider).isEmpty ? (ref.watch(notifGwCountProvider) > gwShown ? ref.watch(notifGwCountProvider) : gwShown) : gwShown;
  return gw + visible.length - gwShown;
});
