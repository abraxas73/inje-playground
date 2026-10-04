import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../app/theme.dart';
import '../config.dart';
import 'release_check.dart';
import 'release_provider.dart';

/// 링크를 여는 함수(테스트 주입용). 기본은 외부 앱으로 — Android는 브라우저가 APK를 내려받고 알림에서 설치, iOS는 TestFlight.
typedef LaunchFn = Future<void> Function(Uri uri);
Future<void> _launchExternal(Uri uri) => launchUrl(uri, mode: LaunchMode.externalApplication);

/// 업데이트 버튼: 캐시된 링크가 아니라 **서버에서 새로 받은** 링크를 연다 — APK 서명 URL은 600초 만료라 아침에 본 배너를 점심에 누르면 죽은 링크다(리뷰 1).
/// 앱이 직접 설치하지는 않는다.
Future<void> openRelease(WidgetRef ref, LaunchFn launch) async {
  final r = await ref.refresh(releaseProvider.future);
  final u = r?.url;
  if (u == null) return;
  await launch(Uri.parse(u));
}

/// 홈 맨 위 "새 버전" 한 줄 카드. 서버 빌드가 앱 빌드보다 클 때만 보인다(개발 빌드 0은 안 보임).
class UpdateBanner extends ConsumerWidget {
  const UpdateBanner({super.key, this.appBuild = Config.appBuild, this.launch = _launchExternal});
  final int appBuild;
  final LaunchFn launch;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final r = ref.watch(releaseProvider).value;
    if (!hasUpdate(r, appBuild)) return const SizedBox.shrink();
    final hasLink = r!.url != null;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      decoration: BoxDecoration(color: Brand.blueTint, borderRadius: BorderRadius.circular(14)),
      child: Row(children: [
        const Icon(Icons.system_update_alt, size: 18, color: Brand.blue),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            hasLink ? '새 버전 ${r.version}이 있어요' : '새 버전 ${r.version}이 있어요 · 웹 /apps에서 받으세요',
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.navy),
          ),
        ),
        if (hasLink) TextButton(onPressed: () => openRelease(ref, launch), child: const Text('업데이트')),
      ]),
    );
  }
}

/// 더보기 "앱 버전" 줄의 trailing — 버전 글자, 새 버전이 있으면 업데이트 버튼(사용자 요청).
class VersionTrailing extends ConsumerWidget {
  const VersionTrailing({super.key, this.appVersion = Config.appVersion, this.appBuild = Config.appBuild, this.launch = _launchExternal});
  final String appVersion;
  final int appBuild;
  final LaunchFn launch;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final r = ref.watch(releaseProvider).value;
    final style = Theme.of(context).textTheme.bodySmall;
    final current = versionLabel(appVersion, appBuild);
    if (!hasUpdate(r, appBuild)) return Text(current, style: style);
    if (r!.url == null) return Text('$current · 새 버전 ${r.version}은 웹 /apps에서', style: style);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Text(current, style: style),
      const SizedBox(width: 4),
      TextButton(onPressed: () => openRelease(ref, launch), child: const Text('업데이트')),
    ]);
  }
}
