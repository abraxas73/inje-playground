import { describe, it, expect } from "vitest";
import { createNotifier, personalNotifyOverrides, USER_NOTIFIER_SETTING_KEYS } from "@/lib/notify";
import { checkWebhookUrl, WEBHOOK_URL_MAX } from "@/lib/notify/url-guard";
import { parseFolderUrl, FOLDER_URL_MAX } from "@/lib/ms/folder-route";

describe("personalNotifyOverrides", () => {
  it("개인 워크플로우 URL이 있으면 그 URL + provider teams로 덮어쓴다", () => {
    expect(personalNotifyOverrides({ teams_notify_webhook_url: "https://x.logic.azure.com/hook" })).toEqual({
      dooray_token: undefined,
      teams_notify_webhook_url: "https://x.logic.azure.com/hook",
      notify_provider: "teams",
    });
  });
  it("개인 URL이 없으면 provider를 건드리지 않는다(전역 설정 그대로)", () => {
    expect(personalNotifyOverrides({})).toEqual({ dooray_token: undefined });
    expect(personalNotifyOverrides({ teams_notify_webhook_url: "   " })).toEqual({ dooray_token: undefined });
  });
  it("개인 Dooray 토큰은 그대로 넘긴다", () => {
    expect(personalNotifyOverrides({ dooray_token: "ut" }).dooray_token).toBe("ut");
  });
  it("전역이 dooray여도 개인 URL이 있으면 Teams로 보낸다", () => {
    const settings: Record<string, string | undefined> = { notify_provider: "dooray", dooray_hook_url: "https://hook.dooray.com/x" };
    const personal = personalNotifyOverrides({ teams_notify_webhook_url: "https://x.logic.azure.com/hook" });
    const notifier = createNotifier("notify", { ...settings, ...personal });
    expect(notifier.channelConfigured).toBe(true);
    expect(notifier.provider).toBe("teams");
  });
  it("개인 설정에서 읽는 키 목록", () => {
    expect([...USER_NOTIFIER_SETTING_KEYS]).toEqual(["teams_notify_webhook_url", "dooray_token"]);
  });
});

describe("checkWebhookUrl", () => {
  it("https 공개 도메인만 통과", () => {
    expect(checkWebhookUrl("https://prod-12.koreacentral.logic.azure.com/workflows/abc/triggers/manual/paths/invoke")).toEqual({
      ok: true, url: "https://prod-12.koreacentral.logic.azure.com/workflows/abc/triggers/manual/paths/invoke",
    });
    expect(checkWebhookUrl(" https://x.example.com/hook ").ok).toBe(true);
  });
  it("http·빈값·형식 오류는 막는다", () => {
    expect(checkWebhookUrl("http://x.example.com").ok).toBe(false);
    expect(checkWebhookUrl("").ok).toBe(false);
    expect(checkWebhookUrl(null).ok).toBe(false);
    expect(checkWebhookUrl("그냥 문자열").ok).toBe(false);
    expect(checkWebhookUrl(`https://x.example.com/${"a".repeat(WEBHOOK_URL_MAX)}`).ok).toBe(false);
  });
  it("사내망·로컬·메타데이터 주소는 막는다(SSRF)", () => {
    for (const u of [
      "https://localhost/hook",
      "https://127.0.0.1/hook",
      "https://10.0.0.5/hook",
      "https://192.168.1.10/hook",
      "https://172.16.0.1/hook",
      "https://169.254.169.254/latest/meta-data",
      "https://gw.internal/hook",
      "https://printer.local/hook",
      "https://[::1]/hook",
    ]) {
      expect(checkWebhookUrl(u).ok, u).toBe(false);
    }
  });
  it("표기 우회(IPv4 매핑 IPv6·후행 점·단일 라벨·사설 접미사)도 막는다", () => {
    for (const u of [
      "https://[::ffff:127.0.0.1]/hook",   // IPv4-mapped IPv6
      "https://[::ffff:7f00:1]/hook",      // 같은 주소의 hex 표기
      "https://localhost./hook",           // 후행 점
      "https://metadata.google.internal./hook",
      "https://gw/hook",                   // 점 없는 단일 라벨
      "https://wiki.corp/hook",
      "https://nas.lan/hook",
      "https://host.home.arpa/hook",
    ]) {
      expect(checkWebhookUrl(u).ok, u).toBe(false);
    }
  });
  it("URL에 계정 정보가 있으면 막는다", () => {
    expect(checkWebhookUrl("https://user:pw@x.example.com/hook").ok).toBe(false);
  });
});

describe("parseFolderUrl", () => {
  it("https 링크만 통과하고 다듬는다", () => {
    expect(parseFolderUrl("  https://innogrid.sharepoint.com/sites/x/Shared%20Documents/RFP  ")).toEqual({
      ok: true, url: "https://innogrid.sharepoint.com/sites/x/Shared%20Documents/RFP",
    });
    expect(parseFolderUrl("http://x").ok).toBe(false);
    expect(parseFolderUrl("").ok).toBe(false);
    expect(parseFolderUrl(123).ok).toBe(false);
    expect(parseFolderUrl(`https://x/${"a".repeat(FOLDER_URL_MAX)}`).ok).toBe(false);
  });
});
