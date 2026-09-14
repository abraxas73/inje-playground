import { describe, expect, it } from "vitest";
import { cleanData, fieldErrors, mergeUpdate, validateAiResult, validateContact } from "@/lib/marketing/validation";
import { emptyContact, type Contact, type Organization } from "@/lib/marketing/types";
const org: Organization = { id: "org1", name: "한빛", category: "IT기업", aliases: ["주식회사 한빛"], version: 1 };
const data = { ...emptyContact(), company: "한빛", name: "김서연", email: "a@example.com", position: "대리" };
const contact: Contact = { id: "contact1", db_id: "DB001", organization_id: org.id, organization: org, version: 1, data };
describe("marketing comparison", () => {
  it("recommends a new contact only for an identified company", () => expect(validateContact({ ...data, email: "b@example.com", name: "박지민" }, [contact], [org]).kind).toBe("신규 등록"));
  it("uses case-insensitive email comparisons without stripping plus-addresses", () => {
    expect(validateContact({ ...data, email: " A@EXAMPLE.COM " }, [contact], [org]).targetId).toBe(contact.id);
    expect(validateContact({ ...data, email: "a+new@example.com", name: "박지민" }, [contact], [org]).targetId).toBeNull();
  });
  it("keeps same email/different person suspicious", () => expect(validateContact({ ...data, name: "다른사람" }, [contact], [org]).kind).toBe("중복 의심"));
  it("keeps same name/company/different email suspicious", () => expect(validateContact({ ...data, email: "b@example.com" }, [contact], [org]).kind).toBe("중복 의심"));
  it("blocks inconsistent DB ID and email identities", () => {
    const other = { ...contact, id: "contact2", data: { ...data, email: "b@example.com" } };
    expect(validateContact(data, [contact, other], [org], other.id).errors).toContain("DB ID와 이메일이 서로 다른 Contact를 가리킵니다.");
  });
  it("does not confirm similar company names without an approved alias", () => {
    const result = validateContact({ ...data, company: "(주) 한빛", name: "새이름", email: "new@example.com" }, [contact], [org]);
    expect(result.kind).toBe("확인 필요"); expect(result.organizationIds).toEqual([org.id]);
  });
  it("inherits a confirmed alias without merging legal entities", () => expect(validateContact({ ...data, company: "주식회사 한빛" }, [contact], [org]).kind).toBe("기존 정보 업데이트"));
  it("does not resolve two organizations with the same name", () => expect(validateContact({ ...data, name: "새이름", email: "new@example.com" }, [], [org, { ...org, id: "org2" }]).kind).toBe("확인 필요"));
  it("keeps unknown companies and unresolved categories in review", () => {
    expect(validateContact(data, [], []).kind).toBe("확인 필요");
    expect(validateContact(data, [], [{ ...org, category: "확인 필요" }]).kind).toBe("확인 필요");
  });
  it("flags duplicate pending and same-batch submissions", () => expect(validateContact(data, [], [org], null, [], [data]).kind).toBe("중복 의심"));
  it("keeps blank update values and only clears explicit fields", () => {
    expect(mergeUpdate(data, emptyContact()).position).toBe("대리");
    expect(mergeUpdate(data, emptyContact(), ["position"]).position).toBe("");
    expect(validateContact(emptyContact(), [contact], [org], contact.id).errors).toEqual([]);
  });
  it("leaves configurable business fields to DB rules and enforces structural size limits", () => {
    expect(fieldErrors(emptyContact())).toEqual([]);
    expect(fieldErrors({ ...data, confirmedAt: "2025-02-29" })).toEqual([]);
    expect(fieldErrors({ ...data, notes: "x".repeat(2001) })).toHaveLength(1);
    expect(fieldErrors({ ...data, confirmedAt: "2024-02-29" })).toEqual([]);
  });
  it("rejects nontext and excessively long fields", () => {
    expect(() => cleanData({ email: 123 })).toThrow(); expect(() => cleanData({ name: "x".repeat(2001) })).toThrow();
  });
  it("rejects invented AI IDs, categories and missing evidence", () => {
    expect(() => validateAiResult({ category: "IT기업", organizationId: "invented", reason: "예측" }, [org])).toThrow();
    expect(() => validateAiResult({ category: "금융회사", organizationId: null, reason: "추정" }, [org])).toThrow();
    expect(validateAiResult({ category: "확인 필요", organizationId: null, reason: "회사 정보가 부족합니다." }, [])).toMatchObject({ organizationId: null });
  });
});
