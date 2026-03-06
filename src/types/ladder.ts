export interface LadderData {
  participants: string[];
  results: string[];
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
