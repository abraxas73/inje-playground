class LadderResult {
  const LadderResult(this.text, this.type); // type: reward | punishment | normal
  final String text, type;
  Map<String, dynamic> toJson() => {'text': text, 'type': type};
  factory LadderResult.fromJson(Map<String, dynamic> j) => LadderResult(j['text'] as String? ?? '', j['type'] as String? ?? 'normal');
}

/// 웹 types/ladder.ts LadderData와 같은 키 — 저장 형식이 같아야 웹 이력에서 열린다.
class LadderData {
  const LadderData({required this.participants, required this.results, required this.columns, required this.rows, required this.bridges});
  final List<String> participants;
  final List<LadderResult> results;
  final int columns, rows;
  final List<List<bool>> bridges; // rows × (columns-1)
  Map<String, dynamic> toJson() => {'participants': participants, 'results': results.map((r) => r.toJson()).toList(), 'columns': columns, 'rows': rows, 'bridges': bridges};
  factory LadderData.fromJson(Map<String, dynamic> j) {
    final bridges = (j['bridges'] as List).map((r) => (r as List).map((b) => b == true).toList()).toList();
    final participants = (j['participants'] as List).cast<String>();
    return LadderData(
      participants: participants,
      results: (j['results'] as List).map((r) => LadderResult.fromJson(r as Map<String, dynamic>)).toList(),
      columns: (j['columns'] as num?)?.toInt() ?? participants.length,
      rows: (j['rows'] as num?)?.toInt() ?? bridges.length,
      bridges: bridges,
    );
  }
}

class LadderMapping {
  const LadderMapping(this.participant, this.result);
  final String participant;
  final LadderResult result;
  Map<String, dynamic> toJson() => {'participant': participant, 'result': result.toJson()};
}
