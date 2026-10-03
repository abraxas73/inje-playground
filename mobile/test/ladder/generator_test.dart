import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/ladder/generator.dart';
import 'package:playground/features/ladder/model.dart';

void main() {
  final people = ['가', '나', '다', '라', '마'];
  final results = [const LadderResult('커피', 'reward'), const LadderResult('꽝', 'normal')];

  test('열=참가자 수, 행=max(2*열, 6), 같은 행에 인접 다리 없음', () {
    for (var seed = 0; seed < 50; seed++) {
      final l = generateLadder(people, results, density: 0.6, random: Random(seed));
      expect(l.columns, 5);
      expect(l.rows, 10);
      expect(l.bridges.length, 10);
      for (final row in l.bridges) {
        expect(row.length, 4);
        for (var c = 1; c < row.length; c++) {
          expect(row[c - 1] && row[c], false, reason: 'seed $seed 인접 다리');
        }
      }
    }
    expect(generateLadder(['a', 'b'], results, random: Random(1)).rows, 6);
  });
  test('결과는 참가자 수만큼 "꽝 N"으로 채우고 넘치면 자른다', () {
    final l = generateLadder(people, results, random: Random(3));
    expect(l.results.length, 5);
    expect(l.results.where((r) => r.text.startsWith('꽝')).length, 4); // 입력 '꽝' 1 + 채움 3
    expect(generateLadder(['a'], [const LadderResult('x', 'normal'), const LadderResult('y', 'normal')], random: Random(1)).results.length, 1);
  });
  test('경로 추적은 전단사 — 모든 참가자가 서로 다른 결과에 닿는다', () {
    for (var seed = 0; seed < 50; seed++) {
      final l = generateLadder(people, results, density: 0.5, random: Random(seed));
      final ends = List.generate(l.columns, (c) => resultIndex(l, c));
      expect(ends.toSet().length, l.columns, reason: 'seed $seed');
      expect(columnPath(l, 0).length, l.rows + 1);
    }
  });
  test('JSON 왕복 — 웹 저장 형식과 키가 같다', () {
    final l = generateLadder(people, results, random: Random(7));
    final j = l.toJson();
    expect(j.keys, containsAll(['participants', 'results', 'columns', 'rows', 'bridges']));
    expect((j['results'] as List).first, isA<Map>());
    expect(LadderData.fromJson(j).bridges, l.bridges);
  });
}
