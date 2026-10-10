import 'dart:math' as math;
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/app/fan_layout.dart';

void main() {
  const width = 390.0;
  test('항목 수만큼 좌표를 내고 전부 원점(바 윗변) 위에 있다', () {
    final pts = fanLayout(count: 4, originX: 195, width: width);
    expect(pts.length, 4);
    expect(pts.every((p) => p.dy < 0), true);
    expect(fanLayout(count: 0, originX: 195, width: width), isEmpty);
  });
  test('가운데 탭은 좌우 대칭 부채꼴', () {
    final pts = fanLayout(count: 5, originX: 195, width: width);
    expect(pts[2].dx, closeTo(0, 0.001)); // 가운데 항목은 바로 위
    expect(pts[0].dx, closeTo(-pts[4].dx, 0.001));
    expect(pts[0].dy, closeTo(pts[4].dy, 0.001));
    expect(pts[0].dx, lessThan(pts[1].dx)); // 왼쪽→오른쪽 순서
  });
  test('가장자리 탭은 안쪽으로 치우친 부채꼴 — 항목이 화면 밖으로 나가지 않는다', () {
    for (final originX in [39.0, 117.0, 273.0, 351.0]) {
      final pts = fanLayout(count: 5, originX: originX, width: width, itemWidth: 72, pad: 8);
      for (final p in pts) {
        final x = originX + p.dx;
        expect(x - 36, greaterThanOrEqualTo(8 - 0.001), reason: 'originX=$originX x=$x');
        expect(x + 36, lessThanOrEqualTo(width - 8 + 0.001), reason: 'originX=$originX x=$x');
      }
    }
  });
  test('이웃 항목 사이가 최소 간격 이상 벌어진다(좁으면 반지름을 키운다) — 단, 반지름은 작게 유지', () {
    // 그룹 탭은 슬롯 1~3(x=117·195·273) — 가장자리 슬롯(홈·더보기)은 부채꼴이 없다
    for (final (count, originX) in [(5, 117.0), (4, 117.0), (3, 195.0), (4, 195.0), (5, 273.0), (2, 273.0)]) {
      final pts = fanLayout(count: count, originX: originX, width: width, minGap: 56);
      for (var i = 1; i < pts.length; i++) {
        expect((pts[i] - pts[i - 1]).distance, greaterThanOrEqualTo(56 - 0.001), reason: 'count=$count originX=$originX');
      }
      expect(pts.first.distance, lessThanOrEqualTo(150), reason: '5개 가장자리도 반지름 150 이하 count=$count originX=$originX');
    }
  });
  test('간격을 끝내 못 맞추는 경우(가장자리 탭에 항목이 많음) 반지름은 +140까지만 키운다 — 폭주 방지', () {
    final pts = fanLayout(count: 7, originX: 273, width: width, radius: 120);
    expect(pts.every((p) => p.distance <= 120 + 140 + 0.001), true);
    expect(fanLayout(count: 5, originX: 273, width: width).every((p) => -p.dy <= 260), true);
  });
  test('항목 1개는 바로 위(90°)', () {
    final p = fanLayout(count: 1, originX: 195, width: width, radius: 120).single;
    expect(p.dx, closeTo(0, 0.001));
    expect(p.dy, closeTo(-120, 0.001));
  });
  test('바 바로 옆으로 눕지 않는다 — 항목 중심은 바에서 60px 이상 위(가장자리 탭 5개도)', () {
    for (final (count, originX) in [(5, 195.0), (5, 273.0), (5, 117.0), (2, 351.0)]) {
      for (final p in fanLayout(count: count, originX: originX, width: width)) {
        expect(-p.dy, greaterThanOrEqualTo(60 - 0.001), reason: 'count=$count originX=$originX');
      }
    }
  });
  test('항목이 적으면 넓게 퍼지지 않는다 — 이웃 각도 최대 34°(3개면 68° 부채꼴, 90°를 중심으로)', () {
    final pts = fanLayout(count: 3, originX: 195, width: width, radius: 120);
    double deg(Offset p) => math.atan2(-p.dy, p.dx) * 180 / math.pi;
    expect(deg(pts[0]), closeTo(124, 0.01));
    expect(deg(pts[1]), closeTo(90, 0.01));
    expect(deg(pts[2]), closeTo(56, 0.01));
  });
  test('가장자리 탭에서 각도 폭이 허용 구간보다 작으면 90°(바로 위)에 최대한 가깝게 붙인다', () {
    // originX=351(오른쪽 끝 탭): 오른쪽이 막혀 안쪽(왼쪽)으로만 펼 수 있다 → 가장 오른쪽 항목이 허용 하한에 붙는다
    final pts = fanLayout(count: 2, originX: 351, width: width, radius: 120, itemWidth: 72, pad: 8);
    expect(pts.every((p) => 351 + p.dx + 36 <= width - 8 + 0.001), true);
    expect(pts[1].dx, greaterThan(pts[0].dx));
    final r = pts[1].distance;
    final thetaMin = math.acos((width - 8 - 36 - 351) / r); // 오른쪽 항목이 허용 하한(화면 안쪽 한계)에 붙는다
    expect(math.atan2(-pts[1].dy, pts[1].dx), closeTo(thetaMin, 0.001));
    expect(math.atan2(-pts[0].dy, pts[0].dx), closeTo(thetaMin + 34 * math.pi / 180, 0.001));
  });
  group('두 줄 배치(fanRings)', () {
    test('5개까지는 한 줄(fanLayout과 같다), 6개부터 두 줄', () {
      expect(fanRings(count: 5, originX: 195, width: width), fanLayout(count: 5, originX: 195, width: width));
      final pts = fanRings(count: 6, originX: 195, width: width);
      expect(pts.map((p) => p.distance.round()).toSet().length, 2);
    });
    test('가운데 탭 8개 — 수용량 비례로 안쪽 3·바깥 5, 바깥 줄은 안쪽 + 84, 줄 안 이웃 간격 56 이상, 화면 안', () {
      expect(fanCapacity(96, originX: 195, width: width), 4);
      expect(fanCapacity(180, originX: 195, width: width), 8);
      final pts = fanRings(count: 8, originX: 195, width: width);
      expect(pts.length, 8);
      final inner = pts.take(3).toList(), outer = pts.skip(3).toList();
      expect(inner.every((p) => (p.distance - 96).abs() < 0.001), true);
      expect(outer.every((p) => (p.distance - 180).abs() < 0.001), true);
      for (final ring in [inner, outer]) {
        for (var i = 1; i < ring.length; i++) {
          expect((ring[i] - ring[i - 1]).distance, greaterThanOrEqualTo(56 - 0.001));
          expect(ring[i].dx, greaterThan(ring[i - 1].dx)); // 왼→오
        }
      }
      for (final p in pts) {
        expect(195 + p.dx - 30, greaterThanOrEqualTo(4 - 0.001));
        expect(195 + p.dx + 30, lessThanOrEqualTo(width - 4 + 0.001));
        expect(-p.dy, greaterThanOrEqualTo(60 - 0.001));
      }
    });
    test('가장자리 탭(6칸 중 5번째) 8개 — 바깥 줄이 넘치면 안쪽으로 넘기고 전부 화면 안', () {
      const originX = 292.5;
      final pts = fanRings(count: 8, originX: originX, width: width);
      expect(pts.length, 8);
      for (final p in pts) {
        expect(originX + p.dx - 30, greaterThanOrEqualTo(4 - 0.001));
        expect(originX + p.dx + 30, lessThanOrEqualTo(width - 4 + 0.001));
      }
      final rings = pts.map((p) => p.distance.round()).toSet().toList()..sort();
      expect(rings.length, 2);
      expect(rings[1] - rings[0], greaterThanOrEqualTo(84 - 1));
    });
    test('두 줄로도 모자라면(12개) 안쪽 줄이 커진 만큼 바깥 줄을 더 띄운다 — 겹치지 않는다', () {
      final pts = fanRings(count: 12, originX: 195, width: width);
      final rIn = pts.first.distance, rOut = pts.last.distance;
      expect(rOut - rIn, greaterThanOrEqualTo(84 - 0.001));
      expect(pts.length, 12);
    });
  });
}
