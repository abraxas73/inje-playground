import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/assistant_sheet.dart';
import 'package:playground/assistant/assistant_voice.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../gw/fakes.dart';
import 'assistant_session_test.dart' show Brain, say, choices, roomOpt, scenarioGw;
import 'gw_assistant_api_test.dart' show Gw;

class FakeVoice implements VoiceInput {
  void Function(String, bool)? cb;
  void Function()? end;
  var allow = true;
  var stopped = 0;
  var starts = 0;
  @override
  Future<bool> start(void Function(String text, bool done) onResult, void Function() onEnd) async {
    starts++;
    cb = onResult;
    end = onEnd;
    return allow;
  }

  @override
  Future<void> stop() async => stopped++;
}

class FakeSpeaker implements Speaker {
  FakeSpeaker({this.basic = false});
  final bool basic;
  @override
  bool get usingBasicVoice => basic;
  @override
  Future<void> prepare() async {}
  final spoken = <String>[];
  Completer<void>? running;
  var stops = 0;
  @override
  Future<void> speak(String text) {
    spoken.add(text);
    running = Completer<void>();
    return running!.future;
  }

  @override
  Future<void> stop() async => stops++; // 실제 플러그인도 stop으로 speak() Future를 끝내지 않는다
}

Widget host(Brain brain, Gw gw, FakeVoice v, FakeSpeaker sp) => ProviderScope(
      key: UniqueKey(),
      overrides: [
        apiClientProvider.overrideWithValue(brain.client),
        gwStoreProvider.overrideWithValue(FakeGwStore(testCreds)),
        gwHttpClientProvider.overrideWithValue(gw.client),
        voiceInputProvider.overrideWithValue(v),
        speakerProvider.overrideWithValue(sp),
      ],
      child: const MaterialApp(home: Scaffold(body: AssistantSheet())),
    );

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('선택지 카드 — 선택지마다 [실행], 누른 선택지만 실행', (tester) async {
    final brain = Brain([
      choices('x', [roomOpt('16시 A', 'R1', 'A'), roomOpt('16시 B', 'R2', 'B')]),
      say('회의실B를 예약했습니다.'),
    ]);
    final gw = scenarioGw();
    await tester.pumpWidget(host(brain, gw, FakeVoice(), FakeSpeaker()));
    await tester.enterText(find.byType(TextField), '16시 회의실');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(find.text('16시 A'), findsOneWidget);
    expect(find.text('16시 B'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '실행'), findsNWidgets(2));
    expect(find.text('고쳐 줘'), findsOneWidget);
    await tester.tap(find.widgetWithText(FilledButton, '실행').last);
    await tester.pumpAndSettle();
    expect(gw.calls['/schres/rs121A06']!.single['resSeq'], 'R2');
    expect(find.widgetWithText(FilledButton, '실행'), findsNothing);
    expect(find.text('회의실B를 예약했습니다.'), findsOneWidget);
  });

  testWidgets('말하기 — 듣는 동안 입력칸에 글자가 차고, 끝나면 보낸다', (tester) async {
    final brain = Brain([say('오늘 일정은 없습니다.')]);
    final v = FakeVoice();
    await tester.pumpWidget(host(brain, scenarioGw(), v, FakeSpeaker()));
    await tester.tap(find.byTooltip('말하기'));
    await tester.pump();
    expect(find.byTooltip('듣기 멈추기'), findsOneWidget);
    v.cb!('오늘', false);
    await tester.pump();
    expect(find.text('오늘'), findsOneWidget);
    v.cb!('오늘 일정 알려줘', true);
    await tester.pumpAndSettle();
    expect(brain.received.single.single['content'], '오늘 일정 알려줘');
    expect(find.text('오늘 일정은 없습니다.'), findsOneWidget);
    expect(find.byTooltip('말하기'), findsOneWidget);
  });

  testWidgets('말하기 — 권한이 없으면 안내만', (tester) async {
    final v = FakeVoice()..allow = false;
    await tester.pumpWidget(host(Brain([]), scenarioGw(), v, FakeSpeaker()));
    await tester.tap(find.byTooltip('말하기'));
    await tester.pumpAndSettle();
    expect(find.textContaining('마이크'), findsOneWidget);
  });

  testWidgets('읽어 주기 — 답변 끝 스피커를 눌러야 읽고, 다시 누르면 멈춤', (tester) async {
    final brain = Brain([say('오늘 일정은 없습니다.')]);
    final sp = FakeSpeaker();
    await tester.pumpWidget(host(brain, scenarioGw(), FakeVoice(), sp));
    await tester.enterText(find.byType(TextField), '일정');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(sp.spoken, isEmpty, reason: '자동으로 읽지 않는다');
    await tester.tap(find.byTooltip('읽어 주기').last);
    await tester.pump();
    expect(sp.spoken, ['오늘 일정은 없습니다.']);
    expect(find.byTooltip('그만 읽기'), findsOneWidget);
    await tester.tap(find.byTooltip('그만 읽기'));
    await tester.pumpAndSettle();
    expect(sp.stops, 1);
    expect(find.byTooltip('그만 읽기'), findsNothing);
  });

  testWidgets('말하기 — 아무 말 없이 끝나면(오류·시간 초과) 듣기 상태가 풀린다', (tester) async {
    final v = FakeVoice();
    await tester.pumpWidget(host(Brain([]), scenarioGw(), v, FakeSpeaker()));
    await tester.tap(find.byTooltip('말하기'));
    await tester.pump();
    expect(find.byTooltip('듣기 멈추기'), findsOneWidget);
    v.end!();
    await tester.pump();
    expect(find.byTooltip('말하기'), findsOneWidget);
  });

  testWidgets('말하기 — 듣는 중 직접 보내면 듣기를 멈추고 늦게 온 인식 결과는 버린다', (tester) async {
    final brain = Brain([say('네.')]);
    final v = FakeVoice();
    await tester.pumpWidget(host(brain, scenarioGw(), v, FakeSpeaker()));
    await tester.tap(find.byTooltip('말하기'));
    await tester.pump();
    await tester.enterText(find.byType(TextField), '직접 입력');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(v.stopped, 1);
    v.cb!('늦은 인식', true);
    await tester.pumpAndSettle();
    expect(brain.received, hasLength(1));
    expect(brain.received.single.single['content'], '직접 입력');
  });

  testWidgets('읽는 중 다른 말풍선·새 대화 — 앞의 읽기를 멈추고 아이콘도 정리', (tester) async {
    final brain = Brain([say('첫째 답.'), say('둘째 답.')]);
    final sp = FakeSpeaker();
    await tester.pumpWidget(host(brain, scenarioGw(), FakeVoice(), sp));
    for (final t in ['a', 'b']) {
      await tester.enterText(find.byType(TextField), t);
      await tester.tap(find.byTooltip('보내기'));
      await tester.pumpAndSettle();
    }
    final speakers = find.byTooltip('읽어 주기');
    await tester.tap(speakers.at(1));
    await tester.pump();
    await tester.tap(find.byTooltip('읽어 주기').last);
    await tester.pump();
    expect(sp.spoken, ['첫째 답.', '둘째 답.']);
    expect(sp.stops, 1);
    expect(find.byTooltip('그만 읽기'), findsOneWidget);
    await tester.tap(find.byTooltip('새 대화'));
    await tester.pump();
    expect(sp.stops, 2);
    expect(find.byTooltip('그만 읽기'), findsNothing);
  });

  testWidgets('선택지 카드 — 실제 대상 줄이 먼저, 모델이 쓴 이름은 보조, 대기 카드 중엔 🎤 꺼짐', (tester) async {
    final brain = Brain([choices('x', [roomOpt('엉뚱한 이름', 'R1', 'A'), roomOpt('둘째', 'R2', 'B')])]);
    await tester.pumpWidget(host(brain, scenarioGw(), FakeVoice(), FakeSpeaker()));
    await tester.enterText(find.byType(TextField), '회의실');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    final line = tester.getTopLeft(find.textContaining('회의실A').first).dy;
    final label = tester.getTopLeft(find.text('엉뚱한 이름')).dy;
    expect(line < label, isTrue, reason: '조회한 대상이 위, 모델 문구는 아래');
    final mic = tester.widget<IconButton>(find.ancestor(of: find.byIcon(Icons.mic), matching: find.byType(IconButton)));
    expect(mic.onPressed, isNull);
  });

  testWidgets('기본 음성뿐이면 🔊 처음 누를 때 고품질 음성 설치 안내(앱 실행당 한 번, 닫기 가능)', variant: TargetPlatformVariant.only(TargetPlatform.iOS), (tester) async {
    final brain = Brain([say('첫째.'), say('둘째.')]);
    final sp = FakeSpeaker(basic: true);
    await tester.pumpWidget(host(brain, scenarioGw(), FakeVoice(), sp));
    for (final t in ['a', 'b']) {
      await tester.enterText(find.byType(TextField), t);
      await tester.tap(find.byTooltip('보내기'));
      await tester.pumpAndSettle();
    }
    expect(find.textContaining('손쉬운 사용'), findsNothing);
    await tester.tap(find.byTooltip('읽어 주기').first);
    await tester.pump();
    expect(find.textContaining('손쉬운 사용 > 읽기 및 말하기 > 음성 > 한국어'), findsOneWidget);
    expect(find.textContaining('향상'), findsOneWidget);
    await tester.tap(find.byTooltip('안내 닫기'));
    await tester.pump();
    expect(find.textContaining('손쉬운 사용'), findsNothing);
    await tester.tap(find.byTooltip('읽어 주기').last);
    await tester.pump();
    expect(find.textContaining('손쉬운 사용'), findsNothing, reason: '한 번만');
  });

  testWidgets('고품질 음성이 있으면 안내 없음', (tester) async {
    final brain = Brain([say('답.')]);
    await tester.pumpWidget(host(brain, scenarioGw(), FakeVoice(), FakeSpeaker()));
    await tester.enterText(find.byType(TextField), 'a');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('읽어 주기').last);
    await tester.pump();
    expect(find.byTooltip('안내 닫기'), findsNothing);
  });

  test('isCommandEnd — 명시적 명령 어미(~줘·~주세요·~실행)로 끝나야 바로 보냄', () {
    for (final t in ['오늘 일정 알려줘', '회의실 잡아줘.', '일정 등록해 주세요', '예약 실행', '바로 실행해', '잡아 줘!']) {
      expect(isCommandEnd(t), isTrue, reason: t);
    }
    for (final t in ['오늘 오후 빈 회의실', '참석자는 우리팀', '', '줘서 고마워요']) {
      expect(isCommandEnd(t), isFalse, reason: t);
    }
  });

  testWidgets('말하기 — 명령 어미가 아니면 계속 듣고, 이어 말한 것을 붙여 명령이 끝나면 바로 보냄', (tester) async {
    final brain = Brain([say('네.')]);
    final v = FakeVoice();
    await tester.pumpWidget(host(brain, scenarioGw(), v, FakeSpeaker()));
    await tester.tap(find.byTooltip('말하기'));
    await tester.pump();
    v.cb!('오늘 오후 빈 회의실', true);
    await tester.pump(const Duration(milliseconds: 1500));
    expect(brain.received, isEmpty, reason: '명령이 끝나지 않았으니 기다린다');
    expect(v.starts, 2, reason: '이어서 듣는다');
    expect(find.byTooltip('듣기 멈추기'), findsOneWidget);
    v.cb!('1시간 잡아줘', true);
    await tester.pumpAndSettle();
    expect(brain.received.single.single['content'], '오늘 오후 빈 회의실 1시간 잡아줘');
  });

  testWidgets('말하기 — 명령 어미 없이 2초 조용하면 그대로 보냄, 그 사이 말을 시작하면 기다림을 연장', (tester) async {
    final brain = Brain([say('네.')]);
    final v = FakeVoice();
    await tester.pumpWidget(host(brain, scenarioGw(), v, FakeSpeaker()));
    await tester.tap(find.byTooltip('말하기'));
    await tester.pump();
    v.cb!('오늘 오후 빈 회의실', true);
    await tester.pump(const Duration(milliseconds: 1500));
    v.cb!('한 시간', false); // 말하는 중 — 타이머 취소
    await tester.pump(const Duration(milliseconds: 1500));
    expect(brain.received, isEmpty);
    expect(find.text('오늘 오후 빈 회의실 한 시간'), findsOneWidget);
    v.cb!('한 시간', true);
    await tester.pump(const Duration(milliseconds: 1999));
    expect(brain.received, isEmpty);
    await tester.pump(const Duration(milliseconds: 10));
    await tester.pumpAndSettle();
    expect(brain.received.single.single['content'], '오늘 오후 빈 회의실 한 시간');
    expect(v.stopped, greaterThanOrEqualTo(1));
  });
}
