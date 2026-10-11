import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../auth/session.dart';
import '../briefing/briefing_provider.dart';
import 'calendar_session.dart';
import 'calendar_webview.dart';

final doorayDayProvider = FutureProvider.autoDispose
    .family<Map<String, dynamic>?, String>((ref, day) async {
      final client = ref.watch(doorayCalendarTransportProvider);
      return client?.read(day);
    });
String doorayDay(DateTime value) => value.toIso8601String().substring(0, 10);

class DoorayCalendarScreen extends ConsumerStatefulWidget {
  const DoorayCalendarScreen({super.key});
  @override
  ConsumerState<DoorayCalendarScreen> createState() =>
      _DoorayCalendarScreenState();
}

class _DoorayCalendarScreenState extends ConsumerState<DoorayCalendarScreen> {
  late DateTime _date = DateTime.parse(
    doorayDay(DateTime.now().toUtc().add(const Duration(hours: 9))),
  );
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
    ref.invalidate(doorayDayProvider);
    ref.invalidate(briefingProvider);
  }

  Future<void> _disconnect() async {
    ref.read(doorayCalendarTransportProvider.notifier).clear();
    await ref.read(doorayCalendarConnectionProvider.notifier).disconnect();
    ref.invalidate(doorayDayProvider);
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
    final result = ref.watch(doorayDayProvider(doorayDay(_date)));
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dooray'),
        actions: [
          IconButton(
            tooltip: '일정 새로고침',
            onPressed: connected
                ? () => ref.invalidate(doorayDayProvider)
                : null,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      body: ListView(
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
                child: Text(connected ? '다시 로그인' : '일정 연결'),
              ),
              if (connected)
                TextButton(
                  onPressed: _disconnect,
                  child: const Text('일정 연결 해제'),
                ),
            ],
          ),
          if (connected) ...[
            TextButton.icon(
              onPressed: () async {
                final day = await showDatePicker(
                  context: context,
                  initialDate: _date,
                  firstDate: DateTime(2020),
                  lastDate: DateTime(2100),
                );
                if (day != null && mounted) setState(() => _date = day);
              },
              icon: const Icon(Icons.calendar_month),
              label: Text('${doorayDay(_date)} (한국 시간)'),
            ),
            result.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (_, _) =>
                  const Text('일정을 불러오지 못했습니다. 새로고침하거나 다시 로그인해 주세요.'),
              data: (data) {
                if (data == null) return const Text('Dooray 연결을 준비하고 있습니다…');
                final items = data['items'] as List;
                if (items.isEmpty) return const Text('해당 날짜의 일정이 없습니다.');
                return Column(
                  children: [
                    for (final e in items)
                      Card(
                        child: ListTile(
                          title: Text(e['subject'] as String),
                          subtitle: Text(
                            e['wholeDayFlag'] == true
                                ? '종일'
                                : '${_time(e['startedAt'])} – ${_time(e['endedAt'])}',
                          ),
                        ),
                      ),
                  ],
                );
              },
            ),
          ],
          const SizedBox(height: 24),
          const Divider(),
          const Text('메일·메신저는 설정의 Dooray 계정 연결을 사용합니다.'),
          OutlinedButton.icon(
            onPressed: () => context.push(
              '/web?path=${Uri.encodeComponent('/dooray?calendarSource=app')}',
            ),
            icon: const Icon(Icons.mail_outline),
            label: const Text('메일·메신저 열기'),
          ),
        ],
      ),
    );
  }

  String _time(String raw) {
    final d = DateTime.tryParse(raw)?.toUtc().add(const Duration(hours: 9));
    return d == null
        ? ''
        : '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';
  }
}
