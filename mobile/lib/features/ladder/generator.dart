// frontend/src/lib/ladder.ts generateLadder·getResultIndex와 동일 규칙.
import 'dart:math';
import 'model.dart';

List<T> _shuffle<T>(List<T> a, Random rnd) {
  final r = [...a];
  for (var i = r.length - 1; i > 0; i--) {
    final j = rnd.nextInt(i + 1);
    final t = r[i];
    r[i] = r[j];
    r[j] = t;
  }
  return r;
}

LadderData generateLadder(List<String> participants, List<LadderResult> results, {double density = 0.4, Random? random}) {
  final rnd = random ?? Random();
  final columns = participants.length;
  final rows = max(columns * 2, 6);
  final bridges = <List<bool>>[];
  for (var r = 0; r < rows; r++) {
    final row = <bool>[];
    for (var c = 0; c < columns - 1; c++) {
      final prev = c > 0 && row[c - 1];
      row.add(!prev && rnd.nextDouble() < density);
    }
    bridges.add(row);
  }
  final padded = [...results];
  while (padded.length < columns) {
    padded.add(LadderResult('꽝 ${padded.length - results.length + 1}', 'normal'));
  }
  return LadderData(participants: _shuffle(participants, rnd), results: _shuffle(padded.take(columns).toList(), rnd), columns: columns, rows: rows, bridges: bridges);
}

/// 각 행을 지난 뒤의 열 위치(길이 rows+1, [0]=시작 열). 그리기와 결과 계산이 같은 경로를 쓴다.
List<int> columnPath(LadderData l, int startColumn) {
  var col = startColumn;
  final path = [col];
  for (var r = 0; r < l.rows; r++) {
    if (col < l.columns - 1 && l.bridges[r][col]) {
      col++;
    } else if (col > 0 && l.bridges[r][col - 1]) {
      col--;
    }
    path.add(col);
  }
  return path;
}

int resultIndex(LadderData l, int startColumn) => columnPath(l, startColumn).last;
