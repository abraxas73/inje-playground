import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/directory/org_directory.dart';
import 'package:playground/directory/person_view.dart';

void main() {
  testWidgets('사진을 누르면 상세 시트 — 이름·직책·소속·이메일과 메신저·메일 버튼, 명부에 없는 사람은 누를 수 없다', (t) async {
    const p = (empSeq: '11', name: '박석현', email: 'park@innogrid.com', dept: '플랫폼팀', duty: '팀장', position: '책임', photo: '', photoLarge: '');
    await t.pumpWidget(ProviderScope(
      overrides: [orgPersonBySeqProvider.overrideWith((ref) async => {'11': p})],
      child: const MaterialApp(home: Scaffold(body: Column(children: [PersonAvatar(empSeq: '11', name: '박석현'), PersonAvatar(empSeq: '99', name: '외부인')]))),
    ));
    await t.pump();
    expect(find.text('박'), findsOneWidget); // 사진이 없으면 첫 글자
    expect(find.ancestor(of: find.text('외'), matching: find.byType(InkWell)), findsNothing);
    await t.tap(find.text('박'));
    await t.pumpAndSettle();
    expect(find.text('팀장 · 책임'), findsOneWidget);
    expect(find.text('플랫폼팀'), findsOneWidget);
    expect(find.text('park@innogrid.com'), findsOneWidget);
    expect(find.text('메신저 대화'), findsOneWidget);
    expect(find.text('메일 쓰기'), findsOneWidget);
  });
}
