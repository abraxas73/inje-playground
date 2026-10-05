// mobile/lib/assistant/assistant_journal.dart
import 'dart:convert';
import 'package:shared_preferences/shared_preferences.dart';
import '../gw/gw_models.dart';
import 'gw_assistant_api.dart';

/// 비서가 실행한 쓰기 작업 기록(기기, 최근 20건). undo = 반대 작업 {tool, args}, 되돌릴 수 없으면 null.
class JournalEntry {
  const JournalEntry({
    required this.at,
    required this.tool,
    required this.summary,
    required this.undo,
  });
  final String at, tool, summary;
  final Map<String, dynamic>? undo;
  Map<String, dynamic> toJson() => {
    'at': at,
    'tool': tool,
    'summary': summary,
    'undo': undo,
  };
  static JournalEntry? fromJson(dynamic j) => j is Map && j['tool'] is String
      ? JournalEntry(
          at: '${j['at'] ?? ''}',
          tool: j['tool'] as String,
          summary: '${j['summary'] ?? ''}',
          undo: j['undo'] is Map
              ? Map<String, dynamic>.from(j['undo'] as Map)
              : null,
        )
      : null;
}

class AssistantJournal {
  AssistantJournal._(this._items);
  static const _key = 'assistant.journal';
  static const max = 20;
  final List<JournalEntry> _items;
  List<JournalEntry> get all => List.unmodifiable(_items);

  static Future<AssistantJournal> load() async {
    try {
      final raw = (await SharedPreferences.getInstance()).getString(_key);
      final list = raw == null ? const [] : jsonDecode(raw) as List;
      return AssistantJournal._([
        for (final x in list) ?JournalEntry.fromJson(x),
      ]);
    } catch (_) {
      return AssistantJournal._([]);
    }
  }

  Future<void> _save() async {
    try {
      await (await SharedPreferences.getInstance()).setString(
        _key,
        jsonEncode([for (final e in _items) e.toJson()]),
      );
    } catch (_) {}
  }

  Future<void> add(JournalEntry e) async {
    _items.add(e);
    while (_items.length > max) {
      _items.removeAt(0);
    }
    await _save();
  }

  /// 최근 것부터 되돌릴 수 있는 n개 — 24시간 안의 것만. at은 kstNow() 규약(KST 벽시계 + UTC 플래그)으로 기록되므로 parseLocal로 같은 규약끼리 비교한다.
  List<JournalEntry> undoable(int n, {DateTime? now}) {
    final t = now ?? kstNow();
    bool fresh(JournalEntry e) {
      final at = parseLocal(e.at);
      return at != null && t.difference(at) < const Duration(hours: 24);
    }

    return _items.reversed
        .where((e) => e.undo != null && fresh(e))
        .take(n)
        .toList();
  }

  Future<void> removeWhere(bool Function(JournalEntry) test) async {
    final before = _items.length;
    _items.removeWhere(test);
    if (_items.length != before) await _save();
  }
}
