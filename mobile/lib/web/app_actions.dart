import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../gw/gw_api.dart';
import '../gw/mail_compose_screen.dart';
import '../messenger/messenger_chat_screen.dart' show MessengerRoomScreen;
import '../messenger/messenger_models.dart';
import '../messenger/messenger_provider.dart';

/// 웹 화면(WebView)이 앱 네이티브 화면을 여는 요청 — 같은 사이트의 `/app-action?kind=…` 이동을 web_screen이 가로챈다.
/// 조직도(/org)의 메신저 대화·메일 보내기가 쓴다(frontend/src/components/org/org-tree.ts appActionUrl).
/// - messenger: emp=사번,… names=이름,… → 1:1은 기존 방 재사용·없으면 생성, 여럿은 그룹방(openRoomWith) → 대화방
/// - mail: to=주소,… → 받는 사람을 채운 메일 쓰기
bool isAppAction(Uri uri, Uri appOrigin) => uri.path == '/app-action' && uri.host == appOrigin.host;

List<String> _list(Uri uri, String key) => (uri.queryParameters[key] ?? '').split(',').map((s) => s.trim()).where((s) => s.isNotEmpty).toList();

Future<void> handleAppAction(BuildContext context, WidgetRef ref, Uri uri) async {
  final nav = Navigator.of(context);
  final messenger = ScaffoldMessenger.of(context);
  void say(String m) => messenger.showSnackBar(SnackBar(content: Text(m)));
  switch (uri.queryParameters['kind']) {
    case 'messenger':
      final emps = _list(uri, 'emp'), names = _list(uri, 'names');
      if (emps.isEmpty) return say('메신저로 대화할 사람을 고르세요.');
      try {
        final roomId = await ref.read(messengerApiProvider).openRoomWith(emps);
        final title = names.isEmpty ? '대화' : names.length == 1 ? names.first : '${names.first} 외 ${names.length - 1}명';
        await nav.push(MaterialPageRoute<void>(builder: (_) => MessengerRoomScreen(room: MsgRoom.minimal(roomId, title: title))));
      } catch (e) {
        say('대화방을 열지 못했습니다: $e');
      }
    case 'mail':
      final api = ref.read(gwApiProvider);
      if (api == null) return say('아마란스를 먼저 연결해 주세요(더보기 > 아마란스).');
      await nav.push(MaterialPageRoute<bool>(builder: (_) => MailComposeScreen(api: api, initialTo: _list(uri, 'to').join(', '))));
    default:
      say('알 수 없는 요청입니다.');
  }
}
