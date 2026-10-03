import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/team/divider.dart';

TeamConfig cfg({List<String>? p, int teams = 2, int min = 1, int max = 10, List<String> cards = const []}) =>
    TeamConfig(participants: p ?? ['a', 'b', 'c', 'd', 'e', 'f'], teamCount: teams, minPerTeam: min, maxPerTeam: max, cardHolders: cards);

void main() {
  test('validateTeamConfig — 웹 lib/team-divider.ts와 같은 문구', () {
    expect(validateTeamConfig(cfg(p: [])), '참여자를 추가해주세요.');
    expect(validateTeamConfig(cfg(teams: 0)), '팀 수는 1 이상이어야 합니다.');
    expect(validateTeamConfig(cfg(min: 0)), '최소 인원은 1 이상이어야 합니다.');
    expect(validateTeamConfig(cfg(min: 3, max: 2)), '최대 인원은 최소 인원 이상이어야 합니다.');
    expect(validateTeamConfig(cfg(teams: 4, min: 2)), '인원이 부족합니다. 최소 8명이 필요합니다.');
    expect(validateTeamConfig(cfg(teams: 2, max: 2)), '팀 수가 부족하거나 최대 인원을 늘려주세요. 현재 최대 수용: 4명');
    expect(validateTeamConfig(cfg()), isNull);
  });
  test('divideTeams — 전원 배정, 최소·최대 준수, 법카 보유자는 팀마다 나눠 배치', () {
    for (var seed = 0; seed < 30; seed++) {
      final teams = divideTeams(cfg(teams: 3, min: 1, max: 3, cards: ['a', 'b', 'c']), random: Random(seed));
      expect(teams.length, 3);
      final all = teams.expand((t) => t.members.map((m) => m.name)).toList()..sort();
      expect(all, ['a', 'b', 'c', 'd', 'e', 'f']);
      for (final t in teams) {
        expect(t.members.length, inInclusiveRange(1, 3));
        expect(t.members.where((m) => m.hasCard).length, 1);
      }
      expect(teams.map((t) => t.name), ['팀 1', '팀 2', '팀 3']);
    }
  });
  test('최소 인원을 먼저 채우고 나머지는 돌아가며 — 7명 2팀 min 3 max 4', () {
    final teams = divideTeams(cfg(p: ['1', '2', '3', '4', '5', '6', '7'], teams: 2, min: 3, max: 4), random: Random(1));
    expect(teams.map((t) => t.members.length).toList()..sort(), [3, 4]);
  });
}
