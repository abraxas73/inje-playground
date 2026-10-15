import 'dart:convert';

/// `data: {...}\n\n` 블록을 이벤트(Map)로. 청크가 아무 데서나 잘려도 되고 CRLF도 받는다. 깨진 블록은 버린다.
class SseDecoder {
  SseDecoder(this.onEvent);
  final void Function(Map<String, dynamic>) onEvent;
  var _buf = '';

  void add(String chunk) {
    _buf = (_buf + chunk).replaceAll('\r\n', '\n');
    for (var i = _buf.indexOf('\n\n'); i >= 0; i = _buf.indexOf('\n\n')) {
      final block = _buf.substring(0, i);
      _buf = _buf.substring(i + 2);
      final data = block.split('\n').where((l) => l.startsWith('data:')).map((l) => l.substring(5).trimLeft()).join('\n');
      if (data.isEmpty) continue;
      Object? v;
      try {
        v = jsonDecode(data);
      } catch (_) {
        continue;
      }
      if (v is Map) onEvent(Map<String, dynamic>.from(v));
    }
  }
}
