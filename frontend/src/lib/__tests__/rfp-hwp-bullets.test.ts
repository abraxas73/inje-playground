import { describe, expect, it } from "vitest";
import CFB from "cfb";
import { deflateRawSync } from "node:zlib";
import { parseHwp } from "@/lib/rfp/parse-hwp";
import { parseDetailUnits } from "@/lib/rfp/mapping/detail-items";

function record(tag: number, level: number, data: Buffer) {
  const header = Buffer.alloc(4);
  header.writeUInt32LE((data.length << 20) | (level << 10) | tag);
  return Buffer.concat([header, data]);
}
function shape(heading: number, left: number, ref: number) {
  const data = Buffer.alloc(54);
  // Real HWP has stale numbering level 5 on the outer bullet; this is NOT its nesting depth.
  data.writeUInt32LE((heading << 23) | (5 << 25));
  data.writeInt32LE(left, 4);
  data.writeUInt16LE(ref, 30);
  return record(25, 0, data);
}
function bullet(char: string) {
  const data = Buffer.alloc(25);
  data.writeUInt16LE(char.charCodeAt(0), 12);
  return record(24, 0, data);
}
function paragraph(style: number, text: string, level = 2) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(style, 8);
  return Buffer.concat([record(66, level, header), record(67, level + 1, Buffer.from(`${text}\r`, "utf16le"))]);
}
function fixture(compressed: boolean) {
  const cfb = CFB.utils.cfb_new();
  const header = Buffer.alloc(256);
  header.write("HWP Document File"); header.writeUInt32LE(compressed ? 1 : 0, 36);
  CFB.utils.cfb_add(cfb, "FileHeader", header);
  const info = Buffer.concat([bullet("ㅇ"), bullet("-"), shape(0, 0, 0), shape(3, 0, 1), shape(3, 1600, 2)]);
  const table = Buffer.alloc(8); table.writeUInt16LE(1, 4); table.writeUInt16LE(2, 6);
  const cell = Buffer.alloc(16); cell.writeUInt16LE(1, 12); cell.writeUInt16LE(1, 14);
  const cell2 = Buffer.from(cell); cell2.writeUInt16LE(1, 8);
  const body = Buffer.concat([
    paragraph(0, "", 0), record(71, 1, Buffer.from(" lbt")), record(77, 1, table), record(72, 1, cell),
    paragraph(1, "HCI Appliance 통합관리도구", 1),
    paragraph(2, "영구 라이선스 제공", 1), paragraph(0, "  ※ 구독은 10년 이상", 1),
    paragraph(2, "VM 관리 기능", 1), paragraph(1, "다음 상위 항목", 1),
    record(72, 1, cell2), paragraph(2, "- 이미 있는 글머리", 1), paragraph(999, "일반 문단", 1),
    paragraph(0, "본문", 0),
  ]);
  CFB.utils.cfb_add(cfb, "DocInfo", compressed ? deflateRawSync(info) : info);
  CFB.utils.cfb_add(cfb, "BodyText/Section0", compressed ? deflateRawSync(body) : body);
  return CFB.write(cfb, { type: "buffer" }) as Buffer;
}
describe("HWP 자동 글머리표", () => {
  it.each([false, true])("압축=%s: 셀 안의 상하위 글머리와 주석 복원", (compressed) => {
    const doc = parseHwp(fixture(compressed));
    const table = doc.blocks.find((b) => b.type === "table")!;
    expect(table.type).toBe("table");
    if (table.type !== "table") return;
    expect(table.cells[0].text).toBe("ㅇ HCI Appliance 통합관리도구\n  - 영구 라이선스 제공\n    ※ 구독은 10년 이상\n  - VM 관리 기능\nㅇ 다음 상위 항목");
    expect(table.cells[1].text).toBe("- 이미 있는 글머리\n일반 문단");
    const units = parseDetailUnits(table.cells[0].text);
    expect(units.units).toHaveLength(2);
    expect(units.units[0].text).toContain("\n    ※ 구독은 10년 이상");
    expect(units.units[0].childCount).toBe(3);
    expect(doc.blocks.at(-1)).toEqual({ type: "paragraph", text: "본문" });
  });
  it("대시만 있는 목록에서도 ※는 앞 항목의 주석으로 유지", () => {
    const parsed = parseDetailUnits("- 라이선스\n  ※ 10년 이상\n- VM 기능");
    expect(parsed.units).toHaveLength(2);
    expect(parsed.units[0].text).toBe("- 라이선스\n  ※ 10년 이상");
  });
});
