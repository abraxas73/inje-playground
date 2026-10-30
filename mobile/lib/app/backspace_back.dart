import 'dart:async';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';

/// 데스크톱: 글 입력 중이 아닐 때 Backspace(보조 키 없이) = 뒤로 가기. 안드로이드 뒤로 버튼과 같은 경로(popRoute)라
/// 대화상자는 닫히고, 웹 화면처럼 PopScope로 뒤로 가기를 직접 다루는 화면은 그 처리를 따른다. WebView 안 키 입력은 여기로 오지 않는다.
bool handleBackspaceBack(KeyEvent e, RouterDelegate<Object> delegate) {
  if (e is! KeyDownEvent || e.logicalKey != LogicalKeyboardKey.backspace) return false;
  final k = HardwareKeyboard.instance;
  if (k.isMetaPressed || k.isControlPressed || k.isAltPressed || k.isShiftPressed) return false;
  final ctx = FocusManager.instance.primaryFocus?.context;
  if (ctx != null && (ctx.widget is EditableText || ctx.findAncestorWidgetOfExactType<EditableText>() != null || ctx.findAncestorWidgetOfExactType<KeepBackspace>() != null)) return false;
  unawaited(delegate.popRoute());
  return true;
}

/// 이 아래에 포커스가 있으면 Backspace를 뒤로 가기로 쓰지 않는다(키가 Flutter로도 오는 WebView 등).
class KeepBackspace extends StatelessWidget {
  const KeepBackspace({super.key, required this.child});
  final Widget child;
  @override
  Widget build(BuildContext context) => child;
}
