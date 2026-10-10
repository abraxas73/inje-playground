import 'dart:math' as math;
import 'package:flutter/painting.dart';

/// 부채꼴 메뉴 좌표(원점 기준, 위쪽이 음수 dy). 원점은 누른 탭의 가운데·바 윗변.
/// 각도 폭은 이웃 사이 최대 [maxStep](항목이 적으면 좁은 부채꼴)이고 되도록 90°(바로 위)를 중심으로 둔다.
/// 기본값은 "너무 퍼지지 않게" 조여 둔 것(반지름 96·간격 56·34°·바 위 60px) — 원 46px 기준.
/// 가장자리 탭은 항목이 화면 밖으로 나가지 않도록 안쪽으로 치우친 부채꼴이 되고(경첩은 그대로 탭),
/// 이웃 항목 사이가 [minGap]보다 좁으면 반지름을 키운다(최대 +140 — 가장자리 탭은 가로 여유가 고정이라
/// 항목이 많으면 어떤 반지름으로도 간격을 못 맞춘다. ponytail: 5개까지는 390px 폭에서 맞고, 더 늘면 두 줄 반지름으로).
/// 바에 눕지 않도록 항목 중심은 바에서 [minHeight] 이상 위(반지름이 크면 그만큼 옆으로 더 펼 수 있다).
List<Offset> fanLayout({
  required int count,
  required double originX,
  required double width,
  double radius = 96,
  double itemWidth = 60,
  double pad = 4,
  double minGap = 56,
  double maxStep = 34 * math.pi / 180,
  double minHeight = 60,
}) {
  if (count <= 0) return const [];
  var r = radius;
  for (var tries = 0;; tries++, r += 10) {
    final w = _window(r, originX: originX, width: width, itemWidth: itemWidth, pad: pad, minHeight: minHeight);
    if (w == null) continue; // 구간이 비면(아주 좁은 화면) 반지름을 키워 다시
    final (thetaMin, thetaMax) = w;
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

/// y = -r·sinθ 가 minHeight 이상, x = originX + r·cosθ 가 화면 안([pad+폭/2, width-pad-폭/2])에 들도록 허용 각도 구간. 비면 null.
(double, double)? _window(double r, {required double originX, required double width, required double itemWidth, required double pad, required double minHeight}) {
  final minX = pad + itemWidth / 2, maxX = width - pad - itemWidth / 2;
  final lo = math.asin((minHeight / r).clamp(0.0, 1.0)), hi = math.pi - lo;
  final thetaMin = math.max(lo, math.acos(((maxX - originX) / r).clamp(-1.0, 1.0)));
  final thetaMax = math.min(hi, math.acos(((minX - originX) / r).clamp(-1.0, 1.0)));
  return thetaMax < thetaMin ? null : (thetaMin, thetaMax);
}

/// 반지름 r인 줄에 이웃 간격 [minGap]을 지키며 들어가는 항목 수(허용 각도 구간 ÷ 최소 각도 + 1)
int fanCapacity(double r, {required double originX, required double width, double itemWidth = 60, double pad = 4, double minGap = 56, double minHeight = 60}) {
  final w = _window(r, originX: originX, width: width, itemWidth: itemWidth, pad: pad, minHeight: minHeight);
  if (w == null) return 0;
  final step = 2 * math.asin((minGap / (2 * r)).clamp(0.0, 1.0));
  return ((w.$2 - w.$1) / step).floor() + 1;
}

/// 항목이 [maxSingle]개를 넘으면 두 줄 — 안쪽은 [radius], 바깥은 안쪽 줄 반지름 + [ringGap](원 46 + 아래 라벨 ~31이 겹치지 않는 간격).
/// 줄별 개수는 각 줄의 수용량([fanCapacity])에 비례해 나누고 바깥이 넘치면 안쪽으로 넘긴다. 결과는 안쪽 줄(왼→오) 다음 바깥 줄(왼→오).
/// 안쪽 줄이 자기 수용량을 넘어 반지름이 커지면 바깥 줄은 그 실제 반지름 기준으로 띄운다(겹침 방지).
List<Offset> fanRings({
  required int count,
  required double originX,
  required double width,
  double radius = 96,
  double itemWidth = 60,
  double pad = 4,
  double minGap = 56,
  double maxStep = 34 * math.pi / 180,
  double minHeight = 60,
  int maxSingle = 5,
  double ringGap = 84,
}) {
  List<Offset> ring(int n, double r) => fanLayout(count: n, originX: originX, width: width, radius: r, itemWidth: itemWidth, pad: pad, minGap: minGap, maxStep: maxStep, minHeight: minHeight);
  if (count <= maxSingle) return ring(count, radius);
  final capIn = math.max(1, fanCapacity(radius, originX: originX, width: width, itemWidth: itemWidth, pad: pad, minGap: minGap, minHeight: minHeight));
  final capOut = math.max(1, fanCapacity(radius + ringGap, originX: originX, width: width, itemWidth: itemWidth, pad: pad, minGap: minGap, minHeight: minHeight));
  var nIn = (count * capIn / (capIn + capOut)).round();
  if (count - nIn > capOut) nIn = count - capOut;
  nIn = nIn.clamp(1, count - 1);
  final inner = ring(nIn, radius);
  final rIn = inner.fold(0.0, (m, p) => math.max(m, p.distance));
  return [...inner, ...ring(count - nIn, rIn + ringGap)];
}
