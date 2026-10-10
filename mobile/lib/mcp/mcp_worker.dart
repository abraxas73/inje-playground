import 'dart:async';
import 'dart:convert';

/// 웹 MCP 끝점이 `mcp_calls`에 넣은 호출 한 건.
class McpCall {
  const McpCall({required this.id, required this.tool, required this.args});
  final String id, tool;
  final Map<String, dynamic> args;

  static McpCall? fromRow(Map<String, dynamic> r) {
    final id = r['id'], tool = r['tool'], args = r['args'];
    if (id is! String || tool is! String) return null;
    return McpCall(id: id, tool: tool, args: args is Map ? Map<String, dynamic>.from(args) : const {});
  }
}

/// 성공이면 JSON 문자열, 실패면 McpToolError(message) throw.
typedef McpExecutor = Future<String> Function(String tool, Map<String, dynamic> args);

/// 사용자에게 그대로 보여 줄 도구 오류 문장.
class McpToolError implements Exception {
  McpToolError(this.message);
  final String message;
  @override
  String toString() => message;
}

const mcpResultLimit = 512 * 1024;

/// 512KB(UTF-8 바이트) 초과면 앞부분 + `…(truncated)`; 원문이 JSON이면 `{"truncated":true,"text":…}`로 감싼다.
String truncateResult(String s) {
  final bytes = utf8.encode(s);
  if (bytes.length <= mcpResultLimit) return s;
  final head = '${utf8.decode(bytes.sublist(0, mcpResultLimit), allowMalformed: true).replaceAll('�', '')}…(truncated)';
  try {
    jsonDecode(s);
    return jsonEncode({'truncated': true, 'text': head});
  } on FormatException {
    return head;
  }
}

/// 데스크탑 앱 실행기(순수 로직 — 저장소·실시간은 주입): 실시간 알림·안전 폴링으로 받은 pending 행을
/// 클레임 → 실행 → 완료. 실행은 한 번에 하나(큐). 클레임이 null이면 다른 기기가 가져간 것이라 건너뛴다.
class McpWorker {
  McpWorker({required this.fetchPending, required this.claim, required this.complete, required this.execute, this.inserts, this.poll = const Duration(seconds: 5), this.worker = '', this.timeout = const Duration(seconds: 90)});
  final Future<List<McpCall>> Function() fetchPending;
  final Future<McpCall?> Function(String id) claim;
  final Future<void> Function(String id, {String? text, String? error}) complete;
  final McpExecutor execute;
  final Stream<McpCall>? inserts;
  final Duration poll, timeout;
  final String worker;

  int _handled = 0;
  DateTime? _lastAt;
  String? _lastTool;
  int get handled => _handled;
  DateTime? get lastAt => _lastAt;
  String? get lastTool => _lastTool;

  Timer? _timer;
  StreamSubscription<McpCall>? _sub;
  Future<void> _tail = Future.value();
  final _queued = <String>{};
  bool _polling = false, _disposed = false;

  Future<void> start() async {
    _sub = inserts?.listen(handle);
    _timer = Timer.periodic(poll, (_) => _poll());
    await _poll();
  }

  Future<void> _poll() async {
    if (_polling || _disposed) return;
    _polling = true;
    try {
      for (final c in await fetchPending()) {
        unawaited(handle(c));
      }
    } catch (_) {
      // 네트워크·세션 — 다음 주기에 다시
    } finally {
      _polling = false;
    }
  }

  /// claim→execute→complete. 같은 id가 실시간·폴링으로 겹쳐 와도 큐에는 한 번만.
  Future<void> handle(McpCall c) {
    if (_disposed || !_queued.add(c.id)) return _tail;
    return _tail = _tail.then((_) => _run(c)).whenComplete(() => _queued.remove(c.id));
  }

  Future<void> _run(McpCall c) async {
    if (_disposed) return;
    try {
      final claimed = await claim(c.id);
      if (claimed == null) return;
      String? text, error;
      try {
        text = truncateResult(await execute(claimed.tool, claimed.args).timeout(timeout));
      } on TimeoutException {
        error = '앱 실행 시간 초과';
      } on McpToolError catch (e) {
        error = e.message;
      } catch (e) {
        error = '처리하지 못했습니다: ${e.runtimeType}'; // 원문 금지 — 토큰이 섞일 수 있음
      }
      _handled++;
      _lastAt = DateTime.now();
      _lastTool = claimed.tool;
      await complete(c.id, text: text, error: error);
    } catch (_) {
      // 클레임·완료 쓰기 실패 — 웹이 시간 초과로 정리한다
    }
  }

  void dispose() {
    _disposed = true;
    _timer?.cancel();
    _sub?.cancel();
  }
}
