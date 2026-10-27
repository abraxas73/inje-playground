import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import '../auth/session.dart';
import '../config.dart';
import 'sse.dart';

abstract class TokenSource {
  Future<String?> accessToken();

  /// 세션 갱신 후 새 액세스 토큰(실패 시 null)
  Future<String?> refreshToken();

  /// 갱신해도 401 → 호출자가 로그아웃 처리
  Future<void> onUnauthorized();
}

class ApiException implements Exception {
  ApiException(this.status, this.message, {this.code});
  final int status;
  final String message;

  /// 서버가 준 기계용 구분값(예: assistant_disabled). 없으면 null.
  final String? code;
  @override
  String toString() => message;
}

/// 모든 네이티브 API 호출의 단일 경로. Bearer·User-Agent 부착, 401이면 갱신 후 1회 재시도, 오류는 {error} 메시지로 통일.
class ApiClient {
  ApiClient({
    required this.httpClient,
    required this.tokens,
    required this.baseUrl,
    required this.userAgent,
  });
  final http.Client httpClient;
  final TokenSource tokens;
  final String baseUrl;
  final String userAgent;

  Future<dynamic> getJson(String path, {Map<String, String>? query}) =>
      _send('GET', path, query: query);
  Future<dynamic> postJson(String path, [Object? body]) =>
      _send('POST', path, body: body);
  Future<dynamic> postJsonAbortable(
    String path,
    Object body,
    Future<void> abortTrigger,
  ) => _send('POST', path, body: body, abortTrigger: abortTrigger);

  /// SSE POST — 이벤트마다 onEvent. 스트림을 열기 전 거절(2xx 아님)은 ApiException, 401은 갱신 후 1회 재시도.
  Future<void> postSse(String path, Object body, void Function(Map<String, dynamic>) onEvent, {Future<void>? abortTrigger}) async {
    var token = await tokens.accessToken();
    var res = await _openStream(path, token, body, abortTrigger);
    if (res.statusCode == 401) {
      await res.stream.drain<void>();
      token = await tokens.refreshToken();
      res = await _openStream(path, token, body, abortTrigger);
      if (res.statusCode == 401) {
        final r = await http.Response.fromStream(res);
        await tokens.onUnauthorized();
        throw _apiError(r);
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) throw _apiError(await http.Response.fromStream(res));
    final dec = SseDecoder(onEvent);
    await for (final chunk in res.stream.transform(utf8.decoder)) {
      dec.add(chunk);
    }
  }

  Future<http.StreamedResponse> _openStream(String path, String? token, Object body, Future<void>? abortTrigger) {
    final req = http.AbortableRequest('POST', Uri.parse('$baseUrl$path'), abortTrigger: abortTrigger)
      ..headers.addAll({'User-Agent': userAgent, 'Accept': 'text/event-stream', 'Content-Type': 'application/json', if (token != null) 'Authorization': 'Bearer $token'})
      ..body = jsonEncode(body);
    return httpClient.send(req);
  }

  /// 파일 하나를 multipart(파트 이름 [field])로 POST — Bearer·401 갱신 1회 재시도·오류 문구는 JSON 호출과 같다.
  Future<dynamic> postFile(String path, String filename, List<int> bytes, {String field = 'file'}) async {
    Future<http.Response> go(String? token) {
      final req = http.MultipartRequest('POST', Uri.parse('$baseUrl$path'))
        ..headers.addAll({'User-Agent': userAgent, 'Accept': 'application/json', if (token != null) 'Authorization': 'Bearer $token'})
        ..files.add(http.MultipartFile.fromBytes(field, bytes, filename: filename));
      return httpClient.send(req).then(http.Response.fromStream);
    }

    var res = await go(await tokens.accessToken());
    if (res.statusCode == 401) {
      res = await go(await tokens.refreshToken());
      if (res.statusCode == 401) {
        await tokens.onUnauthorized();
        throw _apiError(res);
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) throw _apiError(res);
    return res.bodyBytes.isEmpty ? null : jsonDecode(utf8.decode(res.bodyBytes));
  }

  /// 바이트 GET(본문 그림 등, [path]에 쿼리 포함 가능) — Bearer·401 갱신 1회 재시도·오류 문구는 JSON 호출과 같다.
  Future<Uint8List> getBytes(String path) async {
    Future<http.Response> go(String? token) => httpClient.get(Uri.parse('$baseUrl$path'), headers: {'User-Agent': userAgent, if (token != null) 'Authorization': 'Bearer $token'});
    var res = await go(await tokens.accessToken());
    if (res.statusCode == 401) {
      res = await go(await tokens.refreshToken());
      if (res.statusCode == 401) {
        await tokens.onUnauthorized();
        throw _apiError(res);
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) throw _apiError(res);
    return res.bodyBytes;
  }

  Future<dynamic> putJson(String path, Object body) =>
      _send('PUT', path, body: body);
  Future<dynamic> patchJson(String path, Object body) =>
      _send('PATCH', path, body: body);
  Future<dynamic> deleteJson(
    String path, {
    Map<String, String>? query,
    Object? body,
  }) => _send('DELETE', path, query: query, body: body);

  Future<dynamic> _send(
    String method,
    String path, {
    Map<String, String>? query,
    Object? body,
    Future<void>? abortTrigger,
  }) async {
    var token = await tokens.accessToken();
    var res = await _request(method, path, token, query, body, abortTrigger);
    if (res.statusCode == 401) {
      token = await tokens.refreshToken();
      res = await _request(method, path, token, query, body, abortTrigger);
      if (res.statusCode == 401) {
        await tokens.onUnauthorized();
        throw _apiError(res);
      }
    }
    if (res.statusCode < 200 || res.statusCode >= 300) {
      throw _apiError(res);
    }
    if (res.statusCode == 204 || res.bodyBytes.isEmpty) return null;
    return jsonDecode(utf8.decode(res.bodyBytes));
  }

  Future<http.Response> _request(
    String method,
    String path,
    String? token,
    Map<String, String>? query,
    Object? body,
    Future<void>? abortTrigger,
  ) {
    final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query);
    final headers = {
      'User-Agent': userAgent,
      'Accept': 'application/json',
      if (token != null) 'Authorization': 'Bearer $token',
      if (body != null) 'Content-Type': 'application/json',
    };
    final req = http.AbortableRequest(method, uri, abortTrigger: abortTrigger)
      ..headers.addAll(headers);
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

  ApiException _apiError(http.Response res) {
    String? code;
    try {
      final j = jsonDecode(utf8.decode(res.bodyBytes));
      if (j is Map && j['code'] is String) code = j['code'] as String;
    } catch (_) {}
    return ApiException(res.statusCode, _errorMessage(res), code: code);
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
    try {
      return (await _auth.refreshSession()).session?.accessToken;
    } catch (_) {
      return null;
    }
  }

  @override
  Future<void> onUnauthorized() => _onUnauthorized();
}

final apiClientProvider = Provider<ApiClient>((ref) {
  final auth = Supabase.instance.client.auth;
  return ApiClient(
    httpClient: http.Client(),
    tokens: SupabaseTokenSource(
      auth,
      () => ref.read(sessionProvider.notifier).signOut(),
    ),
    baseUrl: Config.apiBase,
    userAgent: Config.userAgent(defaultTargetPlatform.name),
  );
});
