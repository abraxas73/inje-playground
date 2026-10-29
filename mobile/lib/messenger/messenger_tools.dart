// mobile/lib/messenger/messenger_tools.dart — 아마란스 메신저를 도구로(이노봇 messenger_* · Claude 커넥터 *_messenger_*).
// 결과는 Claude에 줄 JSON 맵. 비밀대화(talkSecuYn=Y) 본문은 내놓지 않고, 읽기는 읽음 처리하지 않는다.
import '../gw/gw_client.dart' show asStr;
import 'messenger_api.dart';
import 'messenger_client.dart';
import 'messenger_models.dart';

String _two(int v) => v.toString().padLeft(2, '0');
String _at(DateTime? t) => t == null ? '' : '${t.year}-${_two(t.month)}-${_two(t.day)} ${_two(t.hour)}:${_two(t.minute)}';

/// 메신저 도구 실행 — 같은 요청 안에서 이름 해석(P1471)을 캐시한다.
class MessengerTools {
  MessengerTools(this.api);
  final MessengerApi api;
  final _names = <String, String>{};

  Future<String> get _me async => (await api.client.ensureSession()).empSeq;

  Future<void> _resolve(Iterable<String> seqs) async {
    final need = {for (final s in seqs) if (s.isNotEmpty && !_names.containsKey(s)) s};
    if (need.isEmpty) return;
    try {
      _names.addAll(await api.userNames(need.toList()));
    } catch (_) {} // 이름은 없어도 된다(사번으로 보인다)
  }

  Future<Map<String, Object?>> _room(MsgRoom r, String me) async => {
        'room_id': r.roomId,
        'title': r.titleWith(_names, me),
        'unread': r.unreadCount,
        'last_message': r.preview,
        'last_at': _at(r.lastAt),
      };

  /// 대화방 목록(최근 대화 순). unreadOnly면 안 읽은 방만, query면 방 이름 검색(P326).
  Future<Map<String, Object?>> rooms({bool unreadOnly = false, String query = '', int limit = 20}) async {
    final me = await _me;
    var list = query.trim().isEmpty ? await api.rooms() : await api.searchRooms(query.trim());
    list = [for (final r in list) if (r.roomType != '3' && (!unreadOnly || r.unreadCount > 0)) r]..sort((a, b) => b.lastChatTimeStamp - a.lastChatTimeStamp);
    final shown = list.take(limit.clamp(1, 50)).toList();
    await _resolve([for (final r in shown) ...r.unresolvedSeqs(me)]);
    return {'rooms': [for (final r in shown) await _room(r, me)], if (list.length > shown.length) 'more': list.length - shown.length};
  }

  Map<String, Object?> _chat(MsgChat c, String me) => {
        'chat_id': c.chatId,
        'from': c.sendEmpSeq == me ? '나' : (_names[c.sendEmpSeq] ?? c.sendEmpSeq),
        'at': _at(c.at),
        'text': c.secret ? '[비밀대화 — 메신저에서 확인]' : c.deleted ? '[삭제된 메시지]' : c.displayContent,
        if (c.files.isNotEmpty) 'files': [for (final f in c.files) f.name],
      };

  /// 방 안 최근 대화(오래된 → 최신). 읽음 처리하지 않는다.
  Future<Map<String, Object?>> read(String roomId, {int limit = 30}) async {
    if (roomId.trim().isEmpty) throw MessengerException(-1, 'room_id가 없습니다 — 대화방 목록·검색 결과의 room_id를 쓰세요.');
    final me = await _me;
    final chats = await api.chats(roomId.trim(), pageSize: limit.clamp(1, 100));
    chats.sort((a, b) => a.timeStamp - b.timeStamp);
    await _resolve(chats.map((c) => c.sendEmpSeq));
    return {'room_id': roomId.trim(), 'messages': [for (final c in chats) _chat(c, me)]};
  }

  /// 대화방 이름(P326)과 대화 내용(P081) 검색. roomId를 주면 그 방 안 내용만.
  Future<Map<String, Object?>> search(String query, {String roomId = ''}) async {
    final q = query.trim();
    if (q.isEmpty) throw MessengerException(-1, '검색어가 없습니다.');
    final me = await _me;
    final rooms = roomId.isEmpty ? await api.searchRooms(q, pageSize: 10) : const <MsgRoom>[];
    final chats = await api.searchChats(q, roomId: roomId, pageSize: 20);
    await _resolve([for (final r in rooms) ...r.unresolvedSeqs(me), for (final c in chats) c.sendEmpSeq]);
    return {
      'rooms': [for (final r in rooms) await _room(r, me)],
      'messages': [for (final c in chats) if (!c.secret) {'room_id': c.roomId, ..._chat(c, me)}],
    };
  }

  /// 보내기 전 확인 — 보낼 방의 실제 이름. roomId가 없으면 empSeqs(find_person)로 열 상대 이름.
  Future<String> target({String roomId = '', List<String> empSeqs = const []}) async {
    final me = await _me;
    if (roomId.isNotEmpty) {
      final r = (await api.rooms(pageSize: 200)).where((x) => x.roomId == roomId).firstOrNull;
      if (r == null) throw MessengerException(-1, '대화방을 찾지 못했습니다: $roomId — 대화방 목록·검색 결과의 room_id를 쓰세요.');
      await _resolve(r.unresolvedSeqs(me));
      return r.titleWith(_names, me);
    }
    final peers = [for (final e in empSeqs.toSet()) if (e.isNotEmpty && e != me) e];
    if (peers.isEmpty) throw MessengerException(-1, '보낼 대화방(room_id)이나 상대(emp_seqs)가 없습니다.');
    await _resolve(peers);
    final unknown = [for (final p in peers) if (!_names.containsKey(p)) p];
    if (unknown.isNotEmpty) throw MessengerException(-1, '상대를 찾지 못했습니다: ${unknown.join(', ')} — find_person 결과의 empSeq를 쓰세요.');
    return [for (final p in peers) _names[p]!].join(', ');
  }

  /// 글 보내기 — roomId가 없으면 상대와의 방을 열고(1:1은 기존 방) 보낸다.
  Future<Map<String, Object?>> send({String roomId = '', List<String> empSeqs = const [], required String text}) async {
    if (text.trim().isEmpty) throw MessengerException(-1, '보낼 내용이 없습니다.');
    final id = roomId.isNotEmpty ? roomId : await api.openRoomWith(empSeqs);
    await api.sendChat(roomId: id, content: text, uuid: '${DateTime.now().microsecondsSinceEpoch}');
    return {'ok': true, 'room_id': id};
  }
}

/// 보내기 도중 끊김 등 — 서버가 받았는지 알 수 없는 실패(재전송하면 중복될 수 있다).
bool messengerOutcomeUnknown(Object e) => e is! MessengerException && e is! MessengerAuthException;

/// 메신저 오류 → 사람이 읽을 한 문장.
String messengerError(Object e) => switch (e) {
      MessengerAuthException(noCreds: true) => '아마란스 메신저에 로그인할 정보가 없습니다. 더보기 > 아마란스에서 자동 로그인을 연결하세요.',
      MessengerAuthException(:final message) => '아마란스 메신저 로그인 실패: $message',
      MessengerException(:final message) => message,
      _ => '메신저 처리 중 오류가 발생했습니다 (${e.runtimeType})',
    };

List<String> strList(Object? v) => v is List ? [for (final x in v) asStr(x)] : (v is String && v.isNotEmpty ? [v] : const []);
