import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function AccessDeniedPage() {
  return <div className="flex flex-col items-center gap-4 py-20 text-center">
    <ShieldAlert className="h-10 w-10 text-muted-foreground" />
    <h1 className="text-xl font-semibold">페이지 접근 권한을 확인해 주세요</h1>
    <p className="text-sm text-muted-foreground">접근이 제한되었거나 권한을 확인하지 못했습니다. 권한이 필요하면 관리자에게 문의해 주세요.</p>
    <Button asChild variant="outline"><Link href="/">홈으로 돌아가기</Link></Button>
  </div>;
}
