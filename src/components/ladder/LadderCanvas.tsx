"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import type { LadderData, PathSegment } from "@/types/ladder";
import { generateLadder, tracePath } from "@/lib/ladder";
import { Button } from "@/components/ui/button";
import { Play, Eye } from "lucide-react";

interface LadderCanvasProps {
  participants: string[];
  results: string[];
  bridgeDensity: number;
  onAnimationStart?: () => void;
  onAllRevealed?: (mappings: { participant: string; result: string }[]) => void;
}

const PADDING_X = 60;
const PADDING_Y = 60;
const PATH_COLORS = [
  "#ef4444",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
  "#14b8a6",
  "#6366f1",
];

export default function LadderCanvas({
  participants,
  results,
  bridgeDensity,
  onAnimationStart,
  onAllRevealed,
}: LadderCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [ladder, setLadder] = useState<LadderData | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 500 });
  const [animatingPath, setAnimatingPath] = useState<{
    segments: PathSegment[];
    currentSegment: number;
    progress: number;
    columnIndex: number;
  } | null>(null);
  const [revealedPaths, setRevealedPaths] = useState<
    { segments: PathSegment[]; color: string; resultIndex: number; startCol: number }[]
  >([]);
  const [isRevealed, setIsRevealed] = useState(false);
  const animFrameRef = useRef<number>(0);
  const hasCalledAnimStartRef = useRef(false);

  const handleGenerate = useCallback(() => {
    if (participants.length < 2 || results.length < 2) return;
    const newLadder = generateLadder(participants, results, bridgeDensity);
    setLadder(newLadder);
    setRevealedPaths([]);
    setAnimatingPath(null);
    setIsRevealed(false);
    hasCalledAnimStartRef.current = false;
  }, [participants, results, bridgeDensity]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      const height = Math.max(400, Math.min(600, width * 0.65));
      setCanvasSize({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const buildMappings = useCallback(
    (paths: typeof revealedPaths) => {
      if (!ladder) return [];
      return paths.map((p) => ({
        participant: ladder.participants[p.startCol] || "",
        result: ladder.results[p.resultIndex] || "",
      }));
    },
    [ladder]
  );

  const checkAllRevealed = useCallback(
    (paths: typeof revealedPaths) => {
      if (!ladder) return;
      if (paths.length === ladder.columns) {
        onAllRevealed?.(buildMappings(paths));
      }
    },
    [ladder, onAllRevealed, buildMappings]
  );

  const drawLadder = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      if (!ladder) return;

      const { width, height } = canvasSize;
      const dpr = window.devicePixelRatio || 1;

      ctx.clearRect(0, 0, width * dpr, height * dpr);
      ctx.save();
      ctx.scale(dpr, dpr);

      const { columns, rows, bridges } = ladder;
      const usableWidth = width - PADDING_X * 2;
      const usableHeight = height - PADDING_Y * 2;
      const colSpacing = usableWidth / (columns - 1 || 1);
      const rowSpacing = usableHeight / (rows + 1);

      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 2;
      for (let c = 0; c < columns; c++) {
        const x = PADDING_X + c * colSpacing;
        ctx.beginPath();
        ctx.moveTo(x, PADDING_Y);
        ctx.lineTo(x, PADDING_Y + usableHeight);
        ctx.stroke();
      }

      ctx.strokeStyle = "#94a3b8";
      ctx.lineWidth = 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < columns - 1; c++) {
          if (bridges[r][c]) {
            const x1 = PADDING_X + c * colSpacing;
            const x2 = PADDING_X + (c + 1) * colSpacing;
            const y = PADDING_Y + (r + 1) * rowSpacing;
            ctx.beginPath();
            ctx.moveTo(x1, y);
            ctx.lineTo(x2, y);
            ctx.stroke();
          }
        }
      }

      ctx.fillStyle = "#0f172a";
      ctx.font = "bold 13px sans-serif";
      ctx.textAlign = "center";
      for (let c = 0; c < columns; c++) {
        const x = PADDING_X + c * colSpacing;
        ctx.fillText(ladder.participants[c] || "", x, PADDING_Y - 15);
      }

      for (let c = 0; c < columns; c++) {
        const x = PADDING_X + c * colSpacing;
        const revealedPath = revealedPaths.find((p) => p.resultIndex === c);
        const isThisRevealed = !!revealedPath;

        if (isRevealed || isThisRevealed) {
          ctx.fillStyle = "#0f172a";
          ctx.font = "bold 13px sans-serif";
          ctx.fillText(ladder.results[c] || "", x, PADDING_Y + usableHeight + 25);

          if (revealedPath) {
            const participantName = ladder.participants[revealedPath.startCol] || "";
            ctx.fillStyle = revealedPath.color;
            ctx.font = "11px sans-serif";
            ctx.fillText(participantName, x, PADDING_Y + usableHeight + 42);
          } else if (isRevealed) {
            const matchingPath = revealedPaths.find((p) => p.resultIndex === c);
            if (matchingPath) {
              const participantName = ladder.participants[matchingPath.startCol] || "";
              ctx.fillStyle = matchingPath.color;
              ctx.font = "11px sans-serif";
              ctx.fillText(participantName, x, PADDING_Y + usableHeight + 42);
            }
          }
        } else {
          ctx.fillStyle = "#94a3b8";
          ctx.font = "13px sans-serif";
          ctx.fillText("?", x, PADDING_Y + usableHeight + 25);
        }
      }

      for (const path of revealedPaths) {
        ctx.strokeStyle = path.color;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        for (const seg of path.segments) {
          ctx.beginPath();
          ctx.moveTo(seg.fromX, seg.fromY);
          ctx.lineTo(seg.toX, seg.toY);
          ctx.stroke();
        }
      }

      if (animatingPath) {
        const { segments, currentSegment, progress } = animatingPath;
        const color = PATH_COLORS[animatingPath.columnIndex % PATH_COLORS.length];
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.lineCap = "round";

        for (let i = 0; i < currentSegment; i++) {
          const seg = segments[i];
          ctx.beginPath();
          ctx.moveTo(seg.fromX, seg.fromY);
          ctx.lineTo(seg.toX, seg.toY);
          ctx.stroke();
        }

        if (currentSegment < segments.length) {
          const seg = segments[currentSegment];
          const dx = seg.toX - seg.fromX;
          const dy = seg.toY - seg.fromY;
          ctx.beginPath();
          ctx.moveTo(seg.fromX, seg.fromY);
          ctx.lineTo(seg.fromX + dx * progress, seg.fromY + dy * progress);
          ctx.stroke();
        }
      }

      ctx.restore();
    },
    [ladder, canvasSize, revealedPaths, animatingPath, isRevealed]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !ladder) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;
    canvas.style.width = `${canvasSize.width}px`;
    canvas.style.height = `${canvasSize.height}px`;

    drawLadder(ctx);
  }, [ladder, canvasSize, drawLadder]);

  useEffect(() => {
    if (!animatingPath || !canvasRef.current) return;

    const { segments, currentSegment } = animatingPath;
    if (currentSegment >= segments.length) {
      const color = PATH_COLORS[animatingPath.columnIndex % PATH_COLORS.length];
      const resultIndex =
        ladder
          ? (() => {
              const lastSeg = segments[segments.length - 1];
              const colSpacing =
                (canvasSize.width - PADDING_X * 2) /
                ((ladder.columns - 1) || 1);
              return Math.round((lastSeg.toX - PADDING_X) / colSpacing);
            })()
          : 0;

      setRevealedPaths((prev) => {
        const newPaths = [
          ...prev,
          { segments, color, resultIndex, startCol: animatingPath.columnIndex },
        ];
        setTimeout(() => checkAllRevealed(newPaths), 0);
        return newPaths;
      });
      setAnimatingPath(null);
      return;
    }

    const seg = segments[currentSegment];
    const segLength = Math.sqrt(
      (seg.toX - seg.fromX) ** 2 + (seg.toY - seg.fromY) ** 2
    );
    const duration = Math.max(40, Math.min(120, segLength * 1.5));

    let start: number | null = null;
    const animate = (timestamp: number) => {
      if (!start) start = timestamp;
      const elapsed = timestamp - start;
      const progress = Math.min(1, elapsed / duration);

      setAnimatingPath((prev) =>
        prev ? { ...prev, progress } : null
      );

      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(animate);
      } else {
        setAnimatingPath((prev) =>
          prev
            ? { ...prev, currentSegment: prev.currentSegment + 1, progress: 0 }
            : null
        );
      }
    };

    animFrameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [animatingPath?.currentSegment, ladder, canvasSize, checkAllRevealed]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!ladder || animatingPath) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const { columns } = ladder;
    const colSpacing = (canvasSize.width - PADDING_X * 2) / (columns - 1 || 1);

    for (let c = 0; c < columns; c++) {
      const labelX = PADDING_X + c * colSpacing;
      if (Math.abs(x - labelX) < 30 && y < PADDING_Y) {
        if (revealedPaths.some((p) => p.startCol === c)) return;

        if (!hasCalledAnimStartRef.current) {
          hasCalledAnimStartRef.current = true;
          onAnimationStart?.();
        }

        const segments = tracePath(
          ladder,
          c,
          canvasSize.width,
          canvasSize.height,
          PADDING_X,
          PADDING_Y
        );
        setAnimatingPath({
          segments,
          currentSegment: 0,
          progress: 0,
          columnIndex: c,
        });
        break;
      }
    }
  };

  const handleRevealAll = () => {
    if (!ladder) return;
    setIsRevealed(true);

    const allPaths: typeof revealedPaths = [];
    for (let c = 0; c < ladder.columns; c++) {
      if (revealedPaths.some((p) => p.startCol === c)) continue;
      const segments = tracePath(
        ladder,
        c,
        canvasSize.width,
        canvasSize.height,
        PADDING_X,
        PADDING_Y
      );
      const lastSeg = segments[segments.length - 1];
      const colSpacing =
        (canvasSize.width - PADDING_X * 2) / ((ladder.columns - 1) || 1);
      const resultIndex = Math.round((lastSeg.toX - PADDING_X) / colSpacing);

      allPaths.push({
        segments,
        color: PATH_COLORS[c % PATH_COLORS.length],
        resultIndex,
        startCol: c,
      });
    }

    const combined = [...revealedPaths, ...allPaths];
    setRevealedPaths(combined);
    setAnimatingPath(null);

    onAllRevealed?.(buildMappings(combined));
  };

  const canStart = participants.length >= 2 && results.length >= 2;

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Button
          onClick={handleGenerate}
          disabled={!canStart}
          className="rounded-xl shadow-md hover:shadow-lg transition-shadow"
        >
          <Play className="h-4 w-4 mr-1.5" />
          {ladder ? "사다리 다시 만들기" : "사다리 만들기"}
        </Button>
        {ladder && (
          <Button
            onClick={handleRevealAll}
            disabled={!!animatingPath}
            variant="secondary"
            className="rounded-xl"
          >
            <Eye className="h-4 w-4 mr-1.5" />
            전체 공개
          </Button>
        )}
      </div>

      {!canStart && (
        <p className="text-sm text-muted-foreground">
          참여자와 결과를 각각 2개 이상 입력해주세요.
        </p>
      )}

      {ladder && (
        <div ref={containerRef} className="w-full">
          <p className="text-xs text-muted-foreground mb-2">
            상단의 이름을 클릭하면 경로가 표시됩니다.
          </p>
          <canvas
            ref={canvasRef}
            onClick={handleCanvasClick}
            className="w-full rounded-xl bg-card border cursor-pointer"
            style={{
              width: canvasSize.width,
              height: canvasSize.height,
            }}
          />
        </div>
      )}
    </div>
  );
}
