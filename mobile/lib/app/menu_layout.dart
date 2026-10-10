import 'package:flutter/painting.dart';

/// 그룹 하위 메뉴 좌표 — 바 위에 평범한 줄(한 줄 최대 [perRow]개, 가로 중앙 정렬). 넘치면 줄을 늘려 균등하게 나누고
/// 남는 항목은 아래 줄부터 하나씩 더 둔다(7개 → 위 3·아래 4). 좌표는 원점(누른 탭 가운데·바 윗변) 기준, 위쪽이 음수 dy.
/// 순서는 윗줄 왼→오, 다음 줄 왼→오(펼침 시간차도 이 순서). 셀 폭 기본은 화면 폭 ÷ [perRow](390px → 78, 원 60 + 여유 18).
/// 맨 아래 줄 원 중심은 바에서 [bottom] 위(원 23 + 라벨 ~36이 바에 닿지 않게), 줄 간격은 [rowHeight](항목 높이 82 + 8).
List<Offset> rowLayout({
  required int count,
  required double originX,
  required double width,
  int perRow = 5,
  double rowHeight = 90,
  double bottom = 72,
  double? cellWidth,
}) {
  if (count <= 0) return const [];
  final rows = (count / perRow).ceil();
  final base = count ~/ rows, extra = count % rows;
  final cell = cellWidth ?? width / perRow;
  final out = <Offset>[];
  for (var r = 0; r < rows; r++) {
    final n = base + (r >= rows - extra ? 1 : 0);
    final dy = -(bottom + (rows - 1 - r) * rowHeight);
    final startX = (width - n * cell) / 2 + cell / 2;
    for (var k = 0; k < n; k++) {
      out.add(Offset(startX + k * cell - originX, dy));
    }
  }
  return out;
}
