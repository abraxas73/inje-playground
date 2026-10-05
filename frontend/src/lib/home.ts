/** Mobile home greeting adapted to a fixed Korea time zone, independent of browser locale. */
export function homeGreeting(now: Date) {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const hour = kst.getUTCHours();
  const title = hour < 5 ? "늦은 밤까지 고생이 많아요" : hour < 11 ? "좋은 아침이에요" : hour < 14 ? "점심은 드셨나요" : hour < 18 ? "좋은 오후예요" : hour < 22 ? "오늘도 수고 많았어요" : "늦은 시간까지 고생이 많아요";
  const weekday = kst.getUTCDay();
  const subtitle = weekday === 1 ? "새로운 한 주, 가볍게 시작해요" : weekday === 5 ? "한 주 마무리, 조금만 더!" : weekday === 0 || weekday === 6 ? "주말엔 푹 쉬어요" : "오늘도 좋은 하루 보내세요";
  const date = `${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${"일월화수목금토"[weekday]}요일`;
  // Keep quotations to the Korean proverbs also present in the mobile app.
  const quotes = ["천 리 길도 한 걸음부터.", "시작이 반이다.", "구슬이 서 말이라도 꿰어야 보배.", "티끌 모아 태산.", "고생 끝에 낙이 온다.", "백지장도 맞들면 낫다."];
  const day = Math.floor(kst.getTime() / 86_400_000);
  return { title, subtitle, date, quote: quotes[((day % quotes.length) + quotes.length) % quotes.length] };
}

/** Only select conversations returned by the signed-in user's chat API. */
export function initialChatId(ids: readonly string[], requested: string | null, last: string | null): string | null {
  return requested && ids.includes(requested) ? requested : last && ids.includes(last) ? last : null;
}
