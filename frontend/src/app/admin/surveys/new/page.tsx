"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ChevronLeft } from "lucide-react";
import type { SurveyAccessMode } from "@/types/survey";

export default function NewSurveyPage() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [accessMode, setAccessMode] = useState<SurveyAccessMode>("authenticated");
  const [isAnonymous, setIsAnonymous] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreate = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/surveys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: slug.trim(),
          title: title.trim(),
          description: description.trim() || undefined,
          access_mode: accessMode,
          is_anonymous: isAnonymous,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "생성에 실패했습니다.");
      }
      const survey = await res.json();
      router.push(`/admin/surveys/${survey.id}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      setSaving(false);
    }
  };

  return (
    <div className="max-w-xl">
      <Link
        href="/admin/surveys"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4"
      >
        <ChevronLeft className="h-4 w-4" />
        설문 목록
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">새 설문 만들기</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">제목</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: Claude Code 생산성 설문"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="slug">slug (URL 경로)</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="claude-code-productivity"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">
              영소문자·숫자·하이픈만. 응답 URL은 /survey/{slug || "<slug>"} 입니다.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">설명 (선택)</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="설문 목적·안내 문구"
              rows={3}
            />
          </div>

          <div className="space-y-1.5">
            <Label>접근 모드</Label>
            <Select
              value={accessMode}
              onValueChange={(v) => setAccessMode(v as SurveyAccessMode)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="authenticated">로그인 사용자 전용</SelectItem>
                <SelectItem value="public">공개 (익명 링크)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <Label htmlFor="anon" className="text-sm">
                익명 집계
              </Label>
              <p className="text-xs text-muted-foreground">
                보고 단계에서 개인 식별 정보를 분리합니다.
              </p>
            </div>
            <Switch id="anon" checked={isAnonymous} onCheckedChange={setIsAnonymous} />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2 pt-2">
            <Link href="/admin/surveys">
              <Button variant="outline" disabled={saving}>
                취소
              </Button>
            </Link>
            <Button
              onClick={handleCreate}
              disabled={saving || !slug.trim() || !title.trim()}
            >
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              생성 후 문항 편집
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
