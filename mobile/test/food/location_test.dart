import 'dart:async';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/food/location.dart';

void main() {
  test('현재 위치 실패 메시지 — 시간 초과는 사람이 읽는 안내(주소 변경 유도), 그 외는 원인 포함', () {
    expect(locationFailureMessage(TimeoutException('Future not completed', const Duration(seconds: 10))), '현재 위치를 가져오지 못했습니다(시간 초과). 다시 시도하거나 주소 변경으로 찾아 주세요.');
    expect(locationFailureMessage(StateError('x')), startsWith('현재 위치를 가져오지 못했습니다: '));
  });
}
