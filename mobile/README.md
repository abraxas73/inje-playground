# 이노그리드 모바일 앱 (Flutter)

플레이그라운드(https://inje-playground.vercel.app)의 Android·iOS 클라이언트. 설계 `../docs/superpowers/specs/2026-10-03-mobile-app-design.md`, 런북 `../docs/mobile-app.md`.

- `flutter pub get && flutter run` · `flutter test` · `flutter analyze`
- 네이티브: 로그인·뭐 먹지·사다리·커피 타임·더보기. 그 외 기능은 WebView(`lib/web/`).
- API는 `lib/api/client.dart`(Bearer)만 통해서. 서버 주소 `--dart-define=API_BASE=`.
