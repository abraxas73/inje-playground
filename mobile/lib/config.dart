class Config {
  static const apiBase = String.fromEnvironment(
    'API_BASE',
    defaultValue: 'https://inje-playground.vercel.app',
  );
  static const supabaseUrl = 'https://avooqcxehfeurjhqqgui.supabase.co';

  /// 공개 anon 키(frontend NEXT_PUBLIC_SUPABASE_ANON_KEY와 같은 값). 빌드 시 --dart-define=SUPABASE_ANON_KEY= 로 덮어쓸 수 있다.
  static const supabaseAnonKey = String.fromEnvironment(
    'SUPABASE_ANON_KEY',
    defaultValue:
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF2b29xY3hlaGZldXJqaHFxZ3VpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI3NDMwMzksImV4cCI6MjA4ODMxOTAzOX0.8VsHteroY02N5x9STCDNTZVPReA1z2HAvUTehOkqwU8',
  );

  /// 릴리스 스크립트(mobile/scripts/release-mobile.sh)가 pubspec version에서 읽어 --dart-define으로 넘긴다. 없으면 개발 빌드(dev/0) — 업데이트 확인을 건너뛴다.
  static const appVersion = String.fromEnvironment(
    'APP_VERSION',
    defaultValue: 'dev',
  );
  static const appBuild = int.fromEnvironment('APP_BUILD', defaultValue: 0);
  static const loginRedirect = 'innogrid://login-callback';
  static String userAgent(String platform) =>
      'InnogridApp/$appVersion ($platform) InnogridBuild/$appBuild';
}
