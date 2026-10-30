import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../auth/session.dart';
import '../config.dart';
import 'release_check.dart';
import '../app/platform.dart';

enum DesktopUpdatePhase {
  idle,
  checking,
  available,
  installing,
  current,
  error,
}

class DesktopUpdateState {
  const DesktopUpdateState(
    this.phase, {
    this.release,
    this.message = '',
    this.progress,
    this.visible = false,
  });
  final DesktopUpdatePhase phase;
  final DesktopReleaseInfo? release;
  final String message;
  final double? progress;
  final bool visible;
}

/// Credentials only cross the native channel for the current authorized job.
/// They are never retained in state, logs, URLs or preferences.
class DesktopUpdater extends ChangeNotifier {
  DesktopUpdater({
    required this.platform,
    required this.currentVersion,
    required this.account,
    required this.loadRelease,
    required this.refreshToken,
    this.reportFailure,
    this._channel = const MethodChannel('com.innogrid.playground/updater'),
  }) {
    _channel.setMethodCallHandler(_onNativeCall);
  }
  final String platform, currentVersion;
  final String? Function() account;
  final Future<DesktopReleaseInfo?> Function() loadRelease;
  final Future<String?> Function() refreshToken;
  /// 네이티브가 알려 준 설치 실패 단계·OS 오류 코드를 서버 감사 로그로(실패해도 무시). 토큰·경로는 넣지 않는다.
  final Future<void> Function(Map<String, Object> failure)? reportFailure;
  final MethodChannel _channel;
  final String _instance = DateTime.now().microsecondsSinceEpoch.toString();
  DesktopUpdateState _state = const DesktopUpdateState(DesktopUpdatePhase.idle);
  DesktopUpdateState get state => _state;
  int _epoch = 0;
  String? _activeSession, _activeAccount, _observedAccount;
  bool _disposed = false, _cancelFailed = false;
  Future<void> _pendingCancel = Future.value();
  bool _current(int epoch, String id) =>
      !_disposed && _epoch == epoch && account() == id;
  void _set(DesktopUpdateState value) {
    if (!_disposed) {
      _state = value;
      notifyListeners();
    }
  }

  /// Called by the session provider, not route widgets: exactly one startup
  /// check after restoration, plus a fresh check when a different user signs in.
  Future<void> sessionChanged() async {
    final id = account();
    if (id == _observedAccount) return;
    _observedAccount = id;
    await cancelForSignOut();
    if (!_disposed && id != null && account() == id) await check(manual: false);
  }

  Future<void> check({required bool manual}) async {
    if (_disposed ||
        state.phase == DesktopUpdatePhase.installing ||
        state.phase == DesktopUpdatePhase.checking) {
      return;
    }
    final id = account();
    if (id == null) {
      _set(
        DesktopUpdateState(
          DesktopUpdatePhase.error,
          message: '로그인 후 업데이트를 확인해 주세요.',
          visible: manual,
        ),
      );
      return;
    }
    final epoch = ++_epoch;
    _set(
      DesktopUpdateState(
        DesktopUpdatePhase.checking,
        message: '업데이트 확인 중…',
        visible: manual,
      ),
    );
    try {
      final release = await loadRelease().timeout(const Duration(seconds: 30));
      if (!_current(epoch, id)) return;
      if (release == null) throw StateError('Missing release');
      if (!hasDesktopUpdate(release, currentVersion)) {
        _set(
          DesktopUpdateState(
            DesktopUpdatePhase.current,
            message: '최신 버전($currentVersion)을 사용하고 있습니다.',
            visible: manual,
          ),
        );
      } else if (release.update?.isValid != true) {
        _set(
          DesktopUpdateState(
            DesktopUpdatePhase.error,
            message: '자동 업데이트용 서명이 준비되지 않았습니다. 잠시 후 다시 확인해 주세요.',
            visible: manual,
          ),
        );
      } else {
        _set(
          DesktopUpdateState(
            DesktopUpdatePhase.available,
            release: release,
            visible: true,
          ),
        );
      }
    } catch (_) {
      if (_current(epoch, id)) {
        _set(
          DesktopUpdateState(
            DesktopUpdatePhase.error,
            message: '업데이트 확인에 실패했습니다. 다시 시도해 주세요.',
            visible: manual,
          ),
        );
      }
    }
  }

  Future<void> start() async {
    if (_disposed || state.phase != DesktopUpdatePhase.available) return;
    final id = account();
    if (id == null) {
      await cancelForSignOut();
      return;
    }
    final epoch = ++_epoch;
    final releaseAtClick = state.release;
    _set(
      DesktopUpdateState(
        DesktopUpdatePhase.installing,
        release: releaseAtClick,
        message: '업데이트 준비 중…',
        visible: true,
      ),
    );
    try {
      await _pendingCancel;
      if (!_current(epoch, id)) return;
      if (_cancelFailed) throw StateError('Restart required');
      final token = await refreshToken().timeout(const Duration(seconds: 30));
      if (!_current(epoch, id)) return;
      if (token == null || token.isEmpty) throw StateError('Login required');
      final release = await loadRelease().timeout(const Duration(seconds: 30));
      if (!_current(epoch, id)) return;
      if (release == null ||
          release.update?.isValid != true ||
          !hasDesktopUpdate(release, currentVersion)) {
        throw StateError('Unavailable update');
      }
      if (platform != 'macos' && platform != 'windows') {
        throw StateError('Unsupported platform');
      }
      _activeSession = '$_instance-$epoch';
      _activeAccount = id;
      _set(
        DesktopUpdateState(
          DesktopUpdatePhase.installing,
          release: release,
          message: '업데이트 다운로드 중…',
          visible: true,
        ),
      );
      // Build this from a fixed origin, never from a server-supplied download URL.
      final feed = Uri.https(
        'innocrew.innogrid.com',
        '/api/desktop/update/appcast',
        {'platform': platform, 'version': release.version},
      );
      await _channel.invokeMethod<void>('install', {
        'feedUrl': feed.toString(),
        'accessToken': token,
        'expectedVersion': release.version,
        'edSignature': release.update!.edSignature,
        'sessionId': _activeSession,
      });
    } catch (_) {
      if (_current(epoch, id)) {
        // Cancel native work even if install failed after it started downloading.
        await _cancelNative();
        if (_current(epoch, id)) {
          _set(
            DesktopUpdateState(
              DesktopUpdatePhase.error,
              message: _cancelFailed
                  ? '이전 업데이트를 안전하게 정리하지 못했습니다. 앱을 완전히 종료한 후 다시 실행해 주세요.'
                  : '업데이트를 시작하지 못했습니다. 로그인 상태를 확인하고 다시 시도해 주세요.',
              visible: true,
            ),
          );
        }
      }
    }
  }

  Future<void> _cancelNative() {
    final active = _activeSession;
    _activeSession = null;
    _activeAccount = null;
    if (active == null) return _pendingCancel;
    _pendingCancel = _pendingCancel.then((_) async {
      try {
        await _channel
            .invokeMethod<void>('cancel', {'sessionId': active})
            .timeout(const Duration(seconds: 10));
      } catch (_) {
        _cancelFailed = true;
      }
    });
    return _pendingCancel;
  }

  Future<void> cancelForSignOut() {
    ++_epoch;
    _set(const DesktopUpdateState(DesktopUpdatePhase.idle));
    return _cancelNative();
  }

  Future<void> _onNativeCall(MethodCall call) async {
    if (_disposed) return;
    if (call.method == 'checkForUpdates') {
      await check(manual: true);
      return;
    }
    final args = call.arguments;
    if (call.method != 'status' ||
        args is! Map ||
        _activeSession == null ||
        args['sessionId'] != _activeSession ||
        args['version'] != state.release?.version ||
        state.phase != DesktopUpdatePhase.installing) {
      return;
    }
    // A session transition must cancel, even before the provider listener runs.
    if (account() != _activeAccount) {
      await cancelForSignOut();
      return;
    }
    final phase = args['phase'];
    if (phase == 'error' || phase == 'cancelled') {
      final epoch = _epoch;
      final id = _activeAccount!;
      final failure = phase == 'error' ? nativeFailure(args) : null;
      if (failure != null && reportFailure != null) {
        unawaited(reportFailure!({'platform': platform, 'version': state.release?.version ?? '', ...failure}).catchError((_) {}));
      }
      await _cancelNative();
      if (_current(epoch, id)) {
        _set(
          DesktopUpdateState(
            DesktopUpdatePhase.error,
            message: _cancelFailed
                ? '이전 업데이트를 안전하게 정리하지 못했습니다. 앱을 완전히 종료한 후 다시 실행해 주세요.'
                : '업데이트에 실패했습니다. 다시 확인해 주세요.${failure == null ? '' : ' (오류 코드 ${failure['reason']}-${failure['winError']})'}',
            visible: true,
          ),
        );
      }
    } else if (phase == 'downloading' ||
        phase == 'verifying' ||
        phase == 'installing') {
      final raw = args['progress'];
      final progress = raw is num && raw.isFinite
          ? raw.toDouble().clamp(0.0, 1.0)
          : null;
      _set(
        DesktopUpdateState(
          DesktopUpdatePhase.installing,
          release: state.release,
          progress: progress,
          message: phase == 'installing'
              ? '설치 후 자동으로 다시 시작합니다…'
              : phase == 'verifying'
              ? '설치 파일 검증 중…'
              : '업데이트 다운로드 중…',
          visible: true,
        ),
      );
    }
  }

  void dismiss() {
    if (state.phase != DesktopUpdatePhase.installing) {
      _set(const DesktopUpdateState(DesktopUpdatePhase.idle));
    }
  }

  @override
  void dispose() {
    _disposed = true;
    ++_epoch;
    unawaited(_cancelNative());
    _channel.setMethodCallHandler(null);
    super.dispose();
  }
}

/// Windows 설치 단계 실패(desktop_updater.cpp PostFailure) — 정해진 단계 이름과 정수만 받는다(그 밖의 값은 버림).
const nativeFailureReasons = {'file', 'arguments', 'name', 'version', 'session', 'launch'};
Map<String, Object>? nativeFailure(Map args) {
  final reason = args['reason'], code = args['winError'], attempts = args['attempts'];
  if (reason is! String || !nativeFailureReasons.contains(reason) || code is! int || code < 0 || code > 0xFFFFFFFF || attempts is! int || attempts < 1 || attempts > 10) return null;
  return {'reason': reason, 'winError': code, 'attempts': attempts};
}

final desktopUpdaterProvider = Provider<DesktopUpdater?>((ref) {
  // Sparkle·WinSparkle 기반이라 macOS·Windows만 — Linux는 자동 업데이트가 없다
  if (!isDesktopPlatform || defaultTargetPlatform == TargetPlatform.linux) {
    return null;
  }
  final platform = defaultTargetPlatform == TargetPlatform.macOS
      ? 'macos'
      : 'windows';
  String? account() {
    final session = ref.read(sessionProvider).asData?.value;
    if (session == null || session.isGuest) return null;
    return ref.read(authClientProvider).currentSession?.user.id;
  }

  final updater = DesktopUpdater(
    platform: platform,
    currentVersion: Config.appVersion,
    account: account,
    loadRelease: () async => parseDesktopRelease(
      await ref
          .read(apiClientProvider)
          .getJson(
            '/api/desktop/release',
            query: {'platform': platform, 'mode': 'automatic'},
          ),
    ),
    refreshToken: () => ref.read(apiClientProvider).tokens.refreshToken(),
    reportFailure: (f) async => ref.read(apiClientProvider).postJson('/api/desktop/update-failure', f),
  );
  ref.listen(sessionProvider, (_, _) {
    unawaited(updater.sessionChanged());
  });
  // Do not mutate provider state during its first build.
  scheduleMicrotask(() {
    if (ref.mounted) unawaited(updater.sessionChanged());
  });
  ref.onDispose(updater.dispose);
  return updater;
});
