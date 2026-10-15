import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';

/// 서버가 멈추고 앱에 맡긴 도구 호출(needs_action). location: server|device|desktop-relay, tier: read|write|irreversible|meta|choice.
class PendingCall {
  const PendingCall({required this.id, required this.name, required this.input, required this.location, required this.tier, this.target, this.card});
  final String id, name, location, tier;
  /// 서버가 만든 확인 카드 줄(앱이 모르는 서버 쓰기 — 앱 기능 도구). 있으면 그대로 보인다.
  final List<String>? card;
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
  /// 서버가 입력 오류로 거절(SSE error, retryable:false — "처리할 작업이 없습니다" 등)
  bool rejected = false;
  final Map<String, String> toolStatus = {};
}

/// 불러온 대화의 한 줄 — kind: user|assistant|tool(status·요약)|masked(가린 건수 문구)|files(첨부 이름, 줄바꿈으로 이음).
typedef LoadedLine = ({String kind, String text, String? status});

class ConversationSummary {
  const ConversationSummary(this.id, this.title, this.lastMessageAt);
  final String id, title, lastMessageAt;
}

/// 서버 저장 대화 API(/api/chat/*) — 웹 채팅과 같은 대화. 앱은 client:"app"으로 부른다.
class ChatApi {
  ChatApi(this.api);
  final ApiClient api;

  Future<TurnOutcome> turn(Map<String, dynamic> body, {void Function(String delta)? onText, void Function(String id, String tool, String status, String summary)? onTool, void Function(int count)? onMasked, Future<void>? abort}) async {
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
            onTool?.call(id, '${e['tool']}', status, '${e['summary'] ?? ''}');
            if (status != 'running') o.toolStatus[id] = status;
          case 'masked':
            if (e['count'] case final num n when n > 0) onMasked?.call(n.toInt());
          case 'needs_action':
            finished = true;
            o.needsAction = [
              for (final c in (e['calls'] as List? ?? const []).whereType<Map>())
                PendingCall(id: '${c['id']}', name: '${c['tool']}', input: Map<String, dynamic>.from(c['input'] as Map? ?? const {}), location: '${c['location']}', tier: '${c['tier']}', target: c['target'] is String ? c['target'] as String : null, card: c['card'] is List ? [for (final l in c['card'] as List) '$l'] : null),
            ];
          case 'done':
            finished = true;
          case 'error':
            finished = true;
            o.error = '${e['message'] ?? '이노봇이 답하지 못했습니다.'}';
            o.rejected = e['retryable'] == false;
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

  /// 화면에 다시 그릴 줄 — 사용자·이노봇 텍스트, 기록된 도구 호출(칩), 가린 건수. 실패 행·도구 결과 행의 원문은 그리지 않는다.
  Future<({String? model, List<LoadedLine> lines})> load(String id) async {
    final j = await api.getJson('/api/chat/conversations/${Uri.encodeComponent(id)}');
    final rows = j is Map && j['messages'] is List ? j['messages'] as List : const [];
    final calls = {
      for (final t in (j is Map && j['toolCalls'] is List ? j['toolCalls'] as List : const []).whereType<Map>()) '${t['message_id']}:${t['tool_use_id']}': t,
    };
    final out = <LoadedLine>[];
    for (final r in rows.whereType<Map>()) {
      if (r['status'] == 'failed') continue;
      final blocks = (r['content'] as List? ?? const []).whereType<Map>();
      final t = [for (final b in blocks) if (b['type'] == 'text') '${b['text']}'].join('\n').trim();
      if (t.isNotEmpty) out.add((kind: r['role'] == 'user' ? 'user' : 'assistant', text: t, status: null));
      final files = [for (final b in blocks) if (b['type'] == 'attachment') '${b['name']}'];
      if (files.isNotEmpty) out.add((kind: 'files', text: files.join('\n'), status: null));
      for (final b in blocks) {
        if (b['type'] != 'tool_use') continue;
        if (calls['${r['id']}:${b['id']}'] case final c?) out.add((kind: 'tool', text: '${c['summary'] ?? ''}', status: '${c['status']}'));
      }
      if (r['masked_count'] case final num n when n > 0) out.add((kind: 'masked', text: maskedText(n.toInt()), status: null));
    }
    final conv = j is Map && j['conversation'] is Map ? j['conversation'] as Map : const {};
    return (model: conv['model'] is String ? conv['model'] as String : null, lines: out);
  }

  Future<void> rename(String id, String title) => api.patchJson('/api/chat/conversations/${Uri.encodeComponent(id)}', {'title': title});
  Future<void> delete(String id) => api.deleteJson('/api/chat/conversations/${Uri.encodeComponent(id)}');

  /// 첨부 하나 올리기(대화 연결은 다음 턴의 attachmentIds로). warning: 이미지·스캔 PDF는 개인정보를 가리지 못한다는 안내.
  Future<({String id, String name, String? warning})> upload(String name, List<int> bytes) async {
    final j = await api.postFile('/api/chat/attachments', name, bytes);
    final m = j is Map ? j : const {};
    return (id: '${m['id']}', name: '${m['name'] ?? name}', warning: m['warning'] is String ? m['warning'] as String : null);
  }

  /// 고를 수 있는 모델(관리자 설정 assistant_models)과 기본 모델.
  Future<({List<String> models, String defaultModel})> config() async {
    final j = await api.getJson('/api/chat/config');
    final models = [for (final m in (j is Map && j['models'] is List ? j['models'] as List : const [])) '$m'];
    return (models: models, defaultModel: j is Map && j['defaultModel'] is String ? j['defaultModel'] as String : (models.isEmpty ? '' : models.first));
  }
}

/// 모델 이름표(웹 Composer와 같은 표기).
const modelLabels = {'claude-sonnet-5-5': 'Sonnet 5.5', 'claude-opus-5-5': 'Opus 5.5'};
String modelLabel(String m) => modelLabels[m] ?? m;

/// 채팅 설정(모델 선택지) — 실패하면 선택지 없음(선택 버튼을 숨긴다).
final chatConfigProvider = FutureProvider<({List<String> models, String defaultModel})>((ref) async {
  try {
    return await ref.read(chatApiProvider).config();
  } catch (_) {
    return (models: const <String>[], defaultModel: '');
  }
});

/// 이노봇이 쓸 모델 — null이면 보내지 않아 서버 기본값. 새 대화에도 유지하고, 대화를 열면 그 대화의 모델로 바뀐다.
final assistantModelProvider = NotifierProvider<AssistantModel, String?>(AssistantModel.new);

class AssistantModel extends Notifier<String?> {
  @override
  String? build() => null;
  void pick(String? m) => state = m;
}

String maskedText(int n) => '개인정보 $n건 가림';

final chatApiProvider = Provider<ChatApi>((ref) => ChatApi(ref.watch(apiClientProvider)));

/// 첨부할 수 있는 형식(웹 lib/chat/attachments.ts ATTACH_EXTS와 같게)과 크기.
const attachExts = ['docx', 'pdf', 'pptx', 'xlsx', 'hwp', 'hwpx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'gif', 'webp'];
const attachMaxBytes = 10 * 1024 * 1024;
const attachMaxFiles = 5;

typedef PickedFile = ({String name, int size, Future<List<int>> Function() read});

/// 첨부할 파일 고르기 — 크기를 먼저 알려 주고 내용은 필요할 때 읽는다(10MB 넘는 파일을 메모리에 올리지 않게). 테스트에서 override.
final attachmentPickerProvider = Provider<Future<List<PickedFile>> Function()>((_) => () async {
  final files = await FilePicker.pickFiles(type: FileType.custom, allowedExtensions: attachExts);
  return [for (final f in files) (name: f.name, size: await f.xFile.length(), read: f.xFile.readAsBytes)];
});
