import 'package:shared_preferences/shared_preferences.dart';

/// 법카 보유자(기기 저장) — 웹 localStorage 'team-card-holders'와 같은 역할.
class TeamPrefs {
  static const _k = 'team-card-holders';
  static Future<Set<String>> cardHolders() async => ((await SharedPreferences.getInstance()).getStringList(_k) ?? const []).toSet();
  static Future<void> save(Set<String> s) async => (await SharedPreferences.getInstance()).setStringList(_k, s.toList());
}
