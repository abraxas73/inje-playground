import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/legacy.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/assistant/innobot_prefs.dart';
import 'package:playground/notifications/app_badge.dart';
import 'package:playground/notifications/notifications.dart';

void main() {
  const channel = MethodChannel('com.innogrid.playground/badge');
  final sent = <Object?>[];
  setUp(() {
    sent.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, (c) async {
      sent.add('${c.method}:${c.arguments}');
      return null;
    });
  });
  tearDown(() => TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(channel, null));

  Widget app(ProviderContainer c) => UncontrolledProviderScope(container: c, child: const AppBadgeSync(child: SizedBox()));

  testWidgets('안 읽은 알림 수를 아이콘 배지로, 같은 수는 다시 보내지 않고, 로그아웃이면 0', (tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.macOS;
    final unread = StateProvider<int>((_) => 3);
    final signedIn = StateProvider<bool>((_) => true);
    final c = ProviderContainer(overrides: [
      notifUnreadProvider.overrideWith((ref) => ref.watch(unread)),
      innobotSignedInProvider.overrideWith((ref) => ref.watch(signedIn)),
    ]);
    addTearDown(c.dispose);
    await tester.pumpWidget(app(c));
    expect(sent, ['set:3']);

    await tester.pumpWidget(app(c)); // 같은 수로 다시 그림
    expect(sent, ['set:3']);

    c.read(unread.notifier).state = 5;
    await tester.pump();
    expect(sent.last, 'set:5');

    c.read(signedIn.notifier).state = false;
    await tester.pump();
    expect(sent.last, 'set:0');
    debugDefaultTargetPlatformOverride = null;
  });

  test('Android는 배지를 보내지 않는다', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    await setAppBadge(4);
    expect(sent, isEmpty);
    debugDefaultTargetPlatformOverride = null;
  });
}
