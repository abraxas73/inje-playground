import 'dart:math' as math;
import 'package:flutter/painting.dart';

/// 부채꼴 메뉴 좌표(원점 기준, 위쪽이 음수 dy). 원점은 누른 탭의 가운데·바 윗변.
/// 각도 폭은 이웃 사이 최대 [maxStep](항목이 적으면 좁은 부채꼴)이고 되도록 90°(바로 위)를 중심으로 둔다.
/// 가장자리 탭은 항목이 화면 밖으로 나가지 않도록 안쪽으로 치우친 부채꼴이 되고(경첩은 그대로 탭),
/// 이웃 항목 사이가 [minGap]보다 좁으면 반지름을 키운다(최대 +140 — 가장자리 탭은 가로 여유가 고정이라
/// 항목이 많으면 어떤 반지름으로도 간격을 못 맞춘다. ponytail: 5개까지는 390px 폭에서 맞고, 더 늘면 두 줄 반지름으로).
/// 바에 눕지 않도록 각도는 35°~145° 안.
List<Offset> fanLayout({
  required int count,
  required double originX,
  required double width,
  double radius = 120,
  double itemWidth = 72,
  double pad = 4,
  double minGap = 74,
  double maxStep = 40 * math.pi / 180,
}) {
  if (count <= 0) return const [];
  const lo = 35 * math.pi / 180, hi = 145 * math.pi / 180;
  final minX = pad + itemWidth / 2, maxX = width - pad - itemWidth / 2;
  var r = radius;
  for (var tries = 0;; tries++, r += 10) {
    // x = originX + r·cosθ 가 [minX, maxX] 안에 들도록 허용 각도 구간
    final thetaMin = math.max(lo, math.acos(((maxX - originX) / r).clamp(-1.0, 1.0)));
    final thetaMax = math.min(hi, math.acos(((minX - originX) / r).clamp(-1.0, 1.0)));
    if (thetaMax < thetaMin) continue; // 구간이 비면(아주 좁은 화면) 반지름을 키워 다시
    if (count == 1) {
      final t = (math.pi / 2).clamp(thetaMin, thetaMax);
      return [_at(r, t)];
    }
    final span = math.min(thetaMax - thetaMin, maxStep * (count - 1));
    // (clamp는 하한>상한이면 예외 — 부동소수점으로 span == 구간 폭일 때 생긴다)
    final start = math.max(thetaMin, math.min(thetaMax - span, math.pi / 2 - span / 2));
    final step = span / (count - 1);
    if (2 * r * math.sin(step / 2) >= minGap || tries >= 14) {
      // 왼쪽(큰 각)에서 오른쪽(작은 각) 순서
      return [for (var i = 0; i < count; i++) _at(r, start + span - step * i)];
    }
  }
}

Offset _at(double r, double theta) => Offset(_zero(r * math.cos(theta)), -r * math.sin(theta));
double _zero(double v) => v.abs() < 1e-9 ? 0 : v;
