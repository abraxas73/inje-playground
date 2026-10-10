import 'dart:io';
import 'package:url_launcher/url_launcher.dart';

/// "알림을 누르면 메신저가 열린다"를 흉내 낸다 — 특정 대화방 딥링크는 없다(Mac 메신저 AmaranthMessenger는 URL 스킴 미등록,
/// 웹 알림의 메신저 팝업은 이 테넌트에서 빈 화면 — 2026-10-10 실측). 할 수 있는 만큼: 설치된 메신저 앱을 앞으로 가져오거나 아마란스 앱을 연다.
/// macOS: `open -b com.douzone.amaranth10beta`. Windows: 설치 폴더에서 AmaranthMessenger*.exe를 찾아 실행.
/// iOS·Android: 아마란스10 앱 스킴(웹 번들의 모바일 열기 코드와 같음). 전부 실패하면 그룹웨어 웹(알림센터).
const messengerBundleId = 'com.douzone.amaranth10beta';
const amaranthSchemeIos = 'Amaranth10://';
const amaranthSchemeAndroid = 'com.douzone.app.amaranth10://';
const gwWebUrl = 'https://gw.innogrid.com/#/';

Future<bool> openMessenger() async {
  try {
    if (Platform.isMacOS) {
      final r = await Process.run('open', ['-b', messengerBundleId]);
      if (r.exitCode == 0) return true;
    } else if (Platform.isWindows) {
      final exe = findWindowsMessenger();
      if (exe != null) {
        await Process.start(exe, const [], mode: ProcessStartMode.detached);
        return true;
      }
    } else if (Platform.isIOS || Platform.isAndroid) {
      if (await launchUrl(Uri.parse(Platform.isIOS ? amaranthSchemeIos : amaranthSchemeAndroid))) return true;
    }
  } catch (_) {
    // 앱이 없거나 실행 실패 — 아래 웹으로
  }
  try {
    return await launchUrl(Uri.parse(gwWebUrl), mode: LaunchMode.externalApplication);
  } catch (_) {
    return false;
  }
}

/// Windows 설치 폴더(사용자 Programs·Program Files)에서 메신저 실행 파일을 찾는다(깊이 2). 없으면 null.
String? findWindowsMessenger({Map<String, String>? env}) {
  final e = env ?? Platform.environment;
  final roots = [e['LOCALAPPDATA'] == null ? null : '${e['LOCALAPPDATA']}\\Programs', e['ProgramFiles'], e['ProgramFiles(x86)']].whereType<String>();
  for (final root in roots) {
    final dir = Directory(root);
    if (!dir.existsSync()) continue;
    for (final sub in dir.listSync().whereType<Directory>()) {
      if (!sub.path.split(Platform.pathSeparator).last.toLowerCase().contains('amaranth')) continue;
      for (final f in sub.listSync(recursive: true, followLinks: false).whereType<File>()) {
        final name = f.path.split(Platform.pathSeparator).last.toLowerCase();
        if (name.startsWith('amaranthmessenger') && name.endsWith('.exe')) return f.path;
      }
    }
  }
  return null;
}
