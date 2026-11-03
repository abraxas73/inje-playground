// 아마란스 메신저 연동 켜기/끄기 — 계정 설정 user_settings.amaranth_messenger(on|off, 빈 값 = on), 모든 기기에 적용.
// 끄면 메신저 로그인(P076)·실시간(MQTT)·화면·위젯·이노봇/Claude 커넥터 메신저 도구가 모두 멈춘다 — 원래 아마란스 메신저를 그대로 쓰려는 사람용.
// 막는 자리는 messengerClientProvider의 로그인 한 곳(MessengerDisabledException) + 화면·위젯의 MessengerOffNotice.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../api/client.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../assistant/innobot_prefs.dart' show innobotSignedInProvider;
import 'messenger_client.dart' show MessengerException;

const messengerOffText = '아마란스 메신저 연동이 꺼져 있습니다.';

class MessengerDisabledException extends MessengerException {
  MessengerDisabledException() : super(-2, '$messengerOffText 다시 켜려면 더보기 > 아마란스 메신저 연동을 켜세요.');
}

final messengerEnabledProvider = AsyncNotifierProvider<MessengerEnabledPref, bool>(MessengerEnabledPref.new);

class MessengerEnabledPref extends AsyncNotifier<bool> {
  @override
  Future<bool> build() async {
    if (!ref.watch(innobotSignedInProvider)) return true;
    try {
      final j = await ref.read(apiClientProvider).getJson('/api/users/settings', query: const {'key': 'amaranth_messenger'});
      return !(j is Map && j['amaranth_messenger'] == 'off');
    } catch (_) {
      return true;
    }
  }

  /// 바로 반영하고 서버에 저장. 실패하면 이전 값으로 되돌리고 false.
  Future<bool> set(bool on) async {
    final prev = state.value ?? true;
    state = AsyncData(on);
    try {
      await ref.read(apiClientProvider).putJson('/api/users/settings', {'key': 'amaranth_messenger', 'value': on ? 'on' : 'off'});
      return true;
    } catch (_) {
      if (ref.mounted) state = AsyncData(prev);
      return false;
    }
  }
}

/// 꺼져 있을 때 화면·위젯 자리에 두는 안내 — "다시 켜시려면 → 설정으로 이동"(더보기의 스위치).
class MessengerOffNotice extends StatelessWidget {
  const MessengerOffNotice({super.key});
  @override
  Widget build(BuildContext context) => Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(20),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            Icon(Icons.speaker_notes_off_outlined, size: 40, color: Brand.muted),
            const SizedBox(height: 10),
            Text(messengerOffText, style: Theme.of(context).textTheme.titleSmall, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Wrap(crossAxisAlignment: WrapCrossAlignment.center, alignment: WrapAlignment.center, children: [
              Text('다시 켜시려면', style: TextStyle(fontSize: 13, color: Brand.muted)),
              TextButton.icon(onPressed: () => context.go('/more'), icon: const Icon(Icons.arrow_forward, size: 16), label: const Text('설정으로 이동')),
            ]),
          ]),
        ),
      );
}

/// 메신저 전체 화면 라우트용 — 꺼져 있으면 머리글 + 안내, 켜져 있으면 child.
class MessengerGate extends ConsumerWidget {
  const MessengerGate({super.key, required this.child, this.title = '메신저'});
  final Widget child;
  final String title;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(messengerEnabledProvider).value ?? true) return child;
    return Scaffold(appBar: BrandHeader(title: title, showBack: true), body: const MessengerOffNotice());
  }
}
