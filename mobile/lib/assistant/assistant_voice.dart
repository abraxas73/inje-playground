// 비서 음성 — 말하기(STT, speech_to_text)와 듣기(TTS, flutter_tts). 둘 다 기기 내장 엔진, 한국어.
// 위젯은 이 인터페이스만 쓴다(테스트는 Provider를 가짜로 갈아 끼운다). 인식·읽기 문장은 로그에 남기지 않는다.
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_tts/flutter_tts.dart';
import 'package:speech_to_text/speech_to_text.dart';

abstract class VoiceInput {
  /// 듣기 시작. 권한 거부·인식기 없음이면 false. onResult(지금까지 문장, 끝났는지).
  Future<bool> start(void Function(String text, bool done) onResult);
  Future<void> stop();
}

abstract class Speaker {
  /// 읽기 — 끝나면(또는 stop) 완료되는 Future.
  Future<void> speak(String text);
  Future<void> stop();
}

class DeviceVoiceInput implements VoiceInput {
  final _stt = SpeechToText();
  bool? _ready;

  @override
  Future<bool> start(void Function(String text, bool done) onResult) async {
    _ready ??= await _stt.initialize(onError: (_) {});
    if (_ready != true) return false;
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
