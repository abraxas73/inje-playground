import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/release/release_provider.dart';

void main() {
  for (final platform in [TargetPlatform.macOS, TargetPlatform.windows, TargetPlatform.linux]) {
    test('$platform does not request mobile release or show TestFlight update', () async {
      debugDefaultTargetPlatformOverride = platform;
      final container = ProviderContainer();
      addTearDown(() {
        container.dispose();
        debugDefaultTargetPlatformOverride = null;
      });
      expect(await container.read(releaseProvider.future), isNull);
    });
  }
}
