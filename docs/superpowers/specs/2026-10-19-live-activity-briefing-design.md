# 데일리 브리핑 라이브 액티비티 (iOS 잠금 화면·다이내믹 아일랜드, Android 상시 알림)

2026-10-19 사용자 요청: "모바일 앱에 라이브 액티비티를 넣자. 데일리 브리핑 위주로, 다이내믹 아일랜드에는 알림 및 변경 사항이 파악됐을 때만."

## 결정
- **갱신은 기기 안에서만**(서버 푸시 없음). 아마란스 자격 증명은 기기 밖으로 나가지 않으므로 서버가 브리핑을 만들 수 없다.
- 앱 사용 중: 홈 브리핑(`briefingProvider`)이 새로 수집될 때마다 갱신.
- 앱 밖: `workmanager` 주기 작업(Android WorkManager 15분, iOS `BGAppRefreshTask` — 간격은 OS가 정함). **백그라운드는 아마란스만**(결재·메일·공지·오늘 일정) 수집한다. Supabase 세션을 백그라운드 엔진에서 열면 리프레시 토큰이 회전돼 앱 쪽이 로그아웃될 수 있어서 서버 API(Teams 멘션 등)는 부르지 않는다 — 그 값은 직전 값을 유지.
- 기간: 평일 KST 07:00~18:30. 그 밖이면 끝낸다. 더보기 스위치(기기 저장, 기본 켬)로 끌 수 있다.

## 표시
- 상태(`LiveBriefing`, 순수 Dart `lib/briefing/live_briefing.dart`): 다음 회의(제목·시작·끝 — 종일·근태 제외, 끝나지 않은 첫 회의), 결재·Teams 답장 대기·오늘 안 읽은 메일·새 공지 건수, 한 줄 헤드라인.
- 잠금 화면 / Android 상시 알림: 다음 회의 + 카운트다운(iOS `Text(timerInterval:)`, Android chronometer — 갱신 없이 줄어든다), 건수 한 줄.
- 다이내믹 아일랜드: compact는 아이콘 + 합계 숫자만. **변경이 감지되면** `AlertConfiguration`으로 펼쳐 "결재 1건 새로 도착" 등을 보여 준다. Android는 별도 heads-up 알림(10초 후 사라짐).
- 변경 = 결재·Teams·메일·공지 건수 **증가**(감소는 알리지 않음), 새 회의가 다음 회의로 들어옴은 알리지 않는다.

## 구성
- iOS: 위젯 확장 타깃 `BriefingLiveActivity`(iOS 16.2+, SwiftUI `ActivityConfiguration`), 공용 `BriefingActivityAttributes.swift`(Runner·확장 양쪽 멤버), 앱 쪽 `BriefingLiveActivityPlugin`(MethodChannel `innogrid/live_activity`: `update`·`end`) — 앱 엔진과 workmanager 백그라운드 엔진 양쪽에 등록. Info.plist `NSSupportsLiveActivities`, `BGTaskSchedulerPermittedIdentifiers`, `UIBackgroundModes: fetch`.
- Android: `flutter_local_notifications` 상시 알림(채널 `briefing_live`, 낮은 중요도)과 변경 알림(채널 `briefing_alert`, 높은 중요도). `POST_NOTIFICATIONS` 권한 요청.
- 새 의존성: `workmanager`.

## 범위 밖
- 서버 푸시(APNs Live Activity push·FCM) — iOS 백그라운드 갱신 빈도가 부족하다고 확인되면 다음 단계.
- 데스크톱.
