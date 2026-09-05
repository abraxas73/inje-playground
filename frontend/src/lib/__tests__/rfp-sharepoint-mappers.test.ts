import { describe, it, expect } from "vitest";
import { parseSharepointFolder, mapSharepointUpload, PROJECT_COLUMNS, type SharepointUploadDbRow } from "@/lib/rfp/mappers";

const folder = { url: "https://x.sharepoint.com/sites/A/Shared%20Documents/RFP", driveId: "b!drive", itemId: "01ITEM", name: "RFP", webUrl: "https://x.sharepoint.com/sites/A/Shared%20Documents/RFP", setBy: "u-1", setAt: "2026-09-05T01:00:00.000Z" };

describe("parseSharepointFolder", () => {
  it("필수 문자열 필드가 모두 있으면 그대로, setBy는 null 허용", () => {
    expect(parseSharepointFolder(folder)).toEqual(folder);
    expect(parseSharepointFolder({ ...folder, setBy: null })).toEqual({ ...folder, setBy: null });
  });
  it("null·문자열·필드 누락·타입 불일치는 null", () => {
    expect(parseSharepointFolder(null)).toBeNull();
    expect(parseSharepointFolder("{}")).toBeNull();
    const { itemId: _omit, ...missing } = folder;
    expect(parseSharepointFolder(missing)).toBeNull();
    expect(parseSharepointFolder({ ...folder, driveId: 3 })).toBeNull();
  });
});

describe("mapSharepointUpload", () => {
  it("snake→camel, size_bytes 문자열도 숫자로, 업로더 이름을 붙인다", () => {
    const row = { id: "up-1", project_id: "p-1", drive_id: "b!d", item_id: "01I", file_name: "a.xlsx", web_url: "https://x/a.xlsx", size_bytes: "12345" as unknown as number, uploaded_by: "u-1", created_at: "2026-09-05T02:00:00.000Z" } satisfies SharepointUploadDbRow;
    expect(mapSharepointUpload(row, "강승욱")).toEqual({ id: "up-1", fileName: "a.xlsx", webUrl: "https://x/a.xlsx", sizeBytes: 12345, uploadedBy: { id: "u-1", name: "강승욱" }, createdAt: "2026-09-05T02:00:00.000Z" });
    expect(mapSharepointUpload({ ...row, uploaded_by: null }, null).uploadedBy).toEqual({ id: null, name: null });
  });
});

it("PROJECT_COLUMNS에 sharepoint_folder가 들어간다", () => {
  expect(PROJECT_COLUMNS.split(",").map((s) => s.trim())).toContain("sharepoint_folder");
});
