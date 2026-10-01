"use client";
import { useRef, useState } from "react";
import { FileUp, Link2, Loader2, Sparkles, Type, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { createDeck, uploadSource } from "@/lib/ppt/client";
import { DEFAULT_PPT_MODEL, PPT_MODEL_OPTIONS, PPT_SOURCE_EXTENSIONS_TEXT, SOURCE_MAX_CHARS, type PptTemplateOption } from "@/types/ppt";

const BUILTIN = "builtin";

const ACCEPT = ".docx,.pdf,.hwp,.hwpx,.pptx,.md,.txt";

export default function NewDeckForm({ llmAvailable, templates, onCreated }: { llmAvailable: boolean; templates: PptTemplateOption[]; onCreated: (deckId: string) => void }) {
  const [tab, setTab] = useState<"text" | "file" | "url">("file");
  const [text, setText] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [prompt, setPrompt] = useState("");
  const [title, setTitle] = useState("");
  const [dept, setDept] = useState("");
  const [model, setModel] = useState(DEFAULT_PPT_MODEL);
  const [templateId, setTemplateId] = useState<string>(() => templates.find((t) => t.isDefault)?.id ?? BUILTIN);
  const [busy, setBusy] = useState<"upload" | "create" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!llmAvailable) {
    return (
      <Alert><AlertDescription>PPT 생성에 필요한 AI 모델 또는 PPT 서비스가 이 서버에 설정되어 있지 않습니다. 관리자에게 문의하세요.</AlertDescription></Alert>
    );
  }
  const tooLong = text.length > SOURCE_MAX_CHARS;
  const canSubmit = !busy && !tooLong && (tab === "text" ? text.trim().length > 0 : tab === "url" ? /^https:\/\/\S+\.\S+/i.test(url.trim()) : !!file);

  const submit = async () => {
    setError(null);
    try {
      let body: Parameters<typeof createDeck>[0] = { prompt, title: title.trim() || undefined, dept: dept.trim() || undefined, model, templateId: templateId === BUILTIN ? null : templateId };
      if (tab === "text") body = { ...body, text };
      else if (tab === "url") body = { ...body, url: url.trim() };
      else {
        setBusy("upload");
        const ticket = await uploadSource(file!);
        body = { ...body, storagePath: ticket.storagePath, fileName: file!.name };
      }
      setBusy("create");
      const { deckId } = await createDeck(body);
      onCreated(deckId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 요청에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Sparkles className="h-4 w-4 text-sky-600" />새로 만들기</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "text" | "file" | "url")}>
          <TabsList className="grid h-auto w-full grid-cols-3 gap-1 bg-muted p-1">
            {([
              ["file", FileUp, "파일 원고", "docx·pdf·pptx 등 업로드"],
              ["url", Link2, "URL 원고", "웹 페이지 주소"],
              ["text", Type, "텍스트 원고", "직접 붙여 넣기"],
            ] as const).map(([v, Icon, label, hint]) => (
              <TabsTrigger key={v} value={v} className="flex h-auto flex-col items-center gap-0.5 rounded-md py-2 data-[state=active]:bg-sky-600 data-[state=active]:text-white data-[state=active]:shadow">
                <span className="flex items-center gap-1.5 text-sm font-medium"><Icon className="h-4 w-4" />{label}</span>
                <span className="text-[11px] font-normal opacity-80">{hint}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value="file" className="space-y-2">
            <input ref={inputRef} type="file" accept={ACCEPT} className="hidden" onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ""; }} />
            <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={!!busy}><Upload className="mr-2 h-4 w-4" />{file ? file.name : "파일 선택"}</Button>
            <p className="text-xs text-muted-foreground">{PPT_SOURCE_EXTENSIONS_TEXT} · 50MB 이하. PPT 원고는 장표 순서를 그대로 유지하고 그림·도식을 가져옵니다.</p>
          </TabsContent>
          <TabsContent value="url" className="space-y-2">
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… 공개 웹 페이지·PDF·DOCX 주소" inputMode="url" autoComplete="off" />
            <p className="text-xs text-muted-foreground">서버가 본문 글만 가져와 원고로 씁니다(메뉴·광고 제외, 60,000자까지). 로그인이 필요하거나 스크립트로만 그려지는 페이지는 가져오지 못합니다 — 그때는 내용을 복사해 텍스트 원고로 넣어 주세요. 사내망 주소는 받지 않습니다.</p>
          </TabsContent>
          <TabsContent value="text" className="space-y-1">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="보고서·제안서 원고를 붙여 넣으세요. 마크다운 목차(#, ##)가 있으면 그대로 섹션이 됩니다." />
            <div className={`text-right text-xs ${tooLong ? "text-destructive" : "text-muted-foreground"}`}>{text.length.toLocaleString("ko-KR")} / {SOURCE_MAX_CHARS.toLocaleString("ko-KR")}자</div>
          </TabsContent>
        </Tabs>
        <div className="space-y-1">
          <Label htmlFor="ppt-prompt">프롬프트(선택)</Label>
          <Textarea id="ppt-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} maxLength={2000} placeholder="예: 경영진 보고용, 12장 이내, 결론 먼저" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1"><Label htmlFor="ppt-template">템플릿</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="ppt-template" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{(templates.length ? templates : [{ id: null, name: "기본형", isDefault: true }]).map((t) => <SelectItem key={t.id ?? BUILTIN} value={t.id ?? BUILTIN}>{t.name}{t.isDefault && <span className="ml-2 text-xs text-muted-foreground">기본</span>}</SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1"><Label htmlFor="ppt-model">모델</Label>
            <Select value={model} onValueChange={setModel}>
              <SelectTrigger id="ppt-model" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>{PPT_MODEL_OPTIONS.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}<span className="ml-2 text-xs text-muted-foreground">{o.note}</span></SelectItem>)}</SelectContent>
            </Select></div>
          <div className="space-y-1"><Label htmlFor="ppt-title">표지 제목(선택)</Label><Input id="ppt-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="비우면 원고에서 정합니다(목록에는 파일명·첫 줄이 먼저 보입니다)" /></div>
          <div className="space-y-1"><Label htmlFor="ppt-dept">부서명(선택)</Label><Input id="ppt-dept" value={dept} onChange={(e) => setDept(e.target.value)} maxLength={60} placeholder="비우면 '부서명'으로 표기됩니다" /></div>
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <div className="flex justify-end">
          <Button onClick={submit} disabled={!canSubmit}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {busy === "upload" ? "업로드 중…" : busy === "create" ? (tab === "url" ? "페이지 가져오는 중…" : "요청 중…") : "생성"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
