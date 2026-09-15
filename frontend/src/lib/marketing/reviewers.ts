export interface MarketingReviewer {
 userId: string; name: string; email: string; role: string;
 isManager: boolean; pageAccess: boolean; explicit: boolean; canReview: boolean;
 grantedAt: string | null; grantedBy: string | null; version: string;
}
export interface ReviewerDirectory {
 canImport: boolean; canManage: boolean; rows: MarketingReviewer[]; total: number; pageSize: number;
 history: { id: string; created_at: string; actor_name: string; name: string; email: string; user_id: string; enabled: boolean; reason: string }[];
}
