/// GET /api/users/members 행
class TeamMemberRow {
  TeamMemberRow({required this.name, this.email, required this.isCardHolder});
  final String name;
  final String? email;
  final bool isCardHolder;
  factory TeamMemberRow.fromJson(Map<String, dynamic> j) => TeamMemberRow(name: j['name'] as String, email: j['email'] as String?, isCardHolder: j['is_card_holder'] == true);
}

/// GET /api/team-sessions 행(team_results·team_comments 포함)
class TeamSessionRow {
  TeamSessionRow({required this.id, required this.title, required this.createdAt, required this.results});
  final String id;
  final String? title;
  final DateTime createdAt;
  final List<TeamResultRow> results;
  factory TeamSessionRow.fromJson(Map<String, dynamic> j) => TeamSessionRow(
        id: '${j['id']}',
        title: j['title'] as String?,
        createdAt: DateTime.parse(j['created_at'] as String),
        results: ((j['team_results'] as List?) ?? []).map((e) => TeamResultRow.fromJson(e as Map<String, dynamic>)).toList(),
      );
}

class TeamResultRow {
  TeamResultRow({required this.id, required this.teamName, required this.members, required this.attendance, required this.comments});
  final String id, teamName;
  final List<Map<String, dynamic>> members;
  final Map<String, bool> attendance;
  final List<Map<String, dynamic>> comments;
  factory TeamResultRow.fromJson(Map<String, dynamic> j) => TeamResultRow(
        id: '${j['id']}',
        teamName: j['team_name'] as String? ?? '',
        members: ((j['members'] as List?) ?? []).cast<Map<String, dynamic>>(),
        attendance: {for (final e in ((j['attendance'] as Map?) ?? const {}).entries) e.key as String: e.value == true},
        comments: ((j['team_comments'] as List?) ?? []).cast<Map<String, dynamic>>(),
      );
}
