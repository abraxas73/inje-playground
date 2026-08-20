import { describe, it, expect } from "vitest";
import {
  buildTeamResultMessage,
  buildFoodDecisionMessage,
  buildGuideDmText,
} from "@/lib/notify/messages";

describe("buildTeamResultMessage", () => {
  it("기존 team-notify 포맷과 동일", () => {
    const msg = buildTeamResultMessage([
      { name: "1팀", members: [{ name: "홍길동", hasCard: true }, { name: "김철수", hasCard: false }] },
      { name: "2팀", members: [{ name: "이영희", hasCard: false }] },
    ]);
    expect(msg).toBe(
      ["👥 팀 구성 결과", "", "**1팀** (2명): 홍길동(법카), 김철수", "**2팀** (1명): 이영희"].join("\n")
    );
  });
});

describe("buildFoodDecisionMessage", () => {
  it("선택 필드는 있을 때만 줄이 생긴다", () => {
    // 빈 줄 placeholder는 filter(Boolean)에서 제거되어 운영 라우트와 일치
    expect(
      buildFoodDecisionMessage({
        place_name: "우래옥",
        address: "서울 중구",
        category_name: "한식",
        place_url: "https://place.map.kakao.com/1",
        members: ["홍길동", "김철수"],
      })
    ).toBe(
      [
        "🍽️ 밥 먹으러 갑시다!",
        "📍 **우래옥**",
        "📫 서울 중구",
        "🏷️ 한식",
        "👥 홍길동, 김철수",
        "🔗 https://place.map.kakao.com/1",
      ].join("\n")
    );
  });

  it("null/빈 선택 필드는 생략", () => {
    // 빈 줄 placeholder는 filter(Boolean)에서 제거됨
    expect(
      buildFoodDecisionMessage({ place_name: "우래옥", address: null, category_name: "", place_url: undefined, members: ["홍길동"] })
    ).toBe(["🍽️ 밥 먹으러 갑시다!", "📍 **우래옥**", "👥 홍길동"].join("\n"));
  });
});

describe("buildGuideDmText", () => {
  it("500자 초과 답변은 잘라내고 … 붙임", () => {
    const long = "가".repeat(600);
    const text = buildGuideDmText("질문?", long);
    expect(text.startsWith("📋 **가이드 Q&A 답변 알림**\n\n❓ **질문**: 질문?\n\n💡 **답변**:\n")).toBe(true);
    expect(text.endsWith("가".repeat(500) + "…")).toBe(true);
  });

  it("500자 이하는 그대로", () => {
    expect(buildGuideDmText("q", "a")).toBe("📋 **가이드 Q&A 답변 알림**\n\n❓ **질문**: q\n\n💡 **답변**:\na");
  });
});
