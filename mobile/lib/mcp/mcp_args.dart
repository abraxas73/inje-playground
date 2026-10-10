// mobile/lib/mcp/mcp_args.dart — MCP 도구 인자 정규화. inno-creed 스키마가 ['string','integer']를 섞어 허용하므로 값은 이 함수들로만 읽는다.
import '../gw/gw_client.dart' show asStr, asBool;

String str(Map a, String k, [String d = '']) {
  final v = a[k];
  return v == null ? d : asStr(v).trim();
}

int? intOf(Map a, String k) {
  final v = a[k];
  return v is int ? v : (v is num ? v.toInt() : int.tryParse(asStr(v).trim()));
}

bool boolOf(Map a, String k, [bool d = false]) => a[k] == null ? d : asBool(a[k]);

/// 배열 또는 콤마 문자열 → 공백 제거한 비지 않은 항목.
List<String> strList(Map a, String k) {
  final v = a[k];
  final items = v is List ? v.map(asStr) : (v == null ? const <String>[] : asStr(v).split(','));
  return [for (final s in items) if (s.trim().isNotEmpty) s.trim()];
}

/// 'YYYY-MM-DD'·'YYYYMMDD'·'YYYYMMDDHHmm' → 'YYYYMMDD'. 8자리가 안 되면 숫자 그대로.
String ymd(String v) {
  final d = v.replaceAll(RegExp(r'\D'), '');
  return d.length >= 8 ? d.substring(0, 8) : d;
}

/// 'YYYYMMDDHHmm' → KST 벽시계 DateTime.utc(gw_models kstNow 규약).
DateTime hm(String v) {
  final d = v.replaceAll(RegExp(r'\D'), '');
  if (d.length < 12) throw FormatException('YYYYMMDDHHmm 형식이 아닙니다', v);
  int p(int s, int e) => int.parse(d.substring(s, e));
  return DateTime.utc(p(0, 4), p(4, 6), p(6, 8), p(8, 10), p(10, 12));
}
