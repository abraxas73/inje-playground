import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { ConnectNotice } from "@/components/sharepoint/shared";

it("SharePoint 미연결 안내는 설정 화면을 거치지 않고 원래 문서 화면으로 돌아오는 권한 연결을 시작한다", () => {
  render(<ConnectNotice problem={{ kind: "connect", message: "Microsoft 계정을 먼저 연결하세요." }} />);

  const link = screen.getByRole("link", { name: "SharePoint 권한 연결" });
  expect(link).toHaveAttribute("href", "/api/ms/connect?returnTo=%2Fsharepoint");
  expect(screen.getByText(/앱 로그인은 완료된 상태/)).toBeTruthy();
});
