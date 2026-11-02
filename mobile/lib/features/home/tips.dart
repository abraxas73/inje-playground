// 데스크톱 홈 머리줄의 "Tip!" 한 줄 — 잘 모를 만한 기능을 하나씩, [다음]으로 넘긴다. 시작 팁은 실행마다 무작위.
import 'dart:math' as math;
import 'package:flutter/material.dart';
import '../../app/theme.dart';

const appTips = [
  '텍스트를 드래그하면 클립보드에 복사하거나 할 일로 등록할 수 있습니다.',
  '메일 제목 옆 할 일 버튼을 누르면 그 제목이 바로 할 일로 등록됩니다.',
  '일정 일간 보기의 회의실 타임라인에서 빈 칸을 누르면 그 회의실·시각으로 바로 예약합니다.',
  '일정은 일간·주간·월간으로 바꿔 볼 수 있고, 월간에서 날짜를 누르면 그날로 갑니다.',
  'Dooray를 연결하면 아마란스 일정과 Dooray 일정이 한 캘린더에 함께 보입니다.',
  '일정 화면의 "추가"를 누르면 이노봇이 일정 등록을 도와줍니다.',
  '"홈 편집"에서 위젯 손잡이를 끌어 옮기고, 오른쪽 아래 모서리로 크기를 바꿀 수 있습니다.',
  '홈 편집 툴바의 "자동 배열"은 위젯 사이 빈 줄을 없애 줍니다.',
  '홈 편집 툴바의 "템플릿"으로 배치를 고르거나, 내 배치를 이름 붙여 공유할 수 있습니다.',
  '위젯 ⋮ 메뉴에서 Always On을 켜면 그 위젯이 모든 화면 위에 떠 있습니다.',
  '화면 제목 옆 ☆를 누르면 즐겨찾기에 담기고, 이노봇 위 ★에서 바로 엽니다.',
  '종 버튼 하나로 메신저 멘션·새 대화·미결 결재·안 읽은 메일·Teams 멘션을 모아 봅니다.',
  '이노봇 창은 머리글을 끌어 옮길 수 있고, 다음에 열 때 그 자리에 뜹니다.',
  '이노봇에게 "메신저 안 읽은 방 요약해 줘"처럼 아마란스 메신저를 맡길 수 있습니다.',
  '이노봇이 메신저 보내기·일정 등록 같은 쓰기 작업을 할 때는 확인 카드에서 승인해야 실행됩니다.',
  '이노봇 입력창의 🎤로 말로 묻고, 답 옆 🔊로 읽어 달라고 할 수 있습니다.',
  '메신저 입력창에서 ⌘V(Ctrl+V)로 복사한 그림·파일을 바로 보낼 수 있습니다.',
  '메신저에 링크를 보내면 말풍선 아래에 페이지 미리보기 카드가 붙습니다.',
  '메신저 새 대화는 사내 명부에서 고르면 1:1은 기존 방을, 여럿은 새 그룹방을 엽니다.',
  '메신저 검색은 대화방 이름·구성원과 대화 내용을 함께 찾아 줍니다.',
  '메신저 상세 위젯은 홈에서 대화방 목록부터 대화까지 위젯 안에서 이어집니다.',
  '메일 쓰기에서 그림을 붙여 넣으면 본문 커서 자리에 그대로 들어갑니다.',
  '메일 검색은 from: subject: has:attach is:unread 같은 검색식을 지원합니다.',
  '메일 화면에서 답장·전체답장·전달을 하고, 전달할 때 원본 첨부도 함께 보냅니다.',
  'Teams 채팅 위젯의 🔍로 대화 내용을 검색하면 그 메시지 자리로 바로 갑니다.',
  'Teams 메시지 아래 😊+ 버튼으로 반응을 붙이고, 칩을 다시 누르면 뗍니다.',
  'Teams 채팅 입력줄의 📎로 그림·파일을 보낼 수 있습니다.',
  '근태 화면에서 우리팀·우리센터·우리본부를 골라 이번 주 부재를 한눈에 봅니다.',
  '할 일 매트릭스에서 카드를 끌어 다른 분면에 놓으면 그 분면으로 분류됩니다.',
  '지난 할 일은 하루 한 번 오늘로 이월할지 물어봅니다.',
  '데스크톱 앱을 켜 두면 claude.ai의 INNOGRID 커넥터로 Claude가 아마란스를 쓸 수 있습니다.',
  '데스크톱 앱이 켜져 있으면 웹에서도 아마란스 메일·결재·일정을 볼 수 있습니다.',
  '아마란스 화면은 머리글의 새로고침 버튼으로 최신 내용을 다시 불러옵니다.',
  '더보기 > 화면 테마에서 다크 모드를 고를 수 있습니다.',
  '떠 있는 이노봇 버튼을 숨겼다면 하단 바 오른쪽 아이콘으로 다시 꺼낼 수 있습니다.',
  '홈 머리줄의 조직도 버튼으로 부서 트리와 직원 목록을 바로 엽니다.',
];

class TipLine extends StatefulWidget {
  const TipLine({super.key, this.tips = appTips, this.start});
  final List<String> tips;
  final int? start; // 테스트용 고정 시작
  @override
  State<TipLine> createState() => _TipLineState();
}

class _TipLineState extends State<TipLine> {
  late int _i = widget.start ?? math.Random().nextInt(widget.tips.length);

  @override
  Widget build(BuildContext context) => Row(children: [
        const Icon(Icons.lightbulb_outline, size: 16, color: Brand.blue),
        const SizedBox(width: 6),
        const Text('Tip!', style: TextStyle(fontSize: 13, fontWeight: FontWeight.w700, color: Brand.blue)),
        const SizedBox(width: 6),
        Flexible(
          child: Tooltip(
            message: widget.tips[_i],
            child: Text(widget.tips[_i], key: const ValueKey('tip-text'), maxLines: 1, overflow: TextOverflow.ellipsis, style: TextStyle(fontSize: 13, color: Brand.navy)),
          ),
        ),
        TextButton(onPressed: () => setState(() => _i = (_i + 1) % widget.tips.length), child: const Text('다음')),
      ]);
}
