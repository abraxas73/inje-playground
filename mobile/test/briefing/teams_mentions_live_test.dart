import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/api/client.dart';
import 'package:playground/briefing/briefing_provider.dart';
import 'briefing_provider_test.dart' show AppApi;

void main() {
  test('Teams 답장 대기만 따로 다시 읽는다(2분 주기) — 처음엔 null(브리핑 값 사용), 읽으면 최신 값', () async {
    final app = AppApi({'/api/teams/mentions': (200, {'connected': true, 'items': []})});
    final c = ProviderContainer(overrides: [apiClientProvider.overrideWithValue(app.client)]);
    addTearDown(c.dispose);
    final sub = c.listen(teamsMentionsLiveProvider, (_, _) {});
    addTearDown(sub.close);
    expect(c.read(teamsMentionsLiveProvider), isNull);
    expect(TeamsMentionsLive.every, const Duration(minutes: 2));
    await c.read(teamsMentionsLiveProvider.notifier).poll();
    expect(app.calls['/api/teams/mentions'], 1);
    expect(c.read(teamsMentionsLiveProvider)?.connected, isTrue);
  });
}
