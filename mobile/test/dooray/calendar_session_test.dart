import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:playground/auth/session.dart';
import 'package:playground/dooray/calendar_session.dart';

class _Session extends SessionNotifier {
  _Session(this.session);
  final AppSession session;
  @override
  Future<AppSession?> build() async => session;
}

void main() {
  for (final entry in [
    (email: 'a@x', role: 'user', allowed: true, expected: 'a@x'),
    (email: 'b@x', role: 'user', allowed: true, expected: null),
    (email: 'a@x', role: 'guest', allowed: true, expected: null),
    (email: 'a@x', role: 'user', allowed: false, expected: null),
  ]) {
    test('owner and permission gate $entry', () async {
      SharedPreferences.setMockInitialValues({'dooray.calendar.owner': 'a@x'});
      final c = ProviderContainer(
        overrides: [
          sessionProvider.overrideWith(
            () => _Session(
              AppSession(
                email: entry.email,
                role: entry.role,
                permissions: {'dooray': entry.allowed},
              ),
            ),
          ),
        ],
      );
      addTearDown(c.dispose);
      await c.read(sessionProvider.future);
      await c.read(doorayCalendarConnectionProvider.future);
      expect(c.read(doorayCalendarOwnerProvider), entry.expected);
      await c.read(doorayCalendarConnectionProvider.notifier).disconnect();
      expect(c.read(doorayCalendarOwnerProvider), isNull);
      expect(
        (await SharedPreferences.getInstance()).containsKey(
          'dooray.calendar.owner',
        ),
        false,
      );
    });
  }
}
