import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// 아마란스 자동 로그인용 아이디·비밀번호. 값은 로그·메시지에 찍지 않는다.
class GwLogin {
  const GwLogin({required this.id, required this.pw});
  final String id, pw;
}

/// iOS Keychain · Android Keystore(flutter_secure_storage). 토큰(shared_preferences)보다 민감해서 따로 둔다.
class GwLoginStore {
  static const _id = 'gw.loginId', _pw = 'gw.loginPw';
  final _s = const FlutterSecureStorage();
  Future<GwLogin?> load() async {
    final id = await _s.read(key: _id), pw = await _s.read(key: _pw);
    if (id == null || id.isEmpty) return null;
    return GwLogin(id: id, pw: pw ?? '');
  }

  Future<void> save(GwLogin l) async {
    await _s.write(key: _id, value: l.id);
    await _s.write(key: _pw, value: l.pw);
  }

  Future<void> clear() async {
    await _s.delete(key: _id);
    await _s.delete(key: _pw);
  }
}

final gwLoginStoreProvider = Provider<GwLoginStore>((_) => GwLoginStore());

class GwLoginNotifier extends AsyncNotifier<GwLogin?> {
  @override
  Future<GwLogin?> build() => ref.read(gwLoginStoreProvider).load();
  Future<void> save(GwLogin l) async {
    await ref.read(gwLoginStoreProvider).save(l);
    state = AsyncValue.data(l);
  }

  Future<void> clear() async {
    await ref.read(gwLoginStoreProvider).clear();
    state = const AsyncValue.data(null);
  }
}

final gwLoginProvider = AsyncNotifierProvider<GwLoginNotifier, GwLogin?>(GwLoginNotifier.new);
