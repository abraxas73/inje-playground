import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../gw/gw_api.dart';
import '../web/app_actions.dart';
import 'org_directory.dart';

/// 사람 사진 — 사내 명부의 아마란스 사진(없거나 못 받으면 이름 첫 글자). 명부에 있는 사람은 누르면 상세 시트.
class PersonAvatar extends ConsumerWidget {
  const PersonAvatar({super.key, required this.empSeq, required this.name, this.size = 40});
  final String empSeq, name;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final p = ref.watch(orgPersonBySeqProvider).asData?.value[empSeq];
    final avatar = PersonPhoto(name: name, url: p?.photo ?? '', size: size);
    if (p == null) return avatar;
    return Semantics(
      button: true,
      label: '$name 상세 보기',
      child: InkWell(customBorder: const CircleBorder(), onTap: () => showPersonSheet(context, p), child: avatar),
    );
  }
}

/// 아마란스 사진은 로그인 쿠키가 있어야 받힌다(없으면 401 — 2026-11-04 실측, 원본 메신저도 BIZCUBE 쿠키를 붙인다).
/// 아마란스를 연결하지 않았으면 null — 사진 대신 첫 글자. 재로그인으로 바뀐 토큰을 쓰도록 그릴 때마다 지금 값을 읽는다.
final gwPhotoHeadersProvider = Provider<Map<String, String>? Function()>((ref) {
  final api = ref.watch(gwApiProvider);
  return () {
    final c = api?.client.creds();
    if (c == null || c.authToken.isEmpty) return null;
    return {'Cookie': 'BIZCUBE_AT=${c.authToken}; BIZCUBE_HK=${c.signKey}; BIZCUBE_TYPE=PC;'};
  };
});

/// 원형 사진(주소가 비었거나·아마란스 미연결·못 받으면 이름 첫 글자).
class PersonPhoto extends ConsumerWidget {
  const PersonPhoto({super.key, required this.name, required this.url, this.size = 40});
  final String name, url;
  final double size;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final badge = InitialBadge(name, size: size, circle: true);
    final headers = ref.watch(gwPhotoHeadersProvider)();
    if (url.isEmpty || headers == null) return badge;
    final px = (size * MediaQuery.devicePixelRatioOf(context)).round();
    return ClipOval(child: Image.network(url, headers: headers, width: size, height: size, fit: BoxFit.cover, cacheWidth: px, errorBuilder: (_, _, _) => badge));
  }
}

/// 직원 상세 — 큰 사진·직책·소속·이메일, 메신저 대화·메일 쓰기(웹 조직도와 같은 앱 동작).
Future<void> showPersonSheet(BuildContext context, OrgPerson p) => showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      isScrollControlled: true, // 내용 높이만큼(낮은 데스크톱 창은 안에서 스크롤)
      builder: (sheet) => Consumer(builder: (sheet, ref, _) {
        Future<void> act(Map<String, String> q) async {
          Navigator.of(sheet).pop();
          await handleAppAction(context, ref, Uri(path: '/app-action', queryParameters: q));
        }
        final role = [p.duty, p.position].where((s) => s.isNotEmpty).join(' · ');
        return SafeArea(
          child: SingleChildScrollView(
            child: Padding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 20),
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              PersonPhoto(name: p.name, url: p.photoLarge.isNotEmpty ? p.photoLarge : p.photo, size: 128),
              const SizedBox(height: 12),
              Text(p.name, style: TextStyle(fontSize: 20, fontWeight: FontWeight.w800, color: Brand.navy)),
              if (role.isNotEmpty) Text(role, style: TextStyle(color: Brand.muted)),
              const SizedBox(height: 12),
              if (p.dept.isNotEmpty) ListTile(dense: true, leading: const Icon(Icons.apartment_outlined), title: Text(p.dept)),
              if (p.email.isNotEmpty)
                ListTile(
                  dense: true,
                  leading: const Icon(Icons.mail_outline),
                  title: Text(p.email),
                  trailing: IconButton(
                    tooltip: '이메일 복사',
                    icon: const Icon(Icons.copy, size: 18),
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: p.email));
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('이메일을 복사했습니다.')));
                    },
                  ),
                ),
              const SizedBox(height: 8),
              Wrap(spacing: 8, alignment: WrapAlignment.center, children: [
                if (p.empSeq.isNotEmpty)
                  FilledButton.icon(onPressed: () => act({'kind': 'messenger', 'emp': p.empSeq, 'names': p.name}), icon: const Icon(Icons.chat_bubble_outline, size: 18), label: const Text('메신저 대화')),
                if (p.email.isNotEmpty)
                  OutlinedButton.icon(onPressed: () => act({'kind': 'mail', 'to': p.email}), icon: const Icon(Icons.edit_outlined, size: 18), label: const Text('메일 쓰기')),
              ]),
            ]),
          )),
        );
      }),
    );
