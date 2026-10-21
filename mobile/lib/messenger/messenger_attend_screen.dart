import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'messenger_models.dart';
import 'messenger_provider.dart';
import 'messenger_ui.dart';

/// 오늘 근태(P1181) — 전사 오늘 근태(연차·출장·재택 등)를 이름과 함께. 지금 유효한 근태가 위로.
class MessengerAttendScreen extends ConsumerStatefulWidget {
  const MessengerAttendScreen({super.key});
  @override
  ConsumerState<MessengerAttendScreen> createState() => _MessengerAttendScreenState();
}

class _MessengerAttendScreenState extends ConsumerState<MessengerAttendScreen> {
  late Future<List<MsgAttend>> _future = ref.read(messengerApiProvider).todayAttend();

  Future<void> _refresh() async {
    setState(() => _future = ref.read(messengerApiProvider).todayAttend());
    await _future.catchError((_) => <MsgAttend>[]);
  }

  @override
  Widget build(BuildContext context) {
    final now = DateTime.now();
    return Scaffold(
      appBar: BrandHeader(title: '오늘 근태', showBack: true),
      body: FutureBuilder<List<MsgAttend>>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return MessengerError(error: snap.error!, onRetry: _refresh);
          final list = [...(snap.data ?? const <MsgAttend>[])];
          if (list.isEmpty) {
            return RefreshIndicator(onRefresh: _refresh, child: ListView(children: [SizedBox(height: 120), Center(child: Text('오늘 등록된 근태가 없습니다', style: TextStyle(color: Brand.muted)))]));
          }
          // 지금 유효한 근태 먼저, 그다음 이름순
          list.sort((a, b) {
            final av = a.activeAt(now), bv = b.activeAt(now);
            if (av != bv) return av ? -1 : 1;
            return a.empName.compareTo(b.empName);
          });
          return RefreshIndicator(
            onRefresh: _refresh,
            child: ListView.separated(
              itemCount: list.length,
              separatorBuilder: (_, _) => const Divider(height: 1, indent: 16),
              itemBuilder: (_, i) {
                final a = list[i];
                final active = a.activeAt(now);
                final time = [a.startTm, a.endTm].where((s) => s.isNotEmpty).join(' ~ ');
                return ListTile(
                  leading: InitialBadge(a.empName.isEmpty ? '?' : a.empName),
                  title: Text(a.empName, maxLines: 1, overflow: TextOverflow.ellipsis),
                  subtitle: time.isEmpty ? null : Text(time, style: TextStyle(color: Brand.muted)),
                  trailing: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                    decoration: BoxDecoration(color: active ? Brand.blueTint : Brand.ground, borderRadius: BorderRadius.circular(12)),
                    child: Text(a.atName, style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: active ? Brand.navy : Brand.muted)),
                  ),
                );
              },
            ),
          );
        },
      ),
    );
  }
}
