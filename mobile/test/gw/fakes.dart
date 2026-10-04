import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/testing.dart';
import 'package:playground/gw/gw_client.dart';
import 'package:playground/gw/gw_creds.dart';

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
Widget gwScope({GwCreds? creds, required MockClient http, required Widget child}) => ProviderScope(
      key: UniqueKey(),
      overrides: [gwStoreProvider.overrideWithValue(FakeGwStore(creds)), gwHttpClientProvider.overrideWithValue(http)],
      child: MaterialApp(home: child),
    );
