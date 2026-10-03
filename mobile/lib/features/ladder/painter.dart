import 'package:flutter/material.dart';
import 'generator.dart';
import 'model.dart';

const kPathColors = [Color(0xFFEF4444), Color(0xFF3B82F6), Color(0xFF10B981), Color(0xFFF59E0B), Color(0xFF8B5CF6), Color(0xFFEC4899), Color(0xFF06B6D4), Color(0xFF84CC16)];

/// 사다리 + 공개된 경로(progress 0~1로 애니메이션). 좌표: 열 간격 = 폭/(columns-1), 행 간격 = 높이/(rows+1).
class LadderPainter extends CustomPainter {
  LadderPainter({required this.ladder, required this.revealed, this.animating, this.progress = 1});
  final LadderData ladder;
  final Set<int> revealed; // 공개된 시작 열
  final int? animating; // 지금 그리는 중인 시작 열
  final double progress;
  static const padX = 24.0, padY = 16.0;

  double _x(Size s, int c) => padX + c * (s.width - padX * 2) / (ladder.columns - 1).clamp(1, 1 << 30);
  double _y(Size s, int r) => padY + r * (s.height - padY * 2) / (ladder.rows + 1);

  @override
  void paint(Canvas canvas, Size size) {
    final rail = Paint()
      ..color = const Color(0xFF9CA3AF)
      ..strokeWidth = 3
      ..strokeCap = StrokeCap.round;
    for (var c = 0; c < ladder.columns; c++) {
      canvas.drawLine(Offset(_x(size, c), _y(size, 0)), Offset(_x(size, c), _y(size, ladder.rows + 1)), rail);
    }
    for (var r = 0; r < ladder.rows; r++) {
      for (var c = 0; c < ladder.columns - 1; c++) {
        if (ladder.bridges[r][c]) canvas.drawLine(Offset(_x(size, c), _y(size, r + 1)), Offset(_x(size, c + 1), _y(size, r + 1)), rail);
      }
    }
    for (final start in revealed) {
      _drawPath(canvas, size, start, 1);
    }
    if (animating != null) _drawPath(canvas, size, animating!, progress);
  }

  void _drawPath(Canvas canvas, Size size, int start, double t) {
    final cols = columnPath(ladder, start);
    final pts = <Offset>[Offset(_x(size, cols[0]), _y(size, 0))];
    for (var r = 0; r < ladder.rows; r++) {
      pts.add(Offset(_x(size, cols[r]), _y(size, r + 1)));
      if (cols[r + 1] != cols[r]) pts.add(Offset(_x(size, cols[r + 1]), _y(size, r + 1)));
    }
    pts.add(Offset(_x(size, cols.last), _y(size, ladder.rows + 1)));
    final total = pts.length - 1;
    final upto = total * t;
    final paint = Paint()
      ..color = kPathColors[start % kPathColors.length]
      ..strokeWidth = 4
      ..strokeCap = StrokeCap.round
      ..style = PaintingStyle.stroke;
    final path = Path()..moveTo(pts[0].dx, pts[0].dy);
    for (var i = 1; i <= total; i++) {
      if (i <= upto) {
        path.lineTo(pts[i].dx, pts[i].dy);
      } else {
        final f = upto - (i - 1);
        path.lineTo(pts[i - 1].dx + (pts[i].dx - pts[i - 1].dx) * f, pts[i - 1].dy + (pts[i].dy - pts[i - 1].dy) * f);
        break;
      }
    }
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant LadderPainter o) => o.ladder != ladder || o.revealed != revealed || o.animating != animating || o.progress != progress;
}
