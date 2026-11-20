import 'package:flutter/material.dart';
import '../api/client.dart';

/// 로그인 팝업으로 띄울 설문(관리자가 '로그인 시 팝업'을 켠 진행 중 설문 중 내가 아직 참여하지 않은 것) — 데스크톱 앱만(2026-11-20, 모바일 제외).
typedef LoginSurvey = ({String slug, String title, bool anonymous});

/// `GET /api/surveys/login-prompt` 응답 → 띄울 설문(없으면 null)
LoginSurvey? loginSurveyFrom(Object? j) {
  final s = j is Map ? j['survey'] : null;
  if (s is! Map) return null;
  final slug = '${s['slug'] ?? ''}', title = '${s['title'] ?? ''}';
  return RegExp(r'^[a-z0-9][a-z0-9-]*$').hasMatch(slug) ? (slug: slug, title: title, anonymous: s['anonymous'] == true) : null;
}

Future<LoginSurvey?> fetchLoginSurvey(ApiClient api) async => loginSurveyFrom(await api.getJson('/api/surveys/login-prompt'));

/// 참여 요청 대화상자 — [참여하기]면 true. 바깥을 누르거나 [나중에]면 false(다음 로그인·앱 시작 때 다시).
Future<bool> showLoginSurveyDialog(BuildContext context, LoginSurvey s) async =>
    await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('설문 참여 요청'),
        content: Text('${s.title}\n\n잠시 시간을 내어 참여해 주세요.${s.anonymous ? ' 응답은 익명으로 집계됩니다.' : ''}'),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('나중에')),
          FilledButton(onPressed: () => Navigator.pop(ctx, true), child: const Text('참여하기')),
        ],
      ),
    ) ==
    true;
