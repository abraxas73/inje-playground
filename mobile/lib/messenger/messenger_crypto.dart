import 'dart:convert';
import 'dart:math';
import 'dart:typed_data';
import 'package:pointycastle/export.dart';

/// 아마란스 메신저 로그인(P076) 아이디·비밀번호 암호화.
///
/// 더존 메신저(AmaranthMessenger)와 **같은 규격**이라야 서버가 복호화한다:
/// AES-256-CBC · IV=0(16바이트) · PKCS7 · 평문 UTF-8 · 결과 base64, 키는 아래 표의 32자 문자열.
/// 로그인 때 0~9 중 하나를 `kNum`으로 골라 보내면 서버가 같은 번호의 키로 푼다.
/// (규격 출처: 메신저 번들 `src/dz/dzEncrypt.js` `EncryptLoginData`/`AES256Encrypt`, 키표 `dzkey.js`.)
///
/// 이 키는 사내 전용 메신저의 고정 값이다. 로그·메시지에 평문 자격증명과 함께 찍지 않는다.
const _loginKeys = <String>[
  'hjdidsflkndlkjgnwekljgnewklrgjne',
  'njnuifwbuebsdbajbfhgbrwubfebdjgh',
  'irwnndsjkngejgnlkenjdangjkhasiwq',
  'eqicjsvhsnxklsjsudeidhdumsjfeenc',
  'kdjdwndiddnejrlfjsdjkdsngnqivxkk',
  'dkaayshcyeisnvoegsuzmfudkswocksd',
  'palfucjrgdbhjbdxldgkdgnebbeflnaa',
  'ndgjdhgnajdnsyfugberuabgjlarbjbr',
  'cxvoijbosdfjonwfjihwnkldfnhwnhjr',
  'dfnkjbhnwfhwiounhriwnidsfnidngid',
];

final _zeroIv = Uint8List(16);

/// 0~9 난수. 로그인 본문의 `kNum`으로 보내고, 같은 번호로 아이디·비밀번호를 암호화한다.
int loginKeyIndex([Random? rng]) => (rng ?? Random.secure()).nextInt(10);

PaddedBlockCipher _cipher(int kNum, bool forEncryption) {
  final key = KeyParameter(Uint8List.fromList(utf8.encode(_loginKeys[kNum]))); // 32바이트 = AES-256
  return PaddedBlockCipherImpl(PKCS7Padding(), CBCBlockCipher(AESEngine()))
    ..init(forEncryption, PaddedBlockCipherParameters(ParametersWithIV(key, _zeroIv), null));
}

/// 아이디/비밀번호 한 건을 `kNum` 키로 AES-256-CBC 암호화 → base64.
String encryptLoginData(String plain, int kNum) =>
    base64.encode(_cipher(kNum, true).process(Uint8List.fromList(utf8.encode(plain))));

/// 자기검증용 복호화(실제 로그인엔 안 쓴다 — 서버가 복호화한다). 라운드트립 테스트에서만.
String decryptLoginData(String b64, int kNum) =>
    utf8.decode(_cipher(kNum, false).process(base64.decode(b64)));
