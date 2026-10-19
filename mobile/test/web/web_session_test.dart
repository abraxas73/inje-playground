import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/config.dart';
import 'package:playground/web/web_session.dart';

class _Tokens implements TokenSource {
  @override
  Future<String?> accessToken() async => 'native-session';
  @override
  Future<String?> refreshToken() async => 'refreshed-session';
  @override
  Future<void> onUnauthorized() async {}
}

void main() {
  final origin = Uri.parse('https://inje-playground.vercel.app');
  test('기본 앱의 세션 발급과 SharePoint·MS 연결은 정식 도메인 안에서 처리', () async {
    final api = ApiClient(
      httpClient: MockClient((request) async {
        expect(
          request.url.toString(),
          'https://innocrew.innogrid.com/api/mobile/web-token',
        );
        return http.Response('{"tokenHash":"canonical-session"}', 200);
      }),
      tokens: _Tokens(),
      baseUrl: Config.apiBase,
      userAgent: 'InnogridApp/test (windows)',
    );
    final url = await initialWebSessionUrl(
      api,
      Config.apiBase,
      '/sharepoint',
      eagerBootstrap: true,
    );
    expect(Uri.parse(url).origin, 'https://innocrew.innogrid.com');
    expect(Uri.parse(url).queryParameters['next'], '/sharepoint');
    for (final path in ['/settings', '/sharepoint']) {
      expect(
        WebNavPolicy.decide(
          Uri.parse('https://innocrew.innogrid.com$path'),
          appOrigin: Uri.parse(Config.apiBase),
        ),
        NavAction.inApp,
      );
    }
    expect(
      WebNavPolicy.decide(
        Uri.parse('https://innocrew.innogrid.com/api/ms/connect'),
        appOrigin: Uri.parse(Config.apiBase),
      ),
      NavAction.oauthConnect,
    );
  });
  test(
    'browser session keeps local path but never bootstraps external origins',
    () {
      expect(
        browserSessionPath(
          origin.resolve('/rfp/123?tab=files#results'),
          appOrigin: origin,
        ),
        '/rfp/123?tab=files#results',
      );
      for (final target in [
        'https://other.test/rfp',
        'http://inje-playground.vercel.app/rfp',
        'https://inje-playground.vercel.app:444/rfp',
        'blob:https://inje-playground.vercel.app/id',
        'file:///tmp/private',
        'https://inje-playground.vercel.app/auth/mobile',
      ]) {
        expect(
          browserSessionPath(Uri.parse(target), appOrigin: origin),
          isNull,
        );
      }
      expect(
        WebNavPolicy.decide(
          origin.resolve('/api/rfp/projects/123/xlsx'),
          appOrigin: origin,
        ),
        NavAction.external,
      );
    },
  );
  test('Microsoft 연결은 동일 오리진에서만 앱 인증 흐름으로 시작한다', () async {
    expect(
      WebNavPolicy.decide(
        origin.resolve('/api/jira/connect'),
        appOrigin: origin,
      ),
      NavAction.oauthConnect,
    );
    expect(
      WebNavPolicy.decide(
        origin.resolve('/api/ms/connect?returnTo=%2Fsettings'),
        appOrigin: origin,
      ),
      NavAction.oauthConnect,
    );
    expect(
      WebNavPolicy.decide(
        origin.resolve('/api/ms/callback?code=x'),
        appOrigin: origin,
      ),
      NavAction.inApp,
    );
    for (final url in [
      'https://other.test/api/ms/connect',
      'http://inje-playground.vercel.app/api/ms/connect',
      'https://inje-playground.vercel.app:444/api/ms/connect',
    ]) {
      expect(
        WebNavPolicy.decide(Uri.parse(url), appOrigin: origin),
        NavAction.external,
      );
    }
    final next = Uri(
      path: '/api/ms/connect',
      query: 'returnTo=%2Fteams%2Fchat',
    ).toString();
    final bootstrap = Uri.parse(
      bootstrapUrl(
        apiBase: origin.toString(),
        nextPath: next,
        tokenHash: 'once',
      ),
    );
    expect(
      bootstrap.queryParameters['next'],
      '/api/ms/connect?returnTo=%2Fteams%2Fchat',
    );
    expect(bootstrap.fragment, 'token=once');

    http.Request? seen;
    final api = ApiClient(
      httpClient: MockClient((request) async {
        seen = request;
        return http.Response(
          '{"url":"https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=signed"}',
          200,
        );
      }),
      tokens: _Tokens(),
      baseUrl: origin.toString(),
      userAgent: 'InnogridApp/test (windows)',
    );
    final launch = await oauthLaunchUrl(
      api,
      origin.resolve('/api/ms/connect?returnTo=%2Fsharepoint'),
    );
    expect(
      launch,
      'https://login.microsoftonline.com/tenant/oauth2/v2.0/authorize?state=signed',
    );
    expect(seen?.method, 'POST');
    expect(seen?.url.path, '/api/mobile/ms-connect');
    expect(seen?.headers['authorization'], 'Bearer native-session');
    expect(seen?.body, '{"returnTo":"/sharepoint"}');
  });
  test('Microsoft 승인 URL은 공식 HTTPS 호스트만 외부 브라우저로 연다', () async {
    for (final unsafe in [
      'http://login.microsoftonline.com/x',
      'https://evil.test/x',
      'not-a-url',
    ]) {
      final api = ApiClient(
        httpClient: MockClient(
          (_) async => http.Response('{"url":"$unsafe"}', 200),
        ),
        tokens: _Tokens(),
        baseUrl: origin.toString(),
        userAgent: 'test',
      );
      await expectLater(
        oauthLaunchUrl(api, origin.resolve('/api/ms/connect')),
        throwsA(isA<FormatException>()),
      );
    }
  });
  test('같은 오리진 페이지는 앱 안, /login은 세션 부트스트랩 신호, 다른 도메인·파일은 외부', () {
    expect(
      WebNavPolicy.decide(
        Uri.parse('https://inje-playground.vercel.app/ppt/abc'),
        appOrigin: origin,
      ),
      NavAction.inApp,
    );
    expect(
      WebNavPolicy.decide(
        Uri.parse('https://inje-playground.vercel.app/login?next=/ppt'),
        appOrigin: origin,
      ),
      NavAction.loginRedirect,
    );
    expect(
      WebNavPolicy.decide(
        Uri.parse('https://place.map.kakao.com/123'),
        appOrigin: origin,
      ),
      NavAction.external,
    );
    expect(
      WebNavPolicy.decide(
        Uri.parse(
          'https://avooqcxehfeurjhqqgui.supabase.co/storage/v1/object/sign/ppt/x.pptx?token=1',
        ),
        appOrigin: origin,
      ),
      NavAction.external,
    );
    expect(
      WebNavPolicy.decide(
        Uri.parse(
          'https://inje-playground.vercel.app/api/ppt/decks/1/versions/1/file',
        ),
        appOrigin: origin,
      ),
      NavAction.external,
    );
    expect(
      WebNavPolicy.decide(Uri.parse('tel:021234567'), appOrigin: origin),
      NavAction.external,
    );
  });
  test('부트스트랩 URL은 next를 쿼리에, 토큰을 조각에 넣는다', () {
    expect(
      bootstrapUrl(
        apiBase: 'https://inje-playground.vercel.app',
        nextPath: '/admin/settings?tab=ppt',
        tokenHash: 'h1',
      ),
      'https://inje-playground.vercel.app/auth/mobile?next=%2Fadmin%2Fsettings%3Ftab%3Dppt#token=h1',
    );
  });
  test('Windows 첫 웹 화면은 로그인 리다이렉트를 기다리지 않고 네이티브 세션으로 먼저 부트스트랩한다', () async {
    http.Request? seen;
    final api = ApiClient(
      httpClient: MockClient((request) async {
        seen = request;
        return http.Response('{"tokenHash":"first-web-session"}', 200);
      }),
      tokens: _Tokens(),
      baseUrl: origin.toString(),
      userAgent: 'InnogridApp/1.7.6 (windows)',
    );

    final url = await initialWebSessionUrl(
      api,
      origin.toString(),
      '/sharepoint',
      eagerBootstrap: true,
    );

    expect(seen?.method, 'POST');
    expect(seen?.url.path, '/api/mobile/web-token');
    expect(
      url,
      'https://inje-playground.vercel.app/auth/mobile?next=%2Fsharepoint#token=first-web-session',
    );
  });
  test('다른 플랫폼의 첫 웹 화면은 기존처럼 대상 경로를 바로 연다', () async {
    var requests = 0;
    final api = ApiClient(
      httpClient: MockClient((_) async {
        requests++;
        return http.Response('{}', 500);
      }),
      tokens: _Tokens(),
      baseUrl: origin.toString(),
      userAgent: 'InnogridApp/1.7.6 (macos)',
    );

    final url = await initialWebSessionUrl(
      api,
      origin.toString(),
      '/settings',
      eagerBootstrap: false,
    );

    expect(requests, 0);
    expect(url, 'https://inje-playground.vercel.app/settings');
  });
  test('BootstrapGuard — /login으로 두 번째 튕기면 멈추고, 사용자가 다시 시도할 때만 초기화된다', () {
    final g = BootstrapGuard();
    expect(g.tryBegin(), true); // 첫 /login → 부트스트랩
    expect(g.tryBegin(), false); // 부트스트랩 뒤 또 /login → 오류 상태
    expect(g.tryBegin(), false);
    g.reset();
    expect(g.tryBegin(), true);
  });
  test(
    'isSessionBoundary — /login·/auth/mobile(우리 오리진)만 세션 시작점, 다른 페이지·다른 호스트는 아니다',
    () {
      expect(
        isSessionBoundary(
          'https://inje-playground.vercel.app/login',
          appOrigin: origin,
        ),
        true,
      );
      expect(
        isSessionBoundary(
          'https://inje-playground.vercel.app/login?next=%2Fsettings',
          appOrigin: origin,
        ),
        true,
      );
      expect(
        isSessionBoundary(
          'https://inje-playground.vercel.app/auth/mobile?next=%2Fsettings',
          appOrigin: origin,
        ),
        true,
      );
      expect(
        isSessionBoundary(
          'https://inje-playground.vercel.app/settings',
          appOrigin: origin,
        ),
        false,
      );
      expect(
        isSessionBoundary(
          'https://login.microsoftonline.com/x',
          appOrigin: origin,
        ),
        false,
      );
      expect(isSessionBoundary(null, appOrigin: origin), false);
    },
  );
  test(
    'BackTracker — 뒤로 가기 직후(3초 안) 첫 페이지 시작만 "뒤로 가는 중"으로 판정하고, 오래됐거나 이미 소비했으면 아니다',
    () {
      var t = DateTime(2026, 10, 5, 9);
      final b = BackTracker(now: () => t);
      expect(b.consume(), false); // 뒤로 간 적 없음
      b.begin();
      expect(b.consume(), true);
      expect(b.consume(), false); // 한 번만
      b.begin();
      t = t.add(const Duration(seconds: 4));
      expect(b.consume(), false); // 오래됨
    },
  );
  test(
    '취소된 내비게이션 오류(-999·Frame load interrupted 102·cancelled)는 오류로 보여 주지 않는다',
    () {
      expect(isIgnorableWebError(code: -999, description: 'cancelled'), true);
      expect(
        isIgnorableWebError(code: 102, description: 'Frame load interrupted'),
        true,
      );
      expect(
        isIgnorableWebError(
          code: -1,
          description: 'The operation was cancelled',
        ),
        true,
      );
      expect(
        isIgnorableWebError(
          code: -1009,
          description: 'The Internet connection appears to be offline.',
        ),
        false,
      );
      expect(
        isIgnorableWebError(
          code: -2,
          description: 'net::ERR_NAME_NOT_RESOLVED',
        ),
        false,
      );
    },
  );
  test('머리 제목: 페이지 제목을 사용하고 없으면 주소 대신 앱 이름', () {
    expect(webTitleFor(title: '설정', loading: true), '설정');
    expect(webTitleFor(title: '', loading: true), '로딩 중…');
    expect(webTitleFor(title: '', loading: false), '이노그리드');
  });
  test('Windows가 제목 대신 반환하는 URL과 빈 문서는 앱 이름으로 표시', () {
    for (final title in [
      'https://inje-playground.vercel.app/sharepoint',
      'https://inje-playground.vercel.app/auth/mobile?next=/sharepoint#token=once',
      'http://localhost:3000/settings',
      'about:blank',
      '/sharepoint',
      '   ',
    ]) {
      expect(webTitleFor(title: title, loading: false), '이노그리드', reason: title);
    }
    expect(webTitleFor(title: ' 이노그리드 ', loading: false), '이노그리드');
  });
}
