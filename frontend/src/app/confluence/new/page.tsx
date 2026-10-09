"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import PublishForm from "@/components/confluence/PublishForm";
import { meetingNotesMarkdown, meetingNotesTitle } from "@/lib/confluence/templates";

const todayKst = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);

/** 회의록 만들기 — 회의 정보로 표준 회의록 틀을 채워 Confluence 페이지로. (앱의 이노봇은 아마란스 일정에서 자동으로 채운다) */
export default function NewMeetingNotesPage() {
  const [meeting, setMeeting] = useState({ name: "", date: todayKst(), time: "", place: "", attendees: "" });
  const [markdown, setMarkdown] = useState(() => meetingNotesMarkdown({ date: todayKst() }));
  const [touched, setTouched] = useState(false);
  const set = (k: keyof typeof meeting) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = { ...meeting, [k]: e.target.value };
    setMeeting(next);
    if (!touched) setMarkdown(meetingNotesMarkdown(next));
  };
  return <div className="animate-fade-up space-y-5">
    <div className="flex items-center gap-3">
      <Button asChild variant="ghost" size="icon" aria-label="내 Confluence로"><Link href="/confluence"><ArrowLeft className="h-4 w-4" /></Link></Button>
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50"><FilePlus2 className="h-5 w-5 text-sky-600" /></div>
      <div><h1 className="text-2xl font-bold tracking-tight">회의록 만들기</h1><p className="text-sm text-muted-foreground">회의 정보를 넣으면 표준 회의록 틀을 채웁니다 · 앱의 이노봇에게 “오늘 2시 회의 회의록 만들어줘”라고 해도 됩니다</p></div>
    </div>
    <div className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-5">
      <div className="space-y-1.5 md:col-span-2"><Label htmlFor="m-name">회의명</Label><Input id="m-name" value={meeting.name} onChange={set("name")} placeholder="예: 주간회의" /></div>
      <div className="space-y-1.5"><Label htmlFor="m-date">날짜</Label><Input id="m-date" type="date" value={meeting.date} onChange={set("date")} /></div>
      <div className="space-y-1.5"><Label htmlFor="m-time">시간</Label><Input id="m-time" value={meeting.time} onChange={set("time")} placeholder="14:00–15:00" /></div>
      <div className="space-y-1.5"><Label htmlFor="m-place">장소</Label><Input id="m-place" value={meeting.place} onChange={set("place")} placeholder="회의실 B" /></div>
      <div className="space-y-1.5 md:col-span-5"><Label htmlFor="m-att">참석자</Label><Input id="m-att" value={meeting.attendees} onChange={set("attendees")} placeholder="쉼표로 구분" /></div>
    </div>
    <PublishForm kind="meeting" title={meetingNotesTitle(meeting)} markdown={markdown} onMarkdown={(v) => { setTouched(true); setMarkdown(v); }} />
  </div>;
}
