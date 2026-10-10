import { expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import DeckList from "@/components/ppt/DeckList";
import type { PptDeckSummary } from "@/types/ppt";

const deck = (over: Partial<PptDeckSummary>): PptDeckSummary => ({
  id: "d1", title: "제안서", ownerId: "u1", ownerEmail: "a@example.com", ownerLabel: "홍길동(팀)", currentVersion: 1, shareEnabled: false, shareUrl: null,
  latest: null, costUsd: null, createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z", ...over,
} as PptDeckSummary);

it("관리자 목록(showShared)은 공유 여부 열을 보여 주고, 사용자 목록은 보여 주지 않는다", () => {
  const decks = [deck({ id: "d1", title: "공유한 덱", shareEnabled: true }), deck({ id: "d2", title: "안 공유한 덱" })];
  const view = render(<DeckList decks={decks} showOwner showShared onDeleted={() => {}} onError={() => {}} />);
  expect(screen.getByRole("columnheader", { name: "공유" })).toBeInTheDocument();
  expect(screen.getByText("공유 중")).toBeInTheDocument();
  expect(screen.getByText("비공개")).toBeInTheDocument();
  view.unmount();
  render(<DeckList decks={decks} showOwner={false} onDeleted={() => {}} onError={() => {}} />);
  expect(screen.queryByRole("columnheader", { name: "공유" })).toBeNull();
  expect(screen.queryByText("비공개")).toBeNull();
});
