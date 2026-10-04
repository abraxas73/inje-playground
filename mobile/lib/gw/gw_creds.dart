import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// 아마란스 크레덴셜. authToken = "{groupSeq}|{empSeq}|{secret}". 값은 로그·메시지에 찍지 않는다.
class GwCreds {
  const GwCreds({required this.authToken, required this.signKey, this.empName, this.email});
  final String authToken, signKey;
  final String? empName, email;
  String get groupSeq => authToken.split('|').first;
  String get empSeq => authToken.split('|').elementAtOrNull(1) ?? '';
  GwCreds copyWith({String? empName, String? email}) => GwCreds(authToken: authToken, signKey: signKey, empName: empName ?? this.empName, email: email ?? this.email);
}

/// `document.cookie` 문자열 → 크레덴셜. oAuthToken/signKey가 없으면 BIZCUBE_AT/HK. iOS WKWebView는 JSON 문자열(따옴표 포함)로 돌려주므로 먼저 벗긴다.
GwCreds? parseGwCookies(String raw) {
  var s = raw.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.substring(1, s.length - 1).replaceAll(r'\"', '"');
  final m = <String, String>{};
  for (final part in s.split(';')) {
    final i = part.indexOf('=');
    if (i <= 0) continue;
    final v = part.substring(i + 1).trim();
    String decoded;
    try {
      decoded = Uri.decodeComponent(v);
    } catch (_) {
      decoded = v; // 다른 쿠키의 깨진 퍼센트 인코딩이 연결을 막지 않게
    }
    m[part.substring(0, i).trim()] = decoded;
  }
  final at = m['oAuthToken'] ?? m['BIZCUBE_AT'];
  final hk = m['signKey'] ?? m['BIZCUBE_HK'];
  if (at == null || at.isEmpty || hk == null || hk.isEmpty) return null;
  return GwCreds(authToken: at, signKey: hk);
}

/// shared_preferences 저장(Supabase 세션과 같은 저장소·같은 보호 수준).
class GwCredsStore {
  static const _at = 'gw.authToken', _hk = 'gw.signKey', _name = 'gw.empName', _email = 'gw.email';
  Future<GwCreds?> load() async {
    final p = await SharedPreferences.getInstance();
    final at = p.getString(_at), hk = p.getString(_hk);
    if (at == null || hk == null) return null;
    return GwCreds(authToken: at, signKey: hk, empName: p.getString(_name), email: p.getString(_email));
  }

  Future<void> save(GwCreds c) async {
    final p = await SharedPreferences.getInstance();
    await p.setString(_at, c.authToken);
    await p.setString(_hk, c.signKey);
    if (c.empName != null) await p.setString(_name, c.empName!);
    if (c.email != null) await p.setString(_email, c.email!);
  }

  Future<void> clear() async {
    final p = await SharedPreferences.getInstance();
    for (final k in [_at, _hk, _name, _email]) {
      await p.remove(k);
    }
  }
}

enum GwStatus { none, connected, needsRelogin }

class GwState {
  const GwState({this.creds, this.needsRelogin = false});
  final GwCreds? creds;
  final bool needsRelogin;
  GwStatus get status => creds == null ? GwStatus.none : (needsRelogin ? GwStatus.needsRelogin : GwStatus.connected);
}

final gwStoreProvider = Provider<GwCredsStore>((_) => GwCredsStore());

class GwNotifier extends AsyncNotifier<GwState> {
  @override
  Future<GwState> build() async => GwState(creds: await ref.read(gwStoreProvider).load());

  Future<void> connect(GwCreds c) async {
    await ref.read(gwStoreProvider).save(c);
    state = AsyncValue.data(GwState(creds: c));
  }

  Future<void> disconnect() async {
    await ref.read(gwStoreProvider).clear();
    state = const AsyncValue.data(GwState());
  }

  /// 401 — 토큰은 두고(재연결 때 덮어씀) 호출만 멈춘다.
  void markUnauthorized() {
    final c = state.value?.creds;
    if (c != null) state = AsyncValue.data(GwState(creds: c, needsRelogin: true));
  }
}

final gwProvider = AsyncNotifierProvider<GwNotifier, GwState>(GwNotifier.new);
