import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'app/router.dart';
import 'app/theme.dart';
import 'auth/session.dart';
import 'config.dart';
import 'web/app_webview.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await AppWebController.initializeWindows();
  await Supabase.initialize(url: Config.supabaseUrl, publishableKey: Config.supabaseAnonKey);
  runApp(const ProviderScope(child: App()));
}

class App extends ConsumerStatefulWidget {
  const App({super.key});
  @override
  ConsumerState<App> createState() => _AppState();
}

class _AppState extends ConsumerState<App> {
  late final GoRouter _router = buildRouter(
    refresh: ref.read(sessionListenableProvider),
    redirect: (context, state) => redirectFor(ref.read(sessionProvider), state.matchedLocation),
  );
  @override
  Widget build(BuildContext context) => MaterialApp.router(title: '이노그리드', theme: appTheme(), routerConfig: _router);
}
