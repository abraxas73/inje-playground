import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/auth/session.dart';
import 'package:playground/dooray/calendar_screen.dart';
import 'package:playground/dooray/calendar_session.dart';
class _Session extends SessionNotifier {
  @override Future<AppSession?> build() async => AppSession(email:'a@x',role:'user',permissions:const {});
}
void main() {
  for (final fail in [false,true]) {
    testWidgets('calendar renders success/error without empty-success confusion: $fail', (tester) async {
      await tester.pumpWidget(ProviderScope(overrides:[
        sessionProvider.overrideWith(_Session.new),
        doorayCalendarOwnerProvider.overrideWithValue('a@x'),
        doorayDayProvider.overrideWith((ref, day) async {
          if (fail) throw Exception('upstream');
          return {'items':[{'subject':'기기 회의','startedAt':'2026-10-12T01:00:00Z','endedAt':'2026-10-12T02:00:00Z','wholeDayFlag':false}]};
        }),
      ], child:const MaterialApp(home:DoorayCalendarScreen())));
      await tester.pumpAndSettle();
      expect(find.text('다시 로그인'), findsOneWidget);
      expect(find.text('해당 날짜의 일정이 없습니다.'), findsNothing);
      expect(find.text('기기 회의'), fail ? findsNothing : findsOneWidget);
      if (fail) expect(find.textContaining('일정을 불러오지 못했습니다'), findsOneWidget);
    });
  }
}
