import 'package:flutter_inappwebview_platform_interface/flutter_inappwebview_platform_interface.dart';

Future<void> setWindowsUserAgent(
  PlatformInAppWebViewController controller,
  String value,
) async {
  // Windows 0.6.0 replaces its entire native settings object on setSettings.
  // Sending only the UA silently disables navigation interception, bypassing
  // the app's Microsoft-connect and web-session recovery routes.
  final settings =
      await controller.getSettings() ??
      InAppWebViewSettings(javaScriptEnabled: true);
  settings.userAgent = value;
  settings.useShouldOverrideUrlLoading = true;
  await controller.setSettings(settings: settings);
}
