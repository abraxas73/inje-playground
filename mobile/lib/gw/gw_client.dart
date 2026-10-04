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
    } catch (_) {
      throw GwException(0, -1, '그룹웨어에 연결할 수 없습니다');
    }
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

/// 크레덴셜이 있을 때만 클라이언트. 401이면 gwProvider를 needsRelogin으로.
final gwClientProvider = Provider<GwClient?>((ref) {
  final creds = ref.watch(gwProvider).value?.creds;
  if (creds == null) return null;
  return GwClient(httpClient: ref.watch(gwHttpClientProvider), creds: () => creds, onUnauthorized: () => ref.read(gwProvider.notifier).markUnauthorized());
});
