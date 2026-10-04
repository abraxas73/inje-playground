// 아마란스 로그인 페이지(#/login)에 주입하는 JS와 자동 입력 판단 — 순수 함수. DOM 구조는 2026-10-04 실측:
// 1단계 #reqLoginId + "다음"(submit), 2단계 #reqLoginPw + "로그인"(submit), 회사코드 #reqCompCd는 고정.
// OTP(인증수단 선택) 화면은 input.number 6칸. 페이지 viewport는 width=1280으로 박혀 있어 폰에서 작게 보인다.
import 'dart:convert';
import 'gw_login_store.dart';

/// viewport를 기기 폭으로. 페이지는 390px에서도 안 깨지는 유동 레이아웃(실측).
const viewportFixJs = '''
(function(){var m=document.querySelector('meta[name=viewport]');if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}m.setAttribute('content','width=device-width, initial-scale=1, maximum-scale=1');})();''';

/// 지금 화면에 보이는 것: 아이디칸/비밀번호칸(활성·보임)/OTP칸/오류 문구.
const probeJs = '''
(function(){function vis(e){if(!e||e.disabled)return false;var r=e.getBoundingClientRect();return r.width>0&&r.height>0;}
var id=document.querySelector('#reqLoginId');var pw=document.querySelector('#reqLoginPw');
var otp=Array.prototype.some.call(document.querySelectorAll('input.number'),function(e){var r=e.getBoundingClientRect();return r.width>0&&r.height>0;});
var err=Array.prototype.filter.call(document.querySelectorAll('p'),function(p){var r=p.getBoundingClientRect();return r.height>0&&r.width>0&&/비밀번호|아이디|오류|잘못|실패|일치/.test(p.innerText);}).map(function(p){return p.innerText.trim();}).join(' ').slice(0,80);
return JSON.stringify({hasId:vis(id),hasPw:vis(pw),hasOtp:otp,error:err});})();''';

/// React 입력칸에 값을 넣고(네이티브 setter + input 이벤트) 보이는 submit 버튼을 누른다.
String fillJs({required String selector, required String value, required String submitText}) => '''
(function(){var el=document.querySelector(${jsonEncode(selector)});if(!el)return 'no-field';
var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(el,${jsonEncode(value)});
el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
var btn=Array.prototype.find.call(document.querySelectorAll('button[type=submit]'),function(b){var r=b.getBoundingClientRect();return r.width>0&&b.innerText.trim()===${jsonEncode(submitText)};});
if(!btn)return 'no-button';setTimeout(function(){btn.click();},80);return 'ok';})();''';

class GwProbe {
  const GwProbe({required this.hasId, required this.hasPw, required this.hasOtp, required this.error});
  final bool hasId, hasPw, hasOtp;
  final String error;

  /// runJavaScriptReturningResult 결과. iOS는 JSON 문자열을 한 번 더 따옴표로 감싸 돌려줄 수 있다.
  static GwProbe? parse(Object? raw) {
    if (raw == null) return null;
    try {
      var v = jsonDecode(raw.toString());
      if (v is String) v = jsonDecode(v);
      if (v is! Map) return null;
      return GwProbe(hasId: v['hasId'] == true, hasPw: v['hasPw'] == true, hasOtp: v['hasOtp'] == true, error: (v['error'] ?? '').toString());
    } catch (_) {
      return null;
    }
  }
}

enum FillAction { none, fillId, fillPw, reveal }

/// 무엇을 할지. 오류·OTP·저장 정보 없음은 사람에게(reveal). 각 단계는 한 번만 채운다.
FillAction decideFill(GwProbe p, GwLogin? login, {required bool idDone, required bool pwDone}) {
  if (p.error.isNotEmpty || p.hasOtp) return FillAction.reveal;
  if (p.hasPw) {
    if (login == null || login.pw.isEmpty) return FillAction.reveal;
    return pwDone ? FillAction.none : FillAction.fillPw;
  }
  if (p.hasId) {
    if (login == null || login.id.isEmpty) return FillAction.reveal;
    return idDone ? FillAction.none : FillAction.fillId;
  }
  return FillAction.none;
}
