import 'package:flutter/material.dart';
import '../app/brand.dart';
import '../app/theme.dart';

/// 세션 확인 중 화면 — 탭 화면이 먼저 떠서 위치 권한·API 호출이 일어나지 않게 한다. 로그인 화면과 같은 네이비 바탕이라 전환이 끊기지 않는다.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(
        backgroundColor: Brand.navy,
        body: Stack(children: [
          Positioned.fill(child: GridBackdrop()),
          Center(
            child: Column(mainAxisSize: MainAxisSize.min, children: [
              BrandLogo(width: 148, white: true),
              SizedBox(height: 28),
              SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Brand.sky)),
            ]),
          ),
        ]),
      );
}
