import 'dart:convert';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'gw_creds.dart';
import 'gw_sign.dart';

class GwException implements Exception {
  GwException(this.status, this.resultCode, this.message);
  final int status, resultCode;
  final String message;
  @override
  String toString() => message;
}

/// HTTP 401 — 세션 만료·서명 불일치(resultCode 140/112). 처방은 같다: 다시 연결.
class GwUnauthorized extends GwException {
  GwUnauthorized(int resultCode) : super(401, resultCode, '아마란스 로그인이 만료되었습니다. 다시 연결해 주세요.');
}

/// gw050A02 sessionInfo.ucUserInfo. UC 계열(compSeq/deptSeq/email)과 근태 ERP 코드(erp*Seq)를 한 번에.
class GwSession {
  const GwSession({required this.compSeq, required this.deptSeq, required this.empName, required this.emailAddr, required this.emailDomain, required this.empCd, required this.deptCd, required this.coCd});
  final String compSeq, deptSeq, empName, emailAddr, emailDomain, empCd, deptCd, coCd;
  String get email => emailDomain.isEmpty ? emailAddr : '$emailAddr@$emailDomain';
  factory GwSession.fromUcUserInfo(Map m) => GwSession(
        compSeq: asStr(m['compSeq']), deptSeq: asStr(m['deptSeq']), empName: asStr(m['empName']), emailAddr: asStr(m['emailAdd']), emailDomain: asStr(m['emailDomain']),
        empCd: asStr(m['erpEmpSeq']), deptCd: asStr(m['erpDeptSeq']), coCd: asStr(m['erpCompSeq']));
}

/// 서버가 숫자/문자열/불리언을 섞어 주므로 값은 이 셋으로만 읽는다.
String asStr(Object? v) => v == null ? '' : v.toString();
bool asBool(Object? v) => v == true || v == 1 || (v is String && (v == 'Y' || v == 'y' || v == '1' || v == 'true'));
int asInt(Object? v, [int fallback = 0]) => v is int ? v : (v is num ? v.toInt() : int.tryParse(asStr(v)) ?? fallback);

/// Content-Disposition → 파일명. `filename*=UTF-8''<퍼센트 인코딩>` 우선, 없으면 `filename="…"`, 둘 다 없으면 ''.
String dispositionName(String cd) {
  final star = RegExp(r"filename\*\s*=\s*[^']*'[^']*'([^;]+)", caseSensitive: false).firstMatch(cd)?.group(1);
  if (star != null) {
    try {
      return Uri.decodeComponent(star.trim());
    } catch (_) {
      // 깨진 인코딩은 아래 filename으로
    }
  }
  final m = RegExp(r'filename\s*=\s*"([^"]*)"|filename\s*=\s*([^;]+)', caseSensitive: false).firstMatch(cd);
  return (m?.group(1) ?? m?.group(2) ?? '').trim();
}

/// 모든 아마란스 호출의 단일 관문. 서명 헤더 4종 → POST → 봉투({resultCode,resultMsg,resultData}) 해석.
class GwClient {
  GwClient({required this.httpClient, required this.creds, this.baseUrl = 'https://gw.innogrid.com', DateTime Function()? now, String Function()? txId, this.onUnauthorized})
      : _now = now ?? DateTime.now, _txId = txId ?? gwTransactionId;
  final http.Client httpClient;
  final GwCreds Function() creds;
  final String baseUrl;
  final DateTime Function() _now;
  final String Function() _txId;
  final void Function()? onUnauthorized;
  static const sessionTtl = Duration(minutes: 10);
  GwSession? _session;
  DateTime? _sessionAt;

  Map<String, String> _signed(String path, String contentType) {
    final c = creds();
    final tid = _txId();
    final ts = (_now().millisecondsSinceEpoch ~/ 1000).toString();
    return {
      'Authorization': 'Bearer ${c.authToken}',
      'timestamp': ts,
      'transaction-id': tid,
      'wehago-sign': wehagoSign(authToken: c.authToken, transactionId: tid, timestamp: ts, path: path, signKey: c.signKey),
      'Content-Type': contentType,
      'Accept': 'application/json',
    };
  }

  Future<dynamic> _post(String path, String contentType, String body) async {
    http.Response res;
    try {
      res = await httpClient.post(Uri.parse('$baseUrl$path'), headers: _signed(path, contentType), body: body).timeout(const Duration(seconds: 15));
    } catch (e) {
      // 원인 종류만 싣는다(토큰이 섞일 수 있는 원문은 넣지 않음)
      throw GwException(0, -1, '그룹웨어에 연결할 수 없습니다 (${e.runtimeType})');
    }
    return _decode(res);
  }

  dynamic _decode(http.Response res) {
    Map<String, dynamic> v = const {};
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      if (j is Map<String, dynamic>) v = j;
    } catch (_) {}
    final code = asInt(v['resultCode'], -1);
    final msg = asStr(v['resultMsg']);
    if (res.statusCode == 401) {
      onUnauthorized?.call();
      throw GwUnauthorized(code);
    }
    if (res.statusCode < 200 || res.statusCode >= 300) throw GwException(res.statusCode, code, msg.isEmpty ? '요청에 실패했습니다 (HTTP ${res.statusCode})' : msg);
    if (code != 0 && code != 200) throw GwException(res.statusCode, code, msg.isEmpty ? '요청에 실패했습니다 (resultCode $code)' : msg);
    return v['resultData'];
  }

  /// multipart/form-data POST(메일 발송 mail014A04·임시저장 A14). 서명 헤더는 같고, Content-Type(경계 포함)은 http가 채운다.
  Future<dynamic> callMultipart(String path, Map<String, String> fields) async {
    final req = http.MultipartRequest('POST', Uri.parse('$baseUrl$path'))..fields.addAll(fields);
    req.headers.addAll(_signed(path, 'multipart/form-data')..remove('Content-Type'));
    http.Response res;
    try {
      res = await httpClient.send(req).then(http.Response.fromStream).timeout(const Duration(seconds: 30));
    } catch (e) {
      throw GwException(0, -1, '그룹웨어에 연결할 수 없습니다 (${e.runtimeType})');
    }
    return _decode(res);
  }

  /// 파일을 실은 multipart POST(메일 첨부 업로드 mail014A06 — 파트 이름 `file[]`, application/octet-stream).
  Future<dynamic> callMultipartFiles(String path, List<http.MultipartFile> files, [Map<String, String> fields = const {}]) async {
    final req = http.MultipartRequest('POST', Uri.parse('$baseUrl$path'))
      ..fields.addAll(fields)
      ..files.addAll(files);
    req.headers.addAll(_signed(path, 'multipart/form-data')..remove('Content-Type'));
    return _decode(await _send(() => httpClient.send(req).then(http.Response.fromStream), const Duration(seconds: 75))); // 워커 제한(90초)보다 짧게
  }

  /// 바이너리 받기 — form POST(ecm001A03 첨부). 실패 응답(JSON 봉투)은 그 메시지로 던진다.
  Future<List<int>> formBytes(String path, Map<String, String> params) async => (await formFile(path, params)).$1;

  /// formBytes + 서버 파일명(Content-Disposition `filename*=UTF-8''…` 우선, 없으면 `filename="…"`, 둘 다 없으면 '').
  Future<(List<int>, String)> formFile(String path, Map<String, String> params) async {
    final body = params.entries.map((e) => '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}').join('&');
    final res = await _send(() => httpClient.post(Uri.parse('$baseUrl$path'), headers: _signed(path, 'application/x-www-form-urlencoded')..['Accept'] = '*/*', body: body));
    return (_bytes(res), dispositionName(res.headers['content-disposition'] ?? ''));
  }

  /// 바이너리 받기 — 서명 GET(본문 삽입 이미지). pathAndQuery는 '/'로 시작하는 같은 호스트 경로.
  Future<List<int>> getBytes(String pathAndQuery) async {
    final uri = Uri.parse('$baseUrl$pathAndQuery');
    final headers = _signed(uri.path, '')
      ..remove('Content-Type')
      ..['Accept'] = '*/*';
    return _bytes(await _send(() => httpClient.get(uri, headers: headers)));
  }

  /// 서명 GET 텍스트(SSE `text/event-stream` — eap107A25). 응답에 charset이 없어 바이트를 UTF-8로 푼다. 401은 만료로 던진다.
  Future<String> getText(String pathAndQuery, {String accept = 'text/event-stream'}) async {
    final uri = Uri.parse('$baseUrl$pathAndQuery');
    final headers = _signed(uri.path, '')
      ..remove('Content-Type')
      ..['Accept'] = accept;
    final res = await _send(() => httpClient.get(uri, headers: headers), const Duration(seconds: 15));
    if (res.statusCode == 401) _decode(res);
    if (res.statusCode < 200 || res.statusCode >= 300) throw GwException(res.statusCode, -1, '요청에 실패했습니다 (HTTP ${res.statusCode})');
    return utf8.decode(res.bodyBytes, allowMalformed: true);
  }

  Future<http.Response> _send(Future<http.Response> Function() f, [Duration timeout = const Duration(seconds: 60)]) async {
    try {
      return await f().timeout(timeout);
    } catch (e) {
      throw GwException(0, -1, '그룹웨어에 연결할 수 없습니다 (${e.runtimeType})');
    }
  }

  List<int> _bytes(http.Response res) {
    if (res.statusCode == 401 || (res.headers['content-type'] ?? '').contains('json')) {
      _decode(res); // 401·오류 봉투는 여기서 던진다
      throw GwException(res.statusCode, 0, '파일 대신 다른 응답을 받았습니다');
    }
    if (res.statusCode < 200 || res.statusCode >= 300) throw GwException(res.statusCode, -1, '파일을 받지 못했습니다 (HTTP ${res.statusCode})');
    if ((res.headers['content-type'] ?? '').contains('text/html')) throw GwException(res.statusCode, -1, '파일 대신 웹 페이지를 받았습니다. 아마란스 로그인이 만료됐을 수 있습니다.');
    return res.bodyBytes;
  }

  /// JSON POST → resultData.
  Future<dynamic> call(String path, Object body) => _post(path, 'application/json', jsonEncode(body));

  /// x-www-form-urlencoded POST(gw050A02).
  Future<dynamic> callForm(String path, Map<String, String> params) =>
      _post(path, 'application/x-www-form-urlencoded', params.entries.map((e) => '${Uri.encodeQueryComponent(e.key)}=${Uri.encodeQueryComponent(e.value)}').join('&'));

  /// 세션 정보(10분 캐시). 연결 검증에도 쓴다.
  Future<GwSession> session() async {
    final cached = _session;
    if (cached != null && _sessionAt != null && _now().difference(_sessionAt!) < sessionTtl) return cached;
    final d = await callForm('/gw/gw050A02', {'a10Domain': baseUrl});
    final info = d is Map ? d['sessionInfo'] : null;
    final uc = info is Map ? info['ucUserInfo'] : null;
    if (uc is! Map) throw GwException(200, 0, '세션 정보를 받지 못했습니다');
    _session = GwSession.fromUcUserInfo(uc);
    _sessionAt = _now();
    return _session!;
  }

  /// 캘린더·자원 API 공통 companyInfo. groupSeq는 authToken, 나머지는 세션.
  Future<Map<String, String>> companyInfo() async {
    final s = await session();
    return {'compSeq': s.compSeq, 'groupSeq': creds().groupSeq, 'deptSeq': s.deptSeq, 'emailAddr': s.emailAddr, 'emailDomain': s.emailDomain};
  }
}

final gwHttpClientProvider = Provider<http.Client>((_) => http.Client());

/// 연결돼 있고 만료 표시가 없을 때만 클라이언트(만료 뒤엔 요청을 보내지 않는다). 401이면 gwProvider를 needsRelogin으로.
/// 노티파이어는 미리 잡아 둔다 — 첫 401로 상태가 바뀌면 이 Provider가 다시 빌드돼 옛 ref가 해제되는데,
/// 병렬로 날아간 다른 요청의 401이 그 ref로 read하면 Riverpod 예외가 GwUnauthorized를 가린다.
final gwClientProvider = Provider<GwClient?>((ref) {
  final st = ref.watch(gwProvider).value;
  final creds = st?.creds;
  if (creds == null || st!.needsRelogin) return null;
  final notifier = ref.read(gwProvider.notifier);
  return GwClient(httpClient: ref.watch(gwHttpClientProvider), creds: () => creds, onUnauthorized: notifier.markUnauthorized);
});
