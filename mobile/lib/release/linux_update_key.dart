import 'dart:convert';

/// Linux 업데이트 서명 공개 키(Ed25519 raw 32바이트의 base64). 빌드 때 dart-define으로 넣는다.
const linuxUpdatePublicKey = String.fromEnvironment(
  'INNOCREW_LINUX_UPDATE_KEY',
);

/// raw 키를 `openssl pkey -pubin`이 읽는 SPKI PEM으로 바꾼다. 32바이트가 아니면 null.
String? linuxUpdatePublicKeyPem(String rawBase64) {
  final List<int> raw;
  try {
    raw = base64Decode(rawBase64);
  } on FormatException {
    return null;
  }
  if (raw.length != 32) return null;
  // Ed25519 SPKI 고정 머리(12바이트) + raw 키
  final der = [
    0x30,
    0x2a,
    0x30,
    0x05,
    0x06,
    0x03,
    0x2b,
    0x65,
    0x70,
    0x03,
    0x21,
    0x00,
    ...raw,
  ];
  final body = base64Encode(der);
  final lines = [
    for (var i = 0; i < body.length; i += 64)
      body.substring(i, i + 64 > body.length ? body.length : i + 64),
  ];
  return '-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n';
}
