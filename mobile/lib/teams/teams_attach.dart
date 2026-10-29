import 'dart:convert';
import 'package:file_picker/file_picker.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../api/client.dart';
import '../assistant/chat_api.dart' show PickedFile;

/// Teams 채팅 첨부 — 웹 lib/teams/chat-attach-client.ts와 같은 규칙. 그림(합계 3MB·4장)은 본문 그림으로, 나머지는 내 OneDrive에 직접 올려 첨부로(바이트는 우리 서버를 거치지 않는다).
const teamsInlineImagesMaxBytes = 3 * 1024 * 1024;
const teamsInlineImagesMax = 4;
const teamsUploadChunk = 10 * 320 * 1024; // OneDrive 업로드 세션 조각은 320KiB 배수
const _imageTypes = {'png': 'image/png', 'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp'};

/// 본문 그림 형식(확장자로) — 아니면 null
String? teamsInlineImageType(String name) {
  final dot = name.lastIndexOf('.');
  return dot < 0 ? null : _imageTypes[name.substring(dot + 1).toLowerCase()];
}

/// 앞에서부터 그림(형식·합계 3MB·4장 안)은 본문, 나머지는 파일
({List<PickedFile> images, List<PickedFile> files}) splitTeamsAttachments(List<PickedFile> picked) {
  final images = <PickedFile>[], files = <PickedFile>[];
  var total = 0;
  for (final f in picked) {
    if (teamsInlineImageType(f.name) != null && images.length < teamsInlineImagesMax && total + f.size <= teamsInlineImagesMaxBytes) {
      images.add(f);
      total += f.size;
    } else {
      files.add(f);
    }
  }
  return (images: images, files: files);
}

/// 업로드 세션 주소에 조각(Content-Range)으로 PUT — 마지막 응답의 driveItem id. 토큰 없이(세션 주소가 권한).
/// ponytail: 파일 전체를 메모리에 읽는다(상한 250MB) — 큰 파일이 잦으면 openRead 스트림으로.
Future<String> uploadTeamsFile(http.Client client, String uploadUrl, List<int> bytes) async {
  if (bytes.isEmpty) throw ApiException(400, '빈 파일은 보낼 수 없습니다.');
  for (var at = 0; at < bytes.length; at += teamsUploadChunk) {
    final end = at + teamsUploadChunk < bytes.length ? at + teamsUploadChunk : bytes.length;
    final res = await client.put(Uri.parse(uploadUrl), headers: {'Content-Range': 'bytes $at-${end - 1}/${bytes.length}'}, body: bytes.sublist(at, end));
    if (res.statusCode >= 300) throw ApiException(res.statusCode, '파일을 올리지 못했습니다 (${res.statusCode})');
    if (end == bytes.length) {
      final id = (jsonDecode(res.body) as Map?)?['id'];
      if (id is! String) throw ApiException(502, '올린 파일을 확인하지 못했습니다.');
      return id;
    }
  }
  throw ApiException(400, '빈 파일은 보낼 수 없습니다.');
}

/// 첨부 고르기(아무 형식, 여러 개) — 테스트에서 override.
final teamsAttachPickerProvider = Provider<Future<List<PickedFile>> Function()>((_) => () async {
  final files = await FilePicker.pickFiles();
  return [for (final f in files) (name: f.name, size: await f.xFile.length(), read: f.xFile.readAsBytes)];
});

/// 업로드 세션 PUT용(우리 API가 아닌 OneDrive 주소라 ApiClient를 쓰지 않는다) — 테스트에서 override.
final teamsUploadHttpProvider = Provider<http.Client>((_) => http.Client());
