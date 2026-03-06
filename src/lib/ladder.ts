import type { LadderData, PathSegment } from "@/types/ladder";

export function generateLadder(
  participants: string[],
  results: string[],
  bridgeDensity: number = 0.4
): LadderData {
  const columns = participants.length;
  const rows = Math.max(columns * 2, 6);
  const bridges: boolean[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < columns - 1; c++) {
      // No adjacent bridges on same row
      const prevBridge = c > 0 && row[c - 1];
      row.push(!prevBridge && Math.random() < bridgeDensity);
    }
    bridges.push(row);
  }

  return { participants, results, columns, rows, bridges };
}

export function tracePath(
  ladder: LadderData,
  startColumn: number,
  canvasWidth: number,
  canvasHeight: number,
  paddingX: number = 60,
  paddingY: number = 50
): PathSegment[] {
  const segments: PathSegment[] = [];
  const { columns, rows, bridges } = ladder;

  const usableWidth = canvasWidth - paddingX * 2;
  const usableHeight = canvasHeight - paddingY * 2;
  const colSpacing = usableWidth / (columns - 1 || 1);
  const rowSpacing = usableHeight / (rows + 1);

  let currentCol = startColumn;

  for (let r = 0; r <= rows; r++) {
    const y1 = paddingY + r * rowSpacing;
    const y2 = paddingY + (r + 1) * rowSpacing;
    const x = paddingX + currentCol * colSpacing;

    if (r < rows) {
      // Check for bridge to the right
      if (currentCol < columns - 1 && bridges[r][currentCol]) {
        // Go down to bridge level
        segments.push({
          fromX: x,
          fromY: y1,
          toX: x,
          toY: y2,
          type: "vertical",
        });
        // Go right
        const nextX = paddingX + (currentCol + 1) * colSpacing;
        segments.push({
          fromX: x,
          fromY: y2,
          toX: nextX,
          toY: y2,
          type: "horizontal",
        });
        currentCol++;
      }
      // Check for bridge to the left
      else if (currentCol > 0 && bridges[r][currentCol - 1]) {
        // Go down to bridge level
        segments.push({
          fromX: x,
          fromY: y1,
          toX: x,
          toY: y2,
          type: "vertical",
        });
        // Go left
        const prevX = paddingX + (currentCol - 1) * colSpacing;
        segments.push({
          fromX: x,
          fromY: y2,
          toX: prevX,
          toY: y2,
          type: "horizontal",
        });
        currentCol--;
      }
      // No bridge, just go down
      else {
        segments.push({
          fromX: x,
          fromY: y1,
          toX: x,
          toY: y2,
          type: "vertical",
        });
      }
    } else {
      // Last segment to bottom
      segments.push({
        fromX: x,
        fromY: y1,
        toX: x,
        toY: paddingY + usableHeight,
        type: "vertical",
      });
    }
  }

  return segments;
}

export function getResultIndex(
  ladder: LadderData,
  startColumn: number
): number {
  const { columns, rows, bridges } = ladder;
  let currentCol = startColumn;

  for (let r = 0; r < rows; r++) {
    if (currentCol < columns - 1 && bridges[r][currentCol]) {
      currentCol++;
    } else if (currentCol > 0 && bridges[r][currentCol - 1]) {
      currentCol--;
    }
  }

  return currentCol;
}
