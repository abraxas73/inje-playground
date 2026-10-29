import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/release/desktop_updater.dart';
import 'package:playground/release/release_check.dart';

const updateChannel = MethodChannel('com.innogrid.playground/updater');
const signedRelease = DesktopReleaseInfo(
  version: '1.7.8',
  url:
      'https://innocrew.innogrid.com/api/desktop/update/artifact/windows/1.7.8',
  update: DesktopUpdateMetadata(
    build: 59,
    edSignature:
        'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ==',
    minimumOS: '10.0.17763',
  ),
);

Future<void> nativeStatus(Map<String, Object?> status) async {
  final done = Completer<void>();
  TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
      .handlePlatformMessage(
        updateChannel.name,
        const StandardMethodCodec().encodeMethodCall(
          MethodCall('status', status),
        ),
        (_) => done.complete(),
      );
  await done.future;
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  late DesktopUpdater updater;
  late List<MethodCall> calls;
  String? account;
  var loads = 0;
  Future<DesktopReleaseInfo?> Function()? load;
  Future<String?> Function()? refresh;
  setUp(() {
    calls = [];
    account = 'account-a';
    loads = 0;
    load = null;
    refresh = null;
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(updateChannel, (call) async {
          calls.add(call);
          return null;
        });
    updater = DesktopUpdater(
      platform: 'windows',
      currentVersion: '1.7.7',
      account: () => account,
      loadRelease: () {
        loads++;
        return load?.call() ?? Future.value(signedRelease);
      },
      refreshToken: () =>
          refresh?.call() ?? Future.value('secret-access-token'),
      channel: updateChannel,
    );
  });
  tearDown(() async {
    await updater.cancelForSignOut();
    updater.dispose();
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
        .setMockMethodCallHandler(updateChannel, null);
  });
  test(
    'check offers version, one start refreshes metadata/token and invokes install exactly once',
    () async {
      await updater.check(manual: false);
      expect(updater.state.phase, DesktopUpdatePhase.available);
      await Future.wait([updater.start(), updater.start()]);
      expect(loads, 2);
      final installs = calls.where((c) => c.method == 'install').toList();
      expect(installs, hasLength(1));
      expect(
        installs.single.arguments,
        containsPair(
          'feedUrl',
          'https://innocrew.innogrid.com/api/desktop/update/appcast?platform=windows&version=1.7.8',
        ),
      );
      expect(
        installs.single.arguments,
        containsPair('accessToken', 'secret-access-token'),
      );
      expect(
        installs.single.arguments,
        containsPair('expectedVersion', '1.7.8'),
      );
      expect(
        installs.single.arguments,
        containsPair('edSignature', signedRelease.update!.edSignature),
      );
      expect(updater.state.toString(), isNot(contains('secret-access-token')));
    },
  );
  test(
    'menu callback performs manual check and current versions are visible',
    () async {
      load = () async => const DesktopReleaseInfo(
        version: '1.7.7',
        url: 'https://innocrew.innogrid.com/apps',
      );
      final done = Completer<void>();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .handlePlatformMessage(
            updateChannel.name,
            const StandardMethodCodec().encodeMethodCall(
              const MethodCall('checkForUpdates'),
            ),
            (_) => done.complete(),
          );
      await done.future;
      expect(updater.state.phase, DesktopUpdatePhase.current);
      expect(updater.state.visible, isTrue);
      expect(updater.state.message, '최신 버전(1.7.7)을 사용하고 있습니다.');
    },
  );
  test(
    'unsigned release cannot install and errors do not expose transport secrets',
    () async {
      load = () async => const DesktopReleaseInfo(
        version: '1.7.8',
        url: 'https://storage.test/private',
      );
      await updater.check(manual: true);
      await updater.start();
      expect(calls.where((c) => c.method == 'install'), isEmpty);
      expect(updater.state.phase, DesktopUpdatePhase.error);
      load = () async => throw Exception('Bearer secret-access-token');
      await updater.check(manual: true);
      expect(updater.state.message, isNot(contains('secret-access-token')));
    },
  );
  test(
    'manual logged-out check explains login, and expired refresh does not install',
    () async {
      account = null;
      await updater.check(manual: true);
      expect(updater.state.message, contains('로그인'));
      expect(loads, 0);
      account = 'account-a';
      await updater.check(manual: false);
      refresh = () async => null;
      await updater.start();
      expect(calls.where((c) => c.method == 'install'), isEmpty);
    },
  );
  test(
    'logout while preparing prevents install even when the async result arrives later',
    () async {
      await updater.check(manual: false);
      final token = Completer<String?>();
      refresh = () => token.future;
      final installing = updater.start();
      account = null;
      await updater.cancelForSignOut();
      token.complete('old-account-token');
      await installing;
      expect(calls.where((c) => c.method == 'install'), isEmpty);
      expect(updater.state.phase, DesktopUpdatePhase.idle);
    },
  );
  test(
    'progress is session-bound; canceled/old callbacks cannot change a new job',
    () async {
      await updater.check(manual: false);
      await updater.start();
      final first = Map<String, dynamic>.from(
        calls.firstWhere((c) => c.method == 'install').arguments,
      );
      await nativeStatus({
        'phase': 'downloading',
        'version': '1.7.8',
        'sessionId': first['sessionId'],
        'progress': 0.42,
      });
      expect(updater.state.progress, 0.42);
      await updater.cancelForSignOut();
      await updater.check(manual: false);
      await updater.start();
      await nativeStatus({
        'phase': 'error',
        'version': '1.7.8',
        'sessionId': first['sessionId'],
        'code': 'secret-access-token',
      });
      expect(updater.state.phase, DesktopUpdatePhase.installing);
      final last = Map<String, dynamic>.from(
        calls.lastWhere((c) => c.method == 'install').arguments,
      );
      await nativeStatus({
        'phase': 'error',
        'version': '1.7.8',
        'sessionId': last['sessionId'],
        'code': 'secret-access-token',
      });
      expect(updater.state.phase, DesktopUpdatePhase.error);
      expect(updater.state.message, isNot(contains('secret-access-token')));
    },
  );
  test('nativeFailure keeps only known step names and integer codes', () {
    expect(nativeFailure({'reason': 'launch', 'winError': 32, 'attempts': 3}), {'reason': 'launch', 'winError': 32, 'attempts': 3});
    expect(nativeFailure({'reason': 'secret-access-token', 'winError': 32, 'attempts': 1}), isNull);
    expect(nativeFailure({'reason': 'launch', 'winError': 'x', 'attempts': 1}), isNull);
    expect(nativeFailure({'code': 'secret-access-token'}), isNull);
  });
  test('installer failure is reported and shown with its code', () async {
    final reports = <Map<String, Object>>[];
    final reporting = DesktopUpdater(
      platform: 'windows',
      currentVersion: '1.7.7',
      account: () => account,
      loadRelease: () => Future.value(signedRelease),
      refreshToken: () => Future.value('token'),
      reportFailure: (f) async => reports.add(f),
    );
    addTearDown(reporting.dispose);
    await reporting.check(manual: false);
    await reporting.start();
    final install = Map<String, dynamic>.from(calls.lastWhere((c) => c.method == 'install').arguments);
    await nativeStatus({'phase': 'error', 'version': '1.7.8', 'sessionId': install['sessionId'], 'reason': 'launch', 'winError': 32, 'attempts': 3});
    expect(reporting.state.phase, DesktopUpdatePhase.error);
    expect(reporting.state.message, contains('오류 코드 launch-32'));
    expect(reports, [{'platform': 'windows', 'version': '1.7.8', 'reason': 'launch', 'winError': 32, 'attempts': 3}]);
  });
  test('account switch during discovery discards the old response', () async {
    final pending = Completer<DesktopReleaseInfo?>();
    load = () => pending.future;
    final checking = updater.check(manual: false);
    account = 'account-b';
    pending.complete(signedRelease);
    await checking;
    expect(updater.state.phase, isNot(DesktopUpdatePhase.available));
    expect(calls.where((c) => c.method == 'install'), isEmpty);
  });
  test(
    'failed native cleanup requires process restart, never another install',
    () async {
      await updater.check(manual: false);
      await updater.start();
      TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger
          .setMockMethodCallHandler(updateChannel, (call) async {
            calls.add(call);
            if (call.method == 'cancel') {
              throw PlatformException(code: 'cleanup_failed');
            }
            return null;
          });
      await updater.cancelForSignOut();
      await updater.check(manual: true);
      await updater.start();
      expect(calls.where((c) => c.method == 'install'), hasLength(1));
      expect(updater.state.phase, DesktopUpdatePhase.error);
      expect(updater.state.message, contains('앱을 완전히 종료'));
    },
  );
  test(
    'native events from an account that just changed cannot advance installation',
    () async {
      await updater.check(manual: false);
      await updater.start();
      final install =
          calls.firstWhere((c) => c.method == 'install').arguments as Map;
      account = 'account-b';
      await nativeStatus({
        'phase': 'installing',
        'version': '1.7.8',
        'sessionId': install['sessionId'],
      });
      expect(updater.state.phase, DesktopUpdatePhase.idle);
      expect(calls.last.method, 'cancel');
    },
  );
  test(
    'session restoration checks once, subsequent route reads do not check again',
    () async {
      account = null;
      await updater.sessionChanged();
      expect(loads, 0);
      account = 'account-a';
      await updater.sessionChanged();
      await updater.sessionChanged();
      expect(loads, 1);
      account = null;
      await updater.sessionChanged();
      account = 'account-b';
      await updater.sessionChanged();
      expect(loads, 2);
    },
  );
}
