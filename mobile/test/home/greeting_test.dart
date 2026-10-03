import 'package:flutter_test/flutter_test.dart';
import 'package:playground/features/home/greeting.dart';

void main() {
  test('시간대 인사 + 이름', () {
    expect(greetingFor(DateTime(2026, 10, 7, 8), name: '강승욱').title, '좋은 아침이에요, 강승욱\u2060님'); // 이름–님 사이 단어 결합자(줄바꿈 방지)
    expect(greetingFor(DateTime(2026, 10, 7, 12)).title, '점심은 드셨나요');
    expect(greetingFor(DateTime(2026, 10, 7, 15)).title, '좋은 오후예요');
    expect(greetingFor(DateTime(2026, 10, 7, 19)).title, '오늘도 수고 많았어요');
    expect(greetingFor(DateTime(2026, 10, 7, 23)).title, '늦은 시간까지 고생이 많아요');
  });

  test('날짜 줄: 요일·공휴일·요일별 덕담, 이에요/예요 받침 처리', () {
    expect(greetingFor(DateTime(2026, 10, 3, 9)).subtitle, '10월 3일 토요일 · 오늘은 개천절이에요, 푹 쉬세요');
    expect(greetingFor(DateTime(2026, 12, 25, 9)).subtitle, '12월 25일 금요일 · 오늘은 크리스마스예요, 푹 쉬세요');
    expect(greetingFor(DateTime(2026, 10, 5, 9)).subtitle, '10월 5일 월요일 · 새로운 한 주, 가볍게 시작해요');
    expect(greetingFor(DateTime(2026, 10, 9, 9)).subtitle, '10월 9일 금요일 · 오늘은 한글날이에요, 푹 쉬세요');
    expect(greetingFor(DateTime(2026, 10, 16, 9)).subtitle, '10월 16일 금요일 · 한 주 마무리, 조금만 더!');
    expect(greetingFor(DateTime(2026, 10, 7, 9)).subtitle, '10월 7일 수요일 · 오늘도 좋은 하루 보내세요');
    expect(greetingFor(DateTime(2026, 10, 7, 16)).subtitle, '10월 7일 수요일 · 남은 하루도 힘내요');
    expect(greetingFor(DateTime(2026, 10, 11, 9)).subtitle, '10월 11일 일요일 · 주말엔 푹 쉬어요');
  });
}
