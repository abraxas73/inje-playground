import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import 'divider.dart';
import 'models.dart';

class TeamRepository {
  TeamRepository(this._api);
  final ApiClient _api;
  Future<List<TeamMemberRow>> members() async => parseMemberRows(await _api.getJson('/api/users/members'));
  Future<List<String>> memberNames() async => (await members()).map((m) => m.name).toList();
  Future<List<TeamSessionRow>> sessions() async => ((await _api.getJson('/api/team-sessions')) as List).map((e) => TeamSessionRow.fromJson(e as Map<String, dynamic>)).toList();

  /// 웹 team/page.tsx 저장 본문과 동일. 응답 {id}
  Future<String> save({String? title, required List<String> participants, required int teamCount, required bool cardHolderDistribution, required List<Team> teams}) async {
    final r = await _api.postJson('/api/team-sessions', {'title': title, 'participants': participants, 'teamCount': teamCount, 'cardHolderDistribution': cardHolderDistribution, 'teams': teams.map((t) => t.toJson()).toList()}) as Map;
    return '${r['id']}';
  }

  Future<void> setAttendance(String teamResultId, String memberName, bool attended) => _api.patchJson('/api/team-attendance', {'teamResultId': teamResultId, 'memberName': memberName, 'attended': attended});
  Future<void> addComment(String teamResultId, String author, String content) => _api.postJson('/api/team-comments', {'teamResultId': teamResultId, 'author': author, 'content': content});
  Future<Map<String, dynamic>> notify(List<Team> teams) async => (await _api.postJson('/api/team-notify', {'teams': teams.map((t) => t.toJson()).toList()})) as Map<String, dynamic>;
}

final teamRepositoryProvider = Provider((ref) => TeamRepository(ref.watch(apiClientProvider)));
