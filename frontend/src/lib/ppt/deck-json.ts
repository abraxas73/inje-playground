export type DeckMeta = { title: string[]; subtitle?: string; ver?: string; date?: string; dept?: string; author?: string; body_only?: boolean };
export type KeepSlide = { keep: true };
export type SlideJson = ({ layout: string; sub?: string } & Record<string, unknown>) | KeepSlide;
export type SectionJson = { name: string; subs?: string[]; label?: string; slides: SlideJson[] };
export type DeckJson = { meta: DeckMeta; sections: SectionJson[] };
