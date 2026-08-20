# Teams 연동(Provider 선택) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 채널 알림(A)·멤버 소스(B)·개인 DM(C) 각 축마다 Dooray ↔ Teams provider를 선택할 수 있게 하되, Dooray 기존 동작은 바이트 단위로 보존한다.

**Architecture:** 서버 측 `Notifier`(채널/DM 전송)와 클라이언트 측 `MemberSource`(멤버 목록) 두 인터페이스를 세우고, settings 테이블의 provider 키로 구현을 선택하는 팩토리를 둔다. 사람이 읽는 메시지 조립은 provider 무관 순수 함수로 추출한다. Teams는 알림/DM = Power Automate 웹훅 POST, 멤버 = Microsoft Graph app-only(client credentials, 서버 라우트)로 도달한다.

**Tech Stack:** Next.js 16 App Router(React 19, TS strict), Supabase(settings/user_settings 테이블), vitest 3(jsdom, globals) + @testing-library/react, shadcn/ui(Select/Input/Alert), Microsoft Graph v1.0, Power Automate HTTP 트리거.

**Spec:** `docs/superpowers/specs/2026-08-20-teams-integration-provider-design.md`

## Global Constraints

- **Dooray 무회귀**: 기존 Dooray 페이로드(`{botName, botIconImage, text}`, `{text, organizationMemberId}`), 응답 필드명(`webhook_sent`, `personal_messages_sent`, `dooray_messenger_url`, `dm_errors`), 오류 문자열 포맷(`dm(${memberId}): ${status} ${text}`, `exception(${memberId}): ...`)을 그대로 유지한다.
- **Provider 기본값 `dooray`**: 키 미설정·빈값·알 수 없는 값은 모두 `dooray`로 해석한다.
- **settings 키 이름(스펙 §4.1 그대로)**: `notify_provider`, `member_source_provider`, `dm_provider`, `teams_notify_webhook_url`, `teams_dm_webhook_url`, `teams_graph_client_id`, `teams_tenant_id`, `teams_group_id`.
- **Graph client secret은 오직 환경변수 `TEAMS_GRAPH_CLIENT_SECRET`**. settings 테이블 저장 금지, UI 입력란 금지.
- **Teams 웹훅 계약**: 채널 `{ "title": string, "text": string }`, DM `{ "recipientEmail": string, "text": string }`. (본 계획은 추가로 `html` 필드를 덧붙인다 — 스펙 계약의 상위 호환.)
- **Graph 호출**: 토큰 `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (`grant_type=client_credentials`, `scope=https://graph.microsoft.com/.default`), 멤버 `GET https://graph.microsoft.com/v1.0/groups/{groupId}/members/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName`, `@odata.nextLink` 페이지네이션, 이메일은 `mail` → `userPrincipalName` 폴백. 토큰은 메모리 캐시.
- **UI 문구는 한국어.** 테스트 파일은 `frontend/src/lib/__tests__/*.test.ts(x)`. 모든 명령은 `frontend/`에서 실행(`cd frontend`).
- **Git**: main 브랜치에서 직접 작업(feature 브랜치/worktree 만들지 말 것), 태스크마다 커밋. 커밋 메시지 끝에 `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- 기준선: 현재 `npx vitest run` = 5 files / 68 tests 통과. 각 태스크 종료 시 전체 스위트가 통과해야 한다.

---

## File Structure

| 경로 | 책임 | 상태 |
|---|---|---|
| `frontend/src/lib/providers.ts` | Provider 타입, settings 키 상수, `parseProvider`/`resolveProvider`, admin 전용 키 집합 | Create |
| `frontend/src/lib/settings-server.ts` | 서버 전용 `loadSettings`/`loadUserSettings` (settings·user_settings 테이블 → 맵) | Create |
| `frontend/src/lib/notify/types.ts` | `Notifier`, `ChannelMessage`, `DirectRecipient`, `SendResult`, `FetchLike` | Create |
| `frontend/src/lib/notify/messages.ts` | provider 무관 메시지 빌더 3종(팀 결과·점심 결정·가이드 DM) | Create |
| `frontend/src/lib/notify/dooray.ts` | Dooray Notifier(Incoming Hook + direct-send) — 기존 인라인 로직 추출 | Create |
| `frontend/src/lib/notify/teams.ts` | Teams Notifier(Power Automate 웹훅 2종) + `toTeamsHtml` | Create |
| `frontend/src/lib/notify/recipients.ts` | 요청 본문 → `DirectRecipient[]` 파서(`recipients` 우선, `member_ids` 하위호환) | Create |
| `frontend/src/lib/notify/index.ts` | `createNotifier(axis, settings)`(순수) / `getNotifier(supabase, axis, overrides)`(서버) | Create |
| `frontend/src/lib/members/types.ts` | `Member`, `MemberSource` | Create |
| `frontend/src/lib/members/dooray.ts` | 클라이언트: 브리지(`dooray-client.ts`) 래핑 | Create |
| `frontend/src/lib/members/teams.ts` | 클라이언트: `GET /api/teams/members` 호출 | Create |
| `frontend/src/lib/members/index.ts` | `getMemberSource(provider, doorayCfg)` | Create |
| `frontend/src/lib/teams-graph.ts` | 서버: Graph app-only 토큰(메모리 캐시) + 그룹 멤버 조회(페이지네이션) | Create |
| `frontend/src/hooks/useProviderSettings.ts` | 클라이언트 훅: 3축 provider 로드 | Create |
| `frontend/src/hooks/useSettings.ts` | 키 목록 기반으로 일반화 + Teams/provider 키 추가 | Modify |
| `frontend/src/components/settings/ProviderSettings.tsx` | 관리자: 3축 provider 셀렉트 + 조합 경고 | Create |
| `frontend/src/components/settings/TeamsSettings.tsx` | 관리자: Teams 설정 5개 입력 + env 안내 | Create |
| `frontend/src/app/admin/settings/page.tsx` | 카드 2개 추가 | Modify |
| `frontend/src/app/api/settings/route.ts` | GET: 비admin에게 웹훅 URL 숨김, PUT: admin 전용 | Modify |
| `frontend/src/app/api/team-notify/route.ts` | Notifier 사용 | Modify |
| `frontend/src/app/api/food/decide/route.ts` | Notifier 사용 + `recipients` 지원 | Modify |
| `frontend/src/app/api/guide/chat/route.ts` | Notifier 사용(이메일/멤버ID 수신자 분기) | Modify |
| `frontend/src/app/api/teams/members/route.ts` | `GET` — Graph로 그룹 멤버 반환 | Create |
| `frontend/src/components/shared/DoorayImportButton.tsx` | provider-aware(라벨·소스 분기) | Modify |
| `frontend/src/components/shared/DoorayProjectSelect.tsx` | Teams일 때 렌더 생략 | Modify |
| `frontend/src/components/food/FoodRecommendModal.tsx` | provider-aware 멤버 로드 + `recipients` 전송 | Modify |
| `docs/teams-integration.md` | 관리자 런북(Power Automate·Entra·env·settings) | Create |
| `CLAUDE.md`, `docs/dooray-integration.md` | 라우트/env/provider 안내 갱신 | Modify |

**스펙 단계 매핑**: 스펙 §11의 Phase 1(추상화+설정)은 본 계획 Phase 1(Task 1–10). 스펙 Phase 2(A 채널 Teams)·Phase 3(C DM Teams)은 Teams 웹훅 구현(Task 4)을 팩토리에 바로 연결하므로 Phase 1 안에서 함께 완료된다(stub 단계를 두지 않음 — 구현이 40줄 수준이라 stub→실구현 교체가 오히려 낭비). 점심 DM의 이메일 수신자는 멤버 소스가 Teams여야 확보되므로 스펙 Phase 4(B 멤버 Graph) = 본 계획 Phase 2(Task 11–15)에서 완결된다. Phase 3(Task 16)은 문서·최종 검증.

---

# Phase 1 — 추상화 + 설정 (Dooray 무회귀)

### Task 1: Provider 상수·파서

**Files:**
- Create: `frontend/src/lib/providers.ts`
- Test: `frontend/src/lib/__tests__/providers.test.ts`

**Interfaces:**
- Produces: `type Provider = "dooray" | "teams"`, `type ProviderAxis = "notify" | "memberSource" | "dm"`, `PROVIDER_SETTING_KEYS`, `TEAMS_SETTING_KEYS`, `ADMIN_ONLY_SETTING_KEYS`, `parseProvider(value)`, `resolveProvider(settings, axis)` — 이후 모든 태스크가 사용.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/providers.test.ts
import { describe, it, expect } from "vitest";
import {
  parseProvider,
  resolveProvider,
  PROVIDER_SETTING_KEYS,
  TEAMS_SETTING_KEYS,
  ADMIN_ONLY_SETTING_KEYS,
} from "@/lib/providers";

describe("parseProvider", () => {
  it("teams만 teams, 나머지는 모두 dooray 기본값", () => {
    expect(parseProvider("teams")).toBe("teams");
    expect(parseProvider(" Teams ")).toBe("teams");
    expect(parseProvider("dooray")).toBe("dooray");
    expect(parseProvider("")).toBe("dooray");
    expect(parseProvider(undefined)).toBe("dooray");
    expect(parseProvider(null)).toBe("dooray");
    expect(parseProvider("slack")).toBe("dooray");
  });
});

describe("resolveProvider", () => {
  it("축별 settings 키를 읽는다", () => {
    const s = { notify_provider: "teams", dm_provider: "dooray" };
    expect(resolveProvider(s, "notify")).toBe("teams");
    expect(resolveProvider(s, "dm")).toBe("dooray");
    expect(resolveProvider(s, "memberSource")).toBe("dooray");
  });

  it("키 이름이 스펙 §4.1과 일치한다", () => {
    expect(PROVIDER_SETTING_KEYS).toEqual({
      notify: "notify_provider",
      memberSource: "member_source_provider",
      dm: "dm_provider",
    });
    expect([...TEAMS_SETTING_KEYS]).toEqual([
      "teams_notify_webhook_url",
      "teams_dm_webhook_url",
      "teams_graph_client_id",
      "teams_tenant_id",
      "teams_group_id",
    ]);
  });
});

describe("ADMIN_ONLY_SETTING_KEYS", () => {
  it("웹훅 URL은 숨기고 dooray_token은 숨기지 않는다(브라우저 확장에서 사용)", () => {
    expect(ADMIN_ONLY_SETTING_KEYS.has("dooray_hook_url")).toBe(true);
    expect(ADMIN_ONLY_SETTING_KEYS.has("teams_notify_webhook_url")).toBe(true);
    expect(ADMIN_ONLY_SETTING_KEYS.has("teams_dm_webhook_url")).toBe(true);
    expect(ADMIN_ONLY_SETTING_KEYS.has("dooray_token")).toBe(false);
    expect(ADMIN_ONLY_SETTING_KEYS.has("notify_provider")).toBe(false);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/providers.test.ts`
Expected: FAIL — `Failed to resolve import "@/lib/providers"`

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/providers.ts
/** 연동 provider 식별자. 기본값은 항상 dooray. */
export type Provider = "dooray" | "teams";

/** 관리자가 독립적으로 선택하는 세 축 */
export type ProviderAxis = "notify" | "memberSource" | "dm";

/** 축 → settings 테이블 key */
export const PROVIDER_SETTING_KEYS: Record<ProviderAxis, string> = {
  notify: "notify_provider",
  memberSource: "member_source_provider",
  dm: "dm_provider",
};

/** Teams 관련 settings key (비밀 아님 — Graph client secret은 env 전용) */
export const TEAMS_SETTING_KEYS = [
  "teams_notify_webhook_url",
  "teams_dm_webhook_url",
  "teams_graph_client_id",
  "teams_tenant_id",
  "teams_group_id",
] as const;

/**
 * 비admin 인증 사용자에게 GET /api/settings 응답에서 제외할 키.
 * dooray_token은 브라우저(크롬 확장 브리지)에서 직접 쓰므로 제외 대상이 아니다.
 */
export const ADMIN_ONLY_SETTING_KEYS: ReadonlySet<string> = new Set([
  "dooray_hook_url",
  "teams_notify_webhook_url",
  "teams_dm_webhook_url",
]);

export function parseProvider(value: string | null | undefined): Provider {
  return value?.trim().toLowerCase() === "teams" ? "teams" : "dooray";
}

export function resolveProvider(
  settings: Record<string, string | undefined>,
  axis: ProviderAxis
): Provider {
  return parseProvider(settings[PROVIDER_SETTING_KEYS[axis]]);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/providers.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/providers.ts frontend/src/lib/__tests__/providers.test.ts
git commit -m "feat(teams): provider 상수·파서 추가(notify/memberSource/dm 축, 기본 dooray)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: 메시지 빌더 추출 (provider 무관)

**Files:**
- Create: `frontend/src/lib/notify/messages.ts`
- Test: `frontend/src/lib/__tests__/notify-messages.test.ts`

**Interfaces:**
- Produces: `buildTeamResultMessage(teams: TeamResultInput[]): string`, `buildFoodDecisionMessage(d: FoodDecisionInput): string`, `buildGuideDmText(question: string, answer: string): string`. 기존 라우트 3곳의 출력과 **문자 단위 동일**해야 한다(특성화 테스트).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/notify-messages.test.ts
import { describe, it, expect } from "vitest";
import {
  buildTeamResultMessage,
  buildFoodDecisionMessage,
  buildGuideDmText,
} from "@/lib/notify/messages";

describe("buildTeamResultMessage", () => {
  it("기존 team-notify 포맷과 동일", () => {
    const msg = buildTeamResultMessage([
      { name: "1팀", members: [{ name: "홍길동", hasCard: true }, { name: "김철수", hasCard: false }] },
      { name: "2팀", members: [{ name: "이영희", hasCard: false }] },
    ]);
    expect(msg).toBe(
      ["👥 팀 구성 결과", "", "**1팀** (2명): 홍길동(법카), 김철수", "**2팀** (1명): 이영희"].join("\n")
    );
  });
});

describe("buildFoodDecisionMessage", () => {
  // 주의: 운영 라우트는 `.filter(Boolean)`을 배열 전체에 적용하므로 빈 줄 placeholder("")도 제거된다 → 제목 뒤 빈 줄 없음
  it("선택 필드는 있을 때만 줄이 생긴다", () => {
    expect(
      buildFoodDecisionMessage({
        place_name: "우래옥",
        address: "서울 중구",
        category_name: "한식",
        place_url: "https://place.map.kakao.com/1",
        members: ["홍길동", "김철수"],
      })
    ).toBe(
      [
        "🍽️ 밥 먹으러 갑시다!",
        "📍 **우래옥**",
        "📫 서울 중구",
        "🏷️ 한식",
        "👥 홍길동, 김철수",
        "🔗 https://place.map.kakao.com/1",
      ].join("\n")
    );
  });

  it("null/빈 선택 필드는 생략", () => {
    expect(
      buildFoodDecisionMessage({ place_name: "우래옥", address: null, category_name: "", place_url: undefined, members: ["홍길동"] })
    ).toBe(["🍽️ 밥 먹으러 갑시다!", "📍 **우래옥**", "👥 홍길동"].join("\n"));
  });
});

describe("buildGuideDmText", () => {
  it("500자 초과 답변은 잘라내고 … 붙임", () => {
    const long = "가".repeat(600);
    const text = buildGuideDmText("질문?", long);
    expect(text.startsWith("📋 **가이드 Q&A 답변 알림**\n\n❓ **질문**: 질문?\n\n💡 **답변**:\n")).toBe(true);
    expect(text.endsWith("가".repeat(500) + "…")).toBe(true);
  });

  it("500자 이하는 그대로", () => {
    expect(buildGuideDmText("q", "a")).toBe("📋 **가이드 Q&A 답변 알림**\n\n❓ **질문**: q\n\n💡 **답변**:\na");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/notify-messages.test.ts`
Expected: FAIL — import 해석 실패

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/notify/messages.ts
/**
 * 사람이 읽는 알림 본문 조립. provider(Dooray/Teams)와 무관한 순수 함수.
 * 출력 포맷은 기존 라우트(team-notify, food/decide, guide/chat)와 동일해야 한다.
 */

export interface TeamResultInput {
  name: string;
  members: { name: string; hasCard: boolean }[];
}

export function buildTeamResultMessage(teams: TeamResultInput[]): string {
  const teamLines = teams.map((team) => {
    const memberNames = team.members
      .map((m) => (m.hasCard ? `${m.name}(법카)` : m.name))
      .join(", ");
    return `**${team.name}** (${team.members.length}명): ${memberNames}`;
  });
  return [`👥 팀 구성 결과`, ``, ...teamLines].join("\n");
}

export interface FoodDecisionInput {
  place_name: string;
  address?: string | null;
  category_name?: string | null;
  place_url?: string | null;
  members: string[];
}

export function buildFoodDecisionMessage(d: FoodDecisionInput): string {
  return [
    `🍽️ 밥 먹으러 갑시다!`,
    ``,
    `📍 **${d.place_name}**`,
    d.address ? `📫 ${d.address}` : null,
    d.category_name ? `🏷️ ${d.category_name}` : null,
    `👥 ${d.members.join(", ")}`,
    d.place_url ? `🔗 ${d.place_url}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export const GUIDE_DM_ANSWER_MAX = 500;

export function buildGuideDmText(question: string, answer: string): string {
  return [
    `📋 **가이드 Q&A 답변 알림**`,
    ``,
    `❓ **질문**: ${question}`,
    ``,
    `💡 **답변**:`,
    answer.length > GUIDE_DM_ANSWER_MAX ? answer.slice(0, GUIDE_DM_ANSWER_MAX) + "…" : answer,
  ].join("\n");
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/notify-messages.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/notify/messages.ts frontend/src/lib/__tests__/notify-messages.test.ts
git commit -m "refactor(notify): 알림 메시지 빌더를 provider 무관 순수 함수로 추출

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Notifier 인터페이스 + Dooray 구현

**Files:**
- Create: `frontend/src/lib/notify/types.ts`
- Create: `frontend/src/lib/notify/dooray.ts`
- Test: `frontend/src/lib/__tests__/notify-dooray.test.ts`

**Interfaces:**
- Consumes: `Provider` (Task 1)
- Produces:
  ```ts
  interface ChannelMessage { title: string; text: string; botName?: string }
  interface DirectRecipient { email?: string; memberId?: string; name?: string }
  interface SendResult { ok: boolean; error?: string }
  interface Notifier {
    readonly provider: Provider;
    readonly channelConfigured: boolean;
    readonly directConfigured: boolean;
    sendChannel(msg: ChannelMessage): Promise<SendResult>;
    sendDirect(recipient: DirectRecipient, msg: { text: string }): Promise<SendResult>;
  }
  type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
  createDoorayNotifier(cfg: { hookUrl?: string; token?: string }, fetchImpl?: FetchLike): Notifier
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/notify-dooray.test.ts
import { describe, it, expect, vi } from "vitest";
import { createDoorayNotifier, DOORAY_BOT_ICON } from "@/lib/notify/dooray";

function mockRes(status: number, body = ""): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => (body ? JSON.parse(body) : {}),
  } as unknown as Response;
}

describe("createDoorayNotifier.sendChannel", () => {
  it("Incoming Hook에 기존 페이로드 그대로 POST (botName = botName ?? title)", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(200));
    const n = createDoorayNotifier({ hookUrl: "https://hook.dooray.com/x" }, fetchImpl);
    expect(n.provider).toBe("dooray");
    expect(n.channelConfigured).toBe(true);

    const r = await n.sendChannel({ title: "팀 구성 결과", botName: "팀봇", text: "hello" });
    expect(r).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("https://hook.dooray.com/x", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ botName: "팀봇", botIconImage: DOORAY_BOT_ICON, text: "hello" }),
    });
  });

  it("botName 없으면 title을 botName으로 사용", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(200));
    await createDoorayNotifier({ hookUrl: "https://h" }, fetchImpl).sendChannel({ title: "점심봇", text: "t" });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).botName).toBe("점심봇");
  });

  it("hookUrl 미설정 → 호출 없이 not_configured", async () => {
    const fetchImpl = vi.fn();
    const n = createDoorayNotifier({}, fetchImpl);
    expect(n.channelConfigured).toBe(false);
    expect(await n.sendChannel({ title: "t", text: "x" })).toEqual({ ok: false, error: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("비정상 응답/예외는 ok:false로 삼킨다", async () => {
    expect(
      await createDoorayNotifier({ hookUrl: "https://h" }, vi.fn().mockResolvedValue(mockRes(500))).sendChannel({ title: "t", text: "x" })
    ).toEqual({ ok: false, error: "hook: 500" });
    expect(
      await createDoorayNotifier({ hookUrl: "https://h" }, vi.fn().mockRejectedValue(new Error("boom"))).sendChannel({ title: "t", text: "x" })
    ).toEqual({ ok: false, error: "hook exception: boom" });
  });
});

describe("createDoorayNotifier.sendDirect", () => {
  it("direct-send에 기존 페이로드·헤더 그대로 POST", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(200));
    const n = createDoorayNotifier({ token: "tok" }, fetchImpl);
    expect(n.directConfigured).toBe(true);

    const r = await n.sendDirect({ memberId: "m1", email: "ignored@x.com" }, { text: "hi" });
    expect(r).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("https://api.dooray.com/messenger/v1/channels/direct-send", {
      method: "POST",
      headers: { Authorization: "dooray-api tok", "Content-Type": "application/json" },
      body: JSON.stringify({ text: "hi", organizationMemberId: "m1" }),
    });
  });

  it("오류 문자열 포맷은 기존과 동일", async () => {
    const n = createDoorayNotifier({ token: "tok" }, vi.fn().mockResolvedValue(mockRes(403, "forbidden")));
    expect(await n.sendDirect({ memberId: "m1" }, { text: "hi" })).toEqual({ ok: false, error: "dm(m1): 403 forbidden" });

    const n2 = createDoorayNotifier({ token: "tok" }, vi.fn().mockRejectedValue(new Error("net")));
    expect(await n2.sendDirect({ memberId: "m1" }, { text: "hi" })).toEqual({ ok: false, error: "exception(m1): net" });
  });

  it("토큰 없음 → not_configured, memberId 없음 → 설명 오류", async () => {
    const fetchImpl = vi.fn();
    expect(await createDoorayNotifier({}, fetchImpl).sendDirect({ memberId: "m1" }, { text: "x" })).toEqual({ ok: false, error: "not_configured" });
    expect(await createDoorayNotifier({ token: "t" }, fetchImpl).sendDirect({ email: "a@b.c", name: "홍길동" }, { text: "x" })).toEqual({
      ok: false,
      error: "dm(홍길동): Dooray 멤버 ID 없음",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/notify-dooray.test.ts`
Expected: FAIL — import 해석 실패

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/notify/types.ts
import type { Provider } from "@/lib/providers";

export interface ChannelMessage {
  /** Teams 카드 제목 / Dooray botName 폴백 */
  title: string;
  text: string;
  /** Dooray Incoming Hook의 botName (없으면 title) */
  botName?: string;
}

export interface DirectRecipient {
  /** Teams DM 기준 식별자 */
  email?: string;
  /** Dooray direct-send 기준 식별자(organizationMemberId) */
  memberId?: string;
  /** 오류 메시지 표시용 */
  name?: string;
}

export interface SendResult {
  ok: boolean;
  /** ok=false일 때 사람이 읽는 사유. "not_configured"는 설정 누락(호출 안 함) */
  error?: string;
}

export interface Notifier {
  readonly provider: Provider;
  /** 채널 발송에 필요한 설정이 존재하는가 */
  readonly channelConfigured: boolean;
  /** DM 발송에 필요한 설정이 존재하는가 */
  readonly directConfigured: boolean;
  sendChannel(msg: ChannelMessage): Promise<SendResult>;
  sendDirect(recipient: DirectRecipient, msg: { text: string }): Promise<SendResult>;
}

/** 테스트 주입용 fetch 시그니처 */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
```

```ts
// frontend/src/lib/notify/dooray.ts
import type { ChannelMessage, DirectRecipient, FetchLike, Notifier, SendResult } from "./types";

export const DOORAY_API_BASE = "https://api.dooray.com";
export const DOORAY_BOT_ICON = "https://static.dooray.com/static_images/dooray-bot.png";

export interface DoorayNotifierConfig {
  /** 메신저 Incoming Hook URL (settings.dooray_hook_url) */
  hookUrl?: string;
  /** 개인 API 토큰 (user_settings.dooray_token > settings.dooray_token) */
  token?: string;
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createDoorayNotifier(cfg: DoorayNotifierConfig, fetchImpl: FetchLike = fetch): Notifier {
  const hookUrl = cfg.hookUrl?.trim() ?? "";
  const token = cfg.token?.trim() ?? "";

  return {
    provider: "dooray",
    channelConfigured: hookUrl.length > 0,
    directConfigured: token.length > 0,

    async sendChannel(msg: ChannelMessage): Promise<SendResult> {
      if (!hookUrl) return { ok: false, error: "not_configured" };
      try {
        const res = await fetchImpl(hookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            botName: msg.botName ?? msg.title,
            botIconImage: DOORAY_BOT_ICON,
            text: msg.text,
          }),
        });
        return res.ok ? { ok: true } : { ok: false, error: `hook: ${res.status}` };
      } catch (e) {
        return { ok: false, error: `hook exception: ${errMsg(e)}` };
      }
    },

    async sendDirect(recipient: DirectRecipient, msg: { text: string }): Promise<SendResult> {
      if (!token) return { ok: false, error: "not_configured" };
      const memberId = recipient.memberId;
      if (!memberId) {
        return { ok: false, error: `dm(${recipient.name ?? recipient.email ?? "?"}): Dooray 멤버 ID 없음` };
      }
      try {
        const res = await fetchImpl(`${DOORAY_API_BASE}/messenger/v1/channels/direct-send`, {
          method: "POST",
          headers: { Authorization: `dooray-api ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ text: msg.text, organizationMemberId: memberId }),
        });
        if (res.ok) return { ok: true };
        const errText = await res.text();
        return { ok: false, error: `dm(${memberId}): ${res.status} ${errText}` };
      } catch (e) {
        return { ok: false, error: `exception(${memberId}): ${errMsg(e)}` };
      }
    },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/notify-dooray.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/notify/types.ts frontend/src/lib/notify/dooray.ts frontend/src/lib/__tests__/notify-dooray.test.ts
git commit -m "feat(notify): Notifier 인터페이스 + Dooray 구현(Incoming Hook/direct-send 추출)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Teams Notifier (Power Automate 웹훅)

**Files:**
- Create: `frontend/src/lib/notify/teams.ts`
- Test: `frontend/src/lib/__tests__/notify-teams.test.ts`

**Interfaces:**
- Consumes: `Notifier`, `FetchLike` 등 (Task 3)
- Produces: `createTeamsNotifier(cfg: { notifyWebhookUrl?: string; dmWebhookUrl?: string }, fetchImpl?): Notifier`, `toTeamsHtml(text: string): string`
- 웹훅 페이로드: 채널 `{ title, text, html }`, DM `{ recipientEmail, text, html }` — 스펙 계약(`{title,text}`/`{recipientEmail,text}`)에 `html`을 덧붙인 상위 호환. `html`은 `**굵게**`→`<b>`, 줄바꿈→`<br>`, HTML 특수문자 이스케이프.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/notify-teams.test.ts
import { describe, it, expect, vi } from "vitest";
import { createTeamsNotifier, toTeamsHtml } from "@/lib/notify/teams";

function mockRes(status: number, body = ""): Response {
  return { ok: status >= 200 && status < 300, status, text: async () => body, json: async () => ({}) } as unknown as Response;
}

describe("toTeamsHtml", () => {
  it("마크다운 굵게/줄바꿈을 HTML로, 특수문자는 이스케이프", () => {
    expect(toTeamsHtml("**1팀** (2명): A, B\n<x> & y")).toBe("<b>1팀</b> (2명): A, B<br>&lt;x&gt; &amp; y");
  });
});

describe("createTeamsNotifier.sendChannel", () => {
  it("채널 웹훅에 {title,text,html} POST, 202도 성공", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(202));
    const n = createTeamsNotifier({ notifyWebhookUrl: "https://prod.westus.logic.azure.com/wf1" }, fetchImpl);
    expect(n.provider).toBe("teams");
    expect(n.channelConfigured).toBe(true);
    expect(n.directConfigured).toBe(false);

    expect(await n.sendChannel({ title: "팀 구성 결과", botName: "팀봇", text: "**1팀**\nA" })).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledWith("https://prod.westus.logic.azure.com/wf1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "팀 구성 결과", text: "**1팀**\nA", html: "<b>1팀</b><br>A" }),
    });
  });

  it("미설정 → not_configured, 실패 응답/예외 → ok:false", async () => {
    const fetchImpl = vi.fn();
    expect(await createTeamsNotifier({}, fetchImpl).sendChannel({ title: "t", text: "x" })).toEqual({ ok: false, error: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(
      await createTeamsNotifier({ notifyWebhookUrl: "https://w" }, vi.fn().mockResolvedValue(mockRes(401, "denied"))).sendChannel({ title: "t", text: "x" })
    ).toEqual({ ok: false, error: "teams hook: 401 denied" });
    expect(
      await createTeamsNotifier({ notifyWebhookUrl: "https://w" }, vi.fn().mockRejectedValue(new Error("boom"))).sendChannel({ title: "t", text: "x" })
    ).toEqual({ ok: false, error: "teams hook exception: boom" });
  });
});

describe("createTeamsNotifier.sendDirect", () => {
  it("DM 웹훅에 {recipientEmail,text,html} POST — 이메일 기준", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(mockRes(202));
    const n = createTeamsNotifier({ dmWebhookUrl: "https://w/dm" }, fetchImpl);
    expect(n.directConfigured).toBe(true);
    expect(await n.sendDirect({ email: " user@innogrid.com ", memberId: "ignored" }, { text: "hi" })).toEqual({ ok: true });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ recipientEmail: "user@innogrid.com", text: "hi", html: "hi" });
  });

  it("이메일 없는 수신자는 호출 없이 오류", async () => {
    const fetchImpl = vi.fn();
    expect(await createTeamsNotifier({ dmWebhookUrl: "https://w/dm" }, fetchImpl).sendDirect({ memberId: "m1", name: "홍길동" }, { text: "hi" })).toEqual({
      ok: false,
      error: "dm(홍길동): 이메일 없음 — Teams DM은 이메일 기준",
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("실패 응답/예외 포맷", async () => {
    expect(
      await createTeamsNotifier({ dmWebhookUrl: "https://w" }, vi.fn().mockResolvedValue(mockRes(500, "err"))).sendDirect({ email: "a@b.c" }, { text: "x" })
    ).toEqual({ ok: false, error: "dm(a@b.c): 500 err" });
    expect(
      await createTeamsNotifier({ dmWebhookUrl: "https://w" }, vi.fn().mockRejectedValue(new Error("net"))).sendDirect({ email: "a@b.c" }, { text: "x" })
    ).toEqual({ ok: false, error: "exception(a@b.c): net" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/notify-teams.test.ts`
Expected: FAIL — import 해석 실패

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/notify/teams.ts
import type { ChannelMessage, DirectRecipient, FetchLike, Notifier, SendResult } from "./types";

export interface TeamsNotifierConfig {
  /** A. 채널 게시 Power Automate 워크플로 HTTP 트리거 URL (settings.teams_notify_webhook_url) */
  notifyWebhookUrl?: string;
  /** C. 개인 DM Power Automate 워크플로 HTTP 트리거 URL (settings.teams_dm_webhook_url) */
  dmWebhookUrl?: string;
}

/**
 * Dooray식 마크다운 본문을 Teams "Post message" 커넥터(HTML 본문)용으로 변환.
 * 워크플로가 Adaptive Card(마크다운 지원)를 쓰면 `text`를, 단순 메시지면 `html`을 쓰면 된다.
 */
export function toTeamsHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\n/g, "<br>");
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function postJson(fetchImpl: FetchLike, url: string, payload: unknown): Promise<Response> {
  return fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function createTeamsNotifier(cfg: TeamsNotifierConfig, fetchImpl: FetchLike = fetch): Notifier {
  const notifyUrl = cfg.notifyWebhookUrl?.trim() ?? "";
  const dmUrl = cfg.dmWebhookUrl?.trim() ?? "";

  return {
    provider: "teams",
    channelConfigured: notifyUrl.length > 0,
    directConfigured: dmUrl.length > 0,

    async sendChannel(msg: ChannelMessage): Promise<SendResult> {
      if (!notifyUrl) return { ok: false, error: "not_configured" };
      try {
        const res = await postJson(fetchImpl, notifyUrl, { title: msg.title, text: msg.text, html: toTeamsHtml(msg.text) });
        if (res.ok) return { ok: true };
        return { ok: false, error: `teams hook: ${res.status} ${await res.text()}` };
      } catch (e) {
        return { ok: false, error: `teams hook exception: ${errMsg(e)}` };
      }
    },

    async sendDirect(recipient: DirectRecipient, msg: { text: string }): Promise<SendResult> {
      if (!dmUrl) return { ok: false, error: "not_configured" };
      const email = recipient.email?.trim();
      if (!email) {
        return { ok: false, error: `dm(${recipient.name ?? recipient.memberId ?? "?"}): 이메일 없음 — Teams DM은 이메일 기준` };
      }
      try {
        const res = await postJson(fetchImpl, dmUrl, { recipientEmail: email, text: msg.text, html: toTeamsHtml(msg.text) });
        if (res.ok) return { ok: true };
        return { ok: false, error: `dm(${email}): ${res.status} ${await res.text()}` };
      } catch (e) {
        return { ok: false, error: `exception(${email}): ${errMsg(e)}` };
      }
    },
  };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/notify-teams.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/notify/teams.ts frontend/src/lib/__tests__/notify-teams.test.ts
git commit -m "feat(teams): Power Automate 웹훅 기반 Teams Notifier(채널/DM)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: settings 로더 + Notifier 팩토리

**Files:**
- Create: `frontend/src/lib/settings-server.ts`
- Create: `frontend/src/lib/notify/index.ts`
- Test: `frontend/src/lib/__tests__/notify-factory.test.ts`

**Interfaces:**
- Consumes: `resolveProvider` (Task 1), `createDoorayNotifier` (Task 3), `createTeamsNotifier` (Task 4)
- Produces:
  ```ts
  // settings-server.ts (서버 전용)
  type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;
  loadSettings(supabase: ServerSupabase, keys: readonly string[]): Promise<Record<string, string>>
  loadUserSettings(supabase: ServerSupabase, userId: string, keys: readonly string[]): Promise<Record<string, string>>
  // notify/index.ts
  type NotifyAxis = "notify" | "dm";
  NOTIFIER_SETTING_KEYS: readonly string[]
  createNotifier(axis: NotifyAxis, settings: Record<string, string | undefined>): Notifier   // 순수
  getNotifier(supabase: ServerSupabase, axis: NotifyAxis, overrides?: Record<string, string | undefined>): Promise<Notifier>
  ```
  `overrides`의 truthy 값만 시스템 settings를 덮어쓴다(기존 "user_settings.dooray_token 우선" 의미 보존).

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/notify-factory.test.ts
import { describe, it, expect, vi } from "vitest";
import { createNotifier, getNotifier, NOTIFIER_SETTING_KEYS } from "@/lib/notify";
import { loadSettings, loadUserSettings } from "@/lib/settings-server";

/** supabase.from(table).select(cols).in(col, vals) / .eq(col,val).in(col, vals) 체인 흉내 */
function fakeSupabase(rowsByTable: Record<string, { key: string; value: string }[]>) {
  const calls: { table: string; keys: string[]; eq?: [string, string] }[] = [];
  const client = {
    from(table: string) {
      const call: (typeof calls)[number] = { table, keys: [] };
      calls.push(call);
      const builder = {
        select() { return builder; },
        eq(col: string, val: string) { call.eq = [col, val]; return builder; },
        in(_col: string, vals: string[]) {
          call.keys = vals;
          return Promise.resolve({ data: (rowsByTable[table] ?? []).filter((r) => vals.includes(r.key)), error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as never, calls };
}

describe("createNotifier", () => {
  it("기본(키 없음)은 Dooray, 설정값으로 configured 플래그 결정", () => {
    const n = createNotifier("notify", { dooray_hook_url: "https://hook", dooray_token: "" });
    expect(n.provider).toBe("dooray");
    expect(n.channelConfigured).toBe(true);
    expect(n.directConfigured).toBe(false);
  });

  it("축별로 독립 선택 — notify=teams, dm=dooray", () => {
    const s = { notify_provider: "teams", dm_provider: "dooray", teams_notify_webhook_url: "https://w", dooray_token: "t" };
    expect(createNotifier("notify", s).provider).toBe("teams");
    expect(createNotifier("notify", s).channelConfigured).toBe(true);
    expect(createNotifier("dm", s).provider).toBe("dooray");
    expect(createNotifier("dm", s).directConfigured).toBe(true);
  });

  it("NOTIFIER_SETTING_KEYS에 필요한 키가 모두 있다", () => {
    expect([...NOTIFIER_SETTING_KEYS].sort()).toEqual(
      ["dm_provider", "dooray_hook_url", "dooray_token", "notify_provider", "teams_dm_webhook_url", "teams_notify_webhook_url"].sort()
    );
  });
});

describe("loadSettings / loadUserSettings", () => {
  it("settings 테이블에서 요청 키만 맵으로", async () => {
    const { client, calls } = fakeSupabase({ settings: [{ key: "a", value: "1" }, { key: "b", value: "2" }, { key: "c", value: "3" }] });
    expect(await loadSettings(client, ["a", "c"])).toEqual({ a: "1", c: "3" });
    expect(calls[0]).toMatchObject({ table: "settings", keys: ["a", "c"] });
  });

  it("user_settings는 user_id로 필터", async () => {
    const { client, calls } = fakeSupabase({ user_settings: [{ key: "dooray_token", value: "ut" }] });
    expect(await loadUserSettings(client, "u1", ["dooray_token"])).toEqual({ dooray_token: "ut" });
    expect(calls[0]).toMatchObject({ table: "user_settings", eq: ["user_id", "u1"], keys: ["dooray_token"] });
  });
});

describe("getNotifier", () => {
  it("settings를 읽고 truthy override만 덮어쓴다", async () => {
    const { client } = fakeSupabase({
      settings: [
        { key: "dm_provider", value: "dooray" },
        { key: "dooray_token", value: "system-token" },
      ],
    });
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchImpl);
    try {
      const n = await getNotifier(client, "dm", { dooray_token: "user-token" });
      await n.sendDirect({ memberId: "m" }, { text: "x" });
      expect(fetchImpl.mock.calls[0][1].headers.Authorization).toBe("dooray-api user-token");

      const n2 = await getNotifier(client, "dm", { dooray_token: "" });
      await n2.sendDirect({ memberId: "m" }, { text: "x" });
      expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("dooray-api system-token");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/notify-factory.test.ts`
Expected: FAIL — import 해석 실패

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/settings-server.ts
import type { createServerSupabase } from "@/lib/supabase-server";

/** 라우트 핸들러에서 만든 서버 Supabase 클라이언트 타입(코드베이스 관례) */
export type ServerSupabase = Awaited<ReturnType<typeof createServerSupabase>>;

/** settings(전역) 테이블에서 요청한 키만 {key: value}로 읽는다. 누락 키는 맵에 없다. */
export async function loadSettings(
  supabase: ServerSupabase,
  keys: readonly string[]
): Promise<Record<string, string>> {
  const { data } = await supabase.from("settings").select("key, value").in("key", [...keys]);
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[row.key] = row.value;
  return out;
}

/** user_settings(개인) 테이블에서 특정 사용자의 요청 키만 읽는다. */
export async function loadUserSettings(
  supabase: ServerSupabase,
  userId: string,
  keys: readonly string[]
): Promise<Record<string, string>> {
  const { data } = await supabase
    .from("user_settings")
    .select("key, value")
    .eq("user_id", userId)
    .in("key", [...keys]);
  const out: Record<string, string> = {};
  for (const row of data ?? []) out[row.key] = row.value;
  return out;
}
```

```ts
// frontend/src/lib/notify/index.ts
import { resolveProvider, type ProviderAxis } from "@/lib/providers";
import { loadSettings, type ServerSupabase } from "@/lib/settings-server";
import { createDoorayNotifier } from "./dooray";
import { createTeamsNotifier } from "./teams";
import type { Notifier } from "./types";

export type { Notifier, ChannelMessage, DirectRecipient, SendResult } from "./types";

/** 알림 축: A 채널(notify) / C 개인 DM(dm) */
export type NotifyAxis = Extract<ProviderAxis, "notify" | "dm">;

/** Notifier 구성에 필요한 settings 키 */
export const NOTIFIER_SETTING_KEYS = [
  "notify_provider",
  "dm_provider",
  "dooray_hook_url",
  "dooray_token",
  "teams_notify_webhook_url",
  "teams_dm_webhook_url",
] as const;

/** settings 맵 → Notifier (순수; 테스트 용이) */
export function createNotifier(axis: NotifyAxis, settings: Record<string, string | undefined>): Notifier {
  if (resolveProvider(settings, axis) === "teams") {
    return createTeamsNotifier({
      notifyWebhookUrl: settings.teams_notify_webhook_url,
      dmWebhookUrl: settings.teams_dm_webhook_url,
    });
  }
  return createDoorayNotifier({ hookUrl: settings.dooray_hook_url, token: settings.dooray_token });
}

/**
 * 서버 전용: settings 테이블을 읽어 Notifier 생성.
 * overrides의 truthy 값만 시스템 값을 덮어쓴다(예: user_settings.dooray_token 우선).
 */
export async function getNotifier(
  supabase: ServerSupabase,
  axis: NotifyAxis,
  overrides: Record<string, string | undefined> = {}
): Promise<Notifier> {
  const settings = await loadSettings(supabase, NOTIFIER_SETTING_KEYS);
  for (const [k, v] of Object.entries(overrides)) {
    if (v) settings[k] = v;
  }
  return createNotifier(axis, settings);
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/notify-factory.test.ts && npx tsc --noEmit -p tsconfig.json`
Expected: PASS (6 tests), tsc 오류 없음. (`import type { createServerSupabase }`는 타입 전용이라 `next/headers`가 테스트에서 로드되지 않는다. 만약 tsc가 `.in()` 체인 타입으로 불평하면 `supabase.from("settings")` 호출에 `// eslint-disable-next-line` 대신 `ServerSupabase` 그대로 두고 `[...keys]` 배열만 확인 — 기존 라우트들도 동일 체인을 쓴다.)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/settings-server.ts frontend/src/lib/notify/index.ts frontend/src/lib/__tests__/notify-factory.test.ts
git commit -m "feat(notify): settings 기반 Notifier 팩토리(createNotifier/getNotifier) + 서버 settings 로더

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `team-notify` 라우트를 Notifier로 전환

**Files:**
- Modify: `frontend/src/app/api/team-notify/route.ts` (전체 교체)

**Interfaces:**
- Consumes: `getNotifier` (Task 5), `buildTeamResultMessage` (Task 2)
- 응답 계약 유지: `{ webhook_sent: boolean }`. Dooray botName `"팀봇"` 유지, Teams title `"팀 구성 결과"`.

- [ ] **Step 1: 라우트 교체**

```ts
// frontend/src/app/api/team-notify/route.ts
import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { getNotifier } from "@/lib/notify";
import { buildTeamResultMessage, type TeamResultInput } from "@/lib/notify/messages";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { teams } = body as { teams: TeamResultInput[] };

  if (!teams?.length) {
    return NextResponse.json({ error: "팀 정보가 필요합니다" }, { status: 400 });
  }

  const message = buildTeamResultMessage(teams);

  // 채널 알림 provider(settings.notify_provider)에 따라 Dooray Hook / Teams 웹훅으로 발송
  const notifier = await getNotifier(supabase, "notify");
  const results = { webhook_sent: false };

  if (notifier.channelConfigured) {
    const sent = await notifier.sendChannel({ title: "팀 구성 결과", botName: "팀봇", text: message });
    results.webhook_sent = sent.ok;
  }

  return NextResponse.json(results);
}
```

- [ ] **Step 2: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 오류 없음

- [ ] **Step 3: Dooray 무회귀 수동 검증**

Run: `./frontend/scripts/restart-frontend.sh` → 브라우저 `http://localhost:3003/team`에서 팀 나누기 후 "Dooray 알림" 실행. Dooray 채널에 기존과 동일한 "👥 팀 구성 결과" 메시지(봇 이름 `팀봇`)가 도착해야 한다. `settings.dooray_hook_url`이 없으면 `{ webhook_sent: false }`.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/app/api/team-notify/route.ts
git commit -m "refactor(team-notify): 채널 발송을 Notifier 추상화로 전환(Dooray 동작 동일)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: `food/decide` 라우트 전환 + `recipients` 지원

**Files:**
- Create: `frontend/src/lib/notify/recipients.ts`
- Test: `frontend/src/lib/__tests__/notify-recipients.test.ts`
- Modify: `frontend/src/app/api/food/decide/route.ts` (전체 교체)

**Interfaces:**
- Consumes: `createNotifier`, `NOTIFIER_SETTING_KEYS` (Task 5), `loadSettings`/`loadUserSettings` (Task 5), `buildFoodDecisionMessage` (Task 2), `DirectRecipient` (Task 3)
- Produces: `parseRecipients(body: unknown): DirectRecipient[]` — `body.recipients`(객체 배열)가 있으면 우선, 없으면 `body.member_ids`(문자열 배열)를 `{memberId}`로 변환.
- 요청 본문(하위 호환): 기존 `member_ids: string[]` 그대로 동작. 신규 `recipients: { memberId?: string; email?: string; name?: string }[]` (Task 15에서 Teams 멤버 소스일 때 모달이 보냄).
- 응답 계약 유지: `{ decision, webhook_sent, personal_messages_sent, dooray_messenger_url, dm_errors }`.

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/notify-recipients.test.ts
import { describe, it, expect } from "vitest";
import { parseRecipients } from "@/lib/notify/recipients";

describe("parseRecipients", () => {
  it("recipients 배열을 우선 사용하고 문자열 필드만 남긴다", () => {
    expect(
      parseRecipients({
        recipients: [{ email: "a@b.c", name: "A", memberId: 1 }, { memberId: "m2" }, null, "junk"],
        member_ids: ["ignored"],
      })
    ).toEqual([{ email: "a@b.c", name: "A", memberId: undefined }, { email: undefined, name: undefined, memberId: "m2" }]);
  });

  it("recipients가 없으면 member_ids를 {memberId}로 변환(하위 호환)", () => {
    expect(parseRecipients({ member_ids: ["m1", 2, "m3"] })).toEqual([{ memberId: "m1" }, { memberId: "m3" }]);
  });

  it("둘 다 없거나 빈 배열이면 []", () => {
    expect(parseRecipients({})).toEqual([]);
    expect(parseRecipients({ recipients: [] , member_ids: [] })).toEqual([]);
    expect(parseRecipients(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/notify-recipients.test.ts`
Expected: FAIL — import 해석 실패

- [ ] **Step 3: 파서 구현**

```ts
// frontend/src/lib/notify/recipients.ts
import type { DirectRecipient } from "./types";

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/**
 * 점심 결정 요청 본문에서 DM 수신자 목록을 뽑는다.
 * - `recipients`(신규: Teams는 email, Dooray는 memberId) 우선
 * - 없으면 `member_ids`(기존 Dooray 전용) → {memberId}
 */
export function parseRecipients(body: unknown): DirectRecipient[] {
  if (!body || typeof body !== "object") return [];
  const b = body as { recipients?: unknown; member_ids?: unknown };

  if (Array.isArray(b.recipients) && b.recipients.length > 0) {
    return b.recipients
      .filter((r): r is Record<string, unknown> => !!r && typeof r === "object")
      .map((r) => ({ email: str(r.email), name: str(r.name), memberId: str(r.memberId) }));
  }

  if (Array.isArray(b.member_ids)) {
    return b.member_ids.filter((id): id is string => typeof id === "string").map((id) => ({ memberId: id }));
  }

  return [];
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/notify-recipients.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 라우트 교체**

```ts
// frontend/src/app/api/food/decide/route.ts
import { createServerSupabase } from "@/lib/supabase-server";
import { NextRequest, NextResponse } from "next/server";
import { createNotifier, NOTIFIER_SETTING_KEYS } from "@/lib/notify";
import { buildFoodDecisionMessage } from "@/lib/notify/messages";
import { parseRecipients } from "@/lib/notify/recipients";
import { loadSettings, loadUserSettings } from "@/lib/settings-server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { place_name, place_url, category_name, address, members, send_to_channel } = body;

  if (!place_name || !members?.length) {
    return NextResponse.json({ error: "장소와 구성원이 필요합니다" }, { status: 400 });
  }

  // Save decision
  const { data, error } = await supabase
    .from("food_decisions")
    .insert({
      place_name,
      place_url: place_url || null,
      category_name: category_name || null,
      address: address || null,
      members,
      decided_by: user.email,
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const message = buildFoodDecisionMessage({ place_name, address, category_name, place_url, members });

  // 시스템 설정 + 사용자 개인 설정(dooray_token은 개인 값 우선)
  const settings = await loadSettings(supabase, [...NOTIFIER_SETTING_KEYS, "dooray_messenger_url"]);
  const userSettings = await loadUserSettings(supabase, user.id, ["dooray_token"]);
  const dmSettings = { ...settings, ...(userSettings.dooray_token ? { dooray_token: userSettings.dooray_token } : {}) };

  const channelNotifier = createNotifier("notify", settings);
  const dmNotifier = createNotifier("dm", dmSettings);

  const dmErrors: string[] = [];
  const results: Record<string, unknown> = {
    decision: data,
    webhook_sent: false,
    personal_messages_sent: 0,
    dooray_messenger_url: settings.dooray_messenger_url || null,
    dm_errors: dmErrors,
  };

  // 1. 채널 발송 (요청 시에만)
  if (send_to_channel !== false && channelNotifier.channelConfigured) {
    const sent = await channelNotifier.sendChannel({ title: "점심 결정", botName: "점심봇", text: message });
    results.webhook_sent = sent.ok;
  }

  // 2. 개인 DM — recipients(신규) 또는 member_ids(기존)
  const recipients = parseRecipients(body);
  if (dmNotifier.directConfigured && recipients.length) {
    let sent = 0;
    for (const recipient of recipients) {
      const r = await dmNotifier.sendDirect(recipient, { text: message });
      if (r.ok) sent++;
      else if (r.error) dmErrors.push(r.error);
    }
    results.personal_messages_sent = sent;
  }

  return NextResponse.json(results);
}
```

- [ ] **Step 6: 타입·린트·전체 테스트**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run`
Expected: 모두 통과

- [ ] **Step 7: Dooray 무회귀 수동 검증**

`/food` → 랜덤 추천 → 구성원 선택 → "갑시다". 기존처럼 채널 메시지(`점심봇`)와 개인 DM이 가고, 결과 화면의 "채널 메시지 전송 완료 / 개인 메시지 N명 전송 / 메신저 열기" 표시가 동일해야 한다. DM 실패 시 `DM 오류 N건` 상세 문자열 포맷도 이전과 동일(`dm(<id>): <status> <text>`).

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/lib/notify/recipients.ts frontend/src/lib/__tests__/notify-recipients.test.ts frontend/src/app/api/food/decide/route.ts
git commit -m "refactor(food): 점심 결정 채널/DM 발송을 Notifier로 전환 + recipients(email) 수신자 지원

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: `guide/chat` 라우트 전환 (DM 수신자 분기)

**Files:**
- Modify: `frontend/src/app/api/guide/chat/route.ts`

**Interfaces:**
- Consumes: `getNotifier` (Task 5), `loadUserSettings` (Task 5), `buildGuideDmText` (Task 2), `DirectRecipient` (Task 3)
- 수신자: provider가 `teams`면 `{ email: user.email }`(로그인 이메일), `dooray`면 `{ memberId: user_settings.dooray_member_id }`. 기존처럼 fire-and-forget.

- [ ] **Step 1: 상단 `DOORAY_API_BASE` 상수와 `sendGuideDM` 함수(5~38행) 삭제, import 교체**

기존:
```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { nlmFetch } from "@/lib/nlm-service";

const DOORAY_API_BASE = "https://api.dooray.com";

/** Dooray 1:1 메시지로 가이드 Q&A 결과 전송 */
async function sendGuideDM(
  ...
}
```
교체:
```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { nlmFetch } from "@/lib/nlm-service";
import { getNotifier, type DirectRecipient } from "@/lib/notify";
import { buildGuideDmText } from "@/lib/notify/messages";
import { loadUserSettings } from "@/lib/settings-server";
```

- [ ] **Step 2: DM 블록(기존 108~139행 "// Dooray 1:1 메시지 전송" ~ `sendGuideDM(...)` 호출) 교체**

기존 블록 전체(아래 주석부터 `if (settingsMap.dooray_member_id && settingsMap.dooray_token) { ... }` 닫는 중괄호까지)를 삭제하고:
```ts
    // 개인 DM(provider: settings.dm_provider). Teams = 로그인 이메일, Dooray = user_settings.dooray_member_id
    // fire-and-forget: 채팅 응답에 지연 없음
    const userSettings = await loadUserSettings(supabase, user.id, ["dooray_member_id", "dooray_token"]);
    const notifier = await getNotifier(supabase, "dm", { dooray_token: userSettings.dooray_token });
    const recipient: DirectRecipient =
      notifier.provider === "teams"
        ? { email: user.email }
        : { memberId: userSettings.dooray_member_id };

    if (notifier.directConfigured && (recipient.email || recipient.memberId)) {
      void notifier
        .sendDirect(recipient, { text: buildGuideDmText(question, result.answer) })
        .catch(() => {
          // DM 전송 실패는 무시 (채팅 응답에 영향 없음)
        });
    }
```

- [ ] **Step 3: 타입·린트 확인**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 오류 없음. `grep -n "DOORAY_API_BASE\|sendGuideDM" frontend/src/app/api/guide/chat/route.ts` → 결과 없음.

- [ ] **Step 4: Dooray 무회귀 수동 검증**

`/guide`에서 질문 → 개인 설정에 `dooray_member_id`가 있는 사용자는 기존과 동일한 "📋 가이드 Q&A 답변 알림" DM을 받는다. 답변 응답 지연 없음.

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/app/api/guide/chat/route.ts
git commit -m "refactor(guide): 가이드 답변 DM을 Notifier로 전환(Teams=이메일, Dooray=멤버ID)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `useSettings` 일반화 + 관리자 Provider/Teams 설정 UI

**Files:**
- Modify: `frontend/src/hooks/useSettings.ts` (전체 교체)
- Create: `frontend/src/components/settings/ProviderSettings.tsx`
- Create: `frontend/src/components/settings/TeamsSettings.tsx`
- Modify: `frontend/src/app/admin/settings/page.tsx`
- Test: `frontend/src/lib/__tests__/settings-keys.test.ts`

**Interfaces:**
- Consumes: `PROVIDER_SETTING_KEYS`, `TEAMS_SETTING_KEYS`, `parseProvider` (Task 1)
- Produces: `SETTING_KEYS` (readonly tuple), `SettingKey`, `useSettings()` 반환 형태 동일(`settings`, `updateLocal`, `save`, `isLoaded`, `isSaving`, `hasChanges`, `saveSuccess`). `DooraySettings`/`KakaoSettings`는 `ReturnType<typeof useSettings>`만 쓰므로 수정 불필요.

- [ ] **Step 1: 실패하는 테스트 작성 (키 목록 계약)**

```ts
// frontend/src/lib/__tests__/settings-keys.test.ts
import { describe, it, expect } from "vitest";
import { SETTING_KEYS, DEFAULT_SETTINGS } from "@/hooks/useSettings";
import { PROVIDER_SETTING_KEYS, TEAMS_SETTING_KEYS } from "@/lib/providers";

describe("SETTING_KEYS", () => {
  it("기존 키를 모두 보존한다", () => {
    for (const k of ["dooray_token", "dooray_project_id", "kakao_rest_api_key", "dooray_messenger_url", "dooray_hook_url"]) {
      expect(SETTING_KEYS).toContain(k);
    }
  });

  it("provider 3축 + Teams 5키를 포함한다", () => {
    for (const k of Object.values(PROVIDER_SETTING_KEYS)) expect(SETTING_KEYS).toContain(k);
    for (const k of TEAMS_SETTING_KEYS) expect(SETTING_KEYS).toContain(k);
  });

  it("DEFAULT_SETTINGS는 모든 키를 빈 문자열로", () => {
    expect(Object.keys(DEFAULT_SETTINGS).sort()).toEqual([...SETTING_KEYS].sort());
    expect(Object.values(DEFAULT_SETTINGS).every((v) => v === "")).toBe(true);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/settings-keys.test.ts`
Expected: FAIL — `SETTING_KEYS`/`DEFAULT_SETTINGS` export 없음

- [ ] **Step 3: `useSettings.ts` 교체**

```ts
// frontend/src/hooks/useSettings.ts
"use client";

import { useState, useEffect, useCallback } from "react";
import { logAction } from "@/lib/action-log";

/** 관리자 전역 설정 키 전체(settings 테이블). 추가 시 여기만 수정. */
export const SETTING_KEYS = [
  // Dooray
  "dooray_token",
  "dooray_project_id",
  "dooray_messenger_url",
  "dooray_hook_url",
  // Kakao
  "kakao_rest_api_key",
  // Provider 선택(축별)
  "notify_provider",
  "member_source_provider",
  "dm_provider",
  // Teams (비밀 아님 — Graph secret은 env TEAMS_GRAPH_CLIENT_SECRET)
  "teams_notify_webhook_url",
  "teams_dm_webhook_url",
  "teams_graph_client_id",
  "teams_tenant_id",
  "teams_group_id",
] as const;

export type SettingKey = (typeof SETTING_KEYS)[number];
export type Settings = Record<SettingKey, string>;

export const DEFAULT_SETTINGS: Settings = Object.fromEntries(
  SETTING_KEYS.map((k) => [k, ""])
) as Settings;

function pickSettings(data: Record<string, unknown>): Settings {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of SETTING_KEYS) {
    const v = data[k];
    out[k] = typeof v === "string" ? v : "";
  }
  return out;
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [savedSettings, setSavedSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((data) => {
        const loaded = pickSettings(data ?? {});
        setSettings(loaded);
        setSavedSettings(loaded);
      })
      .catch(() => {})
      .finally(() => setIsLoaded(true));
  }, []);

  const updateLocal = useCallback((key: SettingKey, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaveSuccess(false);
  }, []);

  const hasChanges = SETTING_KEYS.some((k) => settings[k] !== savedSettings[k]);

  const save = useCallback(async () => {
    setIsSaving(true);
    setSaveSuccess(false);
    try {
      const promises = SETTING_KEYS.map((key) =>
        fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value: settings[key] }),
        })
      );
      await Promise.all(promises);
      setSavedSettings({ ...settings });
      setSaveSuccess(true);
      logAction("설정 저장", "settings");
    } catch {
      // save failed
    } finally {
      setIsSaving(false);
    }
  }, [settings]);

  return { settings, updateLocal, save, isLoaded, isSaving, hasChanges, saveSuccess };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/settings-keys.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: `ProviderSettings.tsx` 작성**

```tsx
// frontend/src/components/settings/ProviderSettings.tsx
"use client";

import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { parseProvider, type Provider } from "@/lib/providers";
import type { useSettings, SettingKey } from "@/hooks/useSettings";

interface ProviderSettingsProps {
  settingsHook: ReturnType<typeof useSettings>;
}

const AXES: { key: SettingKey; label: string; hint: string }[] = [
  { key: "notify_provider", label: "채널 알림", hint: "팀 구성 결과·점심 결정을 채널에 게시" },
  { key: "member_source_provider", label: "멤버 가져오기", hint: "사다리/팀/점심의 구성원 목록 소스" },
  { key: "dm_provider", label: "개인 DM", hint: "점심 알림·가이드 답변 1:1 메시지" },
];

const PROVIDER_LABEL: Record<Provider, string> = { dooray: "Dooray", teams: "Microsoft Teams" };

export default function ProviderSettings({ settingsHook }: ProviderSettingsProps) {
  const { settings, updateLocal } = settingsHook;

  const memberSource = parseProvider(settings.member_source_provider);
  const dm = parseProvider(settings.dm_provider);
  const mismatch = memberSource === "dooray" && dm === "teams";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        {AXES.map((axis) => (
          <div key={axis.key} className="space-y-2">
            <Label htmlFor={`provider-${axis.key}`}>{axis.label}</Label>
            <Select
              value={parseProvider(settings[axis.key])}
              onValueChange={(v) => updateLocal(axis.key, v)}
            >
              <SelectTrigger id={`provider-${axis.key}`} className="w-full h-9 text-sm">
                <SelectValue placeholder="선택" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dooray">{PROVIDER_LABEL.dooray}</SelectItem>
                <SelectItem value="teams">{PROVIDER_LABEL.teams}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{axis.hint}</p>
          </div>
        ))}
      </div>

      {mismatch && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Teams DM은 이메일 기준이라 Dooray 멤버(이메일 없음)에게는 점심 DM을 보낼 수 없습니다.
            멤버 가져오기도 Microsoft Teams로 맞춰주세요. (가이드 답변 DM은 로그인 이메일로 정상 동작)
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
```

- [ ] **Step 6: `TeamsSettings.tsx` 작성**

```tsx
// frontend/src/components/settings/TeamsSettings.tsx
"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Info, KeyRound } from "lucide-react";
import type { useSettings, SettingKey } from "@/hooks/useSettings";

interface TeamsSettingsProps {
  settingsHook: ReturnType<typeof useSettings>;
}

const FIELDS: { key: SettingKey; label: string; placeholder: string; hint: string }[] = [
  {
    key: "teams_notify_webhook_url",
    label: "채널 알림 웹훅 URL",
    placeholder: "https://prod-xx.westus.logic.azure.com:443/workflows/...",
    hint: "Power Automate \"HTTP 요청을 받은 경우\" → \"채팅 또는 채널에 메시지 게시\" 워크플로의 HTTP POST URL. 본문 {title, text, html}",
  },
  {
    key: "teams_dm_webhook_url",
    label: "개인 DM 웹훅 URL",
    placeholder: "https://prod-xx.westus.logic.azure.com:443/workflows/...",
    hint: "수신자 이메일로 1:1 메시지를 보내는 워크플로의 HTTP POST URL. 본문 {recipientEmail, text, html}",
  },
  {
    key: "teams_tenant_id",
    label: "Entra 테넌트 ID",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    hint: "Microsoft Entra 관리 센터 > 개요 > 테넌트 ID",
  },
  {
    key: "teams_graph_client_id",
    label: "Graph 앱 클라이언트 ID",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    hint: "로그인용 Entra 앱 등록의 애플리케이션(클라이언트) ID. GroupMember.Read.All(애플리케이션) 권한 + 관리자 동의 필요",
  },
  {
    key: "teams_group_id",
    label: "멤버를 가져올 팀/그룹 ID",
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    hint: "Teams 팀의 Microsoft 365 그룹 개체 ID (Dooray 프로젝트 ID에 해당)",
  },
];

export default function TeamsSettings({ settingsHook }: TeamsSettingsProps) {
  const { settings, updateLocal } = settingsHook;

  return (
    <div className="space-y-4">
      {FIELDS.map((f) => (
        <div key={f.key} className="space-y-2">
          <Label htmlFor={`teams-${f.key}`}>{f.label}</Label>
          <Input
            id={`teams-${f.key}`}
            value={settings[f.key]}
            onChange={(e) => updateLocal(f.key, e.target.value)}
            placeholder={f.placeholder}
          />
          <p className="text-xs text-muted-foreground">{f.hint}</p>
        </div>
      ))}

      <Alert>
        <KeyRound className="h-4 w-4" />
        <AlertDescription>
          Graph 클라이언트 시크릿은 보안상 여기에 저장하지 않습니다. 서버 환경변수{" "}
          <code className="font-mono text-xs">TEAMS_GRAPH_CLIENT_SECRET</code>로 설정하세요 (로컬:
          frontend/.env.local, 운영: Vercel Environment Variables).
        </AlertDescription>
      </Alert>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          설정 절차는 docs/teams-integration.md 참고. 위 &quot;연동 채널 선택&quot;에서 축별로 Teams를 고르면 적용됩니다.
        </AlertDescription>
      </Alert>
    </div>
  );
}
```

- [ ] **Step 7: 관리자 페이지에 카드 2개 추가**

`frontend/src/app/admin/settings/page.tsx`의 import에 추가:
```tsx
import ProviderSettings from "@/components/settings/ProviderSettings";
import TeamsSettings from "@/components/settings/TeamsSettings";
import { Link2, MapPin, MessageSquare, Loader2, Save, Check, Route, Users } from "lucide-react";
```
(기존 `lucide-react` import 줄을 위 한 줄로 교체.)

`return (<> ... </>)` 안에서 **첫 번째 `<Card className="animate-fade-up">`(Dooray 연동) 바로 앞**에 삽입:
```tsx
      <Card className="animate-fade-up">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Route className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">연동 채널 선택</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <ProviderSettings settingsHook={settingsHook} />
        </CardContent>
      </Card>
```
그리고 기존 첫 카드의 className을 `"animate-fade-up delay-100 mt-6"`로 바꾼다.

**"Dooray 메신저" 카드(`</Card>`) 바로 뒤, 저장 버튼 `<div className="flex items-center gap-3 mt-6 ...">` 앞**에 삽입:
```tsx
      <Card className="animate-fade-up delay-300 mt-6">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-base">Microsoft Teams</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <TeamsSettings settingsHook={settingsHook} />
        </CardContent>
      </Card>
```

- [ ] **Step 8: 타입·린트·전체 테스트**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run`
Expected: 모두 통과

- [ ] **Step 9: 수동 검증**

`/admin/settings`: 새 카드 2개 표시. 셀렉트 기본값 "Dooray". 멤버=Dooray, DM=Teams로 바꾸면 경고 표시. 저장 후 새로고침 시 값 유지(`GET /api/settings` 응답에 `notify_provider` 등 포함). 기존 Dooray/Kakao 입력 저장도 그대로 동작.

- [ ] **Step 10: 커밋**

```bash
git add frontend/src/hooks/useSettings.ts frontend/src/components/settings/ProviderSettings.tsx frontend/src/components/settings/TeamsSettings.tsx frontend/src/app/admin/settings/page.tsx frontend/src/lib/__tests__/settings-keys.test.ts
git commit -m "feat(admin): 연동 provider 축별 선택 + Teams 설정 카드(useSettings 키 일반화)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: `/api/settings` 하드닝 (GET 민감키 숨김, PUT admin 전용)

**Files:**
- Modify: `frontend/src/app/api/settings/route.ts` (전체 교체)

**Interfaces:**
- Consumes: `ADMIN_ONLY_SETTING_KEYS` (Task 1)
- 동작: GET — admin은 전체, 비admin(미인증 포함)은 `ADMIN_ONLY_SETTING_KEYS` 제외. `dooray_token`은 브라우저 확장 브리지가 쓰므로 계속 노출(스펙 §7 수용 범위). PUT — admin만(401/403). 관리자 페이지는 이미 미들웨어로 admin 전용이라 UI 영향 없음.

- [ ] **Step 1: 라우트 교체**

```ts
// frontend/src/app/api/settings/route.ts
import { createServerSupabase } from "@/lib/supabase-server";
import { NextResponse } from "next/server";
import { ADMIN_ONLY_SETTING_KEYS } from "@/lib/providers";

async function getCallerRole(supabase: Awaited<ReturnType<typeof createServerSupabase>>) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { user: null, role: "guest" as const };
  const { data } = await supabase.from("user_profiles").select("role").eq("user_id", user.id).single();
  return { user, role: (data?.role ?? "user") as string };
}

/** GET /api/settings — 전역 설정. 웹훅 URL 등 admin 전용 키는 admin에게만 반환 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { role } = await getCallerRole(supabase);

  const { data, error } = await supabase.from("settings").select("key, value");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const settings: Record<string, string> = {};
  for (const row of data) {
    if (role !== "admin" && ADMIN_ONLY_SETTING_KEYS.has(row.key)) continue;
    settings[row.key] = row.value;
  }

  return NextResponse.json(settings);
}

/** PUT /api/settings — 전역 설정 저장 (admin only) */
export async function PUT(request: Request) {
  const supabase = await createServerSupabase();
  const { user, role } = await getCallerRole(supabase);
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }
  if (role !== "admin") {
    return NextResponse.json({ error: "관리자 권한이 필요합니다." }, { status: 403 });
  }

  const body = await request.json();
  const { key, value } = body;

  if (!key || typeof value !== "string") {
    return NextResponse.json({ error: "key and value are required" }, { status: 400 });
  }

  const { error } = await supabase
    .from("settings")
    .upsert({ key, value }, { onConflict: "key" });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
```

- [ ] **Step 2: 타입·린트**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 오류 없음

- [ ] **Step 3: 수동 검증**

- admin 계정: `/admin/settings` 로드·저장 정상, 응답에 `dooray_hook_url` 포함.
- 일반(user) 계정: 브라우저 콘솔에서 `fetch("/api/settings").then(r=>r.json()).then(console.log)` → `dooray_hook_url`, `teams_*_webhook_url` 없음, `dooray_token`·`notify_provider`는 있음. `/ladder`의 "Dooray에서 가져오기"가 계속 동작(토큰 노출 유지 확인).
- 일반 계정으로 `fetch("/api/settings",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({key:"x",value:"y"})})` → 403.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/app/api/settings/route.ts
git commit -m "fix(settings): 비admin에게 웹훅 URL 숨김 + PUT admin 전용 게이트

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

> **Phase 1 완료 시점의 상태**: Dooray 동작 동일. 관리자가 `notify_provider=teams` + `teams_notify_webhook_url`을 넣으면 팀 구성/점심 채널 알림이 Teams로 간다(스펙 Phase 2 달성). `dm_provider=teams` + `teams_dm_webhook_url`이면 가이드 답변 DM이 로그인 이메일로 Teams에 간다(스펙 Phase 3의 가이드 DM 달성). 점심 DM의 Teams 수신자(이메일)는 Phase 2에서 멤버 소스가 Teams가 될 때 완성된다.

---

# Phase 2 — Teams 멤버 (Microsoft Graph app-only)

### Task 11: Graph 클라이언트 (`lib/teams-graph.ts`) + `Member` 타입

**Files:**
- Create: `frontend/src/lib/members/types.ts`
- Create: `frontend/src/lib/teams-graph.ts`
- Test: `frontend/src/lib/__tests__/teams-graph.test.ts`

**Interfaces:**
- Consumes: `FetchLike` (Task 3), `Provider` (Task 1)
- Produces:
  ```ts
  // members/types.ts
  interface Member { id: string; name: string; email?: string }
  interface MemberSource { readonly provider: Provider; listMembers(opts?: { signal?: AbortSignal }): Promise<Member[]> }
  // teams-graph.ts (서버 전용)
  interface GraphAppConfig { tenantId: string; clientId: string; clientSecret: string }
  getGraphAppToken(cfg, fetchImpl?, now?: () => number): Promise<string>   // 메모리 캐시, 만료 60초 전 갱신
  listGroupMembers(cfg, groupId: string, fetchImpl?): Promise<Member[]>     // nextLink 페이지네이션, mail→UPN 폴백, 이름순
  _resetGraphTokenCache(): void                                             // 테스트용
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/teams-graph.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getGraphAppToken, listGroupMembers, _resetGraphTokenCache, GRAPH_BASE } from "@/lib/teams-graph";

const cfg = { tenantId: "tenant-1", clientId: "client-1", clientSecret: "s3cret" };

function jsonRes(status: number, body: unknown): Response {
  const text = JSON.stringify(body);
  return { ok: status >= 200 && status < 300, status, text: async () => text, json: async () => body } as unknown as Response;
}

beforeEach(() => _resetGraphTokenCache());

describe("getGraphAppToken", () => {
  it("client_credentials로 토큰을 받고 캐시한다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(200, { access_token: "T1", expires_in: 3600 }));
    let t = 1_000_000;
    const now = () => t;

    expect(await getGraphAppToken(cfg, fetchImpl, now)).toBe("T1");
    expect(await getGraphAppToken(cfg, fetchImpl, now)).toBe("T1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
    const params = new URLSearchParams(init.body);
    expect(params.get("grant_type")).toBe("client_credentials");
    expect(params.get("client_id")).toBe("client-1");
    expect(params.get("client_secret")).toBe("s3cret");
    expect(params.get("scope")).toBe("https://graph.microsoft.com/.default");

    // 만료 60초 전이 되면 재발급
    t += 3600_000 - 30_000;
    fetchImpl.mockResolvedValueOnce(jsonRes(200, { access_token: "T2", expires_in: 3600 }));
    expect(await getGraphAppToken(cfg, fetchImpl, now)).toBe("T2");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("실패 응답은 본문을 담아 throw", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonRes(401, { error: "invalid_client", error_description: "bad secret" }));
    await expect(getGraphAppToken(cfg, fetchImpl)).rejects.toThrow(/Graph 토큰 발급 실패 \(401\).*bad secret/);
  });
});

describe("listGroupMembers", () => {
  it("nextLink 페이지네이션 + mail→UPN 폴백 + 이름순 정렬 + displayName 없는 항목 제외", async () => {
    const page2Url = `${GRAPH_BASE}/groups/g1/members/microsoft.graph.user?$skiptoken=abc`;
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes(200, { access_token: "T", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonRes(200, {
        value: [
          { id: "u2", displayName: "이영희", mail: null, userPrincipalName: "yh@innogrid.com" },
          { id: "u3", displayName: "  ", mail: "x@innogrid.com" },
        ],
        "@odata.nextLink": page2Url,
      }))
      .mockResolvedValueOnce(jsonRes(200, {
        value: [{ id: "u1", displayName: "강승억", mail: "su@innogrid.com", userPrincipalName: "su_upn@innogrid.com" }],
      }));

    const members = await listGroupMembers(cfg, "g1", fetchImpl);
    expect(members).toEqual([
      { id: "u1", name: "강승억", email: "su@innogrid.com" },
      { id: "u2", name: "이영희", email: "yh@innogrid.com" },
    ]);

    expect(fetchImpl.mock.calls[1][0]).toBe(
      `${GRAPH_BASE}/groups/g1/members/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName&$top=999`
    );
    expect(fetchImpl.mock.calls[1][1].headers.Authorization).toBe("Bearer T");
    expect(fetchImpl.mock.calls[2][0]).toBe(page2Url);
  });

  it("Graph 오류는 status와 본문을 담아 throw", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonRes(200, { access_token: "T", expires_in: 3600 }))
      .mockResolvedValueOnce(jsonRes(403, { error: { code: "Authorization_RequestDenied" } }));
    await expect(listGroupMembers(cfg, "g1", fetchImpl)).rejects.toThrow(/Graph API 오류 \(403\).*Authorization_RequestDenied/);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/teams-graph.test.ts`
Expected: FAIL — import 해석 실패

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/members/types.ts
import type { Provider } from "@/lib/providers";

/** provider 중립 멤버. Dooray는 email 없음, Teams는 Graph mail/UPN */
export interface Member {
  id: string;
  name: string;
  email?: string;
}

export interface MemberSource {
  readonly provider: Provider;
  listMembers(opts?: { signal?: AbortSignal }): Promise<Member[]>;
}
```

```ts
// frontend/src/lib/teams-graph.ts
/**
 * Microsoft Graph app-only(client credentials) 클라이언트 — 서버 전용.
 * 시크릿은 호출자가 env(TEAMS_GRAPH_CLIENT_SECRET)에서 읽어 넘긴다.
 */
import type { Member } from "@/lib/members/types";
import type { FetchLike } from "@/lib/notify/types";

export interface GraphAppConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_SKEW_MS = 60_000;

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** 테스트용: 토큰 캐시 비우기 */
export function _resetGraphTokenCache() {
  tokenCache.clear();
}

export async function getGraphAppToken(
  cfg: GraphAppConfig,
  fetchImpl: FetchLike = fetch,
  now: () => number = Date.now
): Promise<string> {
  const key = `${cfg.tenantId}:${cfg.clientId}`;
  const cached = tokenCache.get(key);
  if (cached && cached.expiresAt - TOKEN_SKEW_MS > now()) return cached.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    scope: "https://graph.microsoft.com/.default",
  });

  const res = await fetchImpl(
    `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenantId)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Graph 토큰 발급 실패 (${res.status}): ${text}`);

  const data = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error("Graph 토큰 응답에 access_token이 없습니다.");

  tokenCache.set(key, { token: data.access_token, expiresAt: now() + (data.expires_in ?? 3600) * 1000 });
  return data.access_token;
}

interface GraphUser {
  id: string;
  displayName?: string | null;
  mail?: string | null;
  userPrincipalName?: string | null;
}

interface GraphPage {
  value?: GraphUser[];
  "@odata.nextLink"?: string;
}

/** 그룹(팀)의 사용자 멤버 전체 — 페이지네이션, mail→UPN 폴백, 이름순 */
export async function listGroupMembers(
  cfg: GraphAppConfig,
  groupId: string,
  fetchImpl: FetchLike = fetch
): Promise<Member[]> {
  const token = await getGraphAppToken(cfg, fetchImpl);
  const members: Member[] = [];

  let url: string | undefined =
    `${GRAPH_BASE}/groups/${encodeURIComponent(groupId)}/members/microsoft.graph.user` +
    `?$select=id,displayName,mail,userPrincipalName&$top=999`;

  while (url) {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    if (!res.ok) throw new Error(`Graph API 오류 (${res.status}): ${text}`);

    const page = JSON.parse(text) as GraphPage;
    for (const u of page.value ?? []) {
      const name = u.displayName?.trim();
      if (!u.id || !name) continue;
      const email = (u.mail || u.userPrincipalName || "").trim() || undefined;
      members.push({ id: u.id, name, email });
    }
    url = page["@odata.nextLink"];
  }

  return members.sort((a, b) => a.name.localeCompare(b.name, "ko"));
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/teams-graph.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/members/types.ts frontend/src/lib/teams-graph.ts frontend/src/lib/__tests__/teams-graph.test.ts
git commit -m "feat(teams): Graph app-only 클라이언트(토큰 메모리 캐시, 그룹 멤버 페이지네이션)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: `GET /api/teams/members` 라우트

**Files:**
- Create: `frontend/src/app/api/teams/members/route.ts`

**Interfaces:**
- Consumes: `listGroupMembers` (Task 11), `loadSettings` (Task 5)
- Produces: `GET /api/teams/members` → `200 { members: Member[] }` / `401` / `400 { error: "Teams 설정이 누락되었습니다: ..." }` / `502 { error }`.
- 환경변수 `TEAMS_GRAPH_CLIENT_SECRET` 필수.

- [ ] **Step 1: 라우트 작성**

```ts
// frontend/src/app/api/teams/members/route.ts
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadSettings } from "@/lib/settings-server";
import { listGroupMembers } from "@/lib/teams-graph";

/** GET /api/teams/members — settings.teams_group_id 그룹의 멤버를 Graph(app-only)로 조회 */
export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await loadSettings(supabase, ["teams_graph_client_id", "teams_tenant_id", "teams_group_id"]);
  const clientSecret = process.env.TEAMS_GRAPH_CLIENT_SECRET ?? "";

  const missing: string[] = [];
  if (!settings.teams_tenant_id) missing.push("teams_tenant_id");
  if (!settings.teams_graph_client_id) missing.push("teams_graph_client_id");
  if (!settings.teams_group_id) missing.push("teams_group_id");
  if (!clientSecret) missing.push("env TEAMS_GRAPH_CLIENT_SECRET");
  if (missing.length) {
    return NextResponse.json(
      { error: `Teams 설정이 누락되었습니다: ${missing.join(", ")}` },
      { status: 400 }
    );
  }

  try {
    const members = await listGroupMembers(
      {
        tenantId: settings.teams_tenant_id,
        clientId: settings.teams_graph_client_id,
        clientSecret,
      },
      settings.teams_group_id
    );
    return NextResponse.json({ members });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Teams 멤버 조회 실패";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
```

- [ ] **Step 2: 타입·린트**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint`
Expected: 오류 없음

- [ ] **Step 3: 수동 검증 (설정 전/후)**

- 설정 없이: 로그인 상태 브라우저에서 `fetch("/api/teams/members").then(r=>r.json()).then(console.log)` → `400 {error: "Teams 설정이 누락되었습니다: ..."}`.
- `frontend/.env.local`에 `TEAMS_GRAPH_CLIENT_SECRET=...` 추가 + `/admin/settings`에 테넌트/클라이언트/그룹 ID 저장 + 프론트 재시작 후 같은 호출 → `{ members: [{id, name, email}, ...] }`. Entra 앱에 `GroupMember.Read.All`(애플리케이션) 권한·관리자 동의가 없으면 `502 Graph API 오류 (403)`이 정상 신호.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/app/api/teams/members/route.ts
git commit -m "feat(teams): GET /api/teams/members — Graph로 그룹 멤버 조회(시크릿은 env)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 13: 클라이언트 MemberSource 추상화 + `useProviderSettings` 훅

**Files:**
- Create: `frontend/src/lib/members/dooray.ts`
- Create: `frontend/src/lib/members/teams.ts`
- Create: `frontend/src/lib/members/index.ts`
- Create: `frontend/src/hooks/useProviderSettings.ts`
- Test: `frontend/src/lib/__tests__/members-source.test.ts`
- Test: `frontend/src/lib/__tests__/useProviderSettings.test.tsx`

**Interfaces:**
- Consumes: `Member`, `MemberSource` (Task 11), `fetchProjectMembers` (`@/lib/dooray-client`, 기존), `parseProvider` (Task 1)
- Produces:
  ```ts
  createDoorayMemberSource(cfg: { token: string; projectId: string }): MemberSource
  createTeamsMemberSource(fetchImpl?: FetchLike): MemberSource     // GET /api/teams/members
  getMemberSource(provider: Provider, dooray: { token: string; projectId: string }): MemberSource
  useProviderSettings(): { notify: Provider; memberSource: Provider; dm: Provider; isLoaded: boolean }
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

```ts
// frontend/src/lib/__tests__/members-source.test.ts
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/dooray-client", () => ({
  fetchProjectMembers: vi.fn(async (token: string, projectId: string) => [{ id: `${token}-${projectId}`, name: "홍길동" }]),
}));

import { createTeamsMemberSource } from "@/lib/members/teams";
import { createDoorayMemberSource } from "@/lib/members/dooray";
import { getMemberSource } from "@/lib/members";
import { fetchProjectMembers } from "@/lib/dooray-client";

describe("createTeamsMemberSource", () => {
  it("/api/teams/members를 호출해 members를 돌려준다", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ members: [{ id: "u1", name: "강승억", email: "su@innogrid.com" }] }) });
    const src = createTeamsMemberSource(fetchImpl as never);
    expect(src.provider).toBe("teams");
    const signal = new AbortController().signal;
    expect(await src.listMembers({ signal })).toEqual([{ id: "u1", name: "강승억", email: "su@innogrid.com" }]);
    expect(fetchImpl).toHaveBeenCalledWith("/api/teams/members", { signal });
  });

  it("실패 응답의 error 메시지를 throw", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ error: "Teams 설정이 누락되었습니다: teams_group_id" }) });
    await expect(createTeamsMemberSource(fetchImpl as never).listMembers()).rejects.toThrow("Teams 설정이 누락되었습니다: teams_group_id");
  });

  it("본문 파싱 실패 시 status 기반 메시지", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error("x"); } });
    await expect(createTeamsMemberSource(fetchImpl as never).listMembers()).rejects.toThrow("Teams 멤버 조회 실패 (502)");
  });
});

describe("createDoorayMemberSource / getMemberSource", () => {
  it("Dooray 소스는 브리지 fetchProjectMembers를 위임", async () => {
    const src = createDoorayMemberSource({ token: "tok", projectId: "p1" });
    expect(src.provider).toBe("dooray");
    expect(await src.listMembers()).toEqual([{ id: "tok-p1", name: "홍길동" }]);
    expect(fetchProjectMembers).toHaveBeenCalledWith("tok", "p1", undefined);
  });

  it("getMemberSource는 provider로 분기", () => {
    expect(getMemberSource("teams", { token: "", projectId: "" }).provider).toBe("teams");
    expect(getMemberSource("dooray", { token: "t", projectId: "p" }).provider).toBe("dooray");
  });
});
```

```tsx
// frontend/src/lib/__tests__/useProviderSettings.test.tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useProviderSettings } from "@/hooks/useProviderSettings";

afterEach(() => vi.unstubAllGlobals());

describe("useProviderSettings", () => {
  it("settings의 provider 키를 파싱하고 isLoaded를 올린다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ notify_provider: "teams", dm_provider: "" }) }));
    const { result } = renderHook(() => useProviderSettings());
    expect(result.current.isLoaded).toBe(false);
    expect(result.current.notify).toBe("dooray");

    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current.notify).toBe("teams");
    expect(result.current.memberSource).toBe("dooray");
    expect(result.current.dm).toBe("dooray");
  });

  it("요청 실패 시 기본값(dooray) 유지 + isLoaded true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net")));
    const { result } = renderHook(() => useProviderSettings());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));
    expect(result.current).toMatchObject({ notify: "dooray", memberSource: "dooray", dm: "dooray" });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/members-source.test.ts src/lib/__tests__/useProviderSettings.test.tsx`
Expected: FAIL — import 해석 실패

- [ ] **Step 3: 구현**

```ts
// frontend/src/lib/members/dooray.ts
/** 클라이언트 전용: Chrome 확장 브리지를 통한 Dooray 프로젝트 멤버 조회를 MemberSource로 래핑 */
import { fetchProjectMembers } from "@/lib/dooray-client";
import type { MemberSource } from "./types";

export function createDoorayMemberSource(cfg: { token: string; projectId: string }): MemberSource {
  return {
    provider: "dooray",
    listMembers: ({ signal } = {}) => fetchProjectMembers(cfg.token, cfg.projectId, signal),
  };
}
```

```ts
// frontend/src/lib/members/teams.ts
/** 클라이언트 전용: 서버 라우트(/api/teams/members)를 통해 Graph 멤버 조회 */
import type { FetchLike } from "@/lib/notify/types";
import type { Member, MemberSource } from "./types";

export function createTeamsMemberSource(fetchImpl: FetchLike = fetch): MemberSource {
  return {
    provider: "teams",
    async listMembers({ signal } = {}) {
      const res = await fetchImpl("/api/teams/members", { signal });
      const data = (await res.json().catch(() => ({}))) as { members?: Member[]; error?: string };
      if (!res.ok) {
        throw new Error(data.error || `Teams 멤버 조회 실패 (${res.status})`);
      }
      return data.members ?? [];
    },
  };
}
```

```ts
// frontend/src/lib/members/index.ts
import type { Provider } from "@/lib/providers";
import { createDoorayMemberSource } from "./dooray";
import { createTeamsMemberSource } from "./teams";
import type { MemberSource } from "./types";

export type { Member, MemberSource } from "./types";

/** provider(settings.member_source_provider)에 맞는 MemberSource. Dooray는 토큰/프로젝트ID가 필요 */
export function getMemberSource(
  provider: Provider,
  dooray: { token: string; projectId: string }
): MemberSource {
  return provider === "teams" ? createTeamsMemberSource() : createDoorayMemberSource(dooray);
}
```

```ts
// frontend/src/hooks/useProviderSettings.ts
"use client";

import { useEffect, useState } from "react";
import { parseProvider, type Provider } from "@/lib/providers";

export interface ProviderSettings {
  notify: Provider;
  memberSource: Provider;
  dm: Provider;
}

const DEFAULTS: ProviderSettings = { notify: "dooray", memberSource: "dooray", dm: "dooray" };

/** 관리자 전역 provider 선택(3축)을 읽는다. 실패/미설정은 dooray. */
export function useProviderSettings() {
  const [providers, setProviders] = useState<ProviderSettings>(DEFAULTS);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: Record<string, string>) => {
        if (cancelled) return;
        setProviders({
          notify: parseProvider(data.notify_provider),
          memberSource: parseProvider(data.member_source_provider),
          dm: parseProvider(data.dm_provider),
        });
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { ...providers, isLoaded };
}
```

- [ ] **Step 4: 통과 확인**

Run: `cd frontend && npx vitest run src/lib/__tests__/members-source.test.ts src/lib/__tests__/useProviderSettings.test.tsx`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/lib/members frontend/src/hooks/useProviderSettings.ts frontend/src/lib/__tests__/members-source.test.ts frontend/src/lib/__tests__/useProviderSettings.test.tsx
git commit -m "feat(members): 클라이언트 MemberSource 추상화(Dooray 브리지/Teams 라우트) + useProviderSettings 훅

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: `DoorayImportButton`·`DoorayProjectSelect` provider-aware

**Files:**
- Modify: `frontend/src/components/shared/DoorayImportButton.tsx`
- Modify: `frontend/src/components/shared/DoorayProjectSelect.tsx`

**Interfaces:**
- Consumes: `useProviderSettings` (Task 13), `createTeamsMemberSource`/`createDoorayMemberSource` (Task 13), `Member` (Task 11)
- props 변화 없음(`onImport`, `projectId`, `onImportedMembers`) → `ladder/page.tsx`, `team/page.tsx` 수정 불필요.
- Teams일 때: 라벨 "Teams에서 가져오기", 설정 조회/DB 폴백 생략, `/api/teams/members` 결과를 `onImport(names)` + `onImportedMembers([{name}])`(Dooray ID 없음)로 전달. `dooray_members` 캐시에는 저장하지 않는다(그 테이블의 id는 Dooray direct-send 식별자).

- [ ] **Step 1: `DoorayImportButton.tsx` import 및 훅 추가**

import 블록을 다음으로 교체:
```tsx
import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Download, Loader2, X } from "lucide-react";
import type { DoorayMember } from "@/types/dooray";
import type { Member } from "@/lib/members/types";
import { createDoorayMemberSource } from "@/lib/members/dooray";
import { createTeamsMemberSource } from "@/lib/members/teams";
import { useProviderSettings } from "@/hooks/useProviderSettings";
import { logAction } from "@/lib/action-log";
```
컴포넌트 본문 첫 줄(`const [loading, setLoading] = useState(false);` 위)에 추가:
```tsx
  const { memberSource, isLoaded } = useProviderSettings();
  const isTeams = memberSource === "teams";
```
`handleImport` 첫 줄에 방어 게이트 추가(설정 로드 전 클릭 시 기본값 dooray로 오동작 방지):
```tsx
    if (!isLoaded) return;
```

- [ ] **Step 2: `handleImport`의 `try { ... }` 블록 교체**

기존 `try {` 부터 `logAction("Dooray 멤버 가져오기", ...)` 줄까지를 다음으로 교체(`catch`/`finally`는 그대로):
```tsx
    try {
      if (isTeams) {
        // Teams: 그룹은 관리자 설정(teams_group_id)에 고정 → 프로젝트 선택 없이 서버 라우트 호출
        const members: Member[] = await createTeamsMemberSource().listMembers({ signal: controller.signal });
        if (!members.length) {
          setError("Teams 그룹에 구성원이 없습니다. 관리자 설정(teams_group_id)을 확인해주세요.");
          return;
        }
        const names = members.map((m) => m.name);
        onImport(names);
        if (onImportedMembers) {
          onImportedMembers(members.map((m) => ({ name: m.name })));
        }
        logAction("Teams 멤버 가져오기", "teams", { memberCount: names.length });
        return;
      }

      // 설정에서 토큰/프로젝트ID 가져오기 (개인 설정 우선)
      const [userSettingsRes, settingsRes] = await Promise.all([
        fetch("/api/users/settings", { signal: controller.signal }),
        fetch("/api/settings", { signal: controller.signal }),
      ]);
      const userSettings = userSettingsRes.ok ? await userSettingsRes.json() : {};
      const settings = settingsRes.ok ? await settingsRes.json() : {};

      const token = userSettings.dooray_token || settings.dooray_token;
      const projectId =
        overrideProjectId?.trim() ||
        userSettings.dooray_project_id ||
        settings.dooray_project_id;

      if (!token || !projectId) {
        const ok = await fallbackFromDB("토큰 또는 프로젝트 ID가 설정되지 않았습니다.");
        if (!ok) {
          setError("설정 페이지에서 Dooray 연동을 확인해주세요.");
        }
        return;
      }

      // 브라우저에서 Dooray API 직접 호출 (Chrome 확장이 CORS 처리)
      const members = await createDoorayMemberSource({ token, projectId }).listMembers({ signal: controller.signal });
      const names = members.map((m) => m.name);
      onImport(names);

      // DB에 캐시 저장 (다음 fallback용)
      saveMembersToCache(members);

      // user_members DB에 저장
      if (onImportedMembers) {
        onImportedMembers(
          members.map((m) => ({
            name: m.name,
            dooray_member_id: m.id,
          }))
        );
      }

      logAction("Dooray 멤버 가져오기", "dooray", { memberCount: names.length, projectId });
```

- [ ] **Step 3: `catch` 블록의 DB 폴백을 Dooray 전용으로 제한**

기존:
```tsx
      const errMsg = err instanceof Error ? err.message : "오류가 발생했습니다.";
      const ok = await fallbackFromDB(errMsg);
      if (!ok) {
        setError(err instanceof Error ? err.message : "오류가 발생했습니다.");
      }
```
교체:
```tsx
      const errMsg = err instanceof Error ? err.message : "오류가 발생했습니다.";
      const ok = isTeams ? false : await fallbackFromDB(errMsg);
      if (!ok) {
        setError(errMsg);
      }
```

- [ ] **Step 4: 라벨 교체**

기존:
```tsx
          <span className="hidden sm:inline">{loading ? "불러오는 중..." : "Dooray에서 가져오기"}</span>
```
교체(설정 로드 전에는 중립 라벨 — Dooray→Teams 깜빡임 방지):
```tsx
          <span className="hidden sm:inline">
            {!isLoaded ? "가져오기" : loading ? "불러오는 중..." : isTeams ? "Teams에서 가져오기" : "Dooray에서 가져오기"}
          </span>
```
같은 `<Button>`의 `disabled={loading}`을 `disabled={loading || !isLoaded}`로 변경.
`fetchProjectMembers` import가 더 이상 쓰이지 않으므로 제거되었는지 확인(`grep -n fetchProjectMembers frontend/src/components/shared/DoorayImportButton.tsx` → 없음). `DoorayMember` 타입은 `fallbackFromDB`/`saveMembersToCache`에서 계속 사용.

- [ ] **Step 5: `DoorayProjectSelect.tsx` — Teams면 렌더 생략**

import 추가:
```tsx
import { useProviderSettings } from "@/hooks/useProviderSettings";
```
컴포넌트 본문 첫 줄에 추가하고, `return (` 직전에 early return:
```tsx
  const { memberSource, isLoaded } = useProviderSettings();
  // ... 기존 state/effects 유지 ...

  if (!isLoaded || memberSource === "teams") return null; // provider 로드 전/Teams(관리자 설정 teams_group_id 고정)면 렌더 없음
```
토큰 로딩 `useEffect`(`/api/users/settings` + `/api/settings` → `setToken`)는 첫 줄에 `if (!isLoaded || memberSource === "teams") return;`를 넣고 의존성 배열을 `[]` → `[isLoaded, memberSource]`로 바꿔 Teams 모드에서 불필요한 조회를 막는다.
(훅 순서 규칙: `if (...) return null;`은 모든 `useState/useEffect/useCallback` 호출 뒤, JSX `return` 바로 앞에 둔다.)

- [ ] **Step 6: 타입·린트·테스트**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run`
Expected: 모두 통과

- [ ] **Step 7: 수동 검증**

- `member_source_provider` 미설정/`dooray`: `/ladder`, `/team`에서 "두레이 프로젝트" 셀렉트와 "Dooray에서 가져오기"가 기존과 동일하게 동작(브리지 → 이름 목록, DB 폴백 메시지 포함).
- `teams`로 저장 후 새로고침: 프로젝트 셀렉트 사라지고 버튼 라벨 "Teams에서 가져오기". 클릭 → Graph 멤버 이름이 참여자 목록에 채워지고 "내 구성원"(user_members)에도 저장됨. 설정 누락 시 빨간 오류 문구에 서버 메시지 표시.

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/components/shared/DoorayImportButton.tsx frontend/src/components/shared/DoorayProjectSelect.tsx
git commit -m "feat(members): 가져오기 버튼/프로젝트 선택을 provider-aware로(Teams 소스 지원)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: `FoodRecommendModal` provider-aware (멤버 목록 + DM 수신자)

**Files:**
- Modify: `frontend/src/components/food/FoodRecommendModal.tsx`

**Interfaces:**
- Consumes: `useProviderSettings` (Task 13), `createTeamsMemberSource` (Task 13), `Member` (Task 11), `/api/food/decide`의 `recipients` (Task 7)
- 동작: `memberSource === "teams"`면 `/api/teams/members`에서 `{id,name,email}` 로드(로컬 캐시 키 `food-teams-members`), 결정 시 `recipients: [{email, name}]` 전송. Dooray면 기존 그대로(`/api/dooray/members/db`, 캐시 키 `food-dooray-members`, `member_ids`).

- [ ] **Step 1: import 교체**

기존:
```tsx
import type { DoorayMember } from "@/types/dooray";
import { logAction } from "@/lib/action-log";
```
교체:
```tsx
import type { Member } from "@/lib/members/types";
import { createTeamsMemberSource } from "@/lib/members/teams";
import { useProviderSettings } from "@/hooks/useProviderSettings";
import type { Provider } from "@/lib/providers";
import { logAction } from "@/lib/action-log";
```

- [ ] **Step 2: 로컬 캐시를 provider별 키로**

기존:
```tsx
const MEMBERS_STORAGE_KEY = "food-dooray-members";

function loadCachedMembers(): DoorayMember[] {
  try {
    const saved = localStorage.getItem(MEMBERS_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveCachedMembers(members: DoorayMember[]) {
  try {
    localStorage.setItem(MEMBERS_STORAGE_KEY, JSON.stringify(members));
  } catch {}
}
```
교체:
```tsx
/** provider별 로컬 캐시 키 (Dooray 기존 키 보존) */
function membersStorageKey(provider: Provider) {
  return provider === "teams" ? "food-teams-members" : "food-dooray-members";
}

function loadCachedMembers(provider: Provider): Member[] {
  try {
    const saved = localStorage.getItem(membersStorageKey(provider));
    if (saved) return JSON.parse(saved);
  } catch {}
  return [];
}

function saveCachedMembers(provider: Provider, members: Member[]) {
  try {
    localStorage.setItem(membersStorageKey(provider), JSON.stringify(members));
  } catch {}
}
```

- [ ] **Step 3: 상태 타입·훅**

기존 `const [members, setMembers] = useState<DoorayMember[]>([]);` → `useState<Member[]>([])`.
그 바로 위(`// Member selection` 주석 위)에 추가:
```tsx
  const { memberSource, isLoaded: providerLoaded } = useProviderSettings();
```

- [ ] **Step 4: `loadMembers` 교체**

기존 `const loadMembers = useCallback(async () => { ... }, []);` 전체를:
```tsx
  // Load members (provider: settings.member_source_provider)
  const loadMembers = useCallback(async () => {
    const cached = loadCachedMembers(memberSource);
    if (cached.length > 0) {
      setMembers(cached);
      return;
    }

    setLoadingMembers(true);
    try {
      let loaded: Member[] = [];
      if (memberSource === "teams") {
        loaded = await createTeamsMemberSource().listMembers();
      } else {
        const res = await fetch("/api/dooray/members/db");
        const data = await res.json();
        loaded = data.members ?? [];
      }
      if (loaded.length) {
        setMembers(loaded);
        saveCachedMembers(memberSource, loaded);
      }
    } catch {
      // Failed to load members
    } finally {
      setLoadingMembers(false);
    }
  }, [memberSource]);

  useEffect(() => {
    if (open && providerLoaded) loadMembers();
  }, [open, providerLoaded, loadMembers]);
```
(기존 `useEffect(() => { if (open) loadMembers(); }, [open, loadMembers]);`는 삭제 — 위 블록이 대체.)

- [ ] **Step 5: `handleGo`의 요청 본문에 수신자 분기**

기존:
```tsx
          members: selectedNames,
          member_ids: selectedIds,
          send_to_channel: sendToChannel,
```
교체:
```tsx
          members: selectedNames,
          // Dooray: 멤버 ID / Teams: 이메일(Notifier가 provider에 맞게 해석)
          ...(memberSource === "teams"
            ? { recipients: selectedMemberObjs.map((m) => ({ email: m.email, name: m.name })) }
            : { member_ids: selectedIds }),
          send_to_channel: sendToChannel,
```

- [ ] **Step 6: 타입·린트·테스트**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json && npm run lint && npx vitest run`
Expected: 모두 통과. `grep -n DoorayMember frontend/src/components/food/FoodRecommendModal.tsx` → 없음.

- [ ] **Step 7: 수동 검증**

- Dooray(기본): `/food` 구성원 선택 목록이 `dooray_members` 캐시에서 기존처럼 로드, 결정 시 Dooray DM 그대로.
- `member_source_provider=teams` + `dm_provider=teams` + DM 웹훅 설정: 구성원 목록이 Graph 멤버로 표시(새 캐시 키), "갑시다" → 선택 멤버 이메일로 Teams 1:1 메시지 도착, 결과 화면 "개인 메시지 N명 전송". 이메일 없는 멤버는 `DM 오류` 상세에 `dm(<이름>): 이메일 없음 — Teams DM은 이메일 기준`.
- `member_source=dooray` + `dm=teams`(비권장 조합): 결과 화면에 `dm(<id>): 이메일 없음 …` 오류가 표시되고 채널 발송은 정상 — 관리자 경고(Task 9)와 일치.

- [ ] **Step 8: 커밋**

```bash
git add frontend/src/components/food/FoodRecommendModal.tsx
git commit -m "feat(food): 점심 모달 멤버 소스/DM 수신자를 provider-aware로(Teams 이메일 DM)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

# Phase 3 — 문서 · 최종 검증

### Task 16: 관리자 런북 + 프로젝트 문서 갱신 + 최종 검증

**Files:**
- Create: `docs/teams-integration.md`
- Modify: `CLAUDE.md` (API Routes, Environment Variables)
- Modify: `docs/dooray-integration.md` (provider 선택 안내 1절 추가)
- Modify: `docs/superpowers/specs/2026-08-20-teams-integration-provider-design.md` (상태 줄)

- [ ] **Step 1: 런북 작성**

```markdown
<!-- docs/teams-integration.md -->
# Microsoft Teams 연동 가이드 (Dooray 대체 선택)

앱은 세 축(채널 알림 A · 멤버 가져오기 B · 개인 DM C)마다 Dooray ↔ Teams provider를 관리자 설정에서 선택한다.
기본값은 Dooray. 설계: `docs/superpowers/specs/2026-08-20-teams-integration-provider-design.md`.

## 1. 관리자 설정 (앱 > 관리 > 시스템 설정)

| 카드 | 키 | 값 |
|---|---|---|
| 연동 채널 선택 | `notify_provider` / `member_source_provider` / `dm_provider` | `dooray` 또는 `teams` (축별 독립) |
| Microsoft Teams | `teams_notify_webhook_url` | A. 채널 게시 워크플로 HTTP POST URL |
| | `teams_dm_webhook_url` | C. 개인 DM 워크플로 HTTP POST URL |
| | `teams_tenant_id` | Entra 테넌트 ID |
| | `teams_graph_client_id` | Graph 앱(클라이언트) ID |
| | `teams_group_id` | 멤버를 가져올 팀의 Microsoft 365 그룹 ID |

**환경변수(서버 전용·비밀)**: `TEAMS_GRAPH_CLIENT_SECRET` — 로컬 `frontend/.env.local`, 운영 Vercel Environment Variables. settings 테이블에 저장하지 않는다.

권장 조합: 멤버(B)와 DM(C)은 같은 provider로. `member=dooray + dm=teams`면 Dooray 멤버에 이메일이 없어 점심 DM을 보낼 수 없다(가이드 답변 DM은 로그인 이메일이라 무관).

## 2. Power Automate 워크플로 2개

### 2.1 A. 채널 알림 — "When an HTTP request is received" → "Post message in a chat or channel"
- 트리거 요청 본문 JSON 스키마:
  ```json
  {
    "type": "object",
    "properties": {
      "title": { "type": "string" },
      "text":  { "type": "string" },
      "html":  { "type": "string" }
    },
    "required": ["title", "text"]
  }
  ```
- 게시 단계: Post as = Flow bot, Post in = Channel, Team/Channel 선택, Message = `@{triggerBody()?['html']}` (HTML 본문; 마크다운 카드를 쓰려면 `text`).
- 저장 후 생성되는 **HTTP POST URL**을 `teams_notify_webhook_url`에 입력.
- 앱이 보내는 본문 예: `{"title":"팀 구성 결과","text":"👥 팀 구성 결과\n\n**1팀** (2명): 홍길동(법카), 김철수","html":"👥 팀 구성 결과<br><br><b>1팀</b> (2명): 홍길동(법카), 김철수"}`

### 2.2 C. 개인 DM — "When an HTTP request is received" → "Post message in a chat or channel"
- 스키마:
  ```json
  {
    "type": "object",
    "properties": {
      "recipientEmail": { "type": "string" },
      "text": { "type": "string" },
      "html": { "type": "string" }
    },
    "required": ["recipientEmail", "text"]
  }
  ```
- 게시 단계: Post as = Flow bot, Post in = Chat with Flow bot, Recipient = `@{triggerBody()?['recipientEmail']}`, Message = `@{triggerBody()?['html']}`.
- URL을 `teams_dm_webhook_url`에 입력.
- 라이선스: Teams 커넥터/HTTP 트리거가 프리미엄으로 분류될 수 있음 — 조직 Power Automate 라이선스 확인.

### 2.3 테스트
```bash
curl -X POST "$TEAMS_NOTIFY_WEBHOOK_URL" -H "Content-Type: application/json" \
  -d '{"title":"테스트","text":"**굵게** 줄1\n줄2","html":"<b>굵게</b> 줄1<br>줄2"}'
```
202 Accepted면 정상.

## 3. Microsoft Graph (멤버 가져오기)

1. Entra 관리 센터 > 앱 등록 > (Supabase Azure 로그인에 쓰는 앱 재사용) > API 권한 > **Microsoft Graph > 애플리케이션 권한 > `GroupMember.Read.All`** 추가 > **관리자 동의 부여**.
2. 인증서 및 암호 > 새 클라이언트 암호 → 값(한 번만 표시)을 `TEAMS_GRAPH_CLIENT_SECRET`에 저장.
3. Teams 팀의 그룹 ID: Teams 관리 센터 > 팀 > 해당 팀 > 그룹 ID, 또는 Graph Explorer `GET /groups?$filter=displayName eq '팀이름'&$select=id`.
4. 앱이 호출하는 API:
   - `POST https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token` (client_credentials, scope `https://graph.microsoft.com/.default`) — 토큰은 서버 메모리 캐시(만료 60초 전 갱신)
   - `GET https://graph.microsoft.com/v1.0/groups/{groupId}/members/microsoft.graph.user?$select=id,displayName,mail,userPrincipalName&$top=999` (+ `@odata.nextLink`)
   - 이메일 = `mail` → 없으면 `userPrincipalName`
5. 확인: 로그인 상태에서 `GET /api/teams/members` → `{ members: [{id, name, email}] }`. `403 Authorization_RequestDenied`면 관리자 동의 누락.

## 4. 코드 구조

| 파일 | 역할 |
|---|---|
| `frontend/src/lib/providers.ts` | provider 타입/키/파서 |
| `frontend/src/lib/notify/` | `Notifier`(채널/DM) — `dooray.ts`, `teams.ts`, 팩토리 `index.ts`, 메시지 `messages.ts` |
| `frontend/src/lib/members/` | `MemberSource`(클라이언트) — `dooray.ts`(브리지), `teams.ts`(라우트) |
| `frontend/src/lib/teams-graph.ts` | Graph app-only 토큰·그룹 멤버(서버) |
| `frontend/src/app/api/teams/members/route.ts` | `GET` 그룹 멤버 |
| `frontend/src/hooks/useProviderSettings.ts` | 클라이언트 provider 조회 |
| `frontend/src/components/settings/ProviderSettings.tsx`, `TeamsSettings.tsx` | 관리자 UI |

## 5. 알려진 제약
- Teams 멤버 import는 `user_members`에 이름만 저장한다(`dooray_member_id`는 null). 재-DM 식별은 점심 모달이 Graph에서 이메일을 다시 읽어 해결한다.
- 가이드 답변 DM(Teams)은 로그인 이메일로 간다 — 개인 설정의 "Dooray 본인 선택"은 Dooray DM에만 쓰인다.
- `GET /api/settings`는 비admin에게 웹훅 URL을 숨긴다. `dooray_token`은 브라우저 확장 브리지 때문에 계속 노출된다(기존과 동일).
```

- [ ] **Step 2: `CLAUDE.md` 갱신**

"### API Routes" 목록 끝에 추가:
```markdown
- `GET /api/teams/members` — Microsoft Graph(app-only)로 `settings.teams_group_id` 그룹 멤버 조회 (`{id, name, email}`)
```
"**Environment Variables**:" 목록에 추가:
```markdown
- `TEAMS_GRAPH_CLIENT_SECRET` — Graph app-only 클라이언트 시크릿 (멤버 가져오기 provider=teams일 때 필수; settings에 저장 금지)
```
"### Key Patterns" 끝에 추가:
```markdown
**Provider 선택(Dooray/Teams)**: 채널 알림·멤버 소스·개인 DM을 관리자 설정(`notify_provider`/`member_source_provider`/`dm_provider`)으로 축별 선택. 서버는 `lib/notify`(Notifier), 클라이언트는 `lib/members`(MemberSource)를 통해서만 provider를 다룬다. 런북: `docs/teams-integration.md`.
```
"Project Overview" 첫 문단의 "with Dooray API integration" → "with Dooray/Microsoft Teams integration (관리자 선택)".

- [ ] **Step 3: `docs/dooray-integration.md` 상단 "## 개요" 아래에 추가**

```markdown
> **Provider 선택**: 채널 알림·멤버·DM 각각을 관리자 설정에서 Dooray ↔ Microsoft Teams로 바꿀 수 있다. Teams 측 설정은 `docs/teams-integration.md` 참고. 이 문서는 Dooray provider 동작을 설명한다.
```

- [ ] **Step 4: 스펙 상태 갱신**

`docs/superpowers/specs/2026-08-20-teams-integration-provider-design.md`의 `- 상태: 설계 승인 대기 → 구현 계획 전 단계` → `- 상태: 구현 완료 (계획: docs/superpowers/plans/2026-08-20-teams-integration-provider.md)`

- [ ] **Step 5: 최종 검증**

Run:
```bash
cd frontend && npx vitest run && npm run lint && npm run build
```
Expected: 테스트 전부 통과(기준 68 + 신규 ≈ 45), lint 0 error, build 성공.

수동 회귀 체크리스트(모두 provider 미설정 = Dooray 상태에서):
- [ ] `/team` 팀 나누기 → Dooray 채널 알림 도착(`팀봇`)
- [ ] `/ladder`, `/team` "Dooray에서 가져오기" + 프로젝트 셀렉트 동작, DB 폴백 메시지 동작
- [ ] `/food` 구성원 목록 로드, 결정 → 채널(`점심봇`)+DM, "메신저 열기" 링크
- [ ] `/guide` 질문 → Dooray DM 도착
- [ ] `/admin/settings` 기존 값 저장/로드

Teams 체크리스트(관리자 준비물 완료 후):
- [ ] `notify_provider=teams` → 팀 구성/점심 채널 메시지가 Teams 채널에 게시
- [ ] `dm_provider=teams` → 가이드 답변이 로그인 이메일로 Teams 1:1 도착
- [ ] `member_source_provider=teams` → 가져오기 버튼 라벨/동작, 프로젝트 셀렉트 숨김, `/food` 멤버 목록 = Graph
- [ ] 위 셋 모두 teams → 점심 DM이 선택 멤버 이메일로 도착

- [ ] **Step 6: 커밋**

```bash
git add docs/teams-integration.md CLAUDE.md docs/dooray-integration.md docs/superpowers/specs/2026-08-20-teams-integration-provider-design.md
git commit -m "docs(teams): Teams 연동 런북 + CLAUDE.md/Dooray 문서 갱신

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: 배포(사용자 지시 시)**

메모리 `frontend-deploy-method.md`대로 GitHub 자동배포가 아니므로: `git push origin main` 후 `./frontend/scripts/deploy-frontend.sh prod`. 배포 전 Vercel 환경변수에 `TEAMS_GRAPH_CLIENT_SECRET` 추가 필요(멤버 provider를 teams로 쓸 때만).

---

## Self-Review 결과

**Spec coverage**
- §3.1 Notifier(dooray/teams/index) → Task 3/4/5. §3.2 MemberSource(dooray/teams/index) → Task 11/13. 
- §4.1 settings 키 8개 → Task 1(상수)·9(훅/UI). §4.2 env 시크릿 → Task 12(읽기)·9(UI 안내)·16(문서).
- §5.1 A 채널 → Task 6/7(+Teams 구현 Task 4). §5.2 B 멤버 → Task 11/12/13/14/15. §5.3 C DM → Task 7/8(+Task 4).
- §6 관리자 UI → Task 9. §7 보안(secret env, settings GET 하드닝) → Task 10/12. §8 혼합 provider 경고 → Task 9(경고)·15(오류 문자열). §9 데이터 모델 → 스키마 변경 없이 이메일을 Graph에서 재조회하는 방식으로 해결(Task 15), 문서에 명시(Task 16 §5). §10 사전조건 1 완료(`0b4cd38`), 2는 런북(Task 16). §11 단계 → 매핑 표 참조.

**Placeholder scan**: TBD/TODO/"적절히 처리" 류 없음. 모든 코드 스텝에 실제 코드 포함.

**Type consistency**: `Notifier`(provider/channelConfigured/directConfigured/sendChannel/sendDirect), `DirectRecipient{email?,memberId?,name?}`, `Member{id,name,email?}`, `createNotifier(axis, settings)`, `getNotifier(supabase, axis, overrides)`, `loadSettings(supabase, keys)`, `loadUserSettings(supabase, userId, keys)`, `createTeamsMemberSource(fetchImpl?)`, `createDoorayMemberSource({token, projectId})`, `useProviderSettings() → {notify, memberSource, dm, isLoaded}`, `SETTING_KEYS`/`SettingKey`/`DEFAULT_SETTINGS` — 모든 태스크에서 동일 명칭 사용 확인.
