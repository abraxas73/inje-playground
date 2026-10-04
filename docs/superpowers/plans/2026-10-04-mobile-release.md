# 모바일 앱 사내 배포 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구성원이 웹 `/apps`(Android APK)·TestFlight 공개 링크(iOS)로 앱을 설치하고, 앱이 새 버전을 알려 주며, 운영자 Mac에서 스크립트 한 번으로 릴리스한다.

**Architecture:** 릴리스 메타데이터는 Supabase `settings` 키 `mobile_release`(문자열 JSON, 플랫폼별 블록), APK는 비공개 버킷 `mobile`. 서버 `GET /api/mobile/release`가 둘을 합쳐 플랫폼별 버전·링크(APK 600초 서명 URL·TestFlight 링크)를 주고, 웹 `/apps` 페이지와 앱의 `releaseProvider`가 이를 읽는다. 릴리스 스크립트가 pubspec 버전을 `--dart-define`으로 빌드에 넣고 스토리지·설정을 service role로 갱신한다.

**Tech Stack:** Flutter 3.44 / Riverpod 3 / url_launcher / flutter_launcher_icons(dev) · Next.js 16 App Router / vitest / Supabase storage · bash + curl + python3 + xcrun altool

**Spec:** `docs/superpowers/specs/2026-10-04-mobile-release-design.md`

## Global Constraints

- 저장소 루트 `/Users/seunguk.kang/Repos/inje-playground`. **main에 직접 커밋**(사용자 규칙), 커밋 끝에 `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. 푸시는 `git pull --rebase` 후.
- Flutter 3.44 stable, Android minSdk 26, iOS 15, 번들 ID `com.innogrid.playground`. pubspec 의존성은 기존 11개 + **dev `flutter_launcher_icons` 1개만** 추가(스펙 §2 예외). 다른 의존성 추가 금지.
- 버전 출처는 `mobile/pubspec.yaml`의 `version: X.Y.Z+N` 하나. 코드는 `--dart-define=APP_VERSION`·`APP_BUILD`로 받고 기본값 `dev`/`0`(0 = 업데이트 확인 안 함).
- 아이콘은 CI 가이드 색 `#006cdb` 바탕 + 흰 CONNECTION(점 8개 링) 모티프. 글자 없음. 앱 UI 팔레트(`Brand`)는 바꾸지 않는다.
- API·페이지는 user 이상(`requireUser`, 카탈로그 `minRole: "user"`). APK 서명 URL 600초, 버킷 비공개. 앱의 Dart 카탈로그 `pages`에는 `/apps`를 넣지 않는다.
- 비밀(service role 키·ASC 키·키스토어 비밀번호·토큰·서명 URL)은 로그·출력·문서·커밋에 남기지 않는다. `key.properties`·`*.jks`·`.env.release`는 gitignore. 커밋 전 `git status`로 확인.
- 쓰기 경로는 릴리스 스크립트뿐(관리 UI 없음). 자동 버전 올리기·CI·Fastlane·앱 자체 설치 없음.
- 테스트 응답에 한글이 들어가면 Dart는 `http.Response.bytes(utf8.encode(...), 200, headers: {'content-type': 'application/json; charset=utf-8'})`. 애니메이션이 있는 위젯은 `pumpAndSettle` 대신 `pump()`. 같은 자리에 `ProviderScope`를 다시 pump할 때는 `key: UniqueKey()`.
- 작업 디렉터리 주의: Bash 호출마다 `cd`를 명시한다(병렬 호출은 cwd를 공유하지 않는다).

## Review Focus

1. 서버 JSON의 `build`가 정수 문자열(`"3"`)로 저장된 경우(손으로 고친 설정) — 숫자로 받아들여야 한다 → Task 1 `parseRelease`, Task 2 `parseMobileRelease` 테스트.
2. 자기 플랫폼 블록이 없을 때(iOS만 올라간 날 Android 앱) — 배너가 뜨지 않고 조용해야 한다 → Task 1·4 테스트.
3. 서명 URL 발급 실패(버킷에 파일 없음) — 버전 안내는 되고 링크만 비어야 한다(200 유지) → Task 2 API 테스트, Task 4 "링크 없으면 웹 안내".
4. 개발 빌드(`APP_BUILD` 없음) — 서버 빌드가 커도 배너·버튼이 절대 뜨지 않아야 한다 → Task 1·4 테스트.
5. 웹 `/apps`에서 서명 URL(600초)이 만료된 뒤 버튼을 누르는 경우 — 누를 때 새로 받아야 한다 → Task 3 "누를 때 새 서명 URL" 테스트.

---

### Task 1: 버전 상수(dart-define)와 릴리스 판정 순수 함수

**Files:**
- Create: `mobile/lib/release/release_check.dart`
- Modify: `mobile/lib/config.dart:6`
- Test: `mobile/test/release/release_check_test.dart`

**Interfaces:**
- Consumes: 없음
- Produces: `class ReleaseInfo { final String version; final int build; final String? url; const ReleaseInfo({required version, required build, url}); }`, `ReleaseInfo? parseRelease(dynamic json, {required bool android})`, `bool hasUpdate(ReleaseInfo? r, int appBuild)`, `String versionLabel(String version, int build)`, `Config.appVersion`(String, 기본 `'dev'`), `Config.appBuild`(int, 기본 `0`).

- [ ] **Step 1: 실패하는 테스트 작성**

```dart
// mobile/test/release/release_check_test.dart
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/config.dart';
import 'package:playground/release/release_check.dart';

void main() {
  const server = {
    'notes': 'n',
    'android': {'version': '1.1.0', 'build': 3, 'releasedAt': '2026-10-04T06:00:00Z', 'url': 'https://x/apk'},
    'ios': {'version': '1.1.0', 'build': '3', 'releasedAt': '2026-10-04T06:30:00Z', 'url': null},
  };
  test('자기 플랫폼 블록만 읽는다 — build는 정수·정수 문자열 모두, url 없으면 null', () {
    final a = parseRelease(server, android: true)!;
    expect((a.version, a.build, a.url), ('1.1.0', 3, 'https://x/apk'));
    final i = parseRelease(server, android: false)!;
    expect((i.version, i.build, i.url), ('1.1.0', 3, null));
  });
  test('블록이 없거나 형식이 틀리면 null', () {
    expect(parseRelease({'android': null, 'ios': null}, android: true), isNull);
    expect(parseRelease({'ios': {'version': '1.0.0', 'build': 0}}, android: false), isNull);
    expect(parseRelease({'ios': {'version': '', 'build': 2}}, android: false), isNull);
    expect(parseRelease({'ios': {'version': '1.0.0', 'build': 'x'}}, android: false), isNull);
    expect(parseRelease('nope', android: true), isNull);
    expect(parseRelease({'android': {'version': '1.0.0', 'build': 2}}, android: false), isNull, reason: 'iOS 블록 없음');
  });
  test('hasUpdate — 서버 빌드가 커야 하고, 앱 빌드 0(개발)은 항상 false', () {
    const r = ReleaseInfo(version: '1.1.0', build: 3);
    expect(hasUpdate(r, 2), isTrue);
    expect(hasUpdate(r, 3), isFalse);
    expect(hasUpdate(r, 4), isFalse);
    expect(hasUpdate(r, 0), isFalse);
    expect(hasUpdate(null, 2), isFalse);
  });
  test('versionLabel — 1.0.0 (1), 개발 빌드는 dev; Config 기본값은 dev/0', () {
    expect(versionLabel('1.0.0', 1), '1.0.0 (1)');
    expect(versionLabel('dev', 0), 'dev');
    expect((Config.appVersion, Config.appBuild), ('dev', 0));
  });
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/seunguk.kang/Repos/inje-playground/mobile && flutter test test/release/release_check_test.dart 2>&1 | tail -5`
Expected: 컴파일 오류 — `release_check.dart` 없음 / `Config.appBuild` 없음.

- [ ] **Step 3: 구현**

```dart
// mobile/lib/release/release_check.dart
/// 서버 `GET /api/mobile/release` 응답에서 자기 플랫폼 블록만 읽는다. 형식이 틀리면 null(업데이트 안내 없음).
class ReleaseInfo {
  const ReleaseInfo({required this.version, required this.build, this.url});
  final String version;
  final int build;
  /// Android: APK 서명 URL(600초) · iOS: TestFlight 링크. 없으면 웹 /apps 안내.
  final String? url;
}

ReleaseInfo? parseRelease(dynamic json, {required bool android}) {
  if (json is! Map) return null;
  final block = json[android ? 'android' : 'ios'];
  if (block is! Map) return null;
  final version = block['version'];
  final build = block['build'];
  final b = build is int ? build : (build is String ? int.tryParse(build) : null);
  if (version is! String || version.isEmpty || b == null || b <= 0) return null;
  final url = block['url'];
  return ReleaseInfo(version: version, build: b, url: url is String && url.isNotEmpty ? url : null);
}

/// 앱 빌드 0은 "모름"(dart-define 없는 개발 빌드) — 안내하지 않는다.
bool hasUpdate(ReleaseInfo? r, int appBuild) => appBuild > 0 && r != null && r.build > appBuild;

/// 더보기 "앱 버전" 표시: `1.0.0 (1)`, 개발 빌드는 `dev`.
String versionLabel(String version, int build) => build > 0 ? '$version ($build)' : 'dev';
```

`mobile/lib/config.dart`의 `static const appVersion = '1.0.0'; // pubspec version과 맞춘다` 줄을 다음으로 교체:

```dart
  /// 릴리스 스크립트(mobile/scripts/release-mobile.sh)가 pubspec version에서 읽어 --dart-define으로 넘긴다. 없으면 개발 빌드(dev/0) — 업데이트 확인을 건너뛴다.
  static const appVersion = String.fromEnvironment('APP_VERSION', defaultValue: 'dev');
  static const appBuild = int.fromEnvironment('APP_BUILD', defaultValue: 0);
```

- [ ] **Step 4: 통과 확인 + 전체**

Run: `cd /Users/seunguk.kang/Repos/inje-playground/mobile && flutter test test/release/release_check_test.dart 2>&1 | tail -3 && flutter test 2>&1 | tail -2 && flutter analyze 2>&1 | tail -2`
Expected: `+4: All tests passed!`, 전체 `+142`(138+4) 통과, `No issues found!`. (`more_screen.dart`는 `Config.appVersion`을 그대로 쓰므로 `dev`로 표시되지만 Task 4에서 바뀐다.)

- [ ] **Step 5: 커밋**

```bash
cd /Users/seunguk.kang/Repos/inje-playground && git add mobile/lib/release/release_check.dart mobile/lib/config.dart mobile/test/release/release_check_test.dart && git commit -q -m "feat(mobile): 앱 버전을 pubspec→--dart-define(APP_VERSION·APP_BUILD)으로, 릴리스 판정 순수 함수(parseRelease·hasUpdate·versionLabel)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: 서버 — `mobile_release` 파싱, `GET /api/mobile/release`, 버킷

**Files:**
- Create: `frontend/src/lib/mobile/release.ts`, `frontend/src/app/api/mobile/release/route.ts`, `docs/sql/2026-10-04-mobile-release.sql`
- Test: `frontend/src/lib/__tests__/mobile-release.test.ts`, `frontend/src/lib/__tests__/mobile-release-api.test.ts`

**Interfaces:**
- Consumes: `requireUser()`(`@/lib/rfp/require-user`) → `{ ok: true, userId, role, admin: SupabaseClient } | { ok: false, response }`.
- Produces: `MOBILE_RELEASE_KEY = "mobile_release"`, `MOBILE_BUCKET = "mobile"`, `APK_URL_TTL_SECONDS = 600`, `parseMobileRelease(raw): MobileRelease`, `releaseResponse(rel, apkUrl): ReleaseResponse`; HTTP `GET /api/mobile/release` → `{ notes, ios: {version, build, releasedAt, url} | null, android: {…} | null }`. 스크립트(Task 6)가 쓰는 설정 JSON 형식: `{ notes, testflightUrl, android: {version, build, apkPath, releasedAt}, ios: {version, build, releasedAt} }`.

- [ ] **Step 1: 파싱 테스트 작성**

```ts
// frontend/src/lib/__tests__/mobile-release.test.ts
import { describe, expect, it } from "vitest";
import { parseMobileRelease, releaseResponse } from "@/lib/mobile/release";

const full = JSON.stringify({ notes: "게시판", testflightUrl: "https://testflight.apple.com/join/abc", android: { version: "1.1.0", build: 3, apkPath: "android/innogrid-1.1.0+3.apk", releasedAt: "2026-10-04T06:00:00Z" }, ios: { version: "1.1.0", build: "3", releasedAt: "2026-10-04T06:30:00Z" } });

describe("parseMobileRelease", () => {
  it("정상 — build는 정수·정수 문자열 모두 받는다", () => {
    const r = parseMobileRelease(full);
    expect(r.android).toEqual({ version: "1.1.0", build: 3, apkPath: "android/innogrid-1.1.0+3.apk", releasedAt: "2026-10-04T06:00:00Z" });
    expect(r.ios).toEqual({ version: "1.1.0", build: 3, releasedAt: "2026-10-04T06:30:00Z" });
    expect(r.testflightUrl).toBe("https://testflight.apple.com/join/abc");
    expect(r.notes).toBe("게시판");
  });
  it.each([undefined, "", "{broken", "[]", "null"])("없음·깨짐(%s)은 빈 값", (raw) => {
    expect(parseMobileRelease(raw)).toEqual({ notes: "", testflightUrl: null, android: null, ios: null });
  });
  it("플랫폼 블록은 version·양의 정수 build가 있어야 산다 — android는 apkPath도", () => {
    expect(parseMobileRelease(JSON.stringify({ android: { version: "1.0.0", build: 0, apkPath: "a" } })).android).toBeNull();
    expect(parseMobileRelease(JSON.stringify({ android: { version: "1.0.0", build: -2, apkPath: "a" } })).android).toBeNull();
    expect(parseMobileRelease(JSON.stringify({ android: { version: "1.0.0", build: 2 } })).android).toBeNull();
    expect(parseMobileRelease(JSON.stringify({ ios: { version: "1.0.0", build: 2 } })).ios).toEqual({ version: "1.0.0", build: 2, releasedAt: null });
    expect(parseMobileRelease(JSON.stringify({ ios: { version: "1.0.0", build: 2 } })).android).toBeNull();
  });
});

describe("releaseResponse", () => {
  it("ios.url은 testflightUrl, android.url은 넘겨준 서명 URL — 없으면 null", () => {
    const r = parseMobileRelease(full);
    expect(releaseResponse(r, "https://signed").android).toEqual({ version: "1.1.0", build: 3, releasedAt: "2026-10-04T06:00:00Z", url: "https://signed" });
    expect(releaseResponse(r, null).android?.url).toBeNull();
    expect(releaseResponse(r, null).ios?.url).toBe("https://testflight.apple.com/join/abc");
    expect(releaseResponse({ ...r, testflightUrl: null }, null).ios?.url).toBeNull();
    expect(releaseResponse({ ...r, ios: null, android: null }, null)).toEqual({ notes: "게시판", ios: null, android: null });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npx vitest run src/lib/__tests__/mobile-release.test.ts 2>&1 | tail -5`
Expected: FAIL — `Failed to resolve import "@/lib/mobile/release"`.

- [ ] **Step 3: 파싱 구현**

```ts
// frontend/src/lib/mobile/release.ts
/** settings 키 `mobile_release`(문자열 JSON) ↔ GET /api/mobile/release 응답. 쓰는 쪽은 릴리스 스크립트(mobile/scripts/release-mobile.sh)뿐. */
export const MOBILE_RELEASE_KEY = "mobile_release";
export const MOBILE_BUCKET = "mobile";
export const APK_URL_TTL_SECONDS = 600;

export type PlatformRelease = { version: string; build: number; releasedAt: string | null };
export type AndroidRelease = PlatformRelease & { apkPath: string };
export type MobileRelease = { notes: string; testflightUrl: string | null; android: AndroidRelease | null; ios: PlatformRelease | null };
export type ReleaseResponse = {
  notes: string;
  ios: (PlatformRelease & { url: string | null }) | null;
  android: (PlatformRelease & { url: string | null }) | null;
};

const EMPTY: MobileRelease = { notes: "", testflightUrl: null, android: null, ios: null };

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);
function buildNo(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : null;
}
function platform(v: unknown): PlatformRelease | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const version = str(o.version);
  const build = buildNo(o.build);
  if (!version || build === null) return null;
  return { version, build, releasedAt: str(o.releasedAt) };
}

/** 관대한 파싱: 없음·깨진 JSON·형식 오류는 빈 값. 플랫폼 블록은 version·양의 정수 build가 있어야 산다(android는 apkPath도). */
export function parseMobileRelease(raw: string | undefined | null): MobileRelease {
  if (!raw) return EMPTY;
  let j: unknown;
  try { j = JSON.parse(raw); } catch { return EMPTY; }
  if (!j || typeof j !== "object" || Array.isArray(j)) return EMPTY;
  const o = j as Record<string, unknown>;
  const a = platform(o.android);
  const apkPath = a ? str((o.android as Record<string, unknown>).apkPath) : null;
  return {
    notes: typeof o.notes === "string" ? o.notes : "",
    testflightUrl: str(o.testflightUrl),
    android: a && apkPath ? { ...a, apkPath } : null,
    ios: platform(o.ios),
  };
}

export function releaseResponse(rel: MobileRelease, apkUrl: string | null): ReleaseResponse {
  return {
    notes: rel.notes,
    ios: rel.ios ? { ...rel.ios, url: rel.testflightUrl } : null,
    android: rel.android ? { version: rel.android.version, build: rel.android.build, releasedAt: rel.android.releasedAt, url: apkUrl } : null,
  };
}
```

- [ ] **Step 4: 파싱 테스트 통과 확인**

Run: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npx vitest run src/lib/__tests__/mobile-release.test.ts 2>&1 | tail -4`
Expected: `Tests  8 passed`.

- [ ] **Step 5: API 테스트 작성**

```ts
// frontend/src/lib/__tests__/mobile-release-api.test.ts
// @vitest-environment node
import { beforeEach, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
const m = vi.hoisted(() => ({ ok: true as boolean, value: null as string | null, signed: vi.fn() }));
vi.mock("@/lib/rfp/require-user", () => ({ requireUser: async () => m.ok
  ? { ok: true, userId: "u1", role: "user", admin: {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: m.value === null ? null : { value: m.value }, error: null }) }) }) }),
      storage: { from: () => ({ createSignedUrl: m.signed }) },
    } }
  : { ok: false, response: NextResponse.json({ error: "사용자 권한이 필요합니다." }, { status: 403 }) } }));
import { GET } from "@/app/api/mobile/release/route";
const rel = JSON.stringify({ notes: "n", testflightUrl: "https://tf", android: { version: "1.1.0", build: 3, apkPath: "android/innogrid-1.1.0+3.apk" }, ios: { version: "1.1.0", build: 3 } });
beforeEach(() => { m.ok = true; m.value = rel; m.signed.mockReset().mockResolvedValue({ data: { signedUrl: "https://signed/apk" }, error: null }); });

it("플랫폼별 버전과 링크 — APK는 600초 서명 URL(파일명 지정), iOS는 TestFlight 링크, no-store", async () => {
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get("Cache-Control")).toBe("no-store");
  expect(await res.json()).toEqual({ notes: "n", ios: { version: "1.1.0", build: 3, releasedAt: null, url: "https://tf" }, android: { version: "1.1.0", build: 3, releasedAt: null, url: "https://signed/apk" } });
  expect(m.signed).toHaveBeenCalledWith("android/innogrid-1.1.0+3.apk", 600, { download: "innogrid-1.1.0+3.apk" });
});
it("설정이 없으면 빈 응답 200, 서명 호출 없음", async () => {
  m.value = null;
  const res = await GET();
  expect(await res.json()).toEqual({ notes: "", ios: null, android: null });
  expect(m.signed).not.toHaveBeenCalled();
});
it("서명 URL 실패는 android.url null로 200 유지", async () => {
  m.signed.mockResolvedValue({ data: null, error: { message: "boom" } });
  const j = await (await GET()).json();
  expect(j.android.url).toBeNull();
  expect(j.android.version).toBe("1.1.0");
});
it("guest·비로그인은 requireUser 응답 그대로", async () => { m.ok = false; expect((await GET()).status).toBe(403); });
```

- [ ] **Step 6: 실패 확인**

Run: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npx vitest run src/lib/__tests__/mobile-release-api.test.ts 2>&1 | tail -5`
Expected: FAIL — `Failed to resolve import "@/app/api/mobile/release/route"`.

- [ ] **Step 7: 라우트 구현**

```ts
// frontend/src/app/api/mobile/release/route.ts
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/rfp/require-user";
import { APK_URL_TTL_SECONDS, MOBILE_BUCKET, MOBILE_RELEASE_KEY, parseMobileRelease, releaseResponse } from "@/lib/mobile/release";

export const runtime = "nodejs";

/**
 * GET /api/mobile/release — 최신 앱 버전(플랫폼별)과 설치 링크. 웹 /apps와 앱 시작 시 업데이트 확인이 쓴다.
 * user 이상(쿠키·Bearer). APK는 비공개 버킷 `mobile`의 600초 서명 URL, iOS는 TestFlight 공개 링크. 서명 실패는 url null로 내리고 200 유지.
 */
export async function GET() {
  const r = await requireUser();
  if (!r.ok) return r.response;
  const { data } = await r.admin.from("settings").select("value").eq("key", MOBILE_RELEASE_KEY).maybeSingle();
  const rel = parseMobileRelease((data as { value?: string } | null)?.value);
  let apkUrl: string | null = null;
  if (rel.android) {
    const name = `innogrid-${rel.android.version}+${rel.android.build}.apk`;
    const signed = await r.admin.storage.from(MOBILE_BUCKET).createSignedUrl(rel.android.apkPath, APK_URL_TTL_SECONDS, { download: name });
    apkUrl = signed.data?.signedUrl ?? null;
  }
  return NextResponse.json(releaseResponse(rel, apkUrl), { headers: { "Cache-Control": "no-store" } });
}
```

- [ ] **Step 8: 통과 확인 + 타입 검사**

Run: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npx vitest run src/lib/__tests__/mobile-release 2>&1 | tail -4 && npx tsc --noEmit 2>&1 | tail -3`
Expected: `Tests  12 passed`, tsc 출력 없음.

- [ ] **Step 9: 버킷 SQL 작성·적용**

```sql
-- docs/sql/2026-10-04-mobile-release.sql
-- 모바일 앱 사내 배포(2026-10-04): APK 저장 버킷. 비공개, 200MB. 쓰기는 릴리스 스크립트(service role)만, 읽기는 서버가 만든 600초 서명 URL만.
-- 릴리스 메타데이터는 settings 키 mobile_release(문자열 JSON: notes·testflightUrl·android{version,build,apkPath,releasedAt}·ios{version,build,releasedAt}).
-- 적용: Supabase MCP 또는 Management API(메모리 supabase-sql-via-management-api).
insert into storage.buckets (id, name, public, file_size_limit)
values ('mobile', 'mobile', false, 209715200)
on conflict (id) do update set public = false, file_size_limit = 209715200;
```

적용(토큰은 출력하지 않는다):

```bash
cd /Users/seunguk.kang/Repos/inje-playground && TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d) && printf '{"query":%s}' "$(jq -Rs . < docs/sql/2026-10-04-mobile-release.sql)" > /private/tmp/claude-501/-Users-seunguk-kang-Repos-inje-playground/bb6d601b-c764-46a3-9d46-f193bc34c6f6/scratchpad/q.json && curl -s -X POST "https://api.supabase.com/v1/projects/avooqcxehfeurjhqqgui/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @/private/tmp/claude-501/-Users-seunguk-kang-Repos-inje-playground/bb6d601b-c764-46a3-9d46-f193bc34c6f6/scratchpad/q.json; echo; printf '{"query":"select id, public, file_size_limit from storage.buckets where id = %s"}' "'mobile'" > /private/tmp/claude-501/-Users-seunguk-kang-Repos-inje-playground/bb6d601b-c764-46a3-9d46-f193bc34c6f6/scratchpad/q.json && curl -s -X POST "https://api.supabase.com/v1/projects/avooqcxehfeurjhqqgui/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @/private/tmp/claude-501/-Users-seunguk-kang-Repos-inje-playground/bb6d601b-c764-46a3-9d46-f193bc34c6f6/scratchpad/q.json; rm -f /private/tmp/claude-501/-Users-seunguk-kang-Repos-inje-playground/bb6d601b-c764-46a3-9d46-f193bc34c6f6/scratchpad/q.json
```
Expected: 첫 호출 `[]`, 둘째 `[{"id":"mobile","public":false,"file_size_limit":209715200}]`.

- [ ] **Step 10: 커밋**

```bash
cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/lib/mobile/release.ts frontend/src/app/api/mobile/release/route.ts frontend/src/lib/__tests__/mobile-release.test.ts frontend/src/lib/__tests__/mobile-release-api.test.ts docs/sql/2026-10-04-mobile-release.sql && git commit -q -m "feat(mobile): GET /api/mobile/release — settings.mobile_release(플랫폼별) + APK 600초 서명 URL·TestFlight 링크, 버킷 mobile(비공개 200MB)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: 웹 `/apps` "모바일 앱" 페이지 + 카탈로그 등록

**Files:**
- Modify: `frontend/src/lib/page-access.ts:13`(survey 다음 줄에 추가), `frontend/src/components/layout/Navigation.tsx:7,22`, `frontend/src/app/page.tsx:5`(import)와 FEATURES의 `/survey` 카드 다음
- Create: `frontend/src/app/apps/page.tsx`
- Test: `frontend/src/lib/__tests__/apps-page.test.tsx`, `frontend/src/lib/__tests__/page-access.test.ts:34`(경계 목록에 `"apps"` 추가)

**Interfaces:**
- Consumes: `GET /api/mobile/release` 응답(Task 2 `ReleaseResponse`).
- Produces: 페이지 키 `apps`(href `/apps`, group `daily`, minRole `user`), `export function AppsPageView({ navigate }: { navigate?: (url: string) => void })`, `export default function AppsPage()`.

- [ ] **Step 1: 페이지 테스트 작성**

```tsx
// frontend/src/lib/__tests__/apps-page.test.tsx
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppsPageView } from "@/app/apps/page";

afterEach(() => vi.unstubAllGlobals());
const ios = { version: "1.1.0", build: 3, releasedAt: "2026-10-04T06:30:00Z", url: "https://testflight.apple.com/join/abc" };

it("두 플랫폼의 버전·링크를 보여 주고, APK 받기는 누를 때 새 서명 URL을 받아 이동한다", async () => {
  const urls = ["https://signed/1", "https://signed/2"];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ notes: "게시판 읽기", ios, android: { version: "1.1.0", build: 3, releasedAt: null, url: urls.shift() } }) })));
  const navigate = vi.fn();
  render(<AppsPageView navigate={navigate} />);
  expect(await screen.findByRole("link", { name: /TestFlight에서 열기 · v1.1.0 \(3\)/ })).toHaveAttribute("href", "https://testflight.apple.com/join/abc");
  expect(screen.getByText("게시판 읽기")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /APK 받기 · v1.1.0 \(3\)/ }));
  await waitFor(() => expect(navigate).toHaveBeenCalledWith("https://signed/2"));
});
it("릴리스가 없으면 버튼은 '준비 중'으로 비활성", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ notes: "", ios: null, android: null }) })));
  render(<AppsPageView navigate={vi.fn()} />);
  expect(await screen.findByRole("button", { name: "TestFlight 준비 중" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "APK 준비 중" })).toBeDisabled();
});
it("권한 오류(403)는 서버 문구와 다시 시도 버튼", async () => {
  const fetchMock = vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ error: "사용자 권한이 필요합니다." }) }));
  vi.stubGlobal("fetch", fetchMock);
  render(<AppsPageView navigate={vi.fn()} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("사용자 권한이 필요합니다.");
  fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
});
```

`frontend/src/lib/__tests__/page-access.test.ts` 34행의 `it.each(["food", "ladder", "team", "survey", "guide", "rfp", "people-news"])`를 `it.each(["food", "ladder", "team", "survey", "apps", "guide", "rfp", "people-news"])`로 바꾼다.

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npx vitest run src/lib/__tests__/apps-page.test.tsx src/lib/__tests__/page-access.test.ts 2>&1 | tail -6`
Expected: apps-page FAIL(`Failed to resolve import "@/app/apps/page"`), page-access의 `apps` 케이스 FAIL(`expected [] to have a length of 1`).

- [ ] **Step 3: 카탈로그·내비게이션·홈 카드**

`frontend/src/lib/page-access.ts` — survey 줄 다음에:
```ts
  { key: "apps", href: "/apps", label: "모바일 앱", group: "daily", minRole: "user" },
```

`frontend/src/components/layout/Navigation.tsx` — 7행 lucide import에 `Smartphone` 추가, 22행 `PAGE_ICONS`에 `apps: Smartphone` 추가(예: `survey: ClipboardList, apps: Smartphone,`).

`frontend/src/app/page.tsx` — 5행 lucide import에 `Smartphone` 추가, FEATURES 배열에서 `href: "/survey"` 카드 객체 바로 다음에:
```ts
  {
    href: "/apps",
    title: "모바일 앱",
    description: "이노그리드 앱을 휴대폰에 설치하세요. iPhone은 TestFlight, Android는 APK로 받습니다.",
    icon: Smartphone,
    gradient: "from-slate-600 to-slate-800",
    bgAccent: "bg-slate-50",
    iconColor: "text-slate-700",
    delay: "delay-100",
  },
```

- [ ] **Step 4: 페이지 구현**

```tsx
// frontend/src/app/apps/page.tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { Apple, Download, Loader2, Smartphone } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type Platform = { version: string; build: number; releasedAt: string | null; url: string | null } | null;
type Release = { notes: string; ios: Platform; android: Platform };

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric", timeZone: "Asia/Seoul" }) : "");
const label = (p: Platform) => (p ? `v${p.version} (${p.build})` : "준비 중");
async function fetchRelease(): Promise<Release> {
  const res = await fetch("/api/mobile/release");
  const j = (await res.json().catch(() => ({}))) as Release & { error?: string };
  if (!res.ok) throw new Error(j.error ?? "버전 정보를 불러오지 못했습니다.");
  return j;
}

/**
 * 모바일 앱 설치 안내(사내 전용, 스토어 미게시). iPhone은 TestFlight 공개 링크, Android는 로그인한 사람만 받는 APK(600초 서명 URL이라 누를 때 새로 받는다).
 * 새 버전은 iOS는 TestFlight가, Android는 앱 안 배너가 알려 준다. 런북 docs/mobile-app.md §배포.
 */
export function AppsPageView({ navigate = (url: string) => window.location.assign(url) }: { navigate?: (url: string) => void }) {
  const [rel, setRel] = useState<Release | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setRel(await fetchRelease()); } catch (e) { setError(e instanceof Error ? e.message : "버전 정보를 불러오지 못했습니다."); } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const downloadApk = async () => {
    setBusy(true);
    setError(null);
    try {
      const fresh = await fetchRelease();
      if (!fresh.android?.url) throw new Error("APK 링크를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.");
      navigate(fresh.android.url);
    } catch (e) { setError(e instanceof Error ? e.message : "APK 링크를 만들지 못했습니다."); } finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold">모바일 앱</h1>
        <p className="text-sm text-muted-foreground">이노그리드 앱을 휴대폰에 설치하세요. 사내 구성원 전용이며 스토어에는 올라가지 않습니다.</p>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error} <Button variant="link" size="sm" onClick={load}>다시 시도</Button>
        </p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Apple className="h-5 w-5" /> iPhone</CardTitle>
            <CardDescription>TestFlight로 설치합니다. 새 버전은 자동으로 받습니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>App Store에서 <b>TestFlight</b> 앱을 설치합니다.</li>
              <li>아래 버튼을 누르고 TestFlight에서 <b>설치</b>를 누릅니다.</li>
            </ol>
            {rel?.ios?.url ? (
              <Button asChild><a href={rel.ios.url} target="_blank" rel="noreferrer">TestFlight에서 열기 · {label(rel.ios)}</a></Button>
            ) : (
              <Button disabled>TestFlight 준비 중</Button>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> Android</CardTitle>
            <CardDescription>APK를 직접 설치합니다. 새 버전은 앱이 알려 줍니다.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>아래 버튼으로 APK를 받습니다(로그인한 사람만 받을 수 있습니다).</li>
              <li>알림에서 받은 파일을 열고, 묻는 경우 <b>이 출처(Chrome)의 앱 설치 허용</b>을 켭니다.</li>
              <li><b>설치</b>를 누릅니다. 이미 설치돼 있으면 업데이트로 덮어씁니다.</li>
            </ol>
            <Button onClick={downloadApk} disabled={!rel?.android || busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {rel?.android ? `APK 받기 · ${label(rel.android)}` : "APK 준비 중"}
            </Button>
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">현재 버전</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {loading && !rel ? (
            <p role="status" className="text-muted-foreground">불러오는 중…</p>
          ) : (
            <>
              <p>iPhone {label(rel?.ios ?? null)}{rel?.ios?.releasedAt ? ` · ${fmtDate(rel.ios.releasedAt)}` : ""}</p>
              <p>Android {label(rel?.android ?? null)}{rel?.android?.releasedAt ? ` · ${fmtDate(rel.android.releasedAt)}` : ""}</p>
              {rel?.notes && <p className="whitespace-pre-line text-muted-foreground">{rel.notes}</p>}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AppsPage() {
  return <AppsPageView />;
}
```

- [ ] **Step 5: 통과 확인 + 전체 프론트 테스트 + 타입**

Run: `cd /Users/seunguk.kang/Repos/inje-playground/frontend && npx vitest run src/lib/__tests__/apps-page.test.tsx src/lib/__tests__/page-access.test.ts 2>&1 | tail -4 && npx tsc --noEmit 2>&1 | tail -3 && npm test 2>&1 | tail -4`
Expected: 두 파일 통과, tsc 무출력, 전체 `Test Files … passed`(실패 0).

- [ ] **Step 6: 커밋**

```bash
cd /Users/seunguk.kang/Repos/inje-playground && git add frontend/src/lib/page-access.ts frontend/src/components/layout/Navigation.tsx frontend/src/app/page.tsx frontend/src/app/apps/page.tsx frontend/src/lib/__tests__/apps-page.test.tsx frontend/src/lib/__tests__/page-access.test.ts && git commit -q -m "feat(web): /apps 모바일 앱 설치 페이지 — TestFlight 링크·APK 받기(누를 때 새 서명 URL)·현재 버전, 카탈로그 apps(일상·user)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: 앱 안 업데이트 확인 — 홈 배너·더보기 업데이트 버튼

**Files:**
- Create: `mobile/lib/release/release_provider.dart`, `mobile/lib/release/update_banner.dart`
- Modify: `mobile/lib/features/home/home_screen.dart:29`(로고 `SizedBox(height: 14)` 다음), `mobile/lib/more/more_screen.dart:7,89`
- Test: `mobile/test/release/update_banner_test.dart`

**Interfaces:**
- Consumes: Task 1 `ReleaseInfo`·`parseRelease`·`hasUpdate`·`versionLabel`·`Config.appVersion`·`Config.appBuild`; `apiClientProvider.getJson(String)`(`lib/api/client.dart`).
- Produces: `releaseProvider: FutureProvider<ReleaseInfo?>`, `class UpdateBanner extends ConsumerWidget { const UpdateBanner({super.key, this.appBuild = Config.appBuild}); }`, `class VersionTrailing extends ConsumerWidget { const VersionTrailing({super.key, this.appVersion = Config.appVersion, this.appBuild = Config.appBuild}); }`, `Future<void> openRelease(ReleaseInfo r)`.

- [ ] **Step 1: 실패하는 위젯 테스트 작성**

```dart
// mobile/test/release/update_banner_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/release/release_check.dart';
import 'package:playground/release/release_provider.dart';
import 'package:playground/release/update_banner.dart';

/// 매번 새 ProviderScope(UniqueKey) — 같은 자리에서 다시 pump해도 이전 상태를 재사용하지 않게.
Widget scope(ReleaseInfo? r, Widget child) => ProviderScope(
      key: UniqueKey(),
      overrides: [releaseProvider.overrideWith((_) async => r)],
      child: MaterialApp(home: Scaffold(body: child)),
    );
const newer = ReleaseInfo(version: '1.1.0', build: 3, url: 'https://x/apk');

void main() {
  testWidgets('서버 빌드가 크면 배너와 업데이트 버튼', (tester) async {
    await tester.pumpWidget(scope(newer, const UpdateBanner(appBuild: 2)));
    await tester.pumpAndSettle();
    expect(find.text('새 버전 1.1.0이 있어요'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '업데이트'), findsOneWidget);
  });
  testWidgets('같거나 낮거나, 개발 빌드(0)거나, 서버 응답이 없으면 안 보인다', (tester) async {
    for (final (r, b) in [(newer, 3), (newer, 4), (newer, 0), (null, 2)]) {
      await tester.pumpWidget(scope(r, UpdateBanner(appBuild: b)));
      await tester.pumpAndSettle();
      expect(find.textContaining('새 버전'), findsNothing, reason: 'build $b');
    }
  });
  testWidgets('링크가 없으면 웹 /apps 안내, 버튼 없음', (tester) async {
    await tester.pumpWidget(scope(const ReleaseInfo(version: '1.1.0', build: 3), const UpdateBanner(appBuild: 2)));
    await tester.pumpAndSettle();
    expect(find.textContaining('웹 /apps에서 받으세요'), findsOneWidget);
    expect(find.byType(TextButton), findsNothing);
  });
  testWidgets('더보기 버전 줄 — 1.0.0 (2) + 업데이트 버튼, 개발 빌드는 dev만', (tester) async {
    await tester.pumpWidget(scope(newer, const VersionTrailing(appVersion: '1.0.0', appBuild: 2)));
    await tester.pumpAndSettle();
    expect(find.text('1.0.0 (2)'), findsOneWidget);
    expect(find.widgetWithText(TextButton, '업데이트'), findsOneWidget);
    await tester.pumpWidget(scope(newer, const VersionTrailing(appVersion: 'dev', appBuild: 0)));
    await tester.pumpAndSettle();
    expect(find.text('dev'), findsOneWidget);
    expect(find.byType(TextButton), findsNothing);
  });
}
```

- [ ] **Step 2: 실패 확인**

Run: `cd /Users/seunguk.kang/Repos/inje-playground/mobile && flutter test test/release/update_banner_test.dart 2>&1 | tail -5`
Expected: 컴파일 오류 — `release_provider.dart`·`update_banner.dart` 없음.

- [ ] **Step 3: 구현**

```dart
// mobile/lib/release/release_provider.dart
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import 'release_check.dart';

/// 서버의 최신 릴리스(자기 플랫폼). 앱 프로세스당 1회. 실패는 null — 업데이트 안내는 부가 기능이라 오류 UI·로그 없음(토큰·URL을 찍지 않는다).
final releaseProvider = FutureProvider<ReleaseInfo?>((ref) async {
  try {
    final json = await ref.read(apiClientProvider).getJson('/api/mobile/release');
    return parseRelease(json, android: defaultTargetPlatform == TargetPlatform.android);
  } catch (_) {
    return null;
  }
});
```

```dart
// mobile/lib/release/update_banner.dart
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';
import '../app/theme.dart';
import '../config.dart';
import 'release_check.dart';
import 'release_provider.dart';

/// Android: 서명 URL을 브라우저로 열어 내려받고 알림에서 설치. iOS: TestFlight 링크. 앱이 직접 설치하지는 않는다.
Future<void> openRelease(ReleaseInfo r) async {
  final u = r.url;
  if (u == null) return;
  await launchUrl(Uri.parse(u), mode: LaunchMode.externalApplication);
}

/// 홈 맨 위 "새 버전" 한 줄 카드. 서버 빌드가 앱 빌드보다 클 때만 보인다(개발 빌드 0은 안 보임).
class UpdateBanner extends ConsumerWidget {
  const UpdateBanner({super.key, this.appBuild = Config.appBuild});
  final int appBuild;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final r = ref.watch(releaseProvider).value;
    if (!hasUpdate(r, appBuild)) return const SizedBox.shrink();
    final hasLink = r!.url != null;
    return Container(
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.fromLTRB(14, 10, 8, 10),
      decoration: BoxDecoration(color: Brand.blueTint, borderRadius: BorderRadius.circular(14)),
      child: Row(children: [
        const Icon(Icons.system_update_alt, size: 18, color: Brand.blue),
        const SizedBox(width: 10),
        Expanded(
          child: Text(
            hasLink ? '새 버전 ${r.version}이 있어요' : '새 버전 ${r.version}이 있어요 · 웹 /apps에서 받으세요',
            style: const TextStyle(fontSize: 13, fontWeight: FontWeight.w600, color: Brand.navy),
          ),
        ),
        if (hasLink) TextButton(onPressed: () => openRelease(r), child: const Text('업데이트')),
      ]),
    );
  }
}

/// 더보기 "앱 버전" 줄의 trailing — 버전 글자, 새 버전이 있으면 업데이트 버튼(사용자 요청).
class VersionTrailing extends ConsumerWidget {
  const VersionTrailing({super.key, this.appVersion = Config.appVersion, this.appBuild = Config.appBuild});
  final String appVersion;
  final int appBuild;
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final r = ref.watch(releaseProvider).value;
    final style = Theme.of(context).textTheme.bodySmall;
    final current = versionLabel(appVersion, appBuild);
    if (!hasUpdate(r, appBuild)) return Text(current, style: style);
    if (r!.url == null) return Text('$current · 새 버전 ${r.version}은 웹 /apps에서', style: style);
    return Row(mainAxisSize: MainAxisSize.min, children: [
      Text(current, style: style),
      const SizedBox(width: 4),
      TextButton(onPressed: () => openRelease(r), child: const Text('업데이트')),
    ]);
  }
}
```

`mobile/lib/features/home/home_screen.dart` — import `'../../release/update_banner.dart';` 추가, `const SizedBox(height: 14),`(로고 바로 다음, 인사말 앞) 뒤에 `const UpdateBanner(),` 한 줄 추가.

`mobile/lib/more/more_screen.dart` — `import '../config.dart';`를 `import '../release/update_banner.dart';`로 바꾸고(Config는 더 이상 안 씀), 89행 `ListTile(leading: const Icon(Icons.info_outline), title: const Text('앱 버전'), trailing: Text(Config.appVersion, style: theme.textTheme.bodySmall)),`을
```dart
                const ListTile(leading: Icon(Icons.info_outline), title: Text('앱 버전'), trailing: VersionTrailing()),
```
으로 교체.

- [ ] **Step 4: 통과 확인 + 전체**

Run: `cd /Users/seunguk.kang/Repos/inje-playground/mobile && flutter test test/release/update_banner_test.dart 2>&1 | tail -3 && flutter test 2>&1 | tail -2 && flutter analyze 2>&1 | tail -2`
Expected: `+4: All tests passed!`, 전체 `+146`, `No issues found!`(`theme` 변수가 더보기에서 아직 쓰이면 그대로 두고, 안 쓰이면 analyze가 unused를 알려 준다 → 그때 지운다).

- [ ] **Step 5: 커밋**

```bash
cd /Users/seunguk.kang/Repos/inje-playground && git add mobile/lib/release mobile/lib/features/home/home_screen.dart mobile/lib/more/more_screen.dart mobile/test/release/update_banner_test.dart && git commit -q -m "feat(mobile): 시작 시 버전 확인 — 홈 '새 버전' 배너 + 더보기 앱 버전 줄 업데이트 버튼(Android APK 브라우저 다운로드·iOS TestFlight)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Android 릴리스 서명 · iOS plist · CI 아이콘

**Files:**
- Create: `mobile/android/upload-keystore.jks`(gitignore), `mobile/android/key.properties`(gitignore), `mobile/assets/brand/app_icon.png`, `mobile/assets/brand/app_icon_fg.png`, 생성물 `mobile/android/app/src/main/res/mipmap-*/ic_launcher*.png`·`mipmap-anydpi-v26/ic_launcher.xml`·`values/colors.xml`(flutter_launcher_icons), `mobile/ios/Runner/Assets.xcassets/AppIcon.appiconset/*`
- Modify: `mobile/android/app/build.gradle.kts`, `mobile/ios/Runner/Info.plist:34`, `mobile/pubspec.yaml`
- Test: 자동 테스트 없음(설정·바이너리). 검증은 서명 인증서 출력·아이콘 파일 속성.

**Interfaces:**
- Consumes: 없음
- Produces: `flutter build apk --release`가 업로드 키로 서명됨, `flutter build ipa` 수출 규정 질문 없음, 앱 아이콘(CI 색 `#006cdb` + 흰 CONNECTION 모티프).

- [ ] **Step 1: 키스토어 생성(비밀번호는 출력하지 않는다)**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/mobile/android && PW=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24) && keytool -genkeypair -keystore upload-keystore.jks -storetype JKS -keyalg RSA -keysize 2048 -validity 10000 -alias upload -storepass "$PW" -keypass "$PW" -dname "CN=Innogrid Playground, O=Innogrid, C=KR" 2>&1 | grep -v -i password && printf 'storePassword=%s\nkeyPassword=%s\nkeyAlias=upload\nstoreFile=../upload-keystore.jks\n' "$PW" "$PW" > key.properties && unset PW && git -C .. check-ignore -v android/key.properties android/upload-keystore.jks && git -C .. status --short | head -3
```
Expected: `check-ignore`가 두 파일 모두 `.gitignore` 규칙(`key.properties`, `**/*.jks`)으로 잡고, `git status`에 둘 다 없음. (JKS 경고 "PKCS12 권장"은 무시.)

- [ ] **Step 2: build.gradle.kts 서명 설정**

`mobile/android/app/build.gradle.kts` 전체를 다음으로 교체:

```kotlin
import java.io.FileInputStream
import java.util.Properties

plugins {
    id("com.android.application")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// 릴리스 서명: android/key.properties(gitignore)가 있으면 업로드 키스토어, 없으면 디버그 키(다른 개발자의 빌드가 깨지지 않게). 런북 docs/mobile-app.md §배포
val keystorePropertiesFile = rootProject.file("key.properties")
val hasReleaseKey = keystorePropertiesFile.exists()
val keystoreProperties = Properties().apply { if (hasReleaseKey) load(FileInputStream(keystorePropertiesFile)) }

android {
    namespace = "com.innogrid.playground"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    defaultConfig {
        applicationId = "com.innogrid.playground"
        minSdk = 26
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                keyAlias = keystoreProperties["keyAlias"] as String
                keyPassword = keystoreProperties["keyPassword"] as String
                storeFile = file(keystoreProperties["storeFile"] as String)
                storePassword = keystoreProperties["storePassword"] as String
            }
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName(if (hasReleaseKey) "release" else "debug")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

flutter {
    source = "../.."
}
```

- [ ] **Step 3: Info.plist 수출 규정 면제**

`mobile/ios/Runner/Info.plist`의
```xml
	<key>CFBundleVersion</key>
	<string>$(FLUTTER_BUILD_NUMBER)</string>
```
바로 다음에
```xml
	<key>ITSAppUsesNonExemptEncryption</key>
	<false/>
```
를 추가(HTTPS만 쓰므로 면제 — 업로드마다 뜨는 질문 제거).

- [ ] **Step 4: 아이콘 원본 생성(일회용 골든 테스트)**

`mobile/test/_icon_gen_test.dart`(커밋하지 않음):
```dart
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

/// CI 가이드 그래픽_면형 CONNECTION(점 8개 링). 1024 기준 점 중심 반지름 224, 점 반지름 56 → 모티프 지름 560(적응형 안전 영역 676 안).
class _Connection extends CustomPainter {
  const _Connection();
  @override
  void paint(Canvas c, Size s) {
    final p = Paint()..color = Colors.white;
    final o = s.center(Offset.zero);
    for (var i = 0; i < 8; i++) {
      final a = i * math.pi / 4;
      c.drawCircle(o + Offset(math.cos(a), math.sin(a)) * 224, 56, p);
    }
  }
  @override
  bool shouldRepaint(covariant CustomPainter old) => false;
}

Future<void> gen(WidgetTester tester, Color bg, String out) async {
  tester.view.physicalSize = const Size(1024, 1024);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(RepaintBoundary(key: const Key('icon'), child: Container(color: bg, child: const CustomPaint(size: Size(1024, 1024), painter: _Connection()))));
  await expectLater(find.byKey(const Key('icon')), matchesGoldenFile(out));
}

void main() {
  testWidgets('app_icon', (t) => gen(t, const Color(0xFF006CDB), '../assets/brand/app_icon.png'));
  testWidgets('app_icon_fg', (t) => gen(t, Colors.transparent, '../assets/brand/app_icon_fg.png'));
}
```

```bash
cd /Users/seunguk.kang/Repos/inje-playground/mobile && flutter test --update-goldens test/_icon_gen_test.dart 2>&1 | tail -2 && rm test/_icon_gen_test.dart && file assets/brand/app_icon.png assets/brand/app_icon_fg.png
```
Expected: `All tests passed!`, 두 파일 모두 `PNG image data, 1024 x 1024, 8-bit/color RGBA`. (Read 도구로 `app_icon.png`를 열어 파란 바탕에 흰 점 8개 링이 중앙에 있는지 눈으로 확인한다.)

- [ ] **Step 5: flutter_launcher_icons 설정·실행**

`mobile/pubspec.yaml` — `dev_dependencies:`에 `flutter_launcher_icons: ^0.14.4` 추가, 파일 끝에:
```yaml

# 앱 아이콘 — 이노그리드 CI 가이드(Background Color #006cdb + 흰 CONNECTION 모티프). 원본은 assets/brand/app_icon*.png(런북 §배포에 재생성 방법). 바뀌면 `dart run flutter_launcher_icons`.
flutter_launcher_icons:
  image_path: assets/brand/app_icon.png
  android: true
  ios: true
  remove_alpha_ios: true
  adaptive_icon_background: "#006cdb"
  adaptive_icon_foreground: assets/brand/app_icon_fg.png
```

```bash
cd /Users/seunguk.kang/Repos/inje-playground/mobile && flutter pub get 2>&1 | tail -1 && dart run flutter_launcher_icons 2>&1 | tail -4 && ls android/app/src/main/res/mipmap-anydpi-v26/ && sips -g pixelWidth -g hasAlpha ios/Runner/Assets.xcassets/AppIcon.appiconset/Icon-App-1024x1024@1x.png | tail -2 && git status --short | head -30
```
Expected: `✓ Successfully generated launcher icons`, `ic_launcher.xml` 존재, iOS 1024 아이콘 `hasAlpha: no`, 변경 파일은 mipmap·AppIcon.appiconset·colors.xml·pubspec·pubspec.lock뿐.

- [ ] **Step 6: 릴리스 빌드 서명 검증 + 전체 테스트**

```bash
cd /Users/seunguk.kang/Repos/inje-playground/mobile && flutter build apk --release --dart-define=APP_VERSION=1.0.0 --dart-define=APP_BUILD=1 2>&1 | tail -2 && keytool -printcert -jarfile build/app/outputs/flutter-apk/app-release.apk | grep -E "^Owner|Valid" && flutter test 2>&1 | tail -1 && flutter analyze 2>&1 | tail -1
```
Expected: `✓ Built build/app/outputs/flutter-apk/app-release.apk`, `Owner: CN=Innogrid Playground, O=Innogrid, C=KR`, 테스트 전체 통과, `No issues found!`.

- [ ] **Step 7: 커밋(키스토어·key.properties가 안 들어가는지 확인)**

```bash
cd /Users/seunguk.kang/Repos/inje-playground && git status --short | grep -E "jks|key.properties" ; git add mobile/android/app/build.gradle.kts mobile/ios/Runner/Info.plist mobile/pubspec.yaml mobile/pubspec.lock mobile/assets/brand/app_icon.png mobile/assets/brand/app_icon_fg.png mobile/android/app/src/main/res mobile/ios/Runner/Assets.xcassets && git commit -q -m "feat(mobile): 릴리스 서명(key.properties 업로드 키스토어, 없으면 디버그 키) · ITSAppUsesNonExemptEncryption=false · CI 가이드 앱 아이콘(#006cdb + CONNECTION 모티프, flutter_launcher_icons)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```
Expected: 첫 grep 출력 없음(둘 다 무시됨).

---

### Task 6: 릴리스 스크립트 `release-mobile.sh`

**Files:**
- Create: `mobile/scripts/release-mobile.sh`(실행 권한)
- Modify: `mobile/.gitignore`(끝에 `/.env.release` 추가)
- Test: `--dry-run` 수동 확인(자동 테스트 없음)

**Interfaces:**
- Consumes: `frontend/.env.local`의 `NEXT_PUBLIC_SUPABASE_URL`·`SUPABASE_SERVICE_ROLE_KEY`; `mobile/.env.release`의 `ASC_KEY_ID`·`ASC_ISSUER_ID`; Task 2의 설정 JSON 형식과 버킷 `mobile`, 경로 `android/innogrid-<version>+<build>.apk`.
- Produces: `release-mobile.sh (android|ios|all) [--notes "…"] [--testflight-url URL] [--dry-run] [--allow-dirty]`.

- [ ] **Step 1: 스크립트 작성**

```bash
#!/usr/bin/env bash
# 모바일 앱 릴리스(운영자 Mac). 사용법:
#   mobile/scripts/release-mobile.sh (android|ios|all) [--notes "…"] [--testflight-url URL] [--dry-run] [--allow-dirty]
# 1) 작업 트리 확인 2) flutter test·analyze 3) pubspec version → APP_VERSION/APP_BUILD
# 4) android: APK 빌드 → Supabase 스토리지 mobile/android/innogrid-<v>+<b>.apk 업로드 → settings.mobile_release.android 갱신
# 5) ios: IPA 빌드 → App Store Connect 업로드(xcrun altool, API 키) → settings.mobile_release.ios 갱신 6) 다음 할 일 출력
# 환경: frontend/.env.local(NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY), mobile/.env.release(ASC_KEY_ID·ASC_ISSUER_ID — iOS만, .p8은 ~/.private_keys/AuthKey_<ID>.p8)
# 비밀 값은 절대 출력하지 않는다. 버전 올리기는 pubspec.yaml을 손으로 고친다. 런북 docs/mobile-app.md §배포
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
MOBILE="$ROOT/mobile"
TARGET=${1:-}; [ $# -gt 0 ] && shift
NOTES=""; TF_URL=""; DRY=0; ALLOW_DIRTY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --notes) NOTES=$2; shift 2;;
    --testflight-url) TF_URL=$2; shift 2;;
    --dry-run) DRY=1; shift;;
    --allow-dirty) ALLOW_DIRTY=1; shift;;
    *) echo "알 수 없는 옵션: $1" >&2; exit 2;;
  esac
done
case "$TARGET" in android|ios|all) ;; *) echo "사용법: $0 (android|ios|all) [--notes \"…\"] [--testflight-url URL] [--dry-run] [--allow-dirty]" >&2; exit 2;; esac
DO_ANDROID=0; DO_IOS=0; [ "$TARGET" != ios ] && DO_ANDROID=1; [ "$TARGET" != android ] && DO_IOS=1
say() { printf '\n▶ %s\n' "$*"; }

# 1. 작업 트리
if [ "$ALLOW_DIRTY" = 0 ] && [ -n "$(git -C "$ROOT" status --porcelain)" ]; then
  echo "작업 트리가 깨끗하지 않습니다. 커밋하거나 --allow-dirty를 쓰세요." >&2; exit 1
fi

# 2. 환경(값은 출력하지 않음)
envval() { grep -E "^$2=" "$1" 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }
SUPABASE_URL=$(envval "$ROOT/frontend/.env.local" NEXT_PUBLIC_SUPABASE_URL)
SERVICE_KEY=$(envval "$ROOT/frontend/.env.local" SUPABASE_SERVICE_ROLE_KEY)
[ -n "$SUPABASE_URL" ] && [ -n "$SERVICE_KEY" ] || { echo "frontend/.env.local에 NEXT_PUBLIC_SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY가 필요합니다." >&2; exit 1; }
ASC_KEY_ID=""; ASC_ISSUER_ID=""
if [ "$DO_IOS" = 1 ]; then
  ASC_KEY_ID=$(envval "$MOBILE/.env.release" ASC_KEY_ID); ASC_ISSUER_ID=$(envval "$MOBILE/.env.release" ASC_ISSUER_ID)
  [ -n "$ASC_KEY_ID" ] && [ -n "$ASC_ISSUER_ID" ] || { echo "mobile/.env.release에 ASC_KEY_ID=…, ASC_ISSUER_ID=… 가 필요합니다(App Store Connect → Users and Access → Integrations)." >&2; exit 1; }
  ls ~/.private_keys/AuthKey_"$ASC_KEY_ID".p8 ~/private_keys/AuthKey_"$ASC_KEY_ID".p8 >/dev/null 2>&1 || { echo "~/.private_keys/AuthKey_$ASC_KEY_ID.p8 가 없습니다." >&2; exit 1; }
fi

# 3. 버전
VERSION_LINE=$(grep -E '^version:' "$MOBILE/pubspec.yaml" | head -1 | awk '{print $2}')
VERSION=${VERSION_LINE%%+*}; BUILD=${VERSION_LINE##*+}
[[ "$BUILD" =~ ^[0-9]+$ ]] && [ "$BUILD" != "$VERSION_LINE" ] || { echo "pubspec version 형식은 X.Y.Z+N 이어야 합니다: $VERSION_LINE" >&2; exit 1; }
say "버전 $VERSION (빌드 $BUILD) · 대상 $TARGET$([ "$DRY" = 1 ] && echo ' · dry-run')"
DEFINES=(--dart-define=APP_VERSION="$VERSION" --dart-define=APP_BUILD="$BUILD")

# 4. 게이트
say "flutter test · analyze"
if [ "$DRY" = 1 ]; then echo "  (dry-run) flutter test && flutter analyze"; else
  (cd "$MOBILE" && flutter test >/dev/null && flutter analyze >/dev/null) || { echo "테스트/분석 실패 — 중단" >&2; exit 1; }
  echo "  통과"
fi

REST="$SUPABASE_URL/rest/v1"; STORAGE="$SUPABASE_URL/storage/v1"
AUTH=(-H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY")
read_release() { curl -sf "${AUTH[@]}" "$REST/settings?key=eq.mobile_release&select=value" | python3 -c 'import sys,json; r=json.load(sys.stdin); print(r[0]["value"] if r else "{}")'; }
# write_release <android|ios> [apkPath] — 자기 플랫폼 블록과 --notes/--testflight-url만 갈아 끼우고 나머지는 보존
write_release() {
  local cur="{}"; [ "$DRY" = 0 ] && cur=$(read_release)
  local merged
  merged=$(PLATFORM="$1" APK_PATH="${2:-}" VERSION="$VERSION" BUILD="$BUILD" NOTES="$NOTES" TF_URL="$TF_URL" python3 - "$cur" <<'PY'
import json, os, sys, datetime
try: cur = json.loads(sys.argv[1] or "{}")
except Exception: cur = {}
if not isinstance(cur, dict): cur = {}
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
p = os.environ["PLATFORM"]
block = {"version": os.environ["VERSION"], "build": int(os.environ["BUILD"]), "releasedAt": now}
if p == "android": block["apkPath"] = os.environ["APK_PATH"]
cur[p] = block
if os.environ["NOTES"]: cur["notes"] = os.environ["NOTES"]
if os.environ["TF_URL"]: cur["testflightUrl"] = os.environ["TF_URL"]
cur.setdefault("notes", ""); cur.setdefault("testflightUrl", None)
print(json.dumps(cur, ensure_ascii=False))
PY
)
  if [ "$DRY" = 1 ]; then echo "  (dry-run) settings.mobile_release ← $merged"; return; fi
  local body; body=$(python3 -c 'import json,sys; print(json.dumps({"key":"mobile_release","value":sys.argv[1]}))' "$merged")
  curl -sf -X POST "${AUTH[@]}" -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates,return=minimal" "$REST/settings?on_conflict=key" --data-binary "$body" >/dev/null
  echo "  settings.mobile_release ← $merged"
}

# 5. Android
if [ "$DO_ANDROID" = 1 ]; then
  APK_NAME="innogrid-$VERSION+$BUILD.apk"; APK_PATH="android/$APK_NAME"; APK_URL_PATH="android/${APK_NAME//+/%2B}"
  say "Android: 같은 빌드가 이미 올라가 있는지 확인"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) storage list mobile/android → $APK_NAME"; else
    n=$(curl -sf "${AUTH[@]}" -H "Content-Type: application/json" -X POST "$STORAGE/object/list/mobile" --data-binary "{\"prefix\":\"android\",\"search\":\"$APK_NAME\",\"limit\":10}" | python3 -c 'import sys,json; n=sys.argv[1]; print(sum(1 for o in json.load(sys.stdin) if o.get("name")==n))' "$APK_NAME")
    [ "$n" = 0 ] || { echo "$APK_PATH 가 이미 있습니다 — pubspec의 빌드 번호(+N)를 올리세요." >&2; exit 1; }
    echo "  없음"
  fi
  say "Android: flutter build apk --release"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) flutter build apk --release ${DEFINES[*]}"; else
    (cd "$MOBILE" && flutter build apk --release "${DEFINES[@]}" >/dev/null) || { echo "APK 빌드 실패" >&2; exit 1; }
    ls -la "$MOBILE/build/app/outputs/flutter-apk/app-release.apk" | awk '{print "  " $5 " bytes"}'
  fi
  say "Android: 스토리지 업로드 → mobile/$APK_PATH"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) POST $STORAGE/object/mobile/$APK_URL_PATH"; else
    curl -sf -X POST "${AUTH[@]}" -H "Content-Type: application/vnd.android.package-archive" -H "x-upsert: false" "$STORAGE/object/mobile/$APK_URL_PATH" --data-binary @"$MOBILE/build/app/outputs/flutter-apk/app-release.apk" >/dev/null || { echo "업로드 실패" >&2; exit 1; }
    echo "  완료"
  fi
  write_release android "$APK_PATH"
fi

# 6. iOS
if [ "$DO_IOS" = 1 ]; then
  say "iOS: flutter build ipa --release (App Store Connect 수출)"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) flutter build ipa --release ${DEFINES[*]}"; else
    (cd "$MOBILE" && flutter build ipa --release "${DEFINES[@]}" >/dev/null) || { echo "IPA 빌드 실패 — Xcode 서명(팀·인증서)을 확인하세요" >&2; exit 1; }
  fi
  IPA=$(ls "$MOBILE"/build/ios/ipa/*.ipa 2>/dev/null | head -1 || true)
  say "iOS: App Store Connect 업로드(altool)"
  if [ "$DRY" = 1 ]; then echo "  (dry-run) xcrun altool --upload-app --type ios --file <ipa> --apiKey $ASC_KEY_ID --apiIssuer <issuer>"; else
    [ -n "$IPA" ] || { echo "IPA가 없습니다(build/ios/ipa)." >&2; exit 1; }
    LOG=$(mktemp)
    xcrun altool --upload-app --type ios --file "$IPA" --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID" >"$LOG" 2>&1 || { tail -20 "$LOG" >&2; rm -f "$LOG"; echo "업로드 실패" >&2; exit 1; }
    grep -i -E "uploaded|succeeded|Delivery UUID" "$LOG" | head -3 || echo "  완료"
    rm -f "$LOG"
  fi
  write_release ios
fi

# 7. 다음 할 일
say "다음 할 일"
[ "$DO_ANDROID" = 1 ] && echo "  · Android: 웹 https://inje-playground.vercel.app/apps 에서 바로 받을 수 있습니다. 설치된 앱은 다음 실행 때 배너로 안내합니다."
[ "$DO_IOS" = 1 ] && echo "  · iOS: App Store Connect → TestFlight에서 처리 완료(≈10분)를 기다린 뒤 외부 그룹 '이노그리드 구성원'에 빌드를 추가하세요(첫 빌드는 Beta App Review)."
echo "  · 공지 예시: [이노그리드 앱 $VERSION] ${NOTES:-변경 내용} — 설치·업데이트: https://inje-playground.vercel.app/apps"
```

```bash
cd /Users/seunguk.kang/Repos/inje-playground && mkdir -p mobile/scripts && chmod +x mobile/scripts/release-mobile.sh && printf '\n# 릴리스 스크립트 비밀(App Store Connect API 키 ID·발급자 ID)\n/.env.release\n' >> mobile/.gitignore && bash -n mobile/scripts/release-mobile.sh && echo syntax-ok
```

- [ ] **Step 2: dry-run 확인**

Run: `cd /Users/seunguk.kang/Repos/inje-playground && mobile/scripts/release-mobile.sh android --dry-run --allow-dirty --notes "테스트"`
Expected: `▶ 버전 1.0.0 (빌드 1) · 대상 android · dry-run`, 각 단계 `(dry-run)` 줄, 마지막 `settings.mobile_release ← {"android": {...}, "notes": "테스트", "testflightUrl": null}`, `다음 할 일`. 비밀 값이 출력되지 않았는지 눈으로 확인. `mobile/scripts/release-mobile.sh ios --dry-run --allow-dirty`는 `.env.release`가 없으면 안내 문구와 exit 1.

- [ ] **Step 3: 커밋**

```bash
cd /Users/seunguk.kang/Repos/inje-playground && git add mobile/scripts/release-mobile.sh mobile/.gitignore && git commit -q -m "feat(mobile): 릴리스 스크립트 release-mobile.sh — 게이트(test·analyze) → pubspec 버전 dart-define → APK 스토리지 업로드·IPA altool 업로드 → settings.mobile_release 병합 갱신, --dry-run

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: 런북·규칙·메모리 + 프론트 배포

**Files:**
- Modify: `docs/mobile-app.md`(`## 개발기 설치` 앞에 `## 배포(사내)` 절 추가, 70행 iOS 문장 갱신, 문제 해결 표 3행), `.claude/rules/mobile.md:14,20`, 메모리 `mobile-app-status.md`
- 배포: `frontend/`에서 `vercel --prod`

- [ ] **Step 1: 런북 배포 절 작성** — `## 개발기 설치` 바로 앞에 삽입:

```markdown
## 배포(사내) (2026-10-04)
스펙 `docs/superpowers/specs/2026-10-04-mobile-release-design.md`. iOS는 **TestFlight 외부 그룹 공개 링크**(개인 Apple 계정, 팀 `LME2TNRC9G`), Android는 **웹 `/apps`에서 APK 직접 받기**(로그인 필요, 비공개 버킷 `mobile`의 600초 서명 URL). 릴리스 메타데이터는 `settings` 키 `mobile_release`(문자열 JSON: `notes`·`testflightUrl`·`android{version,build,apkPath,releasedAt}`·`ios{version,build,releasedAt}`) 하나, 읽는 API는 `GET /api/mobile/release`(user 이상). 앱은 시작 때 이 API로 자기 플랫폼 빌드 번호를 비교해 홈 배너·더보기 "앱 버전" 줄에 업데이트 버튼을 보여 준다(개발 빌드 `dev`/0은 확인 안 함). 쓰는 쪽은 `mobile/scripts/release-mobile.sh`뿐.

### 최초 1회 준비
1. **Android 키스토어**: `mobile/android/upload-keystore.jks` + `key.properties`(둘 다 gitignore). 2026-10-04 생성(별칭 `upload`, RSA 2048, 10000일). **두 파일을 1Password에 백업** — 잃으면 서명이 바뀌어 전 직원이 앱을 지우고 다시 설치해야 한다. 새 Mac에서는 두 파일을 같은 자리에 복원하면 된다(없으면 디버그 키로 빌드돼 기존 설치 위에 업데이트가 안 된다).
2. **App Store Connect**: 번들 ID `com.innogrid.playground` 등록 → 앱 "이노그리드" 생성 → TestFlight 테스트 정보(연락처, **심사용 로그인 계정** — 앱이 Microsoft 로그인만 받으므로 테넌트에 심사용 계정 1개를 IT에 요청하거나 심사 노트에 사내 전용임을 적는다) → 외부 테스터 그룹 "이노그리드 구성원" 생성 → **공개 링크 켜기** → 그 링크를 첫 iOS 릴리스 때 `--testflight-url`로 넘긴다.
3. **App Store Connect API 키**: Users and Access → Integrations → App Store Connect API에서 키(역할 App Manager) 발급, `.p8`을 `~/.private_keys/AuthKey_<KEY_ID>.p8`에 두고 `mobile/.env.release`(gitignore)에 `ASC_KEY_ID=…`, `ASC_ISSUER_ID=…`.
4. Supabase 버킷 `mobile`은 `docs/sql/2026-10-04-mobile-release.sql`로 만들었다(2026-10-04 적용).

### 매 릴리스
1. `mobile/pubspec.yaml`의 `version: X.Y.Z+N`을 올린다(빌드 번호 `+N`은 항상 증가 — 앱은 이 숫자로 새 버전을 판단한다). 커밋.
2. `mobile/scripts/release-mobile.sh all --notes "변경 요약"` (처음 iOS는 `--testflight-url <공개 링크>` 추가). `android`/`ios`만도 된다. `--dry-run`으로 단계만 볼 수 있다. 스크립트가 `flutter test`·`analyze`를 먼저 돌리고, 같은 빌드 번호의 APK가 이미 있으면 멈춘다.
3. iOS: App Store Connect → TestFlight에서 빌드 처리(≈10분) 후 외부 그룹에 추가(첫 빌드는 Beta App Review, 보통 하루 안팎). 이후 빌드는 그룹에 추가만 하면 된다.
4. Teams 공지: 스크립트가 마지막에 문구 예시를 출력한다. 설치·업데이트 안내는 항상 `https://inje-playground.vercel.app/apps`.

### 운영 주의
- TestFlight 빌드는 **90일 만료** — 분기마다 한 번은 빌드 번호를 올려 다시 올린다(만료되면 앱이 열리지 않는다).
- Android는 자동 업데이트가 없다. 앱 배너의 "업데이트"가 브라우저로 APK를 받고 알림에서 설치한다. 회사 MDM이 사이드로딩을 막으면 Google Play 비공개 트랙으로 가야 한다(비범위).
- 아이콘은 이노그리드 CI 가이드(`https://www.innogrid.com/download/ci/Innogrid_CI_Guide.pdf`, 전용색 Background `#006cdb`, 그래픽 모티프 CONNECTION)로 만들었다. 원본 `assets/brand/app_icon.png`·`app_icon_fg.png`(1024, Flutter 골든 렌더 — 스펙 §2·계획 Task 5의 `_icon_gen_test.dart` 참고). 바뀌면 `dart run flutter_launcher_icons`.
- `altool`은 Xcode `ContentDelivery.framework`에 있다(`xcrun altool --version`). 없으면 Transporter 앱(`/Applications/Transporter.app`)으로 IPA를 수동 업로드하고 `settings.mobile_release.ios`는 스크립트 `ios --dry-run` 출력을 참고해 손으로 갱신한다.
```

70행 `3. Personal Team 서명은 7일마다 만료 — 재실행하면 갱신. 배포 방식이 정해지면 Apple Developer 계정 + TestFlight로 전환.`을 `3. Personal Team 서명은 7일마다 만료 — 재실행하면 갱신. 구성원 배포는 §배포(TestFlight)로 한다.`로.

문제 해결 표에 3행 추가:
```markdown
| `release-mobile.sh`가 "작업 트리가 깨끗하지 않습니다"로 멈춤 | 릴리스는 커밋된 상태에서 재현 가능해야 한다 | 커밋하거나 `--allow-dirty` |
| `release-mobile.sh android`가 "이미 있습니다"로 멈춤 | 같은 `+N` 빌드의 APK가 버킷에 있음 | pubspec의 `+N`을 올린다(앱은 이 숫자로 새 버전을 판단) |
| Android에서 APK 설치 시 "앱이 설치되지 않았습니다" / 서명 불일치 | 기존 설치와 서명 키가 다름(디버그 빌드 위에 릴리스, 또는 키스토어 분실) | 기존 앱 삭제 후 설치. 키스토어는 1Password 백업본을 `mobile/android/`에 복원 |
```

- [ ] **Step 2: 규칙·메모리**

`.claude/rules/mobile.md` 14행의 "의존성은 pubspec의 11개뿐(…)— 추가는 스펙 변경으로."를 "의존성은 pubspec의 11개 + dev `flutter_launcher_icons`(아이콘 생성 전용, 2026-10-04 배포 스펙)뿐(…)— 추가는 스펙 변경으로."로 바꾸고, 20행 다음에 추가:
```markdown
- 배포(스펙 2026-10-04-mobile-release): 버전 출처는 `pubspec.yaml` `version: X.Y.Z+N` 하나 — 코드는 `Config.appVersion/appBuild`(`--dart-define`, 기본 `dev`/0 = 업데이트 확인 안 함). 릴리스는 `mobile/scripts/release-mobile.sh`로만(스토리지·`settings.mobile_release` 수동 편집 금지). `settings.mobile_release`는 플랫폼별 블록(`android`/`ios`) JSON, 읽기는 `GET /api/mobile/release`(user 이상, APK 600초 서명 URL). 웹 `/apps`는 카탈로그에 있지만 앱 Dart 카탈로그 `pages`에는 넣지 않는다. 아이콘은 CI 가이드 색(`#006cdb`)·모티프 — `Brand` 팔레트와 별개. `key.properties`·`*.jks`·`.env.release`는 gitignore, 비밀은 로그·문서에 남기지 않는다.
```

메모리 `/Users/seunguk.kang/.claude/projects/-Users-seunguk-kang-Repos-inje-playground/memory/mobile-app-status.md`에 배포 상태 단락 추가(결정 사항·사용자가 할 일 남은 것·키스토어 백업 필요), `MEMORY.md`의 모바일 줄 hook 갱신.

- [ ] **Step 3: 커밋·푸시·프론트 배포**

```bash
cd /Users/seunguk.kang/Repos/inje-playground && git add docs/mobile-app.md .claude/rules/mobile.md docs/superpowers/plans/2026-10-04-mobile-release.md && git commit -q -m "docs(mobile): 사내 배포 런북(최초 준비·매 릴리스·운영 주의·문제 해결) + 규칙

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" && git pull --rebase -q && git push -q && git log --oneline -1
cd /Users/seunguk.kang/Repos/inje-playground/frontend && vercel --prod 2>&1 | tail -3
```
Expected: 푸시 성공. Vercel 출력의 Production URL이 `inje-playground.vercel.app` alias로 연결(배포 URL은 `innogrid-playground-…` 또는 프로젝트 URL). 확인: `curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' https://inje-playground.vercel.app/apps` → `307 https://inje-playground.vercel.app/login?...`(로그인 리디렉션, 404 아님), `curl -s https://inje-playground.vercel.app/api/mobile/release` → `{"error":"인증이 필요합니다."}`.

---

### Task 8: Android 첫 릴리스(1.0.0+1)

**Files:** 코드 변경 없음. 스토리지 `mobile/android/innogrid-1.0.0+1.apk`, `settings.mobile_release`.

- [ ] **Step 1: 실행**

Run: `cd /Users/seunguk.kang/Repos/inje-playground && mobile/scripts/release-mobile.sh android --notes "첫 사내 배포 — 뭐 먹지·사다리·커피 타임·아마란스(미결 결재·출퇴근·일정·메일·게시판)"`
Expected: 게이트 통과 → `없음` → APK 빌드 크기 출력 → `완료` → `settings.mobile_release ← {"android": {"version": "1.0.0", "build": 1, "releasedAt": "…", "apkPath": "android/innogrid-1.0.0+1.apk"}, "notes": "…", "testflightUrl": null}` → 다음 할 일.

- [ ] **Step 2: 확인(Management API, 토큰 비출력)**

```bash
cd /Users/seunguk.kang/Repos/inje-playground && TOKEN=$(security find-generic-password -s "Supabase CLI" -w | sed 's/^go-keyring-base64://' | base64 -d) && printf '{"query":"select value from settings where key = %s; "}' "'mobile_release'" > /private/tmp/claude-501/-Users-seunguk-kang-Repos-inje-playground/bb6d601b-c764-46a3-9d46-f193bc34c6f6/scratchpad/q.json && curl -s -X POST "https://api.supabase.com/v1/projects/avooqcxehfeurjhqqgui/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @/private/tmp/claude-501/-Users-seunguk-kang-Repos-inje-playground/bb6d601b-c764-46a3-9d46-f193bc34c6f6/scratchpad/q.json; echo; printf '{"query":"select name, (metadata->>%s)::bigint as size from storage.objects where bucket_id = %s"}' "'size'" "'mobile'" > /private/tmp/claude-501/-Users-seunguk-kang-Repos-inje-playground/bb6d601b-c764-46a3-9d46-f193bc34c6f6/scratchpad/q.json && curl -s -X POST "https://api.supabase.com/v1/projects/avooqcxehfeurjhqqgui/database/query" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" --data-binary @/private/tmp/claude-501/-Users-seunguk-kang-Repos-inje-playground/bb6d601b-c764-46a3-9d46-f193bc34c6f6/scratchpad/q.json; rm -f /private/tmp/claude-501/-Users-seunguk-kang-Repos-inje-playground/bb6d601b-c764-46a3-9d46-f193bc34c6f6/scratchpad/q.json
```
Expected: 설정 1행(android 블록), 스토리지 1행 `android/innogrid-1.0.0+1.apk` 수십 MB.

- [ ] **Step 3: 재실행 가드 확인**

Run: `cd /Users/seunguk.kang/Repos/inje-playground && mobile/scripts/release-mobile.sh android 2>&1 | tail -2`
Expected: `android/innogrid-1.0.0+1.apk 가 이미 있습니다 — pubspec의 빌드 번호(+N)를 올리세요.` exit 1 (게이트 통과 뒤 멈춤; 빌드·업로드 안 함).

iOS 릴리스는 사용자가 App Store Connect 준비(앱 등록·외부 그룹·공개 링크·API 키·`.env.release`)를 마친 뒤 `release-mobile.sh ios --testflight-url <링크>`로 진행한다 — 이 계획의 범위 밖.
