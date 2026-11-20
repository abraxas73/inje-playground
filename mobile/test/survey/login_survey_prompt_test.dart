import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/survey/login_survey_prompt.dart';

void main() {
  test('서버 응답 해석 — 설문이 없거나 주소가 이상하면 null', () {
    expect(loginSurveyFrom({'survey': {'slug': 'ai-companion-efficiency', 'title': '점검', 'anonymous': true}}), (slug: 'ai-companion-efficiency', title: '점검', anonymous: true));
    expect(loginSurveyFrom({'survey': {'slug': 'a', 'title': 'b'}})?.anonymous, isFalse);
    expect(loginSurveyFrom({'survey': null}), isNull);
    expect(loginSurveyFrom(null), isNull);
    expect(loginSurveyFrom({'survey': {'slug': '../admin', 'title': 'x'}}), isNull);
  });

  testWidgets('참여 요청 대화상자 — [참여하기]면 true, [나중에]면 false', (t) async {
    late BuildContext ctx;
    await t.pumpWidget(MaterialApp(home: Builder(builder: (c) {
      ctx = c;
      return const SizedBox();
    })));
    const s = (slug: 'x', title: 'AI 컴패니언 툴 도입 3개월 업무 효율성 점검', anonymous: true);
    var r = showLoginSurveyDialog(ctx, s);
    await t.pumpAndSettle();
    expect(find.textContaining('AI 컴패니언 툴 도입 3개월'), findsOneWidget);
    expect(find.textContaining('익명으로 집계'), findsOneWidget);
    await t.tap(find.text('참여하기'));
    await t.pumpAndSettle();
    expect(await r, isTrue);
    r = showLoginSurveyDialog(ctx, s);
    await t.pumpAndSettle();
    await t.tap(find.text('나중에'));
    await t.pumpAndSettle();
    expect(await r, isFalse);
  });
}
