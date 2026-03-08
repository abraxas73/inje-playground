export type ResultType = "reward" | "punishment" | "normal";

export interface LadderResult {
  text: string;
  type: ResultType;
}

export interface LadderData {
  participants: string[];
  results: LadderResult[];
  columns: number;
  rows: number;
  bridges: boolean[][];
}

export interface PathSegment {
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  type: "vertical" | "horizontal";
}

export interface LadderMapping {
  participant: string;
  result: LadderResult;
}
