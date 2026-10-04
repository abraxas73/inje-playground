import 'dart:convert';
import 'dart:math';
import 'package:crypto/crypto.dart';

/// 요청마다 새로 뽑는 transaction-id(16바이트 난수 → 32 hex).
String gwTransactionId([Random? rng]) {
  final r = rng ?? Random.secure();
  return [for (var i = 0; i < 16; i++) r.nextInt(256).toRadixString(16).padLeft(2, '0')].join();
}

/// wehago-sign = base64(HMAC_SHA256(authToken ‖ transactionId ‖ timestamp ‖ path, signKey)). 구분자 없음, path는 쿼리 제외.
/// 규격 출처: inno-creed `src/sign.rs`(골든 테스트 동일).
String wehagoSign({required String authToken, required String transactionId, required String timestamp, required String path, required String signKey}) {
  final mac = Hmac(sha256, utf8.encode(signKey));
  return base64.encode(mac.convert(utf8.encode('$authToken$transactionId$timestamp$path')).bytes);
}
