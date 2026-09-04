import { describe, it, expect } from "vitest";
import { storageToText, decodeEntities } from "@/lib/rfp/catalog/storage-text";

describe("decodeEntities", () => {
  it("이름·10진·16진 엔티티를 디코드하고 모르는 것은 남긴다", () => {
    expect(decodeEntities("a&nbsp;b &amp; &lt;x&gt; &quot;q&quot; &#39;s&#39; &#x41;&#66; &zzz;")).toBe("a b & <x> \"q\" 's' AB &zzz;");
  });
});

describe("storageToText", () => {
  it("표는 행마다 '| a | b |', 셀 안 줄바꿈은 공백", () => {
    const html = `<table><tbody><tr><th>기능</th><th>설명</th></tr><tr><td><p>SSO</p></td><td>통합<br/>인증</td></tr></tbody></table>`;
    expect(storageToText(html)).toBe("| 기능 | 설명 |\n| SSO | 통합 인증 |");
  });
  it("목록은 '- ', 제목은 '# ', 문단은 줄바꿈", () => {
    expect(storageToText(`<h2>주요 기능</h2><p>소개</p><ul><li>A</li><li><strong>B</strong></li></ul>`)).toBe("# 주요 기능\n소개\n- A\n- B");
  });
  it("이미지·ri·parameter는 내용까지 제거, 매크로 본문은 남기고 CDATA는 푼다", () => {
    const html = `<ac:image ac:width="300"><ri:attachment ri:filename="a.png" /></ac:image>` +
      `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>안내 본문</p></ac:rich-text-body></ac:structured-macro>` +
      `<ac:structured-macro ac:name="code"><ac:parameter ac:name="language">js</ac:parameter><ac:plain-text-body><![CDATA[if (x < 1) y();]]></ac:plain-text-body></ac:structured-macro>`;
    expect(storageToText(html)).toBe("안내 본문\nif (x < 1) y();");
  });
  it("연속 공백은 하나로, 빈 줄은 모두 없앤다", () => {
    expect(storageToText(`<p>a&nbsp;&nbsp; b</p>\n\n\n<p></p><p></p><p>c</p>`)).toBe("a b\nc");
    expect(storageToText("<p>a\u00a0\u00a0 b</p>")).toBe("a b");
  });
  it("빈 입력은 빈 문자열", () => {
    expect(storageToText("")).toBe("");
  });
});
