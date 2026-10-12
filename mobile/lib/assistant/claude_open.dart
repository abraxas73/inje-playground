// mobile/lib/assistant/claude_open.dart
import 'dart:io';
import 'package:url_launcher/url_launcher.dart';

/// 설치된 Claude 데스크톱 앱을 앞으로 가져온다(gw/messenger_open.dart와 같은 방식). 없으면 내려받기 페이지를 브라우저로 연다.
/// macOS: `open -b com.anthropic.claudefordesktop`(번들 ID·`claude://` 스킴은 설치된 Claude.app의 Info.plist에서 확인, 2026-10-13).
/// Windows: 설치 경로 `%LOCALAPPDATA%\AnthropicClaude\claude.exe`, 없으면 `claude://` 스킴(Microsoft Store 설치판 — 등록돼 있을 때만).
const claudeBundleId = 'com.anthropic.claudefordesktop';
const claudeScheme = 'claude://';
const claudeDownloadUrl = 'https://claude.ai/download';

Future<bool> openClaude() async {
  try {
    if (Platform.isMacOS) {
      final r = await Process.run('open', ['-b', claudeBundleId]);
      if (r.exitCode == 0) return true;
    } else if (Platform.isWindows) {
      final exe = findWindowsClaude();
      if (exe != null) {
        await Process.start(exe, const [], mode: ProcessStartMode.detached);
        return true;
      }
      final uri = Uri.parse(claudeScheme);
      if (await canLaunchUrl(uri) && await launchUrl(uri)) return true;
    }
  } catch (_) {
    // 앱이 없거나 실행 실패 — 아래 내려받기 페이지로
  }
  try {
    return await launchUrl(Uri.parse(claudeDownloadUrl), mode: LaunchMode.externalApplication);
  } catch (_) {
    return false;
  }
}

/// Windows 설치 경로의 claude.exe. 없으면 null. 테스트는 env·exists를 주입한다.
String? findWindowsClaude({Map<String, String>? env, bool Function(String path)? exists}) {
  final local = (env ?? Platform.environment)['LOCALAPPDATA'];
  if (local == null) return null;
  final path = '$local\\AnthropicClaude\\claude.exe';
  return (exists ?? (p) => File(p).existsSync())(path) ? path : null;
}
