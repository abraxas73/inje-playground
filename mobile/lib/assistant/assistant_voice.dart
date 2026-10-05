// 비서 음성 — 말하기(STT, speech_to_text)와 듣기(TTS, flutter_tts). 둘 다 기기 내장 엔진, 한국어.
// 위젯은 이 인터페이스만 쓴다(테스트는 Provider를 가짜로 갈아 끼운다). 인식·읽기 문장은 로그에 남기지 않는다.
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

abstract class Speaker {
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

  @override
  Future<void> speak(String text) async {
    if (!_ready) {
      await _tts.setLanguage('ko-KR');
      await _tts.awaitSpeakCompletion(true);
      _ready = true;
    }
    await _tts.speak(text);
  }

  @override
  Future<void> stop() async => _tts.stop();
}

final voiceInputProvider = Provider<VoiceInput>((ref) => DeviceVoiceInput());
final speakerProvider = Provider<Speaker>((ref) => DeviceSpeaker());
