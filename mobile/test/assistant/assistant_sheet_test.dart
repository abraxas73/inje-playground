import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/assistant_sheet.dart';
import 'package:playground/assistant/innobot_button.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../gw/fakes.dart';
import 'assistant_session_test.dart' show Brain, say, use, scenarioGw;

Widget host(Brain brain, Widget child) => ProviderScope(
  key: UniqueKey(),
  overrides: [
    apiClientProvider.overrideWithValue(brain.client),
    gwStoreProvider.overrideWithValue(FakeGwStore(testCreds)),
    gwHttpClientProvider.overrideWithValue(scenarioGw().client),
  ],
  child: MaterialApp(
    home: Scaffold(body: Stack(children: [const SizedBox.expand(), child])),
  ),
);

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('생각하는 동안 중지 버튼을 누르면 입력이 다시 활성화된다', (tester) async {
    final wait = Completer<void>();
    final brain = Brain([say('늦은 응답')], waitForTurn: wait.future);
    await tester.pumpWidget(host(brain, const AssistantSheet()));
    await tester.enterText(find.byType(TextField), '대기 요청');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pump();
    expect(find.byTooltip('응답 중지'), findsOneWidget);
    await tester.tap(find.byTooltip('응답 중지'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.byType(TextField)).enabled, true);
    expect(find.byTooltip('보내기'), findsOneWidget);
    expect(find.text('생각하는 중…'), findsNothing);
    wait.complete();
    await tester.pumpAndSettle();
    expect(find.text('늦은 응답'), findsNothing);
  });

  testWidgets('대화창을 다시 열면 마지막 대화가 보인다', (tester) async {
    final brain = Brain([say(List.filled(60, '긴 대화').join('\n'))]);
    await tester.pumpWidget(host(brain, const InnobotButton()));
    await tester.tap(find.byTooltip('비서 이노봇'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('오늘 내 일정 알려줘'));
    await tester.pumpAndSettle();
    Navigator.of(tester.element(find.byType(AssistantSheet))).pop();
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('비서 이노봇'));
    await tester.pumpAndSettle();
    final scroll = tester.widget<ListView>(find.byType(ListView)).controller!;
    expect(scroll.offset, scroll.position.maxScrollExtent);
    expect(scroll.offset, greaterThan(0));
  });

  testWidgets('이노봇 버튼 → 시트: 인사·예시 칩, 칩을 누르면 보내고 답이 말풍선으로', (tester) async {
    final brain = Brain([say('오늘 일정은 없습니다.')]);
    await tester.pumpWidget(host(brain, const InnobotButton()));
    await tester.tap(find.byTooltip('비서 이노봇'));
    await tester.pumpAndSettle();
    expect(find.text('무엇을 도와드릴까요?'), findsOneWidget);
    expect(find.text('오늘 내 일정 알려줘'), findsOneWidget);
    expect(
      find.text(
        '오늘 오후 빈 회의실 1시간 잡고, 그에 맞는 일정을 등록해줘, 회의명은 내부회의, 참석자는 우리팀 전원. 캘린더는 이노그리드로 해줘',
      ),
      findsOneWidget,
    );
    await tester.tap(find.text('오늘 내 일정 알려줘'));
    await tester.pumpAndSettle();
    expect(find.text('오늘 일정은 없습니다.'), findsOneWidget);
    expect(brain.received.single.single['content'], '오늘 내 일정 알려줘');
  });

  testWidgets('쓰기 → 확인 카드(실행·고쳐 줘·그만두기), 메일 발송은 경고 문구', (tester) async {
    final brain = Brain([
      use([
        (
          'm',
          'mail_send',
          {
            'to': ['a@x'],
            'subject': '회의록',
            'body': '본문',
          },
        ),
      ]),
      say('취소했습니다.'),
    ]);
    await tester.pumpWidget(host(brain, const AssistantSheet()));
    await tester.enterText(find.byType(TextField), '회의록 보내줘');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(find.textContaining("제목 '회의록'"), findsOneWidget);
    expect(find.text('보내면 되돌릴 수 없습니다'), findsOneWidget);
    for (final l in ['실행', '고쳐 줘', '그만두기']) {
      expect(find.text(l), findsOneWidget);
    }
    await tester.tap(find.text('그만두기'));
    await tester.pumpAndSettle();
    expect(find.text('그만두었습니다'), findsOneWidget);
    expect(find.text('취소했습니다.'), findsOneWidget);
  });

  testWidgets('새 대화는 기록을 비운다', (tester) async {
    final brain = Brain([say('네.')]);
    await tester.pumpWidget(host(brain, const AssistantSheet()));
    await tester.enterText(find.byType(TextField), '안녕');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(find.text('네.'), findsOneWidget);
    await tester.tap(find.byTooltip('새 대화'));
    await tester.pumpAndSettle();
    expect(find.text('네.'), findsNothing);
    expect(find.text('무엇을 도와드릴까요?'), findsOneWidget);
  });

  testWidgets('비서가 꺼져 있으면(서버 enabled:false) 이노봇 버튼을 숨긴다', (tester) async {
    final brain = Brain([
      {'enabled': false},
    ]);
    await tester.pumpWidget(host(brain, const InnobotButton()));
    await tester.tap(find.byTooltip('비서 이노봇'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('오늘 내 일정 알려줘'));
    await tester.pumpAndSettle();
    expect(find.text('관리자가 비서를 꺼 두었습니다.'), findsOneWidget);
    Navigator.of(tester.element(find.text('관리자가 비서를 꺼 두었습니다.'))).pop();
    await tester.pumpAndSettle();
    expect(find.byTooltip('비서 이노봇'), findsNothing);
  });
}
