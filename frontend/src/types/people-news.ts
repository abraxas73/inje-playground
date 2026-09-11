export type NoticeCategory = "personnel" | "obituary";

export interface PeopleNotice {
  source_id: string;
  category: NoticeCategory;
  title: string;
  summary: string;
  source_url: string;
  published_at: string;
}

export interface NoticeSync {
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed";
  item_count: number;
}

export interface PeopleNewsResponse {
  notices: PeopleNotice[];
  total: number;
  page: number;
  pageSize: number;
  lastSyncedAt: string | null;
  latestSync: NoticeSync | null;
}
