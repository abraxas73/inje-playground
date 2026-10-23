// 플랫폼 판별 — UI·기능 분기는 여기만 쓴다. `defaultTargetPlatform` 기준이라 테스트에서
// `debugDefaultTargetPlatformOverride`로 바꿀 수 있다(테스트 기본은 android). `Platform.is*`(dart:io)는
// 테스트 호스트(macOS)를 보므로 실제 OS API(Process 실행·파일 경로·네이티브 채널·WebView 구현 선택)에만 쓴다.
import 'package:flutter/foundation.dart';

/// 데스크톱 앱(macOS·Windows).
bool get isDesktopPlatform => !kIsWeb && (defaultTargetPlatform == TargetPlatform.macOS || defaultTargetPlatform == TargetPlatform.windows);

/// 휴대폰 앱(iOS·Android).
bool get isMobilePlatform => !kIsWeb && (defaultTargetPlatform == TargetPlatform.iOS || defaultTargetPlatform == TargetPlatform.android);
