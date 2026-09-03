import { XMLParser } from "fast-xml-parser";

/**
 * fast-xml-parser preserveOrder 노드.
 * 요소: { "<tag>": XmlNode[](자식), ":@"?: {속성} } / 텍스트: { "#text": string }
 */
export type XmlNode = Record<string, unknown>;

const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
});

export function parseXml(xml: string): XmlNode[] {
  return parser.parse(xml) as XmlNode[];
}

export function tagOf(node: XmlNode): string | null {
  return Object.keys(node).find((k) => k !== ":@") ?? null;
}

export function childrenOf(node: XmlNode): XmlNode[] {
  const t = tagOf(node);
  if (!t) return [];
  const v = node[t];
  return Array.isArray(v) ? (v as XmlNode[]) : [];
}

export function attrsOf(node: XmlNode): Record<string, string> {
  const a = node[":@"];
  if (!a || typeof a !== "object") return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(a as Record<string, unknown>)) out[k] = String(v);
  return out;
}

export function findChild(node: XmlNode, tag: string): XmlNode | undefined {
  return childrenOf(node).find((c) => tagOf(c) === tag);
}

export function findChildren(node: XmlNode, tag: string): XmlNode[] {
  return childrenOf(node).filter((c) => tagOf(c) === tag);
}

/** 자손의 #text를 순서대로 이어 붙인 문자열 */
export function textOf(node: XmlNode): string {
  if ("#text" in node) return String(node["#text"]);
  return childrenOf(node).map(textOf).join("");
}
