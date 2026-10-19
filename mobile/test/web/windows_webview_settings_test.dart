import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_inappwebview_platform_interface/flutter_inappwebview_platform_interface.dart';
import 'package:flutter_inappwebview_windows/flutter_inappwebview_windows.dart';
import 'package:playground/web/windows_webview_settings.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  const channel = MethodChannel('com.pichillilorenzo/flutter_inappwebview_177');
  final messenger =
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger;
  late WindowsInAppWebViewController controller;
  Map<String, dynamic>? current;
  Map<dynamic, dynamic>? sent;

  setUp(() {
    current = InAppWebViewSettings(
      javaScriptEnabled: true,
      useShouldOverrideUrlLoading: true,
      userAgent: 'old-agent',
      supportZoom: false,
      transparentBackground: true,
    ).toMap();
    sent = null;
    messenger.setMockMethodCallHandler(channel, (call) async {
      switch (call.method) {
        case 'getSettings':
          return current;
        case 'setSettings':
          sent = (call.arguments as Map)['settings'] as Map;
          return null;
        default:
          throw StateError('Unexpected native call: ${call.method}');
      }
    });
    controller = WindowsInAppWebViewController(
      const WindowsInAppWebViewControllerCreationParams(id: 177),
    );
  });

  tearDown(() {
    messenger.setMockMethodCallHandler(channel, null);
  });

  test(
    'UA update keeps URL interception and existing Windows settings',
    () async {
      await setWindowsUserAgent(controller, 'InnogridApp/test (windows)');

      expect(sent?['userAgent'], 'InnogridApp/test (windows)');
      expect(sent?['useShouldOverrideUrlLoading'], isTrue);
      expect(sent?['javaScriptEnabled'], isTrue);
      expect(sent?['supportZoom'], isFalse);
      expect(sent?['transparentBackground'], isTrue);
    },
  );

  test(
    'UA update restores interception if native settings disabled it',
    () async {
      current!['useShouldOverrideUrlLoading'] = false;

      await setWindowsUserAgent(controller, 'InnogridApp/test (windows)');

      expect(sent?['useShouldOverrideUrlLoading'], isTrue);
    },
  );

  test(
    'unavailable native settings keep essential bootstrap settings',
    () async {
      current = null;

      await setWindowsUserAgent(controller, 'InnogridApp/test (windows)');

      expect(sent?['userAgent'], 'InnogridApp/test (windows)');
      expect(sent?['useShouldOverrideUrlLoading'], isTrue);
      expect(sent?['javaScriptEnabled'], isTrue);
    },
  );
}
