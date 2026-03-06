"use client";

import DooraySettings from "@/components/settings/DooraySettings";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Settings, Link2 } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="animate-fade-up">
      <div className="flex items-center gap-3 mb-8">
        <div className="h-10 w-10 rounded-xl bg-amber-100 flex items-center justify-center">
          <Settings className="h-5 w-5 text-amber-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">설정</h1>
          <p className="text-sm text-muted-foreground">외부 서비스 연동을 설정합니다</p>
        </div>
      </div>

      <Card className="animate-fade-up delay-100">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Link2 className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Dooray 연동</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <DooraySettings />
        </CardContent>
      </Card>
    </div>
  );
}
