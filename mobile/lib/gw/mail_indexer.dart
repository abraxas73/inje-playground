import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'package:crypto/crypto.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'gw_api.dart';
import 'gw_client.dart' show GwException, asInt;
import 'gw_creds.dart';
import 'gw_mcp_api.dart';
import 'gw_models.dart';
import 'mail_index.dart';

/// 메일 검색 색인의 수집·저장. 목록(mail003A01)은 받은·보낸 메일함을 500통씩 끝까지(증분 때는 바뀐 게 없는 페이지에서 멈춤),
/// 본문(mail002A01)은 이미 읽은 메일만 최신순으로 — 안 읽은 메일은 열지 않는다(서버가 읽음 처리). 본문 화면이 연 메일은 그 자리에서 색인.
/// 파일은 앱 지원 폴더 `mail_index/<계정 해시>.json`(기기 밖으로 나가지 않음), 연결 해제 때 지운다. 내용은 로그에 남기지 않는다.
class MailIndexStatus {
  const MailIndexStatus({this.available = true, this.loaded = false, this.syncing = false, this.docs = 0, this.bodies = 0, this.phase = '', this.lastSync, this.error, this.rev = 0});
  final bool available, loaded, syncing;
  final int docs, bodies, rev;
  final String phase;
  final DateTime? lastSync;
  final String? error;
  MailIndexStatus copyWith({bool? available, bool? loaded, bool? syncing, int? docs, int? bodies, String? phase, DateTime? lastSync, Object? error = _keep, int? rev}) => MailIndexStatus(
      available: available ?? this.available, loaded: loaded ?? this.loaded, syncing: syncing ?? this.syncing, docs: docs ?? this.docs, bodies: bodies ?? this.bodies, phase: phase ?? this.phase,
      lastSync: lastSync ?? this.lastSync, error: identical(error, _keep) ? this.error : error as String?, rev: rev ?? this.rev);
  static const _keep = Object();
}

typedef MailIndexDir = Future<Directory> Function();

/// 색인 파일 저장소 — 앱 지원 폴더 `mail_index/<키>.json`(임시 파일 → rename). 위젯 테스트처럼 플랫폼 채널이 없으면 read가 던져 색인 비활성(네트워크 호출 없음).
class MailIndexStore {
  MailIndexStore([MailIndexDir? dir]) : _dir = dir ?? (() async => Directory('${(await getApplicationSupportDirectory()).path}/mail_index'));
  final MailIndexDir _dir;
  Future<File> _file(String key) async => File('${(await _dir()).path}/$key.json');
  Future<String?> read(String key) async {
    final f = await _file(key);
    return await f.exists() ? f.readAsString() : null;
  }
  Future<void> write(String key, String json) async {
    final f = await _file(key);
    await f.parent.create(recursive: true);
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsString(json, flush: true);
    await tmp.rename(f.path);
  }
  Future<void> wipe() async {
    final d = await _dir();
    if (await d.exists()) await d.delete(recursive: true);
  }
}

final mailIndexStoreProvider = Provider<MailIndexStore>((_) => MailIndexStore());

final mailIndexProvider = NotifierProvider<MailIndexNotifier, MailIndexStatus>(MailIndexNotifier.new);

class MailIndexNotifier extends Notifier<MailIndexStatus> {
  MailIndex? _index;
  String? _key;
  Future<bool>? _loading;
  bool _syncing = false;
  static const staleAfter = Duration(minutes: 10), pageSize = 500, bodyGap = Duration(milliseconds: 80), saveEvery = 25;

  @override
  MailIndexStatus build() {
    ref.listen(gwProvider, (prev, next) {
      if (prev?.value?.creds != null && next.value?.creds == null) unawaited(wipe());
    });
    return const MailIndexStatus();
  }

  /// 계정별 파일을 읽는다(한 번). 저장 폴더를 못 얻으면 false(비활성).
  Future<bool> ensureLoaded(GwApi api) {
    final c = api.client.creds();
    final key = sha256.convert(utf8.encode(c.email ?? c.empSeq)).toString().substring(0, 24);
    if (_key == key && _index != null) return Future.value(true);
    if (_key == key && _loading != null) return _loading!;
    _key = key;
    _index = null;
    return _loading = () async {
      try {
        final raw = await ref.read(mailIndexStoreProvider).read(key);
        var idx = MailIndex();
        if (raw != null) {
          try {
            idx = MailIndex.fromJson(jsonDecode(raw) as Map);
          } catch (_) {
            idx = MailIndex(); // 깨진 파일은 버리고 다시 만든다
          }
        }
        if (_key != key || !ref.mounted) return false;
        _index = idx;
        state = state.copyWith(available: true, loaded: true, docs: idx.docs.length, bodies: idx.bodies, rev: state.rev + 1);
        return true;
      } catch (_) {
        if (ref.mounted && _key == key) state = state.copyWith(available: false, loaded: true, phase: '저장 위치를 얻지 못했습니다');
        return false;
      } finally {
        _loading = null;
      }
    }();
  }

  Future<void> syncIfStale(GwApi api) async {
    final last = state.lastSync;
    if (_syncing || last != null && DateTime.now().difference(last) < staleAfter) return;
    await sync(api);
  }

  /// 목록 → 본문 순서. [full]이면 모든 페이지를 읽고 사라진 메일을 뺀다.
  Future<void> sync(GwApi api, {bool full = false}) async {
    if (_syncing) return;
    _syncing = true;
    state = state.copyWith(syncing: true, phase: '목록 읽는 중', error: null);
    try {
      if (!await ensureLoaded(api)) return;
      final idx = _index!;
      for (final box in const ['INBOX', 'SENT']) {
        int seq;
        try {
          seq = await api.mailboxSeq(box);
        } on GwException {
          if (box == 'INBOX') rethrow;
          continue; // 보낸편지함 이름이 다른 계정
        }
        final seen = <String>{};
        var page = 1, complete = false;
        while (true) {
          final d = await api.mailListAt(box, seq, pageSize: pageSize, page: page);
          final recs = (d is Map ? d['Records'] : null) as List? ?? const [];
          var changed = 0;
          for (final r in recs) {
            if (r is! Map) continue;
            final doc = MailDoc.fromRow(r, box);
            if (doc.muid.isEmpty) continue;
            seen.add(doc.muid);
            if (idx.upsertMeta(doc)) changed++;
          }
          final total = asInt(d is Map ? d['TotalRecordCount'] : null);
          if (recs.length < pageSize || total > 0 && page * pageSize >= total) {
            complete = true;
            break;
          }
          if (!full && changed == 0) break; // 이 페이지에 바뀐 게 없으면 더 오래된 페이지도 그대로
          page++;
        }
        if (complete) idx.retain(box, seen);
        _publish(phase: '목록 읽는 중');
      }
      await _save();
      final pending = idx.docs.values.where((d) => d.seen && d.body == null).toList()..sort((a, b) => b.date.compareTo(a.date));
      var n = 0;
      for (final d in pending) {
        if (!ref.mounted || !identical(idx, _index)) return;
        _publish(phase: '본문 읽는 중 ${n + 1}/${pending.length}');
        try {
          _apply(idx, d.muid, await api.readMail(d.muid));
        } on GwException catch (e) {
          if (e.status == 401) rethrow;
          idx.setDetail(d.muid, body: '', to: '', cc: '', files: const [], date: ''); // 한 통 실패는 건너뛰고 다시 시도하지 않는다
        }
        if (++n % saveEvery == 0) await _save();
        await Future<void>.delayed(bodyGap);
      }
      await _save();
      if (ref.mounted) state = state.copyWith(lastSync: DateTime.now());
    } catch (e) {
      if (ref.mounted) state = state.copyWith(error: e is GwException ? e.message : '동기화하지 못했습니다');
    } finally {
      _syncing = false;
      if (ref.mounted) state = state.copyWith(syncing: false, phase: '', docs: _index?.docs.length ?? 0, bodies: _index?.bodies ?? 0, rev: state.rev + 1);
    }
  }

  /// 본문 화면이 연 메일(이미 서버에서 읽음 처리됨)을 그 자리에서 색인.
  Future<void> putDetail(GwApi api, MailItem item, MailDetail d) async {
    if (!await ensureLoaded(api)) return;
    final idx = _index!;
    idx.upsertMeta(MailDoc(muid: item.muid, box: 'INBOX', subject: item.subject, fromName: item.fromName, fromEmail: item.fromEmail, to: '', cc: '', date: item.tooltip.isNotEmpty ? item.tooltip : item.date, seen: true, attach: item.attach, size: 0));
    idx.setDetail(item.muid, body: d.body, to: d.to, cc: d.cc, files: [for (final f in d.attachments) f.name], date: d.date);
    _publish();
    await _save();
  }

  /// 앱에서 지운 메일을 검색 색인에서도 뺀다(다음 동기화를 기다리지 않게).
  Future<void> remove(String muid) async {
    final idx = _index;
    if (idx == null) return;
    idx.remove(muid);
    _publish();
    await _save();
  }

  static void _apply(MailIndex idx, String muid, MailDetail d) => idx.setDetail(muid, body: d.body, to: d.to, cc: d.cc, files: [for (final f in d.attachments) f.name], date: d.date);

  List<MailHit> search(String query, {bool byRelevance = false}) => _index?.search(query, byRelevance: byRelevance) ?? const [];

  /// 화면 밖(MCP 도구)에서 읽는 현재 상태.
  MailIndexStatus get status => state;

  /// 색인 파일을 지운다(연결 해제·사용자 요청).
  Future<void> wipe() async {
    _index = null;
    _key = null;
    try {
      await ref.read(mailIndexStoreProvider).wipe();
    } catch (_) {}
    if (ref.mounted) state = const MailIndexStatus();
  }

  void _publish({String? phase}) {
    if (ref.mounted) state = state.copyWith(phase: phase, docs: _index?.docs.length ?? 0, bodies: _index?.bodies ?? 0, rev: state.rev + 1);
  }

  Future<void> _save() async {
    final idx = _index, key = _key;
    if (idx == null || key == null) return;
    try {
      await ref.read(mailIndexStoreProvider).write(key, idx.toJson());
    } catch (_) {}
  }
}
