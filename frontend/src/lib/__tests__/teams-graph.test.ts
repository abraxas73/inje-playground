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
