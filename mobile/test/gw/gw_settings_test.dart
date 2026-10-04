import 'package:flutter/material.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/testing.dart';
import 'package:playground/gw/gw_login_store.dart';
import 'package:playground/gw/gw_settings_sheet.dart';
import 'fakes.dart';

void main() {
  testWidgets('아마란스 설정 시트: 아이디·비밀번호를 저장하면 보안 저장소에 들어가고, 삭제하면 지워진다', (tester) async {
    FlutterSecureStorage.setMockInitialValues({});
    await tester.pumpWidget(gwScope(creds: testCreds, http: MockClient((_) async => throw UnimplementedError()), child: const Scaffold(body: GwSettingsSheet())));
    await tester.pumpAndSettle();
    expect(find.textContaining('홍길동'), findsOneWidget); // 연결 상태
    await tester.enterText(find.byKey(const Key('gw-login-id')), 'seunguk.kang');
    await tester.enterText(find.byKey(const Key('gw-login-pw')), 'secret');
    await tester.tap(find.text('저장'));
    await tester.pumpAndSettle();
    final l = await GwLoginStore().load();
    expect((l?.id, l?.pw), ('seunguk.kang', 'secret'));
    expect(find.textContaining('저장됨'), findsOneWidget);
    await tester.tap(find.text('저장 정보 삭제'));
    await tester.pumpAndSettle();
    expect(await GwLoginStore().load(), isNull);
  });
}
