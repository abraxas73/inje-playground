import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:playground/api/client.dart';
import 'package:playground/release/release_provider.dart';

class _Tokens implements TokenSource {
  @override
  Future<String?> accessToken() async => 'token';
  @override
  Future<String?> refreshToken() async => 'token';
  @override
  Future<void> onUnauthorized() async {}
}

void main() {
  for (final platform in [
    TargetPlatform.macOS,
    TargetPlatform.windows,
    TargetPlatform.linux,
  ]) {
    test(
      '$platform does not request mobile release or show TestFlight update',
      () async {
        debugDefaultTargetPlatformOverride = platform;
        final container = ProviderContainer();
        addTearDown(() {
          container.dispose();
          debugDefaultTargetPlatformOverride = null;
        });
        expect(await container.read(releaseProvider.future), isNull);
      },
    );
  }

  for (final (platform, platformName) in [
    (TargetPlatform.macOS, 'macos'),
    (TargetPlatform.windows, 'windows'),
  ]) {
    test('$platform requests its published desktop installer', () async {
      debugDefaultTargetPlatformOverride = platform;
      Uri? seen;
      final api = ApiClient(
        httpClient: MockClient((request) async {
          seen = request.url;
          return http.Response(
            '{"version":"1.7.3","url":"https://storage.test/setup"}',
            200,
          );
        }),
        tokens: _Tokens(),
        baseUrl: 'https://app.test',
        userAgent: 'test',
      );
      final container = ProviderContainer(
        overrides: [apiClientProvider.overrideWithValue(api)],
      );
      addTearDown(() {
        container.dispose();
        debugDefaultTargetPlatformOverride = null;
      });

      final release = await container.read(desktopReleaseProvider.future);
      expect(release?.version, '1.7.3');
      expect(seen?.path, '/api/desktop/release');
      expect(seen?.queryParameters, {'platform': platformName});
    });
  }

  test(
    'mobile and unsupported desktop platforms do not request desktop release',
    () async {
      for (final platform in [
        TargetPlatform.android,
        TargetPlatform.iOS,
        TargetPlatform.linux,
      ]) {
        debugDefaultTargetPlatformOverride = platform;
        var calls = 0;
        final api = ApiClient(
          httpClient: MockClient((_) async {
            calls++;
            return http.Response('{}', 200);
          }),
          tokens: _Tokens(),
          baseUrl: 'https://app.test',
          userAgent: 'test',
        );
        final container = ProviderContainer(
          overrides: [apiClientProvider.overrideWithValue(api)],
        );
        expect(await container.read(desktopReleaseProvider.future), isNull);
        expect(calls, 0, reason: platform.name);
        container.dispose();
      }
      debugDefaultTargetPlatformOverride = null;
    },
  );
}
