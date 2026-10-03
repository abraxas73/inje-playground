import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../../api/client.dart';
import '../team/models.dart' show parseMemberRows;
import 'model.dart';

class LadderSession {
  LadderSession({required this.id, required this.title, required this.createdAt, required this.ladder, required this.mappings});
  final String id;
  final String? title;
  final DateTime createdAt;
  final LadderData ladder;
  final List<Map<String, dynamic>> mappings;
  factory LadderSession.fromJson(Map<String, dynamic> j) => LadderSession(
        id: '${j['id']}',
        title: j['title'] as String?,
        createdAt: DateTime.parse(j['created_at'] as String),
        ladder: LadderData.fromJson({'participants': j['participants'], 'results': j['results'], 'bridges': j['bridges']}),
        mappings: ((j['mappings'] as List?) ?? []).cast<Map<String, dynamic>>(),
      );
}

class LadderRepository {
  LadderRepository(this._api);
  final ApiClient _api;
  Future<List<LadderSession>> list() async => ((await _api.getJson('/api/ladder-sessions')) as List).map((e) => LadderSession.fromJson(e as Map<String, dynamic>)).toList();

  /// 웹 ladder/page.tsx handleSave와 같은 본문
  Future<void> save({required LadderData ladder, required double bridgeDensity, required List<LadderMapping> mappings}) => _api.postJson('/api/ladder-sessions', {
        'participants': ladder.participants,
        'results': ladder.results.map((r) => r.toJson()).toList(),
        'bridges': ladder.bridges,
        'bridgeDensity': bridgeDensity,
        'mappings': mappings.map((m) => m.toJson()).toList(),
      });

  Future<List<String>> myTeamNames() async => parseMemberRows(await _api.getJson('/api/users/members')).map((m) => m.name).toList();
}

final ladderRepositoryProvider = Provider((ref) => LadderRepository(ref.watch(apiClientProvider)));
