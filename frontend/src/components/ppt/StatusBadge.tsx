import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { PptVersionStatus } from "@/types/ppt";

const LABEL: Record<PptVersionStatus, string> = { generating: "생성 중", building: "빌드 중", done: "완료", failed: "실패" };

export default function StatusBadge({ status }: { status: PptVersionStatus }) {
  const busy = status === "generating" || status === "building";
  return (
    <Badge variant={status === "failed" ? "destructive" : status === "done" ? "default" : "secondary"} className="gap-1">
      {busy && <Loader2 className="h-3 w-3 animate-spin" />}{LABEL[status]}
    </Badge>
  );
}
