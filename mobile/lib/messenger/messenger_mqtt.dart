import 'dart:async';
import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:mqtt_client/mqtt_client.dart';
import 'package:mqtt_client/mqtt_server_client.dart';
import '../gw/gw_client.dart' show asStr, asInt;
import '../gw/gw_sign.dart' show gwTransactionId;
import '../gw/talk_notifications.dart' show showMessengerPush;
import 'messenger_client.dart';
import 'messenger_crypto.dart';
import 'messenger_provider.dart';

/// 아마란스 메신저 실시간(MQTT). 로그인(P076) 응답의 mqttInfo로 접속해 대화·접속 상태 토픽을 구독한다.
/// 규격 출처: 메신저 번들 `src/dz/dzMqtt.js`(connId·토픽·QoS2), 비밀번호 복호화는 로그인과 같은 키 테이블.
/// 페이로드 구조는 구현마다 달라, 이벤트는 type·roomId·empSeq만 방어적으로 뽑고 화면은 새로고침으로 반응한다.

/// MQTT로 들어온 신호(한 건). raw는 원본 맵.
class MessengerMqttEvent {
  const MessengerMqttEvent({required this.topic, required this.type, required this.roomId, required this.empSeq, required this.stateCode, required this.raw, this.notifyTitle = '', this.notifyBody = ''});
  final String topic, type, roomId, empSeq, stateCode, notifyTitle, notifyBody;
  final Map raw;

  bool get isChat => topic.contains('/Chat') || type == '001' || type == '002' || type == '003' || type == '004' || type == '007';
  bool get isState => topic.endsWith('/State') || stateCode.isNotEmpty;
  bool get isAttend => topic.contains('attendApplication');
  bool get hasNotify => notifyTitle.isNotEmpty || notifyBody.isNotEmpty;
}

class MessengerMqtt {
  MessengerMqtt();

  MqttServerClient? _client;
  final _controller = StreamController<MessengerMqttEvent>.broadcast();
  final _rooms = <String, int>{}; // 구독 중인 방 토픽 참조수(열린 방 = 알림 억제)
  String _grp = '';
  String _myEmpSeq = '';
  bool _connecting = false;

  /// 알림으로 띄울 푸시가 오면 호출(title, body, 탭 시 이동 경로). 열린 방·내가 보낸 건은 제외된 상태로만 온다.
  void Function(String title, String body, String path)? onPush;

  Stream<MessengerMqttEvent> get events => _controller.stream;
  bool get connected => _client?.connectionStatus?.state == MqttConnectionState.connected;

  /// 세션으로 접속·기본 토픽 구독. 이미 접속돼 있으면 무시. 실패는 조용히(실시간은 부가 기능).
  Future<void> connect(MessengerSession s) async {
    if (_connecting || connected) return;
    final m = s.mqtt;
    final ip = asStr(m['ip']);
    final port = asInt(m['port']);
    if (ip.isEmpty || port == 0 || s.empSeq.isEmpty) return;
    _connecting = true;
    try {
      _grp = s.groupSeq;
      _myEmpSeq = s.empSeq;
      final ssl = asStr(m['sslYn']) == 'Y';
      final transId = gwTransactionId();
      final clientId = '${s.groupSeq}|${s.empSeq}|13|${s.currentTime}|$transId';
      final c = MqttServerClient.withPort(ip, clientId, port)
        ..keepAlivePeriod = 30
        ..autoReconnect = true
        ..secure = ssl
        ..logging(on: false)
        ..onBadCertificate = ((_) => true); // 메신저 원본도 rejectUnauthorized:false
      final auth = asStr(m['authYn']) == 'Y';
      final user = auth ? asStr(m['id']) : null;
      final pwd = _password(m, auth);
      c.connectionMessage = MqttConnectMessage().withClientIdentifier(clientId).startClean();
      await c.connect(user, pwd);
      if (c.connectionStatus?.state != MqttConnectionState.connected) {
        c.disconnect();
        return;
      }
      _client = c;
      c.updates?.listen(_onUpdates);
      for (final t in ['/$_grp/OrgSync', '/$_grp/${s.empSeq}', '/$_grp/Chat', '/$_grp/State', '/$_grp/attendApplicationDetails']) {
        c.subscribe(t, MqttQos.exactlyOnce);
      }
      // 재접속 후에도 방 구독 복원
      for (final roomId in _rooms.keys) {
        c.subscribe('/$_grp/Chat/$roomId', MqttQos.exactlyOnce);
      }
    } catch (_) {
      // 실시간 실패는 무시 — 화면은 수동 새로고침으로 동작
    } finally {
      _connecting = false;
    }
  }

  /// 방 입장 시 그 방 대화 토픽 구독(참조수 관리).
  void enterRoom(String roomId) {
    if (roomId.isEmpty) return;
    _rooms[roomId] = (_rooms[roomId] ?? 0) + 1;
    if (_rooms[roomId] == 1 && connected) {
      _client?.subscribe('/$_grp/Chat/$roomId', MqttQos.exactlyOnce);
    }
  }

  void leaveRoom(String roomId) {
    if (roomId.isEmpty || !_rooms.containsKey(roomId)) return;
    final n = (_rooms[roomId] ?? 1) - 1;
    if (n <= 0) {
      _rooms.remove(roomId);
      if (connected) _client?.unsubscribe('/$_grp/Chat/$roomId');
    } else {
      _rooms[roomId] = n;
    }
  }

  String? _password(Map m, bool auth) {
    final raw = asStr(m['password']);
    if (!auth) return raw.isEmpty ? null : raw;
    if (asStr(m['encryptionYn']) == 'Y' && asStr(m['encryptionVer']) == '1') {
      final idx = asInt(m['encryptionKey']);
      try {
        return decryptLoginData(raw, idx); // MQTT 키 테이블 = 로그인 키 테이블
      } catch (_) {
        return raw;
      }
    }
    return raw.isEmpty ? null : raw;
  }

  void _onUpdates(List<MqttReceivedMessage<MqttMessage>> batch) {
    for (final rec in batch) {
      try {
        final msg = rec.payload as MqttPublishMessage;
        final text = MqttPublishPayload.bytesToStringAsString(msg.payload.message);
        final data = jsonDecode(text);
        if (data is! Map) continue;
        final roomId = asStr(data['roomId']);
        final empSeq = asStr(data['empSeq']);
        // 알림 페이로드(title/content는 언어별 맵). 원본 규격: 내가 receiver에 있고 setting.alertYn=Y·pushYn=Y일 때만.
        final title = _lang(data['title']);
        final body = _lang(data['content']).isNotEmpty ? _lang(data['content']) : _lang(data['preview']);
        _controller.add(MessengerMqttEvent(
          topic: rec.topic,
          type: asStr(data['type']),
          roomId: roomId,
          empSeq: empSeq,
          stateCode: data.containsKey('state') ? asStr(data['state']) : '',
          raw: data,
          notifyTitle: title,
          notifyBody: body,
        ));
        if (title.isNotEmpty && _shouldNotify(data, roomId, empSeq)) {
          final path = roomId.isEmpty ? '/gw/messenger' : '/gw/room?id=${Uri.encodeComponent(roomId)}&title=${Uri.encodeComponent(title)}';
          onPush?.call(title, body, path);
        }
      } catch (_) {
        // 깨진 페이로드는 건너뛴다
      }
    }
  }

  /// 언어별 맵({kr:..,en:..})이면 kr 우선, 문자열이면 그대로.
  String _lang(dynamic v) {
    if (v is String) return v;
    if (v is Map) return asStr(v['kr']).isNotEmpty ? asStr(v['kr']) : asStr(v.values.firstWhere((e) => asStr(e).isNotEmpty, orElse: () => ''));
    return '';
  }

  /// 알림을 띄울지: 내가 보낸 게 아니고, 지금 열어 둔 방이 아니고, 수신 설정이 켜져 있을 때.
  bool _shouldNotify(Map data, String roomId, String empSeq) {
    if (empSeq.isNotEmpty && empSeq == _myEmpSeq) return false; // 내가 보낸 것
    if (roomId.isNotEmpty && _rooms.containsKey(roomId)) return false; // 지금 보고 있는 방
    final setting = data['setting'];
    if (setting is Map && asStr(setting['alertYn']) == 'N') return false;
    final receiver = data['receiver'];
    if (receiver is Map && receiver.containsKey(_myEmpSeq)) {
      final me = receiver[_myEmpSeq];
      if (me is Map && asStr(me['pushYn']) == 'N') return false;
    }
    return true;
  }

  void dispose() {
    try {
      _client?.disconnect();
    } catch (_) {}
    _controller.close();
  }
}

/// 앱 생존 동안 유지되는 MQTT 서비스. 세션이 있어야 접속되므로 화면이 ensureConnected로 깨운다.
final messengerMqttProvider = Provider<MessengerMqtt>((ref) {
  final mqtt = MessengerMqtt()
    ..onPush = (title, body, path) => showMessengerPush(title: title, body: body, path: path);
  ref.onDispose(mqtt.dispose);
  return mqtt;
});

/// 세션을 보장하고 MQTT 접속을 시도한다(메신저 화면 진입 시 호출).
Future<void> ensureMessengerRealtime(WidgetRef ref) async {
  try {
    final s = await ref.read(messengerClientProvider).ensureSession();
    await ref.read(messengerMqttProvider).connect(s);
  } catch (_) {}
}
