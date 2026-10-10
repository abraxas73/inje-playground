import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/menu_layout.dart';

void main() {
  const width = 390.0;
  test('5개까지는 한 줄 — 가로 중앙 정렬, 셀 폭 78, 바에서 72 위', () {
    final pts = rowLayout(count: 4, originX: 227.5, width: width);
    expect(pts.length, 4);
    expect(pts.every((p) => p.dy == -72), true);
    final xs = pts.map((p) => 227.5 + p.dx).toList();
    expect((xs.first + xs.last) / 2, closeTo(width / 2, 0.001)); // 중앙 정렬(누른 탭 위치와 무관)
    expect(xs[1] - xs[0], closeTo(78, 0.001));
    expect(rowLayout(count: 0, originX: 195, width: width), isEmpty);
  });
  test('8개는 두 줄 4·4 — 윗줄이 먼저, 줄 간격 90', () {
    final pts = rowLayout(count: 8, originX: 227.5, width: width);
    expect(pts.take(4).every((p) => p.dy == -(72 + 90)), true);
    expect(pts.skip(4).every((p) => p.dy == -72), true);
    for (var i = 1; i < 4; i++) {
      expect(pts[i].dx, greaterThan(pts[i - 1].dx)); // 왼→오
      expect(pts[i].dx, closeTo(pts[i + 4].dx, 0.001)); // 위아래 정렬
    }
  });
  test('7개는 위 3·아래 4, 11개는 3·4·4 — 남는 항목은 아래 줄부터', () {
    final seven = rowLayout(count: 7, originX: 195, width: width);
    expect(seven.where((p) => p.dy == -(72 + 90)).length, 3);
    expect(seven.where((p) => p.dy == -72).length, 4);
    final eleven = rowLayout(count: 11, originX: 195, width: width);
    expect([for (final dy in [-(72 + 180.0), -(72 + 90.0), -72.0]) eleven.where((p) => p.dy == dy).length], [3, 4, 4]);
  });
  test('항목이 화면 밖으로 나가지 않는다(가장자리 탭·꽉 찬 줄)', () {
    for (final originX in [32.5, 227.5, 357.5]) {
      for (final p in rowLayout(count: 10, originX: originX, width: width)) {
        final x = originX + p.dx;
        expect(x - 30, greaterThanOrEqualTo(0));
        expect(x + 30, lessThanOrEqualTo(width));
      }
    }
  });
}
