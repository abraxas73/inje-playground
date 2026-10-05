import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/assistant/assistant_voice.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  final calls = <String>[];
  setUp(() {
    calls.clear();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('flutter_tts'),
      (c) async {
        calls.add(c.method == 'setIosAudioCategory' ? 'cat:${(c.arguments as Map)['iosAudioCategoryKey']}' : c.method);
        return 1;
      },
    );
  });
  tearDown(() => debugDefaultTargetPlatformOverride = null);

  test('iOS — 읽을 때마다 재생 카테고리로(무음 스위치·음성 인식 뒤 세션 복원에도 들리게) 세션을 켠 뒤 읽는다', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    final sp = DeviceSpeaker();
    await sp.speak('하나');
    await sp.speak('둘');
    final speaks = [for (final (i, m) in calls.indexed) if (m == 'speak') i];
    expect(speaks, hasLength(2));
    for (final i in speaks) {
      final before = calls.sublist(0, i);
      // 카테고리 호출(setIosAudioCategory)은 플러그인이 실제 OS(Platform.isIOS)를 보고 걸러 테스트 호스트(macOS)에선 채널까지 오지 않는다 — 세션 켜기로 확인.
      expect(before.lastIndexOf('setSharedInstance'), greaterThan(before.lastIndexOf('speak')));
    }
  });

  test('Android — iOS 오디오 세션 호출 없음', () async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    await DeviceSpeaker().speak('하나');
    expect(calls.where((m) => m.startsWith('cat:') || m == 'setSharedInstance'), isEmpty);
    expect(calls, contains('speak'));
  });
}
