import 'dart:math';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/gw_sign.dart';

void main() {
  test('골든: inno-creed sign.rs와 같은 입력에 같은 서명', () {
    expect(
      wehagoSign(authToken: 'gcmsAmaranth31433|3166|test', transactionId: '0123456789abcdef0123456789abcdef', timestamp: '1700000000', path: '/gw/gw050A02', signKey: 'SIGNKEY-abc'),
      'IIJvpAZ5u3uKLH5mGGgNoEtcnXVwplKL2pNErNz/PXc=',
    );
  });
  test('입력 순서(token‖tid‖ts‖path)가 바뀌면 서명이 달라진다', () {
    final a = wehagoSign(authToken: 'A', transactionId: 'B', timestamp: 'C', path: 'D', signKey: 'k');
    final b = wehagoSign(authToken: 'B', transactionId: 'A', timestamp: 'C', path: 'D', signKey: 'k');
    expect(a, isNot(b));
  });
  test('transaction-id는 32자리 hex이고 매번 다르다', () {
    final t = gwTransactionId();
    expect(t.length, 32);
    expect(RegExp(r'^[0-9a-f]{32}$').hasMatch(t), true);
    expect(t, isNot(gwTransactionId()));
    expect(gwTransactionId(Random(1)), gwTransactionId(Random(1))); // 주입한 난수원은 재현 가능
  });
}
