// 비서 음성 — 말하기(STT, speech_to_text)와 듣기(TTS, flutter_tts). 둘 다 기기 내장 엔진, 한국어.
// 위젯은 이 인터페이스만 쓴다(테스트는 Provider를 가짜로 갈아 끼운다). 인식·읽기 문장은 로그에 남기지 않는다.
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:speech_to_text/speech_to_text.dart';

abstract class VoiceInput {
  /// 듣기 시작. 권한 거부·인식기 없음이면 false. onResult(지금까지 문장, 끝났는지), onEnd는 결과 없이 끝나도(무음·오류·시간 초과) 불린다.
  Future<bool> start(
    void Function(String text, bool done) onResult,
    void Function() onEnd,
  );
  Future<void> stop();
}

/// 설치된 음성 중 가장 좋은 한국어 음성 — iOS quality premium > enhanced > default, Android very high > high > normal…
/// 같은 등급이면 오프라인(network_required 0) 우선. natural = 향상·프리미엄(iOS) 또는 high 이상(Android).
({Map<String, String> voice, bool natural})? pickKoreanVoice(Object? voices) {
  const rank = {
    'premium': 6,
    'very high': 6,
    'enhanced': 5,
    'high': 5,
    'default': 2,
    'normal': 2,
    'low': 1,
    'very low': 0,
  };
  if (voices is! List) return null;
  Map? best;
  var bestScore = -1;
  for (final v in voices) {
    if (v is! Map || !'${v['locale']}'.toLowerCase().startsWith('ko')) continue;
    final score =
        (rank['${v['quality']}'] ?? 1) * 2 +
        ('${v['network_required']}' == '1' ? 0 : 1);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  if (best == null) return null;
  return (
    voice: {
      for (final k in ['name', 'locale', 'identifier'])
        if (best[k] != null) k: '${best[k]}',
    },
    natural: (rank['${best['quality']}'] ?? 0) >= 5,
  );
}

abstract class Speaker {
  /// 마지막으로 읽을 때 기본(압축) 한국어 음성만 있었는지 — 고품질 음성 설치 안내용.
  bool get usingBasicVoice;

  /// 읽기 전에 음성을 고른다(usingBasicVoice가 이 뒤에 정해진다). speak도 안에서 부른다.
  Future<void> prepare();

  /// 읽기 — 다 읽으면 완료되는 Future(stop으로 멈추면 실제 플러그인은 완료하지 않을 수 있으니 기다림에 기대지 않는다).
  Future<void> speak(String text);
  Future<void> stop();
}

class DeviceVoiceInput implements VoiceInput {
  final _stt = SpeechToText();
  bool _ready = false;
  void Function()? _onEnd;

  @override
  Future<bool> start(
    void Function(String text, bool done) onResult,
    void Function() onEnd,
  ) async {
    _onEnd = onEnd;
    // 성공만 기억한다 — 권한을 거부했다가 설정에서 허용하고 돌아오면 다시 묻는다.
    if (!_ready) {
      _ready = await _stt.initialize(
        onError: (_) => _onEnd?.call(),
        onStatus: (s) {
          if (s == SpeechToText.doneStatus ||
              s == SpeechToText.notListeningStatus) {
            _onEnd?.call();
          }
        },
      );
    }
    if (!_ready) return false;
    try {
      await _stt.listen(
        onResult: (r) => onResult(r.recognizedWords, r.finalResult),
        listenOptions: SpeechListenOptions(
          localeId: 'ko_KR',
          partialResults: true,
          cancelOnError: true,
          pauseFor: const Duration(seconds: 3),
          listenFor: const Duration(seconds: 30),
        ),
      );
    } catch (_) {
      return false;
    }
    return true;
  }

  @override
  Future<void> stop() => _stt.stop();
}

class DeviceSpeaker implements Speaker {
  final _tts = FlutterTts();
  bool _ready = false;
  bool _natural = false;
  @override
  bool usingBasicVoice = false;

  /// 고품질 음성을 찾을 때까지 읽을 때마다 다시 고른다(사용자가 설정에서 내려받으면 앱 재시작 없이 바로 쓰도록).
  @override
  Future<void> prepare() async {
    if (!_ready) {
      await _tts.setLanguage('ko-KR');
      await _tts.awaitSpeakCompletion(true);
      _ready = true;
    }
    if (_natural) return;
    try {
      final p = pickKoreanVoice(await _tts.getVoices);
      if (p == null) return;
      await _tts.setVoice(p.voice);
      _natural = p.natural;
      usingBasicVoice = !p.natural;
    } catch (_) {}
  }

  @override
  Future<void> speak(String text) async {
    await prepare();
    if (defaultTargetPlatform == TargetPlatform.iOS) {
      // iOS 기본 세션(soloAmbient)은 무음 스위치를 따르고, 음성 인식은 끝날 때 그 카테고리로 되돌리고 세션을 끈다 —
      // 그러면 읽기는 진행되는데 소리가 안 난다(1.3.0 실기기). 사용자가 🔊를 누른 것이므로 매번 재생 카테고리로 켠 뒤 읽는다.
      await _tts.setIosAudioCategory(
        IosTextToSpeechAudioCategory.playback,
        [IosTextToSpeechAudioCategoryOptions.duckOthers],
        IosTextToSpeechAudioMode.spokenAudio,
      );
      await _tts.setSharedInstance(true);
    }
    await _tts.speak(text);
  }

  @override
  Future<void> stop() async => _tts.stop();
}

final voiceInputProvider = Provider<VoiceInput>((ref) => DeviceVoiceInput());
final speakerProvider = Provider<Speaker>((ref) => DeviceSpeaker());
