// frontend/src/lib/team-divider.ts 그대로 — 검증 문구·배치 규칙이 웹과 같아야 한다.
import 'dart:math';

class TeamConfig {
  const TeamConfig({required this.participants, required this.teamCount, required this.minPerTeam, required this.maxPerTeam, required this.cardHolders});
  final List<String> participants, cardHolders;
  final int teamCount, minPerTeam, maxPerTeam;
}

class TeamMember {
  const TeamMember(this.name, this.hasCard);
  final String name;
  final bool hasCard;
  Map<String, dynamic> toJson() => {'name': name, 'hasCard': hasCard};
}

class Team {
  const Team(this.name, this.members);
  final String name;
  final List<TeamMember> members;
  Map<String, dynamic> toJson() => {'name': name, 'members': members.map((m) => m.toJson()).toList()};
}

String? validateTeamConfig(TeamConfig c) {
  final total = c.participants.length;
  if (total == 0) return '참여자를 추가해주세요.';
  if (c.teamCount <= 0) return '팀 수는 1 이상이어야 합니다.';
  if (c.minPerTeam <= 0) return '최소 인원은 1 이상이어야 합니다.';
  if (c.maxPerTeam < c.minPerTeam) return '최대 인원은 최소 인원 이상이어야 합니다.';
  if (c.teamCount * c.minPerTeam > total) return '인원이 부족합니다. 최소 ${c.teamCount * c.minPerTeam}명이 필요합니다.';
  if (c.teamCount * c.maxPerTeam < total) return '팀 수가 부족하거나 최대 인원을 늘려주세요. 현재 최대 수용: ${c.teamCount * c.maxPerTeam}명';
  return null;
}

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

List<Team> divideTeams(TeamConfig c, {Random? random}) {
  final rnd = random ?? Random();
  final cards = c.cardHolders.toSet();
  final cardMembers = _shuffle(c.participants.where(cards.contains).toList(), rnd);
  final regular = _shuffle(c.participants.where((p) => !cards.contains(p)).toList(), rnd);
  final teams = List.generate(c.teamCount, (_) => <TeamMember>[]);
  var t = 0;
  for (final m in cardMembers) {
    teams[t].add(TeamMember(m, true));
    t = (t + 1) % c.teamCount;
  }
  var cursor = 0;
  for (var i = 0; i < c.teamCount; i++) {
    while (teams[i].length < c.minPerTeam && cursor < regular.length) {
      teams[i].add(TeamMember(regular[cursor++], false));
    }
  }
  while (cursor < regular.length) {
    for (var i = 0; i < c.teamCount && cursor < regular.length; i++) {
      if (teams[i].length < c.maxPerTeam) teams[i].add(TeamMember(regular[cursor++], false));
    }
  }
  return [for (var i = 0; i < teams.length; i++) Team('팀 ${i + 1}', teams[i])];
}
