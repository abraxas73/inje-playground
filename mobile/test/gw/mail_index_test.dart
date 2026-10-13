import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:playground/gw/mail_index.dart';

MailDoc doc(String muid, {String box = 'INBOX', String subject = '', String fromName = '', String fromEmail = '', String to = '', String date = '2026-10-01 09:00:00', bool seen = true, bool attach = false, String? body, List<String> files = const []}) =>
    MailDoc(muid: muid, box: box, subject: subject, fromName: fromName, fromEmail: fromEmail, to: to, cc: '', date: date, seen: seen, attach: attach, size: 0, body: body, files: files);

void main() {
  group('검색식 해석', () {
    test('단어는 AND, 따옴표는 구문, -는 제외, OR는 묶음', () {
      final q = parseMailQuery('회의 "10월 결산" -취소 a OR b');
      expect(q.groups.map((g) => g.map((t) => t.text).toList()).toList(), [['회의'], ['10월 결산'], ['a', 'b']]);
      expect(q.excludes.single.text, '취소');
    });
    test('필드 접두어(영문·한글)와 날짜·플래그', () {
      final q = parseMailQuery('from:홍길동 받는사람:"김 철수" subject:보고 본문:지연 file:pdf after:2026-9 before:2026/10/05 has:attach is:unread in:sent');
      expect(q.groups.map((g) => g.single.field).toList(), [MailField.from, MailField.to, MailField.subject, MailField.body, MailField.file]);
      expect(q.groups[1].single.text, '김 철수');
      expect((q.after, q.before), ('2026-09', '2026-10-05'));
      expect((q.attach, q.seen, q.box), (true, false, 'SENT'));
    });
    test('모르는 접두어는 그냥 글자, 잘못된 날짜는 무시, 빈 검색식', () {
      final q = parseMailQuery('http://x.com after:어제');
      expect(q.groups.single.single.text, 'http://x.com');
      expect(q.after, isNull);
      expect(parseMailQuery('   ').isEmpty, isTrue);
      expect(parseMailQuery('is:read').isEmpty, isFalse); // 플래그만 있어도 검색
    });
  });

  group('검색', () {
    final idx = MailIndex()
      ..upsertMeta(doc('1', subject: '10월 결산 회의', fromName: '홍길동', fromEmail: 'hong@innogrid.com', date: '2026-10-02 10:00:00', body: '결산 회의는 3층 회의실에서 합니다.\n참석 바랍니다.', files: ['결산자료.pdf']))
      ..upsertMeta(doc('2', subject: '회의 취소 안내', fromName: '김철수', fromEmail: 'kim@innogrid.com', date: '2026-09-30 10:00:00', body: '회의가 취소되었습니다', seen: false))
      ..upsertMeta(doc('3', box: 'SENT', subject: 'Re: 결산', fromName: '나', fromEmail: 'me@innogrid.com', to: '홍길동 <hong@innogrid.com>', date: '2026-10-03 10:00:00', attach: true, body: 'Meeting notes attached'));

    test('본문·제목·보낸 사람을 함께 찾고 최신순', () {
      expect(idx.search('회의').map((h) => h.doc.muid).toList(), ['1', '2']); // 3은 'Meeting'이라 안 맞음
      expect(idx.search('meeting').map((h) => h.doc.muid).toList(), ['3']); // 대소문자 무시
      expect(idx.search('회의 -취소').map((h) => h.doc.muid).toList(), ['1']);
      expect(idx.search('취소 OR notes').map((h) => h.doc.muid).toList(), ['3', '2']);
    });
    test('필드·날짜·플래그 필터', () {
      expect(idx.search('from:홍').map((h) => h.doc.muid).toList(), ['1']);
      expect(idx.search('to:hong@').map((h) => h.doc.muid).toList(), ['3']);
      expect(idx.search('subject:결산').map((h) => h.doc.muid).toList(), ['3', '1']);
      expect(idx.search('file:pdf').map((h) => h.doc.muid).toList(), ['1']);
      expect(idx.search('결산 after:2026-10-03').map((h) => h.doc.muid).toList(), ['3']);
      expect(idx.search('결산 before:2026-10-03').map((h) => h.doc.muid).toList(), ['1']);
      expect(idx.search('has:attach').map((h) => h.doc.muid).toList(), ['3']);
      expect(idx.search('is:unread').map((h) => h.doc.muid).toList(), ['2']);
      expect(idx.search('in:inbox 결산').map((h) => h.doc.muid).toList(), ['1']);
    });
    test('관련도순은 제목 일치가 본문 일치보다 앞', () {
      expect(idx.search('취소', byRelevance: true).first.doc.muid, '2');
      final hits = idx.search('결산', byRelevance: true);
      expect(hits.first.doc.muid, '1'); // 제목+본문+첨부 이름
    });
    test('발췌는 본문에서 첫 일치 주변, 없으면 앞부분', () {
      final h = idx.search('참석').single;
      expect(h.snippet, contains('참석 바랍니다'));
      expect(idx.search('subject:결산').last.snippet, startsWith('결산 회의는'));
      expect(matchRanges('회의 회의', h.terms), isEmpty);
      expect(matchRanges('참석! 참석', idx.search('참석').single.terms), [(0, 2), (4, 6)]);
    });
  });

  group('문서 갱신·저장', () {
    test('목록 갱신은 본문을 지우지 않고, 읽음 상태 변화만 변경으로 본다', () {
      final idx = MailIndex();
      expect(idx.upsertMeta(doc('1', subject: 'a', seen: false)), isTrue);
      idx.setDetail('1', body: '본문', to: '나', cc: '', files: ['x.txt'], date: '2026-10-01 09:00:00'); // 열어 봤으니 읽음
      expect(idx.upsertMeta(doc('1', subject: 'a', seen: true)), isFalse);
      expect(idx.upsertMeta(doc('1', subject: 'a', seen: false)), isTrue); // 안 읽음으로 되돌림
      expect((idx.docs['1']!.body, idx.docs['1']!.seen, idx.docs['1']!.to), ('본문', false, '나'));
      expect(idx.docs['1']!.files, ['x.txt']);
      expect(idx.bodies, 1);
    });
    test('본문은 10,000자에서 자르고 retain은 사라진 메일을 지운다', () {
      final idx = MailIndex()..upsertMeta(doc('1'))..upsertMeta(doc('2'))..upsertMeta(doc('3', box: 'SENT'));
      idx.setDetail('1', body: 'x' * 20000, to: '', cc: '', files: const [], date: '');
      expect(idx.docs['1']!.body!.length, 10000);
      idx.retain('INBOX', {'2'});
      expect(idx.docs.keys.toList(), ['2', '3']);
    });
    test('JSON 왕복', () {
      final idx = MailIndex()..upsertMeta(doc('1', subject: '제목', fromName: '홍', attach: true, body: '본문', files: ['a.pdf']));
      final back = MailIndex.fromJson(jsonDecode(idx.toJson()) as Map);
      final d = back.docs['1']!;
      expect((d.subject, d.fromName, d.attach, d.body, d.date), ('제목', '홍', true, '본문', '2026-10-01 09:00:00'));
      expect(d.files, ['a.pdf']);
      expect(MailIndex.fromJson(const {}).docs, isEmpty);
    });
    test('목록 행 → 문서(toItem 왕복)', () {
      final d = MailDoc.fromRow({'muid': 14865628, 'subject': 's', 'fromAddrName': '홍', 'fromAddrEmail': 'h@x.com', 'toAddrName': '나', 'toAddrEmail': 'me@x.com', 'rfc822date': '10-09 02:33', 'tooltipDate': '2026-10-09 02:33:09', 'seen': 1, 'attach': false, 'size': 10}, 'INBOX');
      expect((d.muid, d.to, d.date, d.seen, d.from), ('14865628', '나 <me@x.com>', '2026-10-09 02:33:09', true, '홍 <h@x.com>'));
      final i = d.toItem();
      expect((i.muid, i.subject, i.fromName, i.date, i.tooltip, i.seen), ('14865628', 's', '홍', '10-09 02:33', '2026-10-09 02:33:09', true));
    });
  });
}
