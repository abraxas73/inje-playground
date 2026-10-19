# 데일리 브리핑 라이브 액티비티 (iOS 잠금 화면·다이내믹 아일랜드, Android 상시 알림)

2026-10-19 사용자 요청: "모바일 앱에 라이브 액티비티를 넣자. 데일리 브리핑 위주로, 다이내믹 아일랜드에는 알림 및 변경 사항이 파악됐을 때만."

## 결정
- **갱신은 기기 안에서만**(서버 푸시 없음). 아마란스 자격 증명은 기기 밖으로 나가지 않으므로 서버가 브리핑을 만들 수 없다.
- 앱 사용 중: 홈 브리핑(`briefingProvider`)이 새로 수집될 때마다 갱신.
- 앱 밖: `workmanager` 주기 작업(Android WorkManager 15분, iOS `BGAppRefreshTask` — 간격은 OS가 정함). **백그라운드는 아마란스만**(결재·메일·공지·오늘 일정) 수집한다. Supabase 세션을 백그라운드 엔진에서 열면 리프레시 토큰이 회전돼 앱 쪽이 로그아웃될 수 있어서 서버 API(Teams 멘션 등)는 부르지 않는다 — 그 값은 직전 값을 유지.
- 기간: 평일 KST 07:00~18:30. 그 밖이면 끝낸다. 더보기 스위치(기기 저장, 기본 켬)로 끌 수 있다.

## 표시
- 상태(`LiveBriefing`, 순수 Dart `lib/briefing/live_briefing.dart`): 다가오는 회의(아래 "변경" 참고), 결재·Teams 답장 대기·오늘 안 읽은 메일·새 공지 건수, 한 줄 헤드라인.
- 잠금 화면 / Android 상시 알림: 다음 회의 + 카운트다운(iOS `Text(timerInterval:)`, Android chronometer — 갱신 없이 줄어든다), 건수 한 줄.
- 다이내믹 아일랜드: compact는 아이콘 + 합계 숫자만. **변경이 감지되면** `AlertConfiguration`으로 펼쳐 "결재 1건 새로 도착" 등을 보여 준다. Android는 별도 heads-up 알림(10초 후 사라짐).
- 변경 = 결재·Teams·메일·공지 건수 **증가**(감소는 알리지 않음), 새 회의가 다음 회의로 들어옴은 알리지 않는다.

## 구성
- iOS: 위젯 확장 타깃 `BriefingLiveActivity`(iOS 16.2+, SwiftUI `ActivityConfiguration`), 공용 `BriefingActivityAttributes.swift`(Runner·확장 양쪽 멤버), 앱 쪽 `BriefingLiveActivityPlugin`(MethodChannel `innogrid/live_activity`: `update`·`end`) — 앱 엔진과 workmanager 백그라운드 엔진 양쪽에 등록. Info.plist `NSSupportsLiveActivities`, `BGTaskSchedulerPermittedIdentifiers`, `UIBackgroundModes: fetch`.
- Android: `flutter_local_notifications` 상시 알림(채널 `briefing_live`, 낮은 중요도)과 변경 알림(채널 `briefing_alert`, 높은 중요도). `POST_NOTIFICATIONS` 권한 요청.
- 새 의존성: `workmanager`.

## 변경 — 잠금 화면 줄 늘림 (2026-10-19 사용자 요청)
"잠금 화면 줄 수를 더 쓰고, 일정은 현재 시각 기준 다가오는 것만(10분 이내에 시작한 것 포함). 회의 2·결재 2·메일 2, 최대 5건. 맨 밑 일정·결재·메일 건수는 그대로."
- 회의: 시작이 **지금 − 10분 이후**인 것만(종일·근태 제외) — 오래전에 시작해 진행 중인 회의는 뺀다. 최대 2건, 각각 시작까지 카운트다운(이미 시작했으면 끝 시각).
- 결재: 대기 목록 앞 2건(제목·기안자). 메일: 오늘 안 읽은 메일 앞 2건(**제목·보낸 사람** — 본문은 싣지 않음. 기존 "메일 제목은 싣지 않는다"를 사용자 요청으로 바꿈).
- 줄 순서 회의 → 결재 → 메일, 종류별 2건 + **전체 5줄 상한**(셋 다 2건이면 마지막 메일이 빠진다). 맨 아래 건수 줄에 "일정 N"(다가오는 회의 전체 수)을 앞에 붙였다.
- iOS 잠금 화면 높이 상한(약 160pt)에 머리 줄 + 5줄 + 건수 줄이 들어가도록 글자·간격을 줄였다. 다이내믹 아일랜드는 그대로(첫 회의 + 건수). Android는 펼친 알림(InboxStyle)에 같은 줄 + 요약에 건수.

## 범위 밖
- 서버 푸시(APNs Live Activity push·FCM) — iOS 백그라운드 갱신 빈도가 부족하다고 확인되면 다음 단계.
- 데스크톱.
