import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../gw/gw_client.dart' show gwHttpClientProvider;
import '../gw/gw_login_store.dart';
import 'messenger_api.dart';
import 'messenger_client.dart';

/// 메신저 클라이언트 — 저장된 아마란스 자동 로그인(아이디·비밀번호)으로 P076 로그인을 수행한다.
/// 자격증명이 없으면 호출 시 MessengerAuthException. 세션·프로토콜표는 클라이언트가 캐시한다.
final messengerClientProvider = Provider<MessengerClient>((ref) {
  return MessengerClient(
    httpClient: ref.watch(gwHttpClientProvider),
    loadCreds: () async {
      final l = await ref.read(gwLoginStoreProvider).load();
      if (l == null || l.id.isEmpty) return null;
      return (id: l.id, pw: l.pw);
    },
  );
});

/// 메신저 기능 API(대화·쪽지·검색·근태·접속상태·공지/파일함).
final messengerApiProvider = Provider<MessengerApi>((ref) => MessengerApi(ref.watch(messengerClientProvider)));
