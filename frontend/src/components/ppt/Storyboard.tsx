import { Badge } from "@/components/ui/badge";
import type { StorySection } from "@/lib/ppt/storyboard";

export default function Storyboard({ sections }: { sections: StorySection[] }) {
  return (
    <div className="space-y-6">
      {sections.map((sec, si) => (
        <section key={si} className="space-y-3">
          <h3 className="flex items-baseline gap-2 text-sm font-semibold"><span className="text-sky-600">{String(si + 1).padStart(2, "0")}.</span>{sec.name}{sec.subs.length > 0 && <span className="text-xs font-normal text-muted-foreground">{sec.subs.join(" · ")}</span>}</h3>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {sec.slides.map((sl) => (
              <article key={sl.index} className="rounded-lg border bg-card p-3 text-sm">
                <div className="mb-1 flex items-center justify-between"><Badge variant="outline" className="font-mono text-[11px]">{sl.layout}</Badge><span className="text-xs text-muted-foreground">장표 {sl.index + 1}</span></div>
                {sl.title.length > 0 && <div className="font-medium">{sl.title.map((t, i) => <div key={i} className={i === sl.title.length - 1 && sl.title.length > 1 ? "text-sky-700" : ""}>{t}</div>)}</div>}
                {sl.groups.map((g, gi) => (
                  <div key={gi} className="mt-2 space-y-1">
                    <div className="text-[11px] uppercase text-muted-foreground">{g.label}</div>
                    <ul className="space-y-1">
                      {g.items.map((it, ii) => (
                        <li key={ii} className="rounded bg-muted/40 px-2 py-1">
                          {it.title && <div className="font-medium">{it.title}</div>}
                          {it.body.map((b, bi) => <div key={bi} className="text-muted-foreground whitespace-pre-wrap">{b}</div>)}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                {sl.footer.length > 0 && <div className="mt-2 border-t pt-2 text-xs text-muted-foreground">{sl.footer.map((f, fi) => <div key={fi}>{f}</div>)}</div>}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
