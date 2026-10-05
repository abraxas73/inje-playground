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
  voicePickTests();

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

void voicePickTests() {
  group('pickKoreanVoice', () {
    test('iOS — 프리미엄 > 향상 > 기본, 한국어만', () {
      final v = pickKoreanVoice([
        {'name': 'Samantha', 'locale': 'en-US', 'quality': 'premium', 'identifier': 'en.p'},
        {'name': 'Yuna', 'locale': 'ko-KR', 'quality': 'default', 'identifier': 'ko.d'},
        {'name': 'Yuna', 'locale': 'ko-KR', 'quality': 'enhanced', 'identifier': 'ko.e'},
      ]);
      expect(v!.voice['identifier'], 'ko.e');
      expect(v.natural, isTrue);
      final basic = pickKoreanVoice([
        {'name': 'Yuna', 'locale': 'ko-KR', 'quality': 'default', 'identifier': 'ko.d'},
      ]);
      expect(basic!.natural, isFalse);
    });
    test('Android — very high > high, 같으면 오프라인 우선, 한국어 없으면 null', () {
      final v = pickKoreanVoice([
        {'name': 'ko-kr-x-ism-network', 'locale': 'ko-KR', 'quality': 'very high', 'network_required': '1'},
        {'name': 'ko-kr-x-ism-local', 'locale': 'ko-KR', 'quality': 'very high', 'network_required': '0'},
        {'name': 'ko-kr-language', 'locale': 'ko-KR', 'quality': 'normal', 'network_required': '0'},
      ]);
      expect(v!.voice['name'], 'ko-kr-x-ism-local');
      expect(v.voice.keys, containsAll(['name', 'locale']));
      expect(pickKoreanVoice([{'name': 'x', 'locale': 'en-US', 'quality': 'high'}]), isNull);
      expect(pickKoreanVoice('garbage'), isNull);
    });
  });
}
