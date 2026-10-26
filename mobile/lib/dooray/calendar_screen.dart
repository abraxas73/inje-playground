import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../auth/session.dart';
import '../briefing/briefing_provider.dart';
import '../calendar/calendar_model.dart';
import '../calendar/calendar_view.dart';
import '../gw/gw_models.dart' show kstNow;
import 'calendar_session.dart';
import 'calendar_webview.dart';
import '../favorites/favorites.dart';

/// (시작일 'YYYY-MM-DD', 날 수 1~42) 범위의 Dooray 일정. 연결이 없으면 null.
final doorayRangeProvider = FutureProvider.autoDispose
    .family<Map<String, dynamic>?, (String, int)>((ref, key) async {
      final client = ref.watch(doorayCalendarTransportProvider);
      return client?.read(key.$1, days: key.$2);
    });
String doorayDay(DateTime value) => value.toIso8601String().substring(0, 10);

class DoorayCalendarScreen extends ConsumerStatefulWidget {
  const DoorayCalendarScreen({super.key});
  @override
  ConsumerState<DoorayCalendarScreen> createState() =>
      _DoorayCalendarScreenState();
}

class _DoorayCalendarScreenState extends ConsumerState<DoorayCalendarScreen> {
  CalMode _mode = CalMode.day;
  DateTime _date = kstNow();
  Future<void> _connect() async {
    final owner = ref.read(sessionProvider).value?.email;
    if (owner == null) return;
    final ok = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => const DoorayCalendarLogin()),
    );
    if (!mounted ||
        ok != true ||
        ref.read(sessionProvider).value?.email != owner) {
      return;
    }
    // Restart the engine even when reconnecting the same owner after session expiry.
    await ref.read(doorayCalendarConnectionProvider.notifier).disconnect();
    await WidgetsBinding.instance.endOfFrame;
    if (!mounted) return;
    await ref.read(doorayCalendarConnectionProvider.notifier).connect(owner);
    ref.invalidate(doorayRangeProvider);
    ref.invalidate(briefingProvider);
  }

  Future<void> _disconnect() async {
    ref.read(doorayCalendarTransportProvider.notifier).clear();
    await ref.read(doorayCalendarConnectionProvider.notifier).disconnect();
    ref.invalidate(doorayRangeProvider);
    ref.invalidate(briefingProvider);
  }

  @override
  Widget build(BuildContext context) {
    final session = ref.watch(sessionProvider).value;
    if (session == null ||
        session.isGuest ||
        (!session.isAdmin && session.permissions['dooray'] == false)) {
      return const Scaffold(body: Center(child: Text('Dooray 접근 권한이 없습니다.')));
    }
    final connected = ref.watch(doorayCalendarOwnerProvider) != null;
    final (start, endEx) = calRange(_mode, _date);
    final result = ref.watch(doorayRangeProvider((doorayDay(start), endEx.difference(start).inDays)));
    return Scaffold(
      appBar: AppBar(
        title: const Row(children: [Flexible(child: Text('Dooray')), FavoriteStar(path: '/dooray/calendar', title: 'Dooray 캘린더')]),
        actions: [
          IconButton(
            tooltip: '일정 새로고침',
            onPressed: connected
                ? () => ref.invalidate(doorayRangeProvider)
                : null,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: SelectionArea(child: ListView( // 화면 자체 선택 영역(일정 화면과 같은 이유)
        padding: const EdgeInsets.all(16),
        children: [
          const Text(
            '일정',
            style: TextStyle(fontSize: 22, fontWeight: FontWeight.bold),
          ),
          const SizedBox(height: 8),
          const Text('이 기기에서 Dooray에 로그인하면 일정과 홈 브리핑을 확인할 수 있습니다.'),
          Wrap(
            spacing: 8,
            children: [
              OutlinedButton(
                onPressed: _connect,
                child: Text(connected ? '다시 로그인' : '연결'),
              ),
              if (connected)
                TextButton(
                  onPressed: _disconnect,
                  child: const Text('연결 해제'),
                ),
            ],
          ),
          if (connected) ...[
            const SizedBox(height: 8),
            CalendarView(
              mode: _mode,
              day: _date,
              events: [
                for (final x in (result.value?['items'] as List?) ?? const [])
                  if (x is Map) ?calFromDooray(x),
              ],
              loading: result.isLoading,
              error: result.hasError
                  ? '일정을 불러오지 못했습니다. 새로고침하거나 다시 로그인해 주세요.'
                  : null,
              note: !result.isLoading && !result.hasError && result.value == null
                  ? 'Dooray 연결을 준비하고 있습니다…'
                  : null,
              onMode: (m) => setState(() => _mode = m),
              onDay: (d) => setState(() => _date = d),
              onPickDay: (d) => setState(() {
                _date = d;
                _mode = CalMode.day;
              }),
            ),
          ],
          const SizedBox(height: 24),
          const Divider(),
          const Text('이 기기 로그인으로 일정과 안 읽은 메일을 브리핑에서 확인합니다. 메일 소식·메신저 화면은 설정의 Dooray 계정 연결을 사용합니다.'),
          OutlinedButton.icon(
            onPressed: () => context.push(
              '/web?path=${Uri.encodeComponent('/dooray?calendarSource=app')}',
            ),
            icon: const Icon(Icons.mail_outline),
            label: const Text('메일·메신저 열기'),
          ),
        ],
      )),
    );
  }
}
