import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../auth/session.dart';
import 'calendar_bridge.dart';

/// Only consent/owner is persisted. HttpOnly cookies remain managed by WebView.
class DoorayCalendarConnection extends AsyncNotifier<String?> {
  @override
  Future<String?> build() async => (await SharedPreferences.getInstance())
      .getString('dooray.calendar.owner');
  Future<void> connect(String owner) async {
    await (await SharedPreferences.getInstance()).setString(
      'dooray.calendar.owner',
      owner,
    );
    state = AsyncData(owner);
  }

  Future<void> disconnect() async {
    await (await SharedPreferences.getInstance()).remove(
      'dooray.calendar.owner',
    );
    state = const AsyncData(null);
  }
}

final doorayCalendarConnectionProvider =
    AsyncNotifierProvider<DoorayCalendarConnection, String?>(
      DoorayCalendarConnection.new,
    );
final doorayCalendarOwnerProvider = Provider<String?>((ref) {
  final owner = ref.watch(doorayCalendarConnectionProvider).value;
  if (owner == null) return null;
  final session = ref.watch(sessionProvider).value;
  return session != null &&
          !session.isGuest &&
          (session.isAdmin || session.permissions['dooray'] != false) &&
          session.email == owner
      ? owner
      : null;
});

class DoorayCalendarTransport extends Notifier<DoorayCalendarClient?> {
  @override
  DoorayCalendarClient? build() => null;
  void attach(DoorayCalendarClient client) {
    state?.close();
    state = client;
  }

  void detach(DoorayCalendarClient client) {
    client.close();
    if (!ref.mounted) return;
    if (identical(state, client)) state = null;
  }

  void clear() {
    state?.close();
    state = null;
  }
}

final doorayCalendarTransportProvider =
    NotifierProvider<DoorayCalendarTransport, DoorayCalendarClient?>(
      DoorayCalendarTransport.new,
    );
