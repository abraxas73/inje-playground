---
name: innocrew-app-testers
description: 이노크루 앱 사용 신청(웹 /admin/app-requests)의 신청 대기·처리 중 건을 처리한다 — iOS는 App Store Connect 초대(Customer Support·INNOGRID만) → 수락 확인 → TestFlight AX-Dev (Android는 2026-10-24 정식 출시로 신청을 받지 않는다), 끝나면 관리자 상태·안내 저장. "앱 신청 처리해", "모바일 앱 신청 들어온 것 처리", "테스터 등록" 요청 시 사용. 앱 빌드·릴리스·외부 테스트 심사에는 쓰지 않는다.
---

# 이노크루 앱 사용 신청 처리

신청 처리·후속 점검을 요청받으면 아래 순서대로 실제 플랫폼 등록과 관리자 상태 반영까지 끝낸다. 현황만 물으면 조회만 한다. 이미 받은 처리 권한을 다시 묻지 않는다. 원본 방침은 Codex 스킬 `~/.codex/skills/innocrew-app-testers/SKILL.md`이고, 이 문서는 2026-10-20 실측으로 다듬은 Claude용이다.

## 준비

- 브라우저는 ego-browser만 쓴다. 먼저 `ego-browser skill` 출력을 따른다. 목표당 TaskSpace 하나(이름 예: `innocrew app requests YYYYMMDD`), 끝나면 `finish({ keep: [] })`.
- iOS는 **브라우저 대신 API 도우미** `.claude/skills/innocrew-app-testers/asc.py`를 쓴다. ASC 웹 세션은 자주 끊기고 재로그인엔 사용자 비밀번호·2FA가 필요하다. 릴리스용 ASC API 키(Admin)로 조회·초대·AX-Dev 추가가 모두 된다. 실행은 `python3 -I .claude/skills/innocrew-app-testers/asc.py …`(저장소 루트에서). 키가 없는 워크트리여도 본 저장소(`~/Repos/inje-playground/mobile/.env.release`)를 찾아 쓴다.
- 고정 값: Apple 앱 INNOGRID `6818983333`, AX-Dev 그룹 `62fd9923-9909-4fa3-8a3a-3cd59801c9fc`. Play 내부 테스트 테스터 탭 `https://play.google.com/console/u/0/developers/9115286728049311811/app/4974351096970053750/tracks/internal-testing?tab=testers`, Android 참여 링크 `https://play.google.com/apps/internaltest/4701070333674267983`.

## 1. 신청 목록 읽기

ego 브라우저로 `https://innocrew.innogrid.com/admin/app-requests`(정식 주소 — 로그인 쿠키가 여기에 있다. 예전 `inje-playground.vercel.app`은 로그아웃으로 보여 401)를 연 뒤, 같은 페이지 세션으로 API를 부른다(폼보다 빠르고 정확하다).

```js
for (const s of ["pending", "processing"]) {
  const j = JSON.parse((await page.fetch(`/api/admin/app-requests?status=${s}&platform=all&page=0`)).body);
  console.log(s, j.total); for (const x of j.items) console.log(x.id, x.applicant?.name, x.platform, x.store_email, x.revision);
}
```

50건이 넘으면 `page=1…`도 읽는다. 신청한 **스토어 이메일**로만 작업한다(회사 메일·다른 플랫폼 메일로 대체 금지).

## 2. iOS

1. `asc.py status <신청 이메일들>`로 현재 상태를 본다. USER(수락함)·INVITE(수락 전, 앱 범위·만료)·AX-Dev 소속이 함께 나온다.
2. **아무 기록 없음** → `asc.py invite <email> <이름> <성>`. 역할은 Customer Support, 앱은 INNOGRID만으로 고정돼 있다. 다시 `status`로 앱 범위가 `INNOGRID` 하나인지 확인한다.
3. **INVITE(수락 전)** → 재발송하지 않는다. 만료(`expirationDate`, -07:00 표기 → +16시간이 KST)가 지났으면 `asc.py uninvite <id>` 후 다시 `invite`. 앱 범위가 INNOGRID 하나가 아니면 수락 전에는 고칠 수 없으니 같은 방식으로 지우고 다시 보낸다.
4. **USER(수락함)** → 앱이 `INNOGRID` 하나가 아니면 `asc.py scope <user id>`로 교체(사용자 결정 2026-10-20: 테스터는 INNOGRID만). AX-Dev에 없으면 `asc.py axdev <email> <이름> <성>`(201, state INVITED면 성공). TestFlight 설치 여부는 완료 조건이 아니다.
5. 관리자 상태: 초대만 보낸 사람은 `processing` + 수락 안내, AX-Dev까지 끝난 사람은 `approved`.

외부 TestFlight 그룹 추가·외부 심사 제출·빌드는 하지 않는다. 기존 사용자 계정은 삭제하지 않는다.

## 3. Android (2026-10-24부터 사용 안 함)

Android는 Google Play 정식 출시라 새 신청을 받지 않는다(API가 400으로 거부). 예전에 남은 android 대기·처리 중 건은 `approved` + "Google Play에서 이노크루 앱을 바로 설치해 주세요: https://play.google.com/store/apps/details?id=com.innogrid.playground" 안내로 닫는다. 아래는 기록용.


1. ego 브라우저로 위 테스터 탭을 연다. `이메일 목록 AX-TF 수정` 버튼이 숨은 것까지 **두 개 렌더될 수 있어** 셀렉터 클릭이 실패한다 — 보이는 것을 `evaluate`로 누른다.
   ```js
   await page.evaluate(() => [...document.querySelectorAll('button[aria-label="이메일 목록 AX-TF 수정"]')].find(b => b.getBoundingClientRect().width > 0).click());
   ```
2. `[role=grid][aria-label="추가된 이메일 주소"]` 목록을 먼저 읽고, 없을 때만 `input[aria-label="이메일 주소 추가"]`에 넣고 Enter. 추가 뒤 목록이 **기존 전부 + 새 이메일**인지 확인한 다음 "변경사항 저장".
3. "개발자 계정의 모든 앱에서 사용" 확인 창의 `저장`을 누른다(대화상자 안 버튼을 `evaluate`로).
4. 목록 표에서 AX-TF 인원 수가 늘었고 체크가 `true`로 남아 있는지 확인한다. 다른 목록·트랙 체크는 건드리지 않는다.
5. 관리자 상태 `approved` + 참여 링크 안내. SharePoint APK 링크로 안내하지 않는다.

## 4. 관리자 결과 저장

같은 페이지 세션에서 PATCH한다. `revision`은 1단계에서 읽은 값(어긋나면 409 → 다시 읽기).

```js
await page.fetch(`/api/admin/app-requests/${id}`, { method: "PATCH", headers: { "content-type": "application/json" },
  body: JSON.stringify({ revision, status: "processing" | "approved" | "rejected", note }) });
```

안내문은 신청자 설정 화면에 그대로 보인다. 내부 작업 기록·디버그 내용을 넣지 않는다.

- iOS 초대 후: `App Store Connect 초대를 발송했습니다(M월 D일). 신청하신 Apple 계정(<email>)으로 받은 초대 메일을 YYYY년 M월 D일 <시각> 전에 수락해 주세요(기한이 지나면 초대가 만료됩니다). 수락이 확인되면 TestFlight AX-Dev 내부 테스터 등록을 마무리하고 다시 안내드립니다.` (재초대면 앞에 "이전 초대가 만료되어")
- iOS 완료: `TestFlight AX-Dev 내부 테스터 등록을 완료했습니다. <email>으로 받은 TestFlight 초대 메일을 확인하고 TestFlight 앱에서 이노크루(INNOGRID) 앱을 설치해 주세요.`
- Android 완료: `Google Play 내부 테스트(AX-TF) 테스터로 등록했습니다. 신청하신 Google 계정(<email>)으로 로그인한 상태에서 아래 참여 링크를 열어 '테스트 참여'를 누른 뒤, Google Play에서 이노크루 앱을 설치해 주세요.` + 줄바꿈 + 참여 링크 + `다른 Google 계정으로 접속하면 테스트에 참여할 수 없습니다.`

마지막에 pending·processing 건수를 다시 읽어 확인한다.

## 중단 조건과 보고

- 수락 대기, 로그인·2FA 필요, 사용자에게 브라우저 제어가 넘어간 경우 그 건은 완료로 두지 않고 나머지를 먼저 끝낸다. 수락 대기 계정을 반복 재초대하거나 기다리지 않는다.
- 플랫폼 초대 메일 외에 Teams·메일로 따로 공지하지 않는다.
- 보고: 신규 건수, 등록 완료, 수락 대기(초대 만료 시각 KST), 다음 점검 시점. 관련 메모리 `app-tester-asc-invites.md`의 다음 점검 대상 목록을 갱신한다.
