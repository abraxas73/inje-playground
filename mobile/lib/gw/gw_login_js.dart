// 아마란스 로그인 페이지(#/login)에 주입하는 JS와 자동 입력 판단 — 순수 함수. DOM 구조는 2026-10-04 실측:
// 1단계 #reqLoginId + "다음"(submit), 2단계 #reqLoginPw + "로그인"(submit), 회사코드 #reqCompCd는 고정.
// OTP(인증수단 선택) 화면은 input.number 6칸. 페이지 viewport는 width=1280으로 박혀 있어 폰에서 작게 보인다.
import 'dart:convert';
import 'gw_login_store.dart';

/// 기기 폭으로 맞추고 고정 폭·휴대폰용 scale(2.5)을 해제한다. 작은 화면·키보드에서도 세로 스크롤을 허용한다.
/// 폭을 줄이면 하단 고정 저작권 문구("Copyright 2020. DOUZONE…")가 로그인 버튼을 덮으므로 숨긴다 —
/// 글자가 Copyright로 시작하고 입력칸·버튼이 들어 있지 않은 요소만, SPA가 다시 그려도 MutationObserver로 재적용.
const viewportFixJs = '''
(function(){var m=document.querySelector('meta[name=viewport]');if(!m){m=document.createElement('meta');m.name='viewport';document.head.appendChild(m);}m.setAttribute('content','width=device-width, initial-scale=1, minimum-scale=1');
var style=document.getElementById('__gwMobileLogin');
if(!style){style=document.createElement('style');style.id='__gwMobileLogin';document.head.appendChild(style);}
style.textContent=`@media(max-width:600px){
.logintype-A{min-width:0!important;overflow:auto!important;}
.logintype-A .userCustomBox,.logintype-A .corpArea{display:none!important;}
.logintype-A .loginBox{position:relative!important;width:100%!important;min-height:100%!important;top:auto!important;right:auto!important;bottom:auto!important;overflow:auto!important;}
.logintype-A .loginBox .loginForm{position:relative!important;left:auto!important;right:auto!important;top:auto!important;transform:none!important;width:calc(100% - 32px)!important;max-width:346px!important;margin:24px auto 80px!important;box-sizing:border-box!important;}
.logintype-A .loginBox .loginForm input{font-size:16px!important;box-sizing:border-box!important;max-width:100%!important;}
.logintype-A .loginBox .loginForm .textBox{position:relative!important;bottom:auto!important;margin-top:16px!important;}
}`;
function hide(){Array.prototype.forEach.call(document.body?document.body.querySelectorAll('*'):[],function(e){if(e.style.display!=='none'&&/^\\s*Copyright/i.test(e.textContent||'')&&!e.querySelector('input,button,form'))e.style.display='none';});}
hide();if(!window.__gwCopyHide&&document.body){window.__gwCopyHide=new MutationObserver(hide);window.__gwCopyHide.observe(document.body,{childList:true,subtree:true});}})();''';

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
