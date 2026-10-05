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
      overrides: [apiClientProvider.overrideWithValue(brain.client), gwStoreProvider.overrideWithValue(FakeGwStore(testCreds)), gwHttpClientProvider.overrideWithValue(scenarioGw().client)],
      child: MaterialApp(home: Scaffold(body: Stack(children: [const SizedBox.expand(), child]))),
    );

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('이노봇 버튼 → 시트: 인사·예시 칩, 칩을 누르면 보내고 답이 말풍선으로', (tester) async {
    final brain = Brain([say('오늘 일정은 없습니다.')]);
    await tester.pumpWidget(host(brain, const InnobotButton()));
    await tester.tap(find.byTooltip('비서 이노봇'));
    await tester.pumpAndSettle();
    expect(find.text('무엇을 도와드릴까요?'), findsOneWidget);
    expect(find.text('오늘 내 일정 알려줘'), findsOneWidget);
    await tester.tap(find.text('오늘 내 일정 알려줘'));
    await tester.pumpAndSettle();
    expect(find.text('오늘 일정은 없습니다.'), findsOneWidget);
    expect(brain.received.single.single['content'], '오늘 내 일정 알려줘');
  });

  testWidgets('쓰기 → 확인 카드(실행·고쳐 줘·그만두기), 메일 발송은 경고 문구', (tester) async {
    final brain = Brain([use([('m', 'mail_send', {'to': ['a@x'], 'subject': '회의록', 'body': '본문'})]), say('취소했습니다.')]);
    await tester.pumpWidget(host(brain, const AssistantSheet()));
    await tester.enterText(find.byType(TextField), '회의록 보내줘');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(find.textContaining("제목 '회의록'"), findsOneWidget);
    expect(find.text('보내면 되돌릴 수 없습니다'), findsOneWidget);
    for (final l in ['실행', '고쳐 줘', '그만두기']) { expect(find.text(l), findsOneWidget); }
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
}
