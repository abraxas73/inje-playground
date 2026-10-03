// 웹 frontend/src/lib/page-access.ts PAGES·canUsePage와 같은 규칙. 웹 카탈로그가 바뀌면 여기도 맞춘다.
import '../auth/session.dart';

class PageEntry {
  const PageEntry(this.key, this.href, this.label, this.group, this.minRole);
  final String key, href, label, group, minRole;
}

const pages = <PageEntry>[
  PageEntry('food', '/food', '뭐 먹지', 'daily', 'guest'),
  PageEntry('ladder', '/ladder', '사다리', 'daily', 'guest'),
  PageEntry('team', '/team', '커피 타임', 'daily', 'guest'),
  PageEntry('survey', '/survey', '설문', 'daily', 'guest'),
  PageEntry('teams_chat', '/teams/chat', 'Teams 채팅', 'daily', 'user'),
  PageEntry('usage_code', '/usage/code', 'Claude Code', 'ai', 'user'),
  PageEntry('usage_chat', '/usage/chat', 'Claude 채팅', 'ai', 'user'),
  PageEntry('usage_perf', '/usage/perf', '성과', 'ai', 'user'),
  PageEntry('rfp', '/rfp', 'RFP 분석', 'work', 'user'),
  PageEntry('ppt', '/ppt', 'PPT 만들기', 'work', 'user'),
  PageEntry('people_news', '/people-news', '인사·부고', 'work', 'user'),
  PageEntry('marketing', '/marketing', '마케팅 Master DB', 'work', 'user'),
];
const defaultDenied = {'marketing'};

const adminPages = <PageEntry>[
  PageEntry('admin_users', '/admin/users', '사용자 관리', 'admin', 'admin'),
  PageEntry('admin_page_permissions', '/admin/page-permissions', '페이지 접근 권한', 'admin', 'admin'),
  PageEntry('admin_settings', '/admin/settings', '시스템 설정', 'admin', 'admin'),
  PageEntry('admin_guide', '/admin/guide', '가이드 관리', 'admin', 'admin'),
  PageEntry('admin_chat_history', '/admin/chat-history', '질의/응답 관리', 'admin', 'admin'),
  PageEntry('admin_surveys', '/admin/surveys', '설문 관리', 'admin', 'admin'),
  PageEntry('admin_claude_usage', '/admin/claude-usage', 'Claude Code 사용량', 'admin', 'admin'),
  PageEntry('admin_claude_chat', '/admin/claude-chat', 'Claude 사용량 (Chat/Cowork)', 'admin', 'admin'),
  PageEntry('admin_claude_cost', '/admin/claude-cost', '비용 관리', 'admin', 'admin'),
  PageEntry('admin_perf', '/admin/perf', '성과', 'admin', 'admin'),
  PageEntry('admin_directory', '/admin/directory', '조직/팀', 'admin', 'admin'),
  PageEntry('admin_rfp_catalog', '/admin/rfp-catalog', 'RFP 솔루션 카탈로그', 'admin', 'admin'),
  PageEntry('admin_ppt', '/admin/ppt', 'PPT 덱 관리', 'admin', 'admin'),
  PageEntry('admin_audit', '/admin/audit', 'Audit 로그', 'admin', 'admin'),
];

const _rank = {'guest': 0, 'user': 1, 'admin': 2};

bool canUsePage(AppSession s, PageEntry p) {
  if (s.isAdmin) return true;
  if ((_rank[s.role] ?? 0) < (_rank[p.minRole] ?? 0)) return false;
  final explicit = s.permissions[p.key];
  if (explicit != null) return explicit;
  return !defaultDenied.contains(p.key);
}

List<PageEntry> visiblePages(AppSession s) => pages.where((p) => canUsePage(s, p)).toList();
List<PageEntry> visibleAdminPages(AppSession s) => s.isAdmin ? adminPages : const [];
