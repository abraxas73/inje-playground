import { describe, it, expect } from "vitest";
import { extractFeaturesByRules, isCodeOnly, rulesNote, HEADING_DESC_MAX } from "@/lib/rfp/catalog/extract-rules";
import { storageToText } from "@/lib/rfp/catalog/storage-text";

describe("isCodeOnly", () => {
  it("코드·번호만인 문자열", () => {
    for (const s of ["SEC-001", "F01", "1.2.3", "3", "A-1_2", "SEC_AUTH_01", "DEV-01-02"]) expect(isCodeOnly(s)).toBe(true);
  });
  it("숫자 없는 약어·일반 이름은 코드가 아니다", () => {
    for (const s of ["IAM", "SSO", "SSO 로그인", "API 게이트웨이", "S3 연동", "iam"]) expect(isCodeOnly(s)).toBe(false);
  });
});

describe("extractFeaturesByRules — 표", () => {
  it("헤더에서 기능명 열을 찾고 코드 행·반복 헤더·빈 이름을 건너뛰며 나머지 셀을 ' · '로 잇는다(코드 셀 제외)", () => {
    const text = [
      "| 대분류 | 기능명 | 코드 | 설명 |",
      "| 계정 | SSO 로그인 | SEC-001 | 통합 인증 |",
      "| 계정 | SEC-002 | SEC-002 | 코드만 있는 행 |",
      "| 대분류 | 기능명 | 코드 | 설명 |",
      "|  | 감사 로그 | SEC-003 |  |",
      "| 계정 |  | SEC-004 | 이름 없음 |",
    ].join("\n");
    const r = extractFeaturesByRules(text);
    expect(r.features).toEqual([
      { name: "SSO 로그인", description: "계정 · 통합 인증" },
      { name: "감사 로그", description: "" },
    ]);
    expect(r.stats).toEqual({ tables: 1, headings: 0, bullets: 0 });
    expect(r.warnings).toEqual([]);
    expect(rulesNote(r)).toBe("규칙 추출: 표 1·제목 0·글머리 0 → 기능 2개");
  });
  it("헤더 키워드가 없으면 0열, 0열이 번호면 1열. '기능 설명' 같은 설명 헤더는 이름 열로 잡지 않는다", () => {
    expect(extractFeaturesByRules("| 항목 | 비고 |\n| 백업 | 일 1회 |").features).toEqual([{ name: "백업", description: "일 1회" }]);
    expect(extractFeaturesByRules("| No | 항목 | 비고 |\n| 1 | 백업 | 일 1회 |").features).toEqual([{ name: "백업", description: "일 1회" }]);
    expect(extractFeaturesByRules("| 구분 | 기능 설명 | 기능명 |\n| 보안 | 통합 인증 제공 | SSO |").features).toEqual([{ name: "SSO", description: "보안 · 통합 인증 제공" }]);
  });
  it("1열 표는 이름만, 60자 초과 이름은 문장으로 보고 건너뛴다", () => {
    const long = "가".repeat(61);
    expect(extractFeaturesByRules(`| 기능 |\n| 백업 |\n| ${long} |`).features).toEqual([{ name: "백업", description: "" }]);
  });
});

describe("extractFeaturesByRules — storageToText 연동", () => {
  it("빈 셀(<td></td>)이 있는 행도 열이 밀리지 않는다(storageToText는 연속 공백을 하나로 줄인다)", () => {
    const xhtml = `<table><tbody>
      <tr><th>대분류</th><th>중분류</th><th>기능명</th><th>설명</th></tr>
      <tr><td>계정</td><td></td><td>SSO 로그인</td><td>통합 인증</td></tr>
      <tr><td></td><td>권한</td><td>역할 관리</td><td></td></tr>
    </tbody></table><h2>3. 감사</h2><p>감사 로그 조회</p>`;
    const text = storageToText(xhtml);
    expect(text.split("\n")[1]).toBe("| 계정 | | SSO 로그인 | 통합 인증 |");
    expect(extractFeaturesByRules(text).features).toEqual([
      { name: "SSO 로그인", description: "계정 · 통합 인증" },
      { name: "역할 관리", description: "권한" },
      { name: "감사", description: "감사 로그 조회" },
    ]);
  });
});

describe("extractFeaturesByRules — 제목·글머리", () => {
  it("h2~h4만 기능으로 받고 번호 접두를 떼며 다음 제목·표 전까지의 줄을 설명으로 잇는다", () => {
    const text = [
      "# 문서 제목",
      "## 1.1 멀티테넌트 IAM",
      "테넌트별 계정·권한 관리",
      "- 역할 기반 접근 제어",
      "### 2) 감사 로그",
      "##### 세부 항목",
      "무시되는 h5 아래 문장",
      "## 개요",
      "설명은 기능이 아님",
      "## " + "가".repeat(41),
    ].join("\n");
    const r = extractFeaturesByRules(text);
    expect(r.features).toEqual([
      { name: "멀티테넌트 IAM", description: "테넌트별 계정·권한 관리 역할 기반 접근 제어" },
      { name: "감사 로그", description: "" },
    ]);
    expect(r.stats.headings).toBe(2);
  });
  it("제목 설명은 300자에서 자른다", () => {
    const r = extractFeaturesByRules(`## 기능A\n${"설".repeat(400)}`);
    expect(r.features[0].description).toHaveLength(HEADING_DESC_MAX);
  });
  it("글머리표 '이름: 설명'·'이름 — 설명'을 받고 날짜·URL·담당자는 버린다", () => {
    const text = [
      "- 파이프라인 템플릿: CI/CD 파이프라인을 템플릿으로 생성",
      "- 알림 연동 — Slack·Teams 웹후크",
      "- 담당자: 홍길동",
      "- 배포일: 2026-09-01 예정",
      "- 참고 링크: https://example.com/x",
      "- 설명 없는 항목",
      "- SEC-010: 코드 이름",
    ].join("\n");
    const r = extractFeaturesByRules(text);
    expect(r.features).toEqual([
      { name: "파이프라인 템플릿", description: "CI/CD 파이프라인을 템플릿으로 생성" },
      { name: "알림 연동", description: "Slack·Teams 웹후크" },
    ]);
    expect(r.stats.bullets).toBe(2);
  });
  it("같은 이름은 dedupeIncoming으로 합치고(긴 설명 우선), 빈 문서는 경고", () => {
    const r = extractFeaturesByRules("## SSO\n짧음\n| 기능 | 설명 |\n| SSO | 통합 인증을 제공하는 기능 |");
    expect(r.features).toEqual([{ name: "SSO", description: "통합 인증을 제공하는 기능" }]);
    const empty = extractFeaturesByRules("");
    expect(empty.features).toEqual([]);
    expect(empty.warnings).toEqual(["문서에서 기능을 찾지 못했습니다."]);
  });
});
