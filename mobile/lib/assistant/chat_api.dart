import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';

/// 서버가 멈추고 앱에 맡긴 도구 호출(needs_action). location: server|device|desktop-relay, tier: read|write|irreversible|meta|choice.
class PendingCall {
  const PendingCall({required this.id, required this.name, required this.input, required this.location, required this.tier, this.target});
  final String id, name, location, tier;
  final Map<String, dynamic> input;
  /// 서버가 조회한 실제 대상(서버 쓰기만)
  final String? target;
  bool get onServer => location == 'server';
}

class TurnOutcome {
  String? conversationId;
  List<PendingCall>? needsAction;
  String? error;
  bool disabled = false;
  final Map<String, String> toolStatus = {};
}

class ConversationSummary {
  const ConversationSummary(this.id, this.title, this.lastMessageAt);
  final String id, title, lastMessageAt;
}

/// 서버 저장 대화 API(/api/chat/*) — 웹 채팅과 같은 대화. 앱은 client:"app"으로 부른다.
class ChatApi {
  ChatApi(this.api);
  final ApiClient api;

  Future<TurnOutcome> turn(Map<String, dynamic> body, {void Function(String delta)? onText, void Function(String id, String tool, String status)? onTool, Future<void>? abort}) async {
    final o = TurnOutcome();
    var finished = false;
    try {
      await api.postSse('/api/chat/turn', body, (e) {
        switch (e['type']) {
          case 'conversation':
            o.conversationId = '${e['id']}';
          case 'text':
            onText?.call('${e['delta'] ?? ''}');
          case 'tool':
            final id = '${e['id']}', status = '${e['status']}';
            onTool?.call(id, '${e['tool']}', status);
            if (status != 'running') o.toolStatus[id] = status;
          case 'needs_action':
            finished = true;
            o.needsAction = [
              for (final c in (e['calls'] as List? ?? const []).whereType<Map>())
                PendingCall(id: '${c['id']}', name: '${c['tool']}', input: Map<String, dynamic>.from(c['input'] as Map? ?? const {}), location: '${c['location']}', tier: '${c['tier']}', target: c['target'] is String ? c['target'] as String : null),
            ];
          case 'done':
            finished = true;
          case 'error':
            finished = true;
            o.error = '${e['message'] ?? '이노봇이 답하지 못했습니다.'}';
        }
      }, abortTrigger: abort);
    } on ApiException catch (e) {
      if (e.code == 'assistant_disabled') {
        o.disabled = true;
      } else {
        o.error = e.message;
      }
      return o;
    }
    if (!finished) o.error = '응답이 중간에 끊겼습니다. 다시 시도해 주세요.';
    return o;
  }

  Future<List<ConversationSummary>> list({int limit = 50}) async {
    final j = await api.getJson('/api/chat/conversations', query: {'limit': '$limit'});
    final rows = j is Map && j['conversations'] is List ? j['conversations'] as List : const [];
    return [for (final r in rows.whereType<Map>()) ConversationSummary('${r['id']}', '${r['title'] ?? ''}', '${r['last_message_at'] ?? ''}')];
  }

  /// 화면에 다시 그릴 말 — 사용자·이노봇 텍스트만(도구 결과 행·실패 행·빈 행 제외).
  Future<List<({String role, String text})>> load(String id) async {
    final j = await api.getJson('/api/chat/conversations/${Uri.encodeComponent(id)}');
    final rows = j is Map && j['messages'] is List ? j['messages'] as List : const [];
    return [
      for (final r in rows.whereType<Map>())
        if (r['status'] != 'failed')
          if ([for (final b in (r['content'] as List? ?? const []).whereType<Map>()) if (b['type'] == 'text') '${b['text']}'].join('\n').trim() case final t when t.isNotEmpty)
            (role: r['role'] == 'user' ? 'user' : 'assistant', text: t),
    ];
  }
}

final chatApiProvider = Provider<ChatApi>((ref) => ChatApi(ref.watch(apiClientProvider)));
