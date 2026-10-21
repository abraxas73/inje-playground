import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import 'messenger_client.dart';

/// 메신저 공통 오류 표시. 자격증명 자체가 없으면 연결 안내, 그 외엔 실제 코드·메시지 + 다시 시도.
class MessengerError extends StatelessWidget {
  const MessengerError({super.key, required this.error, required this.onRetry});
  final Object error;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) {
    final noCreds = error is MessengerAuthException && (error as MessengerAuthException).noCreds;
    final detail = switch (error) {
      MessengerAuthException a => '메신저 로그인 거부 (코드 ${a.resultCode})\n${a.message}',
      MessengerException m => '메신저 오류 (코드 ${m.resultCode})\n${m.message}',
      _ => '$error',
    };
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(28),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          TintIcon(noCreds ? Icons.apartment_outlined : Icons.error_outline, size: 56),
          const SizedBox(height: 16),
          Text(noCreds ? '아마란스를 연결하면 메신저를 씁니다' : '불러오지 못했습니다', style: Theme.of(context).textTheme.titleMedium, textAlign: TextAlign.center),
          const SizedBox(height: 6),
          Text(noCreds ? '자동 로그인에 저장된 아이디·비밀번호로 메신저에 로그인합니다. 토큰은 이 기기에만 저장됩니다.' : detail, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Brand.muted), textAlign: TextAlign.center),
          const SizedBox(height: 20),
          if (noCreds)
            FilledButton.icon(onPressed: () => context.push('/gw/connect'), icon: const Icon(Icons.login, size: 18), label: const Text('아마란스 연결하기'))
          else
            OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh, size: 18), label: const Text('다시 시도')),
        ]),
      ),
    );
  }
}
