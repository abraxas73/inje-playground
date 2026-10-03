import 'package:flutter/material.dart';

/// 세션 확인 중 화면 — 탭 화면이 먼저 떠서 위치 권한·API 호출이 일어나지 않게 한다.
class SplashScreen extends StatelessWidget {
  const SplashScreen({super.key});
  @override
  Widget build(BuildContext context) => const Scaffold(body: Center(child: CircularProgressIndicator()));
}
