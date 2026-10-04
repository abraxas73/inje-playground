import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';
import '../app/brand.dart';
import '../app/theme.dart';
import '../auth/session.dart';
import 'catalog.dart';

/// 페이지 아이콘·한 줄 설명(카탈로그 key 기준). 사내 서비스 카드와 하단 바 부채꼴 메뉴가 같이 쓴다.
const serviceMeta = <String, (IconData, String)>{
  'food': (Icons.restaurant, '주변 식당·카페'),
  'ladder': (Icons.stairs, '순서·당번 정하기'),
  'team': (Icons.coffee, '팀 나누기·법카'),
  'survey': (Icons.poll_outlined, '진행 중인 설문 응답'),
  'teams_chat': (Icons.forum_outlined, '지정 그룹 채팅 읽기·보내기'),
  'usage_code': (Icons.terminal, 'Claude Code 사용량'),
  'usage_chat': (Icons.chat_bubble_outline, 'Chat·Cowork 사용량'),
  'usage_perf': (Icons.insights_outlined, '개발 성과 지표'),
  'rfp': (Icons.description_outlined, '제안요청서 분석·매핑'),
  'ppt': (Icons.slideshow_outlined, '원고 → 표준 템플릿'),
  'people_news': (Icons.newspaper_outlined, '인사·부고 소식'),
  'marketing': (Icons.campaign_outlined, 'Master DB 조회'),
  'gw_approvals': (Icons.fact_check_outlined, '미결 문서'),
  'gw_attendance': (Icons.timer_outlined, '출근·퇴근 기록'),
  'gw_today': (Icons.event_outlined, '일정·회의실'),
  'gw_mail': (Icons.mail_outline, '받은메일 미읽음'),
  'gw_board': (Icons.article_outlined, '공지·새 글'),
};
const nativeTabKeys = {'food', 'ladder', 'team'};
/// 홈 "바로 가기"에 따로 나오는 것(네이티브 탭 3개 + Teams 채팅) — 사내 서비스 그리드에서는 뺀다.
const quickKeys = {...nativeTabKeys, 'teams_chat'};
const teamsChatEntry = PageEntry('teams_chat', '/teams/chat', 'Teams 채팅', 'work', 'user');

List<PageEntry> webServices(AppSession s) => visiblePages(s).where((p) => !quickKeys.contains(p.key)).toList();

/// 웹 기능(WebView로 여는 것) 2열 카드 그리드.
class ServiceGrid extends StatelessWidget {
  const ServiceGrid({super.key, required this.session});
  final AppSession session;
  @override
  Widget build(BuildContext context) {
    final services = webServices(session);
    if (services.isEmpty) return const SizedBox.shrink();
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      childAspectRatio: 1.45,
      children: [for (final p in services) _card(context, p)],
    );
  }

  Widget _card(BuildContext context, PageEntry p) {
    final (icon, desc) = serviceMeta[p.key] ?? (Icons.open_in_new, '웹에서 열기');
    return Card(
      child: InkWell(
        onTap: () => context.push('/web?path=${Uri.encodeComponent(p.href)}'),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            TintIcon(icon, size: 36, background: Brand.tintFor(p.key), color: Brand.navy),
            const Spacer(),
            Text(p.label, style: const TextStyle(fontSize: 14, fontWeight: FontWeight.w700), maxLines: 1, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 2),
            Text(desc, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontSize: 12), maxLines: 1, overflow: TextOverflow.ellipsis),
          ]),
        ),
      ),
    );
  }
}
