import 'package:flutter/material.dart';

/// 디자인 시안(Claude Design 캔버스 "이노그리드 앱 디자인" · 스타일 가이드 보드)의 토큰.
/// 웹 CI 블루(#0441FF)는 그대로, 앱다운 대비를 위해 딥 네이비 바탕을 더했다.
///
/// 다크모드: 구조색(바탕·글자·선·면)은 밝기에 따라 바뀌는 getter, 브랜드 색(파랑·보라 등)은 고정.
/// 현재 밝기는 [Brand.brightness] — 테마를 만들 때(appTheme)와 MaterialApp builder에서 활성 밝기로 맞춘다.
/// getter는 const가 아니므로 `const TextStyle(color: Brand.navy)` 같은 const 사용처는 const를 떼야 한다.
abstract final class Brand {
  /// 지금 그릴 밝기. 기본 라이트 — 테스트·골든은 이 기본값으로 라이트를 그린다.
  static Brightness brightness = Brightness.light;
  static bool get _d => brightness == Brightness.dark;

  // 고정 브랜드 색(라이트·다크 공통) — const 유지라 const 사용처가 안 깨진다.
  static const botViolet = Color(0xFF6268FF); // 이노봇 버튼 바탕(SECloudit BI "iT" 바탕색)
  static const claudeInk = Color(0xFF1F1F1F); // Claude 열기 버튼 바탕
  static const blue = Color(0xFF0441FF); // 주 버튼·선택 상태·링크
  static const sky = Color(0xFF68CAFF); // 어두운 바탕 위 포인트
  static const danger = Color(0xFFDC2626);
  static const dangerText = Color(0xFFB91C1C);
  static const success = Color(0xFF0E9F6E);
  static const cardBadgeBg = Color(0xFFFFF4D6); // 법카
  static const cardBadgeFg = Color(0xFF8A5A00);

  // 밝기별 구조색 getter.
  static Color get navy => _d ? const Color(0xFFE9EDF5) : const Color(0xFF0B1A3A); // 제목·강조 글자·아이콘
  static Color get ground => _d ? const Color(0xFF0E1117) : const Color(0xFFF4F6FB); // 화면 바탕
  static Color get surface => _d ? const Color(0xFF1A1F27) : Colors.white; // 카드·시트·입력 바탕(라이트=흰색)
  static Color get line => _d ? const Color(0xFF2A313C) : const Color(0xFFE3E8F2); // 테두리·구분선
  static Color get hairline => _d ? const Color(0xFF222932) : const Color(0xFFF0F3F8); // 목록 구분선
  static Color get fill => _d ? const Color(0xFF262D38) : const Color(0xFFE6EBF4); // 세그먼트 바탕·비활성
  static Color get blueTint => _d ? const Color(0xFF1D2A48) : const Color(0xFFE8EEFF); // 선택 탭·아이콘 배경
  static Color get muted => _d ? const Color(0xFF9BA6B8) : const Color(0xFF5B6578); // 보조 글자
  static Color get faint => _d ? const Color(0xFF6C7585) : const Color(0xFF9AA3B2); // 비활성 글자·아이콘

  /// 눈에 띄는 어두운 면(스낵바 등) — 두 밝기 모두 어두운 바탕 + 흰 글자.
  static Color get inkSurface => _d ? const Color(0xFF2A313C) : const Color(0xFF0B1A3A);

  /// 짙은 장식 배경(히어로·프로필 머리·인용 카드·짙은 버튼) — 두 밝기 모두 짙고 흰 글자가 얹힌다.
  /// navy는 글자색이라 다크에서 밝게 뒤집히므로, "배경으로 쓰는 navy"는 이걸로 바꾼다.
  static Color get hero => _d ? const Color(0xFF172138) : const Color(0xFF0B1A3A);

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
/// [brightness]로 라이트·다크 두 테마를 만든다. 호출할 때 [Brand.brightness]를 그 밝기로 맞춰
/// 아래 토큰 getter들이 올바른 색을 돌려주게 한다.
ThemeData appTheme({String? fontFamily, Brightness brightness = Brightness.light}) {
  Brand.brightness = brightness;
  final dark = brightness == Brightness.dark;
  final onColored = Colors.white; // 파랑·네이비 등 색 바탕 위 글자(두 밝기 공통)
  final scheme = ColorScheme(
    brightness: brightness,
    primary: Brand.blue,
    onPrimary: onColored,
    primaryContainer: Brand.blueTint,
    onPrimaryContainer: dark ? Brand.navy : Brand.blue,
    secondary: Brand.navy,
    onSecondary: dark ? Brand.ground : onColored,
    secondaryContainer: Brand.fill,
    onSecondaryContainer: Brand.navy,
    tertiary: Brand.sky,
    onTertiary: const Color(0xFF0B1A3A),
    error: Brand.danger,
    onError: onColored,
    surface: Brand.surface,
    onSurface: Brand.navy,
    onSurfaceVariant: Brand.muted,
    outline: Brand.line,
    outlineVariant: Brand.hairline,
    surfaceContainerLowest: Brand.surface,
    surfaceContainerLow: dark ? const Color(0xFF151A21) : const Color(0xFFF8FAFD),
    surfaceContainer: Brand.ground,
    surfaceContainerHigh: dark ? const Color(0xFF20262F) : const Color(0xFFEDF1F7),
    surfaceContainerHighest: Brand.fill,
    inverseSurface: Brand.navy,
    onInverseSurface: Brand.surface,
    inversePrimary: Brand.sky,
    shadow: const Color(0xFF0B1A3A),
    scrim: const Color(0xFF0B1A3A),
  );
  final text = TextTheme(
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
    labelLarge: const TextStyle(fontSize: 15, fontWeight: FontWeight.w700),
    labelMedium: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600),
    labelSmall: const TextStyle(fontSize: 11, fontWeight: FontWeight.w700),
  );
  return ThemeData(
    useMaterial3: true,
    brightness: brightness,
    colorScheme: scheme,
    fontFamily: fontFamily,
    textTheme: text,
    scaffoldBackgroundColor: Brand.ground,
    splashFactory: InkSparkle.splashFactory,
    appBarTheme: AppBarTheme(
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
      backgroundColor: Brand.surface,
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
        side: BorderSide(color: Brand.line),
        foregroundColor: Brand.navy,
        backgroundColor: Brand.surface,
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
      fillColor: Brand.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      hintStyle: TextStyle(fontSize: 15, color: Brand.faint),
      prefixIconColor: Brand.muted,
      suffixIconColor: Brand.muted,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: Brand.line),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(14),
        borderSide: BorderSide(color: Brand.line),
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
      color: Brand.surface,
      elevation: 0,
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
    ),
    chipTheme: ChipThemeData(
      backgroundColor: Brand.surface,
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
      iconTheme: IconThemeData(size: 16, color: Brand.muted),
    ),
    segmentedButtonTheme: SegmentedButtonThemeData(
      style: ButtonStyle(
        backgroundColor: WidgetStateProperty.resolveWith(
          (s) => s.contains(WidgetState.selected) ? Brand.surface : Brand.fill,
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
        side: WidgetStatePropertyAll(BorderSide(color: Brand.fill)),
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
        (s) => s.contains(WidgetState.selected) ? Brand.blue : Brand.fill,
      ),
      thumbColor: WidgetStatePropertyAll(Brand.surface),
    ),
    dividerTheme: DividerThemeData(
      color: Brand.hairline,
      thickness: 1,
      space: 1,
    ),
    listTileTheme: ListTileThemeData(
      iconColor: Brand.muted,
      titleTextStyle: TextStyle(
        fontSize: 15,
        fontWeight: FontWeight.w600,
        color: Brand.navy,
      ),
      subtitleTextStyle: TextStyle(fontSize: 13, color: Brand.muted),
    ),
    snackBarTheme: SnackBarThemeData(
      backgroundColor: Brand.inkSurface,
      contentTextStyle: const TextStyle(fontSize: 14, color: Colors.white),
      behavior: SnackBarBehavior.floating,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
    ),
    bottomSheetTheme: BottomSheetThemeData(
      backgroundColor: Brand.surface,
      surfaceTintColor: Colors.transparent,
      showDragHandle: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
    ),
    dialogTheme: DialogThemeData(
      backgroundColor: Brand.surface,
      surfaceTintColor: Colors.transparent,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
    ),
    progressIndicatorTheme: ProgressIndicatorThemeData(
      color: Brand.blue,
      linearTrackColor: Brand.blueTint,
    ),
    iconTheme: IconThemeData(color: Brand.navy),
    dropdownMenuTheme: DropdownMenuThemeData(
      textStyle: TextStyle(fontSize: 14, color: Brand.navy),
    ),
  );
}
