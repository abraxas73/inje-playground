/// 날짜·시간에 맞는 인사(순수 함수). 제목은 시간대 + 이름, 부제는 날짜·요일 + 공휴일/요일별 덕담.
({String title, String subtitle}) greetingFor(DateTime now, {String? name}) {
  final h = now.hour;
  final byHour = h < 5
      ? '늦은 밤까지 고생이 많아요'
      : h < 11
          ? '좋은 아침이에요'
          : h < 14
              ? '점심은 드셨나요'
              : h < 18
                  ? '좋은 오후예요'
                  : h < 22
                      ? '오늘도 수고 많았어요'
                      : '늦은 시간까지 고생이 많아요';
  final who = (name == null || name.trim().isEmpty) ? '' : ', ${name.trim()}\u2060님'; // 단어 결합자: 이름과 '님' 사이에서 줄이 끊기지 않게
  const weekdays = ['월', '화', '수', '목', '금', '토', '일'];
  final holiday = kHolidays['${now.month}-${now.day}'];
  final flavor = holiday != null
      ? '오늘은 $holiday${_ieyo(holiday)}, 푹 쉬세요'
      : switch (now.weekday) {
          DateTime.monday => '새로운 한 주, 가볍게 시작해요',
          DateTime.friday => '한 주 마무리, 조금만 더!',
          DateTime.saturday || DateTime.sunday => '주말엔 푹 쉬어요',
          _ => h < 14 ? '오늘도 좋은 하루 보내세요' : '남은 하루도 힘내요',
        };
  return (title: '$byHour$who', subtitle: '${now.month}월 ${now.day}일 ${weekdays[now.weekday - 1]}요일 · $flavor');
}

/// 양력 고정 공휴일만(설·추석 등 음력은 해마다 달라 제외).
const kHolidays = <String, String>{
  '1-1': '새해 첫날',
  '3-1': '삼일절',
  '5-5': '어린이날',
  '6-6': '현충일',
  '8-15': '광복절',
  '10-3': '개천절',
  '10-9': '한글날',
  '12-25': '크리스마스',
};

/// 마지막 글자 받침 유무로 "이에요"/"예요".
String _ieyo(String word) {
  final c = word.codeUnitAt(word.length - 1);
  final hangul = c >= 0xAC00 && c <= 0xD7A3;
  return hangul && (c - 0xAC00) % 28 != 0 ? '이에요' : '예요';
}
