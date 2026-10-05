import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../api/client.dart';
import '../app/theme.dart';

/// 출근 기록 후 Teams 채팅방에 "9시 23분 출근했습니다." (+ 추가 문구)를 보낸다.
/// 채팅방은 사용자가 고른 내 Teams 그룹·1:1 채팅(서버 /api/teams/chat — 본인 Microsoft 위임 토큰, 내 이름으로 올라감).
/// 선택·켜짐 여부는 기기에만 저장(SharedPreferences). 메시지 내용은 로그에 남기지 않는다.

/// comeTm 'YYYYMMDDHHmm' → "9시 23분 출근했습니다."(정각은 "10시 출근했습니다."), 추가 문구는 한 칸 띄워 붙인다.
String clockInMessage(String comeTm, String extra) {
  final d = comeTm.replaceAll(RegExp(r'\D'), '');
  final h = d.length >= 12 ? int.parse(d.substring(8, 10)) : 0;
  final m = d.length >= 12 ? int.parse(d.substring(10, 12)) : 0;
  final base = '$h시${m == 0 ? '' : ' $m분'} 출근했습니다.';
  final e = extra.trim();
  return e.isEmpty ? base : '$base $e';
}

class ClockInNotifyPrefs {
  const ClockInNotifyPrefs({this.chatId = '', this.topic = '', this.enabled = false});
  final String chatId, topic;
  final bool enabled;
  bool get hasChat => chatId.isNotEmpty;

  static const _kChat = 'clockin.teams.chatId', _kTopic = 'clockin.teams.topic', _kOn = 'clockin.teams.enabled';

  static Future<ClockInNotifyPrefs> load() async {
    try {
      final p = await SharedPreferences.getInstance();
      return ClockInNotifyPrefs(chatId: p.getString(_kChat) ?? '', topic: p.getString(_kTopic) ?? '', enabled: p.getBool(_kOn) ?? false);
    } catch (_) {
      return const ClockInNotifyPrefs();
    }
  }

  Future<void> save() async {
    try {
      final p = await SharedPreferences.getInstance();
      await p.setString(_kChat, chatId);
      await p.setString(_kTopic, topic);
      await p.setBool(_kOn, enabled);
    } catch (_) {}
  }
}

/// 내 Teams 채팅 목록에서 하나 고르기. Microsoft 미연결·권한 없음이면 안내만.
Future<({String id, String topic})?> pickTeamsChat(BuildContext context, ApiClient api) => showModalBottomSheet<({String id, String topic})>(
      context: context,
      isScrollControlled: true,
      builder: (c) => SafeArea(
        child: SizedBox(
          height: MediaQuery.of(c).size.height * 0.6,
          child: FutureBuilder<dynamic>(
            future: api.getJson('/api/teams/chat'),
            builder: (c, snap) {
              if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
              final j = snap.data;
              final chats = j is Map && j['hasChatScope'] == true && j['chats'] is List ? [for (final x in j['chats'] as List) if (x is Map) (id: '${x['id']}', topic: '${x['topic'] ?? ''}')] : <({String id, String topic})>[];
              if (snap.hasError || chats.isEmpty) {
                return const Center(child: Padding(padding: EdgeInsets.all(24), child: Text('Teams 채팅을 불러오지 못했습니다.\n웹 설정에서 Microsoft 계정을 연결(채팅 권한 포함)한 뒤 다시 시도하세요.', textAlign: TextAlign.center)));
              }
              return ListView(children: [
                const Padding(padding: EdgeInsets.fromLTRB(20, 16, 20, 8), child: Text('출근 알림을 보낼 Teams 채팅방', style: TextStyle(fontWeight: FontWeight.w700, color: Brand.navy))),
                for (final ch in chats) ListTile(leading: const Icon(Icons.forum_outlined), title: Text(ch.topic.isEmpty ? '(제목 없음)' : ch.topic), onTap: () => Navigator.pop(c, ch)),
              ]);
            },
          ),
        ),
      ),
    );

/// 출근 확인창 결과: 기록할지 + 알릴지 + 추가 문구.
typedef ClockInChoice = ({bool notify, String extra, ClockInNotifyPrefs prefs});

class ClockInDialog extends StatefulWidget {
  const ClockInDialog({super.key, required this.prefs, required this.pick});
  final ClockInNotifyPrefs prefs;
  final Future<({String id, String topic})?> Function() pick;
  @override
  State<ClockInDialog> createState() => _ClockInDialogState();
}

class _ClockInDialogState extends State<ClockInDialog> {
  late ClockInNotifyPrefs _p = widget.prefs;
  final _extra = TextEditingController();

  @override
  void dispose() {
    _extra.dispose();
    super.dispose();
  }

  Future<void> _choose() async {
    final ch = await widget.pick();
    if (ch == null || !mounted) return;
    final p = ClockInNotifyPrefs(chatId: ch.id, topic: ch.topic, enabled: true);
    await p.save();
    if (mounted) setState(() => _p = p);
  }

  @override
  Widget build(BuildContext context) => AlertDialog(
        title: const Text('지금 출근을 기록할까요?'),
        content: SingleChildScrollView(
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
            const Text('실제 근태에 반영되며 되돌릴 수 없습니다.'),
            const SizedBox(height: 14),
            if (!_p.hasChat)
              OutlinedButton.icon(onPressed: _choose, icon: const Icon(Icons.forum_outlined, size: 18), label: const Text('Teams 채팅방 고르기'))
            else ...[
              Row(children: [
                Expanded(child: Text('Teams에 알리기 · ${_p.topic}', style: const TextStyle(fontSize: 14, color: Brand.navy), overflow: TextOverflow.ellipsis)),
                Switch(value: _p.enabled, onChanged: (v) => setState(() => _p = ClockInNotifyPrefs(chatId: _p.chatId, topic: _p.topic, enabled: v))),
              ]),
              Align(alignment: Alignment.centerLeft, child: TextButton(onPressed: _choose, child: const Text('채팅방 바꾸기'))),
              TextField(controller: _extra, enabled: _p.enabled, maxLength: 200, decoration: const InputDecoration(hintText: '추가 문구(선택)', isDense: true)),
            ],
          ]),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('취소')),
          FilledButton(onPressed: () => Navigator.pop<ClockInChoice>(context, (notify: _p.hasChat && _p.enabled, extra: _extra.text, prefs: _p)), child: const Text('기록')),
        ],
      );
}

/// 보내기. 성공이면 null, 실패면 사용자에게 보일 문구.
Future<String?> sendClockInToTeams(ApiClient api, String chatId, String text) async {
  try {
    await api.postJson('/api/teams/chat/messages', {'chat': chatId, 'text': text});
    return null;
  } on ApiException catch (e) {
    return e.message;
  } catch (e) {
    return '$e';
  }
}
