import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/testing.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';
import 'package:playground/gw/mail_indexer.dart';

class FakeGwStore extends GwCredsStore {
  FakeGwStore([this.creds]);
  GwCreds? creds;
  @override
  Future<GwCreds?> load() async => creds;
  @override
  Future<void> save(GwCreds c) async => creds = c;
  @override
  Future<void> clear() async => creds = null;
}

const testCreds = GwCreds(authToken: 'g|7|s', signKey: 'k', empName: '홍길동', email: 'hong@innogrid.com');

/// 매번 새 ProviderScope(UniqueKey) — 같은 자리에서 다시 pump해도 이전 상태를 재사용하지 않게.
Widget gwScope({GwCreds? creds, required MockClient http, required Widget child, List<dynamic> overrides = const [] /* ProviderScope.overrides 항목(Override는 riverpod이 내보내지 않는 타입) */}) => ProviderScope(
      key: UniqueKey(),
      overrides: [gwStoreProvider.overrideWithValue(FakeGwStore(creds)), gwHttpClientProvider.overrideWithValue(http), ...overrides],
      child: MaterialApp(home: child),
    );

/// 메일 검색 색인을 메모리에만(위젯 테스트는 FakeAsync라 실제 파일 IO가 끝나지 않는다).
class MemoryMailIndexStore extends MailIndexStore {
  final files = <String, String>{};
  @override
  Future<String?> read(String key) async => files[key];
  @override
  Future<void> write(String key, String json) async => files[key] = json;
  @override
  Future<void> wipe() async => files.clear();
}
