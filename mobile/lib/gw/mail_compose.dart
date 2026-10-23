import 'dart:convert';
import '../assistant/gw_assistant_api.dart' show composeFields, textToHtml;
import 'gw_api.dart';
import 'gw_client.dart';
import 'gw_mcp_api.dart';
import 'gw_models.dart' show htmlToText;

/// 메일 쓰기·답장·전체답장·전달 — 아마란스 웹 메일과 같은 흐름(웹 번들 `5080` compose·`5744` uploader·`main` makeMailHeader 분석).
/// - 작성 폼: mail014A01 {mailKind, uid(원본 muid), mailTo, mbox, viewFlag:noRead} → 서명·세션키 + 답장·전달이면 mailInfo(원본).
/// - 받는 사람·"Re: "/"FW: " 제목·인용문은 서버가 아니라 클라이언트가 채운다(웹과 같음).
/// - 발송: mail014A04 — 새 메일과 같은 필드에 mail_kind(re·reall·fw)·muid(원본)·mimeHeader(원본 헤더 JSON)·전달 첨부(fwFile·uidAuthList).
/// - 새로 붙인 파일은 mail014A06으로 올린 뒤 uidAuthList에 넣는다(웹 fnAttFileUpload와 같음).

enum MailKind {
  plain('plain'),
  reply('re'),
  replyAll('reall'),
  forward('fw');

  const MailKind(this.code);
  final String code;
  bool get answers => this != plain;
}

/// 작성 화면에 미리 채울 값.
typedef MailPrefill = ({String to, String cc, String subject, String quote, List<({String sn, String name})> originalFiles});

Map _m(Object? v) => v is Map ? v : const {};

/// 서명 HTML(head·html·body 껍데기 제거) — 작성 폼의 signature.
String mailSignatureHtml(Map init) => asStr(init['signature'])
    .replaceAll(RegExp(r'<head\b[^>]*>.*?</head>', caseSensitive: false, dotAll: true), '')
    .replaceAll(RegExp(r'</?(html|body)\b[^>]*>', caseSensitive: false), '');

/// 첨부 크기 표기(웹과 같은 "12.34 KB").
String mailSizeLabel(int n) => n < 1024 ? '$n Bytes' : n < 1 << 20 ? '${(n / 1024).toStringAsFixed(2)} KB' : '${(n / (1 << 20)).toStringAsFixed(2)} MB';

/// 원본 인용 머리 — 웹 makeMailHeader 그대로(첫 줄만 콜론 앞 공백 없음).
String mailQuoteHtml(Map mailInfo) {
  final dm = _m(mailInfo['decodeMime']);
  final body = _m(_m(mailInfo['mime'])['body']);
  String p(String s) => "<p style='color: rgb(0, 0, 0);'>$s</p>";
  final head = StringBuffer()
    ..write('${p('보내는사람: ${asStr(dm['from'])}')}<br/>')
    ..write('${p('받는사람 : ${asStr(dm['to'])}')}<br/>');
  if (dm['cc'] != null) head.write('${p('참조 : ${asStr(dm['cc'])}')}<br/>');
  head
    ..write('${p('보낸 날짜 : ${asStr(dm['date'])}')}<br/><br><br/>')
    ..write('${p('제목 : ${asStr(dm['subject'])}')}<br/><br><br/>');
  final orig = asStr(body['html']).isNotEmpty ? asStr(body['html']) : textToHtml(asStr(body['plain']));
  return '<br/><br/><hr dze_content_sep /><br/>$head$orig';
}

/// 주소 값 — 서버가 &lt;…&gt;로 이스케이프해 주면 풀고, 아니면 그대로(htmlToText는 <주소>를 태그로 보고 지운다).
String _addr(Object? v) {
  final s = asStr(v);
  return s.contains('&') ? htmlToText(s) : s.trim();
}

/// 주소 목록(쉼표)에서 내 주소가 든 항목을 뺀다.
String _withoutMe(String list, String myEmail) => list
    .split(',')
    .map((s) => s.trim())
    .where((s) => s.isNotEmpty && (myEmail.isEmpty || !s.toLowerCase().contains(myEmail.toLowerCase())))
    .join(', ');

/// 답장·전체답장·전달의 미리 채울 값(웹 mailKindSetting과 같음 — 접두어는 이미 있어도 붙인다).
MailPrefill mailPrefill(MailKind kind, Map init, {required String myEmail}) {
  final info = _m(init['mailInfo']);
  final dm = _m(info['decodeMime']);
  final subject = htmlToText(asStr(dm['subject']));
  final from = _addr(dm['from']);
  final files = [
    for (final f in (_m(info['mime'])['fileList'] as List? ?? const []).whereType<Map>())
      if (asStr(f['originalFileName']).isNotEmpty) (sn: asStr(f['fileSn']), name: asStr(f['originalFileName'])),
  ];
  final quote = kind.answers && info.isNotEmpty ? mailQuoteHtml(info) : '';
  return switch (kind) {
    MailKind.plain => (to: '', cc: '', subject: '', quote: '', originalFiles: const []),
    MailKind.reply => (to: from, cc: '', subject: 'Re: $subject', quote: quote, originalFiles: const []),
    MailKind.replyAll => (
        to: _withoutMe([from, _addr(dm['to'])].join(','), myEmail),
        cc: _withoutMe(_addr(dm['cc']), myEmail),
        subject: 'Re: $subject',
        quote: quote,
        originalFiles: const [],
      ),
    MailKind.forward => (to: '', cc: '', subject: 'FW: $subject', quote: quote, originalFiles: files),
  };
}

/// 본문 HTML = 내가 쓴 글 + 서명 + 원본 인용(웹 setMailContents 순서).
String mailBodyHtml(String text, {String signature = '', String quote = ''}) =>
    '${textToHtml(text)}${signature.isEmpty ? '' : '<br/><br/>$signature'}$quote';

extension GwMailCompose on GwApi {
  /// 작성 폼. 새 메일은 plain, 답장·전달은 원본 muid로(원본을 읽음 처리하지 않는 viewFlag noRead).
  Future<Map> mailComposeInit(MailKind kind, {String muid = '', String mailTo = '', String mbox = 'INBOX'}) async {
    if (kind == MailKind.plain) return composeInit();
    final d = await client.call('/mail/mail014A01', {
      'mailKind': kind.code, 'mailTo': mailTo, 'uid': muid, 'mbox': mbox, 'viewFlag': 'noRead', 'fromFlag': false, 'readType': '', 'domainSeq': '',
    });
    if (d is! Map || _m(d['mailInfo']).isEmpty) throw GwException(200, 0, '원본 메일을 열지 못했습니다');
    return d;
  }

  /// 보내기(mail014A04). 되돌릴 수 없다 — 화면에서 확인을 받은 뒤 부른다.
  /// [keepFiles]는 전달할 원본 첨부의 fileSn(전달만), [newFiles]는 새로 붙인 파일.
  Future<void> mailSendComposed({
    required MailKind kind,
    required Map init,
    required String to,
    String cc = '',
    String bcc = '',
    required String subject,
    required String html,
    List<String> keepFiles = const [],
    List<({String name, List<int> bytes})> newFiles = const [],
  }) async {
    final s = await client.session();
    final info = _m(init['mailInfo']);
    final origMuid = asStr(info['muid']);
    final fields = composeFields(init, fromName: s.empName, bodyAuth: '${s.emailAddr}|${client.creds().authToken}', to: to, cc: cc, subject: subject.trim().isEmpty ? '(제목없음)' : subject, html: html)
      ..['bcc'] = bcc
      ..['mail_kind'] = kind.code;
    if (kind.answers) {
      if (origMuid.isEmpty) throw GwException(200, 0, '원본 메일 번호가 없습니다');
      final header = _m(_m(info['mime'])['header']);
      fields
        ..['muid'] = origMuid
        ..['mimeHeader'] = header.isEmpty ? '' : jsonEncode(header);
    }
    final uid = <Map<String, Object?>>[];
    if (newFiles.isNotEmpty) {
      final up = await mailUpload([for (final f in newFiles) (f.name, f.bytes)]);
      if (up.length != newFiles.length) throw GwException(200, 0, '첨부 업로드에 실패했습니다');
      for (final f in up) {
        final n = asInt(f['fileSize']);
        uid.add({
          'fileClass': 'icon_${asStr(f['fileExtsn'])}', 'fileDeleteYN': 'Y', 'fileExtsn': asStr(f['fileExtsn']), 'fileId': asStr(f['fileId']), 'fileName': asStr(f['originalFileName']),
          'filePath': asStr(f['filePath']), 'filePublicYn': 'N', 'fileSize': mailSizeLabel(n), 'fileThumUrl': '', 'fileUrl': '', 'id': uid.length, 'link': 'N', 'modifyLocalAttach': 'N',
          'moduleGbn': 'MAIL', 'noConvertFileSize': n, 'title': '${asStr(f['originalFileName'])}${mailSizeLabel(n)}',
        });
      }
    }
    final fwNames = <String>[];
    if (kind == MailKind.forward && keepFiles.isNotEmpty) {
      final auth = await mailAuthKey(origMuid);
      for (final sn in keepFiles) {
        final r = await mailAttachInfo(auth, sn, forDraft: true);
        final n = asInt(r['fileSize']);
        fwNames.add(asStr(r['originalFileName']));
        uid.add({
          ...r, 'fileSn': sn, 'link': 'N', 'authKeyMap': auth, 'moduleGbn': 'MAIL', 'fileDeleteYN': 'Y', 'serverFile': 'Y',
          'fileClass': 'icon_${asStr(r['fileExtsn'])}', 'fileSize': mailSizeLabel(n), 'noConvertFileSize': n, 'id': uid.length,
        });
      }
    }
    if (uid.isNotEmpty) {
      fields
        ..['uidAuthList'] = jsonEncode(uid)
        ..['bigFileCnt'] = '${uid.length}';
    }
    if (fwNames.isNotEmpty) fields['fwFile'] = fwNames.join(',');
    dynamic r;
    try {
      r = await client.callMultipart('/mail/mail014A04', fields);
    } on GwException catch (e) {
      // 요청을 보낸 뒤 연결이 끊기면(status 0) 이미 발송됐을 수 있다 — 실패로 단정하지 않는다
      if (e is! GwUnauthorized && e.status == 0) throw GwException(0, -1, '발송 결과를 확인할 수 없습니다. 보낸편지함을 확인한 뒤 다시 보내세요');
      rethrow;
    }
    if (r is! Map || r['result'] != true) throw GwException(200, 0, '메일 발송에 실패했습니다');
  }
}

