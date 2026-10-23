import 'dart:convert';
import 'dart:typed_data';
import 'package:http/http.dart' as http;
import '../gw/gw_client.dart' show asStr, asInt;
import '../gw/gw_sign.dart';
import 'messenger_crypto.dart';

/// 아마란스 메신저 게이트웨이(`proxymgw`) 클라이언트 — 그룹웨어 웹 API와 **별도 인증**이다.
///
/// 웹 토큰(`GwCreds`)으로는 메신저 모듈이 11008로 거부한다(실측). 그래서 저장된 아이디·비밀번호로
/// P076 메신저 로그인을 따로 해서 메신저 전용 token·hashKey를 받고, 이후 호출을 그 값으로 서명한다.
/// - 프로토콜 표: 로그인 전에 `proxymgw01A01`에서 받는다(기능 ID → 실제 URL).
/// - 요청 서명: 웹과 같은 `wehago-sign`(HMAC) — 서명키만 메신저 hashKey로 바뀐다.
/// - 본문: `{header, body}` 봉투로 감싼다.
/// 토큰·비밀번호·서명키는 로그·메시지에 남기지 않는다.
///
/// 규격 출처: 메신저 번들 `src/dz/dzhttp.js`(reqUnAuth·reqLogin·reqAuth·makeRequestHeader).

const _gwBase = 'https://gw.innogrid.com';
const _protocolCheckPath = '/proxymgw/proxymgw01A01';
const _mobileId = 'INNOGRID';
const _appType = '13';
const _osType = '03';

/// 메신저 로그인(P076)이 거부됐을 때. resultCode 11008(세션 만료)·11004(서비스 오류) 등.
/// noCreds=true는 "저장된 아이디·비밀번호가 없다"(연결 안내), false는 "로그인은 시도했으나 서버가 거부"(실제 코드·메시지).
class MessengerAuthException implements Exception {
  MessengerAuthException(this.resultCode, this.message, {this.noCreds = false});
  final int resultCode;
  final String message;
  final bool noCreds;
  @override
  String toString() => message;
}

/// 호출 실패(로그인 외). resultCode는 메신저 봉투 값.
class MessengerException implements Exception {
  MessengerException(this.resultCode, this.message);
  final int resultCode;
  final String message;
  @override
  String toString() => message;
}

/// P076 로그인 성공 결과. token·hashKey로 이후 호출을 서명한다. mqtt는 실시간 연동(별도)용 원본.
class MessengerSession {
  MessengerSession({
    required this.token,
    required this.hashKey,
    required this.loginId,
    required this.groupSeq,
    required this.empSeq,
    this.empName = '',
    required this.companyInfo,
    required this.mqtt,
    required this.currentTime,
  });

  final String token, hashKey, loginId, groupSeq, empSeq;
  final String empName;

  /// 서버 기준 시각(connId 구성에 쓴다). 없으면 0.
  final int currentTime;

  /// 메신저 호출 본문 `companyInfo`(compSeq/bizSeq/deptSeq/emailAddr/emailDomain).
  final Map<String, String> companyInfo;

  /// MQTT 접속 정보 원본(ip·port·id·password·authYn·encryption*·sslYn). 실시간 단계에서 쓴다.
  final Map<String, dynamic> mqtt;

  static MessengerSession fromLogin(String loginId, Map data) {
    final companies = data['companyList'];
    Map comp = const {};
    if (companies is List) {
      comp = companies.cast<Map>().firstWhere(
            (c) => asStr(c['compSeq']) == asStr(data['compSeq']) && asStr(c['bizSeq']) == asStr(data['bizSeq']) && asStr(c['deptSeq']) == asStr(data['deptSeq']),
            orElse: () => companies.isEmpty ? const {} : companies.first as Map,
          );
    } else if (companies is Map && companies.isNotEmpty) {
      comp = companies.values.first as Map;
    }
    return MessengerSession(
      token: asStr(data['token']),
      hashKey: asStr(data['hashKey']),
      loginId: loginId,
      groupSeq: asStr(data['groupSeq']),
      empSeq: asStr(data['empSeq']),
      empName: asStr(data['empName']),
      companyInfo: {
        'compSeq': asStr(data['compSeq']).isNotEmpty ? asStr(data['compSeq']) : asStr(comp['compSeq']),
        'bizSeq': asStr(data['bizSeq']).isNotEmpty ? asStr(data['bizSeq']) : asStr(comp['bizSeq']),
        'deptSeq': asStr(data['deptSeq']).isNotEmpty ? asStr(data['deptSeq']) : asStr(comp['deptSeq']),
        'emailAddr': asStr(comp['emailAddr']),
        'emailDomain': asStr(comp['emailDomain']),
      },
      mqtt: data['mqttInfo'] is Map ? Map<String, dynamic>.from(data['mqttInfo'] as Map) : const {},
      currentTime: asInt(data['currentTime']),
    );
  }
}

/// 저장된 아이디·비밀번호 공급자. 없으면 null(연결 안 됨).
typedef MessengerCredsLoader = Future<({String id, String pw})?> Function();

class MessengerClient {
  MessengerClient({required this.httpClient, required this.loadCreds, DateTime Function()? now, String Function()? txId})
      : _now = now ?? DateTime.now,
        _txId = txId ?? gwTransactionId;

  final http.Client httpClient;
  final MessengerCredsLoader loadCreds;
  final DateTime Function() _now;
  final String Function() _txId;

  Map<String, String>? _protocols; // 기능 ID → URL
  MessengerSession? _session;

  MessengerSession? get session => _session;

  /// 세션을 보장한다(없으면 로그인). groupSeq·empSeq 등이 필요할 때.
  Future<MessengerSession> ensureSession() async => _session ?? await _login();

  /// 기능 ID로 호출. 미로그인/만료(11008)면 한 번 로그인(재로그인) 후 재시도.
  Future<dynamic> call(String pid, Map<String, Object?> body) async {
    final sess = _session ?? await _login();
    try {
      return await _signedCall(pid, body, sess);
    } on MessengerAuthException {
      final fresh = await _login(); // 만료 → 재로그인 1회
      return _signedCall(pid, body, fresh);
    }
  }

  /// companyInfo를 붙여 호출(대부분의 메신저 조회가 요구). body에 이미 있으면 그대로.
  Future<dynamic> callCo(String pid, Map<String, Object?> body) async {
    final sess = _session ?? await _login();
    final merged = {'companyInfo': sess.companyInfo, ...body};
    return call(pid, merged);
  }

  Future<MessengerSession> _login() async {
    final creds = await loadCreds();
    if (creds == null || creds.id.isEmpty) {
      throw MessengerAuthException(-1, '아마란스 자동 로그인 정보가 없습니다. 아마란스를 먼저 연결해 주세요.', noCreds: true);
    }
    final protocols = await _loadProtocols(creds.id);
    final kNum = loginKeyIndex();
    final data = await _unauthPost(protocols['P076']!, 'P076', {
      'appType': _appType,
      'appVer': '',
      'loginId': encryptLoginData(creds.id, kNum),
      'passwd': encryptLoginData(creds.pw, kNum),
      'kNum': kNum.toString(),
      'mobileId': _mobileId,
      'osType': _osType,
      'fidoLoginYn': 'N',
      'fidoPasswdLoginYn': 'Y',
      'ssoUUID': '',
    });
    final sess = MessengerSession.fromLogin(creds.id, data as Map);
    if (sess.token.isEmpty) throw MessengerAuthException(-1, '메신저 로그인에 실패했습니다.');
    _session = sess;
    return sess;
  }

  Future<Map<String, String>> _loadProtocols(String loginId) async {
    if (_protocols != null) return _protocols!;
    final q = '?mobileId=$_mobileId&loginId=${Uri.encodeComponent(loginId)}&appType=$_appType&osType=$_osType&osVer=&model=';
    final data = await _unauthGet('$_gwBase$_protocolCheckPath$q', _protocolCheckPath);
    final list = (data as Map)['protocolList'];
    final map = <String, String>{};
    if (list is List) {
      for (final p in list) {
        if (p is Map) map[asStr(p['protocolId'])] = asStr(p['protocolUrl']);
      }
    }
    if (!map.containsKey('P076')) throw MessengerAuthException(-1, '메신저 프로토콜 주소를 받지 못했습니다.');
    _protocols = map;
    return map;
  }

  // ── 비인증(로그인 전) 요청: get_token → signature 헤더 ──────────────────

  Future<dynamic> _unauthGet(String url, String path) async {
    final headers = await _unauthHeaders(path);
    final res = await _send(http.Request('GET', Uri.parse(url))..headers.addAll(headers));
    return _decodeUnauth(res);
  }

  Future<dynamic> _unauthPost(String url, String pid, Map<String, Object?> body) async {
    final path = Uri.parse(url).path;
    final headers = await _unauthHeaders(path);
    final req = http.Request('POST', Uri.parse(url))
      ..headers.addAll({...headers, 'Content-Type': 'application/json; charset=utf-8'})
      ..body = jsonEncode({'header': _reqHeader(pid, ''), 'body': body});
    return _decodeUnauth(await _send(req));
  }

  Future<Map<String, String>> _unauthHeaders(String path) async {
    final p = Uri.parse(_gwBase);
    final tid = _txId();
    final tokRes = await _send(http.Request('GET', p.replace(path: '/get_token/', queryParameters: {'url': path}))..headers['transaction-id'] = tid);
    final tok = jsonDecode(utf8.decode(tokRes.bodyBytes)) as Map;
    final token = asStr(tok['token']);
    final curDate = asStr(tok['cur_date']);
    final signature = base64.encode(sha256OfUtf8('$token$curDate$tid$path'));
    return {'transaction-id': _txId(), 'signature': signature, 'timestamp': _now().millisecondsSinceEpoch.toString()};
  }

  // ── 인증 요청: wehago-sign(메신저 hashKey) ──────────────────────────────

  Future<dynamic> _signedCall(String pid, Map<String, Object?> body, MessengerSession sess) async {
    final url = _url(pid);
    final req = http.Request('POST', Uri.parse(url))
      ..headers.addAll({..._signedHeaders(url, sess), 'Content-Type': 'application/json; charset=utf-8'})
      ..body = jsonEncode({'header': _reqHeader(pid, sess.token), 'body': body});
    return _decodeAuth(await _send(req));
  }

  String _url(String pid) => _protocols?[pid] ?? (throw MessengerException(-1, '알 수 없는 메신저 기능($pid)'));

  Map<String, String> _signedHeaders(String url, MessengerSession sess) {
    final tid = _txId();
    final ts = _now().millisecondsSinceEpoch.toString();
    return {
      'Authorization': 'Bearer ${sess.token}',
      'transaction-id': tid,
      'timestamp': ts,
      'wehago-sign': wehagoSign(authToken: sess.token, transactionId: tid, timestamp: ts, path: Uri.parse(url).path, signKey: sess.hashKey),
    };
  }

  /// 파일을 실은 호출(multipart) — 메신저 앱 `reqNewFileUpload`와 같은 모양: 봉투 JSON은 `body` 칸, 파일은 `file` 칸마다 하나.
  /// 서버가 파일을 붙여 대화를 만든다(본문 `file`은 빈 배열 그대로). 만료면 재로그인 1회.
  Future<dynamic> upload(String pid, Map<String, Object?> body, List<({String name, Uint8List bytes})> files, {Map<String, String> fields = const {}}) async {
    Future<dynamic> once(MessengerSession sess) async {
      final url = _url(pid);
      final req = http.MultipartRequest('POST', Uri.parse(url))
        ..headers.addAll(_signedHeaders(url, sess))
        ..fields['body'] = jsonEncode({'header': _reqHeader(pid, sess.token), 'body': {'companyInfo': sess.companyInfo, ...body}})
        ..fields.addAll(fields)
        ..files.addAll([for (final f in files) http.MultipartFile.fromBytes('file', f.bytes, filename: f.name)]);
      return _decodeAuth(await _send(req, timeout: const Duration(minutes: 3)));
    }
    final sess = _session ?? await _login();
    try {
      return await once(sess);
    } on MessengerAuthException {
      return once(await _login());
    }
  }

  /// 파일 내용 받기 — 응답이 JSON 봉투가 아니라 파일 바이트 그대로다(P084 등). 422 = 보안 정책으로 막힌 파일.
  Future<Uint8List> download(String pid, Map<String, Object?> body) async {
    Future<Uint8List> once(MessengerSession sess) async {
      final url = _url(pid);
      final req = http.Request('POST', Uri.parse(url))
        ..headers.addAll({..._signedHeaders(url, sess), 'Content-Type': 'application/json; charset=utf-8'})
        ..body = jsonEncode({'header': _reqHeader(pid, sess.token), 'body': body});
      return _bytes(await _send(req, timeout: const Duration(minutes: 3)));
    }
    final sess = _session ?? await _login();
    try {
      return await once(sess);
    } on MessengerAuthException {
      return once(await _login());
    }
  }

  /// 썸네일 등 GET 파일(메신저 앱은 `<img src>` + 메인 프로세스가 붙이는 BIZCUBE 쿠키). 서명 헤더도 함께 보낸다.
  Future<Uint8List> getFile(String pid, Map<String, String> query) async {
    final sess = _session ?? await _login();
    final url = Uri.parse(_url(pid));
    final req = http.Request('GET', url.replace(queryParameters: {...url.queryParameters, 'mobileId': _mobileId, ...query}))
      ..headers.addAll({..._signedHeaders(url.toString(), sess), 'Cookie': 'BIZCUBE_AT=${sess.token}; BIZCUBE_HK=${sess.hashKey}; BIZCUBE_TYPE=PC;'});
    return _bytes(await _send(req));
  }

  Uint8List _bytes(http.Response res) {
    if (res.statusCode == 401) throw MessengerAuthException(401, '메신저 세션이 만료되었습니다. (401)');
    if (res.statusCode == 422) throw MessengerException(422, '보안 정책으로 받을 수 없는 파일입니다.');
    if (res.statusCode < 200 || res.statusCode >= 300) throw MessengerException(res.statusCode, '파일을 받지 못했습니다 (HTTP ${res.statusCode})');
    // 실패도 200 + JSON 봉투로 올 수 있다
    if ((res.headers['content-type'] ?? '').contains('json')) {
      _decodeAuth(res);
      throw MessengerException(-1, '파일을 받지 못했습니다.');
    }
    return res.bodyBytes;
  }

  Map<String, Object?> _reqHeader(String pid, String token) => {
        'appType': _appType,
        'loginId': _session?.loginId ?? '',
        'mobileId': _mobileId,
        'osType': _osType,
        'pid': pid,
        'tId': _txId(),
        'token': token,
      };

  Future<http.Response> _send(http.BaseRequest req, {Duration timeout = const Duration(seconds: 15)}) async {
    try {
      return await http.Response.fromStream(await httpClient.send(req)).timeout(timeout);
    } catch (e) {
      throw MessengerException(0, '메신저에 연결할 수 없습니다 (${e.runtimeType})');
    }
  }

  dynamic _decodeUnauth(http.Response res) {
    final v = _envelope(res);
    final code = asInt(v['resultCode'], -1);
    if (code != 0) throw MessengerAuthException(code, asStr(v['resultMsg']).isEmpty ? '메신저 로그인에 실패했습니다 ($code)' : asStr(v['resultMsg']));
    return v['resultData'];
  }

  dynamic _decodeAuth(http.Response res) {
    final v = _envelope(res);
    final code = asInt(v['resultCode'], -1);
    // 11008: 세션 만료/오래 미사용 → 재로그인 신호
    if (code == 11008) throw MessengerAuthException(code, '메신저 세션이 만료되었습니다.');
    if (code != 0) throw MessengerException(code, asStr(v['resultMsg']).isEmpty ? '메신저 요청에 실패했습니다 ($code)' : asStr(v['resultMsg']));
    return v['resultData'];
  }

  Map<String, dynamic> _envelope(http.Response res) {
    // 401 = 세션 무효(동시 접속으로 우리 토큰이 밀렸거나 만료). 재로그인 신호로 올린다(call이 1회 재로그인·재시도).
    if (res.statusCode == 401) {
      throw MessengerAuthException(401, '메신저 세션이 만료되었습니다. (401)');
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw MessengerException(res.statusCode, '메신저 요청에 실패했습니다 (HTTP ${res.statusCode})');
    }
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      if (j is Map<String, dynamic>) return j;
    } catch (_) {}
    throw MessengerException(-1, '메신저 응답을 해석할 수 없습니다.');
  }
}
