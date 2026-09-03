import { describe, expect, it } from "vitest";
import { classifyPrompt } from "@/lib/claude-usage/prompt-kind";

describe("classifyPrompt", () => {
  it("claude-mem 관찰자·요약·시작 프롬프트와 헬스체크는 automation", () => {
    expect(classifyPrompt("<observed_from_primary_session>\n  <what_happened>Bash</what_happened>")).toBe("automation");
    expect(classifyPrompt("You are a Claude-Mem, a specialized observer tool")).toBe("automation");
    expect(classifyPrompt("Hello memory agent, you are continuing to observe")).toBe("automation");
    expect(classifyPrompt("--- MODE SWITCH: PROGRESS SUMMARY ---\n⚠️")).toBe("automation");
    expect(classifyPrompt("  Reply with: OK ")).toBe("automation");
  });
  it("사람 프롬프트·내용 없음은 human", () => {
    expect(classifyPrompt("계속 진행해줘")).toBe("human");
    expect(classifyPrompt("memory agent에 대해 설명해줘")).toBe("human");
    expect(classifyPrompt("reply with: ok 라고 답하는 봇을 만들어줘")).toBe("human");
    expect(classifyPrompt("")).toBe("human");
    expect(classifyPrompt(null)).toBe("human");
  });
});
