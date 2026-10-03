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

/// GET /api/users/members 응답은 `{members: [...]}` — 배열이 아니다(frontend/src/app/api/users/members/route.ts).
List<TeamMemberRow> parseMemberRows(dynamic json) {
  final list = json is Map ? (json['members'] as List?) ?? const [] : const [];
  return list.map((e) => TeamMemberRow.fromJson(e as Map<String, dynamic>)).toList();
}

/// 출석 기본값은 웹 TeamHistory와 같이 false(attendance에 없으면 미참석).
bool attended(Map<String, bool> attendance, String name) => attendance[name] ?? false;

/// POST /api/team-notify 응답은 `{webhook_sent}` 하나 — 그것으로만 성공을 판단한다.
String notifyResultMessage(Map<String, dynamic> res) => res['webhook_sent'] == true ? '알림을 보냈습니다.' : '알림 채널이 설정되지 않았거나 전송에 실패했습니다.';
