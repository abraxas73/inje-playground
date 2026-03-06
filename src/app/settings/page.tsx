"use client";

import DooraySettings from "@/components/settings/DooraySettings";

export default function SettingsPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-slate-900 mb-6">설정</h1>

      <section className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-4">
          Dooray 연동
        </h2>
        <DooraySettings />
      </section>
    </div>
  );
}
