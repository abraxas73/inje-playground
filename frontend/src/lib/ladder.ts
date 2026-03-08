import type { LadderData, LadderResult, PathSegment } from "@/types/ladder";

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function generateLadder(
  participants: string[],
  results: LadderResult[],
  bridgeDensity: number = 0.4
): LadderData {
  const columns = participants.length;
  const rows = Math.max(columns * 2, 6);
  const bridges: boolean[][] = [];

  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < columns - 1; c++) {
      const prevBridge = c > 0 && row[c - 1];
      row.push(!prevBridge && Math.random() < bridgeDensity);
    }
    bridges.push(row);
  }

  // Pad results to match participant count, then shuffle both
  const paddedResults: LadderResult[] = [...results];
  while (paddedResults.length < columns) {
    paddedResults.push({ text: `꽝 ${paddedResults.length - results.length + 1}`, type: "normal" });
  }
  // Trim if more results than participants
  const trimmedResults = paddedResults.slice(0, columns);

  const shuffledParticipants = shuffle(participants);
  const shuffledResults = shuffle(trimmedResults);

  return { participants: shuffledParticipants, results: shuffledResults, columns, rows, bridges };
}

export function rebuildLadder(
  participants: string[],
  results: LadderResult[],
  bridges: boolean[][],
): LadderData {
  const columns = participants.length;
  const rows = bridges.length;
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
      if (currentCol < columns - 1 && bridges[r][currentCol]) {
        segments.push({ fromX: x, fromY: y1, toX: x, toY: y2, type: "vertical" });
        const nextX = paddingX + (currentCol + 1) * colSpacing;
        segments.push({ fromX: x, fromY: y2, toX: nextX, toY: y2, type: "horizontal" });
        currentCol++;
      } else if (currentCol > 0 && bridges[r][currentCol - 1]) {
        segments.push({ fromX: x, fromY: y1, toX: x, toY: y2, type: "vertical" });
        const prevX = paddingX + (currentCol - 1) * colSpacing;
        segments.push({ fromX: x, fromY: y2, toX: prevX, toY: y2, type: "horizontal" });
        currentCol--;
      } else {
        segments.push({ fromX: x, fromY: y1, toX: x, toY: y2, type: "vertical" });
      }
    } else {
      segments.push({
        fromX: x, fromY: y1, toX: x, toY: paddingY + usableHeight, type: "vertical",
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
