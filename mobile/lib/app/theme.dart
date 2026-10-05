import 'package:flutter/material.dart';

/// 디자인 시안(Claude Design 캔버스 "이노그리드 앱 디자인" · 스타일 가이드 보드)의 토큰.
/// 웹 CI 블루(#0441FF)는 그대로, 앱다운 대비를 위해 딥 네이비 바탕을 더했다.
abstract final class Brand {
  static const navy = Color(0xFF0B1A3A); // 로그인 바탕·제목·강조 버튼
  static const botViolet = Color(
    0xFF6268FF,
  ); // 이노봇 버튼 바탕(SECloudit BI "iT" 바탕색)
  static const blue = Color(0xFF0441FF); // 주 버튼·선택 상태·링크
  static const blueTint = Color(0xFFE8EEFF); // 선택 탭·아이콘 배경
  static const sky = Color(0xFF68CAFF); // 어두운 바탕 위 포인트
  static const ground = Color(0xFFF4F6FB); // 화면 바탕
  static const line = Color(0xFFE3E8F2); // 테두리·구분선
  static const hairline = Color(0xFFF0F3F8); // 목록 구분선
  static const fill = Color(0xFFE6EBF4); // 세그먼트 바탕·비활성
  static const muted = Color(0xFF5B6578); // 보조 글자
  static const faint = Color(0xFF9AA3B2); // 비활성 글자·아이콘
  static const danger = Color(0xFFDC2626);
  static const dangerText = Color(0xFFB91C1C);
  static const success = Color(0xFF0E9F6E);
  static const cardBadgeBg = Color(0xFFFFF4D6); // 법카
  static const cardBadgeFg = Color(0xFF8A5A00);

  /// 이름 머리글자 배경(6색 순환).
  static const tints = [
    Color(0xFFE8EEFF),
    Color(0xFFDDF4EA),
    Color(0xFFFFE8D6),
    Color(0xFFFDE2E2),
    Color(0xFFFFF3C4),
    Color(0xFFE2F5D8),
  ];
  static Color tintFor(String key) => tints[key.hashCode.abs() % tints.length];
}

/// [fontFamily]는 테스트에서 한글 글꼴을 심을 때만 쓴다 — 앱은 OS 기본 고딕.
ThemeData appTheme({String? fontFamily}) {
  const scheme = ColorScheme(
    brightness: Brightness.light,
    primary: Brand.blue,
    onPrimary: Colors.white,
    primaryContainer: Brand.blueTint,
    onPrimaryContainer: Brand.blue,
    secondary: Brand.navy,
    onSecondary: Colors.white,
    secondaryContainer: Brand.fill,
    onSecondaryContainer: Brand.navy,
    tertiary: Brand.sky,
    onTertiary: Brand.navy,
    error: Brand.danger,
    onError: Colors.white,
    surface: Colors.white,
    onSurface: Brand.navy,
    onSurfaceVariant: Brand.muted,
    outline: Brand.line,
    outlineVariant: Brand.hairline,
    surfaceContainerLowest: Colors.white,
    surfaceContainerLow: Color(0xFFF8FAFD),
    surfaceContainer: Brand.ground,
    surfaceContainerHigh: Color(0xFFEDF1F7),
    surfaceContainerHighest: Brand.fill,
    inverseSurface: Brand.navy,
    onInverseSurface: Colors.white,
    inversePrimary: Brand.sky,
    shadow: Brand.navy,
    scrim: Brand.navy,
  );
  const text = TextTheme(
    headlineMedium: TextStyle(
      fontSize: 34,
      fontWeight: FontWeight.w800,
      letterSpacing: -0.5,
      height: 1.22,
      color: Brand.navy,
    ),
    headlineSmall: TextStyle(
      fontSize: 26,
      fontWeight: FontWeight.w800,
      letterSpacing: -0.4,
      height: 1.2,
      color: Brand.navy,
    ),
    titleLarge: TextStyle(
      fontSize: 20,
      fontWeight: FontWeight.w800,
      letterSpacing: -0.3,
      color: Brand.navy,
    ),
    titleMedium: TextStyle(
      fontSize: 15,
      fontWeight: FontWeight.w700,
      color: Brand.navy,
    ),
    titleSmall: TextStyle(
      fontSize: 13,
      fontWeight: FontWeight.w700,
      color: Brand.muted,
      letterSpacing: 0.3,
    ),
    bodyLarge: TextStyle(fontSize: 16, height: 1.5, color: Brand.navy),
    bodyMedium: TextStyle(fontSize: 15, height: 1.5, color: Brand.navy),
    bodySmall: TextStyle(fontSize: 13, height: 1.4, color: Brand.muted),
    labelLarge: TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
    labelMedium: TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
    labelSmall: TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
  );
  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: fontFamily,
    textTheme: text,
    scaffoldBackgroundColor: Brand.ground,
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: const AppBarTheme(
      backgroundColor: Brand.ground,
      foregroundColor: Brand.navy,
      elevation: 0,
      scrolledUnderElevation: 0,
      surfaceTintColor: Colors.transparent,
      centerTitle: false,
      titleTextStyle: TextStyle(
        fontSize: 20,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.3,
        color: Brand.navy,
      ),
    ),
    navigationBarTheme: NavigationBarThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      height: 68,
      indicatorColor: Brand.blueTint,
      indicatorShape: const StadiumBorder(),
      labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
      iconTheme: WidgetStateProperty.resolveWith(
        (s) => IconThemeData(
          size: 22,
          color: s.contains(WidgetState.selected) ? Brand.blue : Brand.muted,
        ),
      ),
      labelTextStyle: WidgetStateProperty.resolveWith(
        (s) => TextStyle(
          fontSize: 11,
          fontWeight: s.contains(WidgetState.selected)
              ? FontWeight.w700
              : FontWeight.w600,
          color: s.contains(WidgetState.selected) ? Brand.blue : Brand.muted,
        ),
      ),
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, 48),
        padding: const EdgeInsets.symmetric(horizontal: 20),
        shape: const StadiumBorder(),
        textStyle: text.labelLarge,
        elevation: 0,
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, 48),
        padding: const EdgeInsets.symmetric(horizontal: 18),
        shape: const StadiumBorder(),
        side: const BorderSide(color: Brand.line),
        foregroundColor: Brand.navy,
        backgroundColor: Colors.white,
        textStyle: text.labelLarge,
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        foregroundColor: Brand.blue,
        textStyle: const TextStyle(fontSize: 14, fontWeight: FontWeight.w600),
        shape: const StadiumBorder(),
      ),
    ),
    iconButtonTheme: IconButtonThemeData(
      style: IconButton.styleFrom(foregroundColor: Brand.muted),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: Colors.white,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: const TextStyle(fontSize: 15, color: Brand.faint),
      prefixIconColor: Brand.muted,
      suffixIconColor: Brand.muted,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Brand.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Brand.line),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Brand.blue, width: 1.5),
      ),
      errorBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: const BorderSide(color: Brand.danger),
      ),
    ),
    cardTheme: CardThemeData(
      color: Colors.white,
      elevation: 0,
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Colors.white,
      selectedColor: Brand.blue,
      disabledColor: Brand.fill,
      showCheckmark: false,
      shape: const StadiumBorder(),
      side: WidgetStateBorderSide.resolveWith(
        (s) => BorderSide(
          color: s.contains(WidgetState.selected) ? Brand.blue : Brand.line,
        ),
      ),
      // WidgetStateTextStyle은 Chip이 copyWith로 복사하며 값이 사라져 글자가 안 보인다 — 색만 WidgetStateColor로 상태 분기(2026-10-03 시뮬레이터 재현)
      labelStyle: TextStyle(
        fontSize: 14,
        fontWeight: FontWeight.w600,
        color: WidgetStateColor.resolveWith(
          (s) => s.contains(WidgetState.selected) ? Colors.white : Brand.navy,
        ),
      ),
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      deleteIconColor: Brand.faint,
      iconTheme: const IconThemeData(size: 16, color: Brand.muted),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? Colors.white : Brand.fill,
        ),
        foregroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? Brand.navy : Brand.muted,
        ),
        textStyle: WidgetStateProperty.resolveWith(
          (s) => TextStyle(
            fontSize: 13,
            fontWeight: s.contains(WidgetState.selected)
                ? FontWeight.w700
                : FontWeight.w600,
          ),
        ),
        side: const WidgetStatePropertyAll(BorderSide(color: Brand.fill)),
        shape: const WidgetStatePropertyAll(StadiumBorder()),
        padding: const WidgetStatePropertyAll(
          EdgeInsets.symmetric(horizontal: 14),
        ),
        visualDensity: VisualDensity.compact,
      ),
    ),
    switchTheme: SwitchThemeData(
      trackOutlineColor: const WidgetStatePropertyAll(Colors.transparent),
      trackColor: WidgetStateProperty.resolveWith(
        (s) => s.contains(WidgetState.selected)
            ? Brand.blue
            : const Color(0xFFCBD3E1),
      ),
      thumbColor: const WidgetStatePropertyAll(Colors.white),
    ),
    dividerTheme: const DividerThemeData(
      color: Brand.hairline,
      thickness: 1,
      space: 1,
    ),
    listTileTheme: const ListTileThemeData(
      iconColor: Brand.muted,
      titleTextStyle: TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: Brand.navy,
      ),
      subtitleTextStyle: TextStyle(fontSize: 13, color: Brand.muted),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: Brand.navy,
      contentTextStyle: const TextStyle(fontSize: 14, color: Colors.white),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    bottomSheetTheme: const BottomSheetThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Colors.white,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    progressIndicatorTheme: const ProgressIndicatorThemeData(
      color: Brand.blue,
      linearTrackColor: Brand.blueTint,
    ),
    iconTheme: const IconThemeData(color: Brand.navy),
    dropdownMenuTheme: const DropdownMenuThemeData(
      textStyle: TextStyle(fontSize: 14, color: Brand.navy),
    ),
  );
}
