import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import RequirementsTable from "@/components/rfp/RequirementsTable";
import type { RfpRequirement } from "@/types/rfp";
import type { ComponentProps } from "react";

const requirement = {
  id: "r1", categoryCode: "ECR", categoryName: "장비", reqId: "ECR-001", title: "시스템 구성",
  definition: "정의 첫 줄\n정의 둘째 줄\n정의 셋째 줄\n정의 넷째 줄", details: "첫째\n둘째\n셋째\n넷째\n다섯째", deliverables: "", related: "", sortOrder: 0,
} as RfpRequirement;
const props: ComponentProps<typeof RequirementsTable> = {
  projectId: "p1", requirements: [requirement], mappings: [], catalog: [], solutions: [],
  llmAvailable: true, maxCandidates: 2, mappingStatus: "none", categorySummary: [], verdictFilter: null,
  onRunMapping: vi.fn(), onChange: vi.fn(), onMappingsChange: vi.fn(),
};
function openDetails() {
  fireEvent.mouseDown(screen.getByRole("tab", { name: /ECR/ }), { button: 0, ctrlKey: false });
}
it("keeps expanded text, selected tab and search during parent rerenders and data refresh", () => {
  const view = render(<RequirementsTable {...props} />);
  openDetails();
  const detailCell = screen.getByText(/첫째.*둘째.*셋째/).closest("td")!;
  expect(within(detailCell).queryByRole("button", { name: /더보기/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /더보기/ }));
  const search = screen.getByPlaceholderText("ID·명칭·내용·솔루션 검색");
  fireEvent.change(search, { target: { value: "시스템" } });
  view.rerender(<RequirementsTable {...props} requirements={[{ ...requirement }]} onChange={vi.fn()} />);
  expect(screen.getByRole("button", { name: "접기" })).toBeInTheDocument();
  expect(search).toHaveValue("시스템");
  expect(screen.getByRole("tab", { name: /ECR/ })).toHaveAttribute("aria-selected", "true");
  view.unmount();
});
it("keeps an unsaved draft during parent rerenders", () => {
  const view = render(<RequirementsTable {...props} />);
  openDetails();
  fireEvent.click(screen.getByText(/첫째.*둘째.*셋째/));
  const editor = screen.getByDisplayValue(/첫째.*둘째/);
  fireEvent.change(editor, { target: { value: "작성 중인 내용" } });
  view.rerender(<RequirementsTable {...props} onChange={vi.fn()} />);
  expect(screen.getByDisplayValue("작성 중인 내용")).toBe(editor);
  view.unmount();
});
