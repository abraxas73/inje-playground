/** GET /api/ms/connection — 토큰은 절대 포함하지 않는다 */
export type MsConnectionStatus =
  | { connected: false }
  | {
      connected: true;
      accountUpn: string | null;
      accountName: string | null;
      connectedAt: string;
      lastUsedAt: string | null;
      /** refresh 실패 코드(invalid_grant 등)·"decrypt". 있으면 화면은 "다시 연결" 안내 */
      lastError: string | null;
      scopes: string[];
    };
