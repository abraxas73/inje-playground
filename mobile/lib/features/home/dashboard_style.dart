// 홈 위젯 배경색 — 위젯 ⋮ 메뉴에서 고른다. 계정별로 이 기기에 저장(Always On 고정 목록과 같은 방식).
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../app/theme.dart';
import 'pinned_widgets.dart' show pinnedAccountProvider;

/// 고를 수 있는 배경색(밝은 화면 기준). 어두운 화면에서는 위젯 바탕에 옅게 섞는다.
const widgetBgChoices = <(String, Color)>[
  ('하늘', Color(0xFFE8EEFF)),
  ('민트', Color(0xFFDDF4EA)),
  ('살구', Color(0xFFFFE8D6)),
  ('분홍', Color(0xFFFDE2E2)),
  ('레몬', Color(0xFFFFF3C4)),
  ('연두', Color(0xFFE2F5D8)),
  ('회색', Color(0xFFEEF0F4)),
];

/// 위젯 영역 바탕 — 고른 색이 없으면 기본(카드 바탕).
Color widgetBgColor(int? i) {
  if (i == null || i < 0 || i >= widgetBgChoices.length) return Brand.surface;
  final c = widgetBgChoices[i].$2;
  return Brand.brightness == Brightness.dark ? Color.alphaBlend(c.withValues(alpha: 0.16), Brand.surface) : c;
}

final widgetBgProvider = NotifierProvider<WidgetBgs, Map<String, int>>(WidgetBgs.new);

class WidgetBgs extends Notifier<Map<String, int>> {
  String? _account;
  String get _key => 'dashboard.bg.${_account ?? ''}';

  @override
  Map<String, int> build() {
    _account = ref.watch(pinnedAccountProvider);
    if (_account != null) _load();
    return const {};
  }

  Future<void> _load() async {
    try {
      final raw = (await SharedPreferences.getInstance()).getString(_key);
      final m = raw == null ? const {} : jsonDecode(raw);
      if (ref.mounted && state.isEmpty && m is Map) state = {for (final e in m.entries) if (e.value is int) '${e.key}': e.value as int};
    } catch (_) {}
  }

  /// i가 null이면 기본으로 되돌린다.
  void set(String id, int? i) {
    state = {...state}..remove(id);
    if (i != null) state = {...state, id: i};
    if (_account == null) return;
    final json = jsonEncode(state);
    SharedPreferences.getInstance().then((p) => p.setString(_key, json)).catchError((_) => false);
  }
}
