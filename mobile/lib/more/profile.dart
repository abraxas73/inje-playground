import 'dart:convert';
import 'dart:typed_data';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../api/client.dart';
import '../auth/session.dart';

String profileDisplayName({String? organizationName, String? accountName}) {
  for (final value in [organizationName, accountName]) {
    if (value != null && value.trim().isNotEmpty) return value.trim();
  }
  return '사용자';
}

final profilePhotoProvider = FutureProvider.autoDispose<Uint8List?>((ref) async {
  final session = ref.watch(sessionProvider).asData?.value;
  if (session == null || session.isGuest) return null;
  try {
    final result = await ref.watch(apiClientProvider).getJson('/api/users/profile/photo');
    final photo = result['photo'];
    return photo is String && photo.isNotEmpty ? base64Decode(photo) : null;
  } catch (_) {
    return null;
  }
});
