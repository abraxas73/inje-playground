import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/home/quotes.dart';

void main() {
  test('오늘의 한 줄 — 날짜로 정해지고(같은 날 같은 글), 날마다 바뀌며, 목록은 글·출처가 비지 않는다', () {
    final a = dailyQuote(DateTime(2026, 10, 3, 8)), b = dailyQuote(DateTime(2026, 10, 3, 22)), c = dailyQuote(DateTime(2026, 10, 4));
    expect(a, b);
    expect(a == c, false);
    expect(quotes.length, greaterThanOrEqualTo(30));
    for (final q in quotes) {
      expect(q.text.trim().isNotEmpty, true);
      expect(q.source.trim().isNotEmpty, true);
    }
    expect(quotes.map((q) => q.text).toSet().length, quotes.length, reason: '중복 없음');
  });
}
