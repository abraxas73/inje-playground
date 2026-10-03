import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../config.dart';

abstract class TokenSource {
  Future<String?> accessToken();
  /// 세션 갱신 후 새 액세스 토큰(실패 시 null)
  Future<String?> refreshToken();
  /// 갱신해도 401 → 호출자가 로그아웃 처리
  Future<void> onUnauthorized();
}

class ApiException implements Exception {
  ApiException(this.status, this.message);
  final int status;
  final String message;
  @override
  String toString() => message;
}

/// 모든 네이티브 API 호출의 단일 경로. Bearer·User-Agent 부착, 401이면 갱신 후 1회 재시도, 오류는 {error} 메시지로 통일.
class ApiClient {
  ApiClient({required this.httpClient, required this.tokens, required this.baseUrl, required this.userAgent});
  final http.Client httpClient;
  final TokenSource tokens;
  final String baseUrl;
  final String userAgent;

  Future<dynamic> getJson(String path, {Map<String, String>? query}) => _send('GET', path, query: query);
  Future<dynamic> postJson(String path, [Object? body]) => _send('POST', path, body: body);
  Future<dynamic> patchJson(String path, Object body) => _send('PATCH', path, body: body);
  Future<dynamic> deleteJson(String path, {Map<String, String>? query, Object? body}) => _send('DELETE', path, query: query, body: body);

  Future<dynamic> _send(String method, String path, {Map<String, String>? query, Object? body}) async {
    var token = await tokens.accessToken();
    var res = await _request(method, path, token, query, body);
    if (res.statusCode == 401) {
      token = await tokens.refreshToken();
      res = await _request(method, path, token, query, body);
      if (res.statusCode == 401) {
        await tokens.onUnauthorized();
        throw ApiException(401, _errorMessage(res));
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) throw ApiException(res.statusCode, _errorMessage(res));
    if (res.statusCode == 204 || res.bodyBytes.isEmpty) return null;
    return jsonDecode(utf8.decode(res.bodyBytes));
  }

  Future<http.Response> _request(String method, String path, String? token, Map<String, String>? query, Object? body) {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final headers = {'User-Agent': userAgent, 'Accept': 'application/json', if (token != null) 'Authorization': 'Bearer $token', if (body != null) 'Content-Type': 'application/json'};
    final req = http.Request(method, uri)..headers.addAll(headers);
    if (body != null) req.body = jsonEncode(body);
    return httpClient.send(req).then(http.Response.fromStream);
  }

  String _errorMessage(http.Response res) {
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      if (j is Map && j['error'] is String) return j['error'] as String;
    } catch (_) {}
    return '요청에 실패했습니다 (HTTP ${res.statusCode})';
  }
}

class SupabaseTokenSource implements TokenSource {
  SupabaseTokenSource(this._auth, this._onUnauthorized);
  final GoTrueClient _auth;
  final Future<void> Function() _onUnauthorized;
  @override
  Future<String?> accessToken() async => _auth.currentSession?.accessToken;
  @override
  Future<String?> refreshToken() async {
    try { return (await _auth.refreshSession()).session?.accessToken; } catch (_) { return null; }
  }
  @override
  Future<void> onUnauthorized() => _onUnauthorized();
}

final apiClientProvider = Provider<ApiClient>((ref) {
  final auth = Supabase.instance.client.auth;
  return ApiClient(
    httpClient: http.Client(),
    tokens: SupabaseTokenSource(auth, () => auth.signOut()),
    baseUrl: Config.apiBase,
    userAgent: Config.userAgent(defaultTargetPlatform.name),
  );
});
